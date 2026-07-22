import type { GitConflictVersions } from 'electron-core-ui'
import type { FolderItem } from '../types/folderTypes'
import type { ApiDocumentation } from '../types/apiDocumentation'
import { flattenEntities, ownFieldsSnapshot, parseProjectYaml, type GitEntityKind } from './gitCommitDiff'

export interface ConflictEntity {
  id: string
  kind: GitEntityKind
  name: string
  /** Our local version of the entity (the working tree's stage `:2`). */
  ours: FolderItem
  /** The remote's version of the entity (stage `:3`). */
  theirs: FolderItem
  /** The common-ancestor version, if the merge base still had it (stage
   * `:1` — `null` for an add/add conflict, which has none). Exposed for a
   * future 3-way resolution refinement; the v1 4-panel view only shows
   * ours/theirs/resolved. */
  base: FolderItem | null
  /** Ancestor folder names, root-first, self excluded (from OUR tree —
   * both sides share the id, and a same-entity move is not a conflict this
   * model surfaces). Feeds the modal's read-only breadcrumb band. */
  pathSegments: string[]
  /** Set when this entry is a saved quick-config of the request rather
   * than the request itself. A quick-config is a snapshot of the whole
   * request configuration, so it is compared and resolved through the
   * SAME request diff UI — `ours`/`theirs` here are the request as that
   * config leaves it, not the request's own live fields. The name is what
   * the list and the header line show, so the user knows which of the
   * request's configs is being arbitrated. */
  quickConfigName?: string
  /** Set on the single "tree structure" entry: the ids that sit in a
   * different folder on each side. The panel outlines exactly these in
   * both trees, so the user sees WHICH items moved rather than being
   * asked to compare two whole hierarchies by eye. */
  movedItemIds?: string[]
}

/** The id of the one entry that arbitrates the tree shape itself. Not an
 * entity id: the whole hierarchy is arbitrated as a unit (Yoann's rule —
 * a simple left/right choice, no per-item reorganisation). */
export const TREE_STRUCTURE_CONFLICT_ID = '__tree-structure__'

/** Where each entity sits, as a `parentId` per id — the shape the tree
 * comparison needs. `flattenEntities` gives ancestor NAMES, which change
 * on a rename and would report a move that never happened. */
function parentIdByChild(items: FolderItem[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  const walk = (nodes: FolderItem[], parentId: string | null): void => {
    for (const item of nodes) {
      out.set(item.id, parentId)
      const children = (item as FolderItem & { items?: FolderItem[] }).items
      if (children && children.length > 0) walk(children, item.id)
    }
  }
  walk(items, null)
  return out
}

/**
 * Items both sides moved, in different directions — the three-way rule
 * applied to the tree shape rather than to an entity's fields. A move only
 * one side made has an obvious answer (that side's), so it is adopted
 * silently and never listed here.
 */
export function conflictingMoves(
  baseItems: FolderItem[],
  oursItems: FolderItem[],
  theirsItems: FolderItem[]
): string[] {
  const base = parentIdByChild(baseItems)
  const ours = parentIdByChild(oursItems)
  const theirs = parentIdByChild(theirsItems)
  const moved: string[] = []
  for (const [id, oursParent] of ours) {
    if (!base.has(id) || !theirs.has(id)) continue
    const baseParent = base.get(id) ?? null
    const theirsParent = theirs.get(id) ?? null
    const weMoved = oursParent !== baseParent
    const theyMoved = theirsParent !== baseParent
    if (weMoved && theyMoved && oursParent !== theirsParent) moved.push(id)
  }
  return moved
}

/** A request's saved quick-configs, project target only (user-settings
 * configs never travel with the file, so they cannot conflict). */
function projectQuickConfigs(item: FolderItem): { name: string, fields: Record<string, unknown> }[] {
  const configs = (item as FolderItem & { quickConfigs?: { name?: unknown, fields?: unknown, storageTarget?: unknown }[] }).quickConfigs
  if (!Array.isArray(configs)) return []
  return configs
    .filter((c) => c.storageTarget !== 'settings' && typeof c.name === 'string')
    .map((c) => ({ name: c.name as string, fields: (c.fields ?? {}) as Record<string, unknown> }))
}

/** The request as one of its saved configs leaves it: identity fields kept
 * (the panel still shows whose request this is), configured fields
 * overwritten by the snapshot. Pure — never touches the source item. */
function requestUnderQuickConfig(item: FolderItem, fields: Record<string, unknown>): FolderItem {
  return { ...(item as unknown as Record<string, unknown>), ...fields } as unknown as FolderItem
}

/**
 * An environment-folder's `apiDocumentation` (AC#6) never drives a MANUAL
 * conflict: it auto-resolves by version/commit-timestamp instead (see
 * `apiDocumentationConflict.ts`, applied at write-back time in
 * `gitConflictMerge.ts` — independently of whether this entity even shows
 * up here). Stripping it before the equality check means an
 * environmentFolder whose ONLY difference is `apiDocumentation` is
 * correctly treated as "identical" and never enters the conflict list;
 * one that ALSO differs on a real field (e.g. `notes`) still conflicts —
 * on that other field — exactly as if `apiDocumentation` weren't part of
 * the entity's own-fields snapshot at all.
 */
function conflictSnapshot(item: FolderItem, kind: GitEntityKind): string {
  if (kind !== 'environmentFolder') {
    // `quickConfigs` is compared separately, one entry per config (see
    // `quickConfigConflicts`): a config is a whole-request snapshot, so
    // folding it into the request's own-field comparison would report
    // "this request conflicts" without ever saying WHICH configuration
    // disagrees — and would arbitrate every config at once.
    //
    // `documentation` is excluded for the same reason the env-folder's
    // `apiDocumentation` is: it is imported content, not something the
    // user authors, so asking them to arbitrate it is asking a question
    // they cannot answer. It auto-resolves at write-back instead.
    const { quickConfigs: _configs, documentation: _documentation, ...withoutConfigs } =
      item as FolderItem & { quickConfigs?: unknown, documentation?: unknown }
    return ownFieldsSnapshot(withoutConfigs as FolderItem)
  }
  const { apiDocumentation: _apiDocumentation, ...withoutDocumentation } = item as FolderItem & { apiDocumentation?: ApiDocumentation }
  return ownFieldsSnapshot(withoutDocumentation as FolderItem)
}

/**
 * Identify which entities actually conflict from a single-file project's
 * 3 git-index stages (`window.api.git.getConflictVersions`'s result) —
 * AC#7's "parse the single YAML → identify entities → present only
 * conflicting ones". An entity present on only one side (added there,
 * absent on the other) is NOT a conflict — it merges in automatically,
 * same principle as a request's saved quick-configs (config added on one
 * side merges in by default). Only entities present on BOTH sides with
 * DIFFERENT own-field content are genuine conflicts.
 *
 * `rehydrate` is forwarded to each `parseProjectYaml` call — see that
 * function's doc for why it defaults to a no-op (process-neutral module;
 * only the renderer's 4-panel UI needs real `ValueType` class instances).
 */
export function identifyConflictingEntities(
  versions: GitConflictVersions,
  rehydrate: (items: FolderItem[]) => FolderItem[] = (items) => items,
  /** Display name of the tree-structure entry. This model is shared with
   * the main process, which has no i18n instance, so the caller supplies
   * the translated label. */
  treeConflictName = 'Tree structure'
): ConflictEntity[] {
  const ours = flattenEntities(parseProjectYaml(versions.ours, rehydrate))
  const theirs = flattenEntities(parseProjectYaml(versions.theirs, rehydrate))
  const base = flattenEntities(parseProjectYaml(versions.base, rehydrate))

  const conflicts: ConflictEntity[] = []
  for (const [id, oursEntity] of ours) {
    const theirsEntity = theirs.get(id)
    if (!theirsEntity) continue
    const oursSnapshot = conflictSnapshot(oursEntity.item, oursEntity.kind)
    const theirsSnapshot = conflictSnapshot(theirsEntity.item, oursEntity.kind)
    if (oursSnapshot === theirsSnapshot) continue

    // Three-way, not two-way: differing from the other side is NOT enough
    // to be a conflict — an entity only ONE side touched has an obvious
    // answer (that side's version) and must never be put to the user.
    // Comparing ours-vs-theirs alone would flag every entity its own
    // author edited, so a user who changed one request while a colleague
    // changed a different one would be asked to arbitrate their own work.
    // A conflict requires BOTH sides to have moved away from the common
    // ancestor, in different directions.
    const baseEntity = base.get(id)
    if (baseEntity) {
      const baseSnapshot = conflictSnapshot(baseEntity.item, oursEntity.kind)
      // Only they moved → their version wins automatically (applied by
      // `gitConflictMerge.ts`, which folds theirs-side changes in).
      if (oursSnapshot === baseSnapshot) continue
      // Only we moved → our version stands; the merged tree is built from
      // ours, so there is nothing to do here either.
      if (theirsSnapshot === baseSnapshot) continue
    }
    conflicts.push({
      id,
      kind: oursEntity.kind,
      name: oursEntity.name,
      ours: oursEntity.item,
      theirs: theirsEntity.item,
      base: base.get(id)?.item ?? null,
      pathSegments: oursEntity.path
    })
  }

  // One entry per saved config contested on both sides, presented through
  // the same request diff as the request itself.
  for (const [id, oursEntity] of ours) {
    const theirsEntity = theirs.get(id)
    if (!theirsEntity) continue
    const oursConfigs = projectQuickConfigs(oursEntity.item)
    if (oursConfigs.length === 0) continue
    const theirsByName = new Map(projectQuickConfigs(theirsEntity.item).map((c) => [c.name, c]))
    const baseByName = new Map(projectQuickConfigs(base.get(id)?.item ?? ({} as FolderItem)).map((c) => [c.name, c]))
    for (const oursConfig of oursConfigs) {
      const theirsConfig = theirsByName.get(oursConfig.name)
      // Present on one side only = added there, merges in like any other
      // one-sided addition. Nothing to arbitrate.
      if (!theirsConfig) continue
      const oursFields = JSON.stringify(oursConfig.fields)
      const theirsFields = JSON.stringify(theirsConfig.fields)
      if (oursFields === theirsFields) continue
      // Same three-way rule as entities: only a config both sides moved,
      // differently, is a genuine conflict.
      const baseConfig = baseByName.get(oursConfig.name)
      if (baseConfig) {
        const baseFields = JSON.stringify(baseConfig.fields)
        if (oursFields === baseFields || theirsFields === baseFields) continue
      }
      conflicts.push({
        id: `${id}::quick-config::${oursConfig.name}`,
        kind: oursEntity.kind,
        name: oursEntity.name,
        ours: requestUnderQuickConfig(oursEntity.item, oursConfig.fields),
        theirs: requestUnderQuickConfig(theirsEntity.item, theirsConfig.fields),
        base: baseConfig ? requestUnderQuickConfig(oursEntity.item, baseConfig.fields) : null,
        pathSegments: oursEntity.path,
        quickConfigName: oursConfig.name
      })
    }
  }

  const kindOrder: Record<GitEntityKind, number> = { folder: 0, environmentFolder: 1, request: 2, scenario: 3 }
  conflicts.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name))

  // ONE entry for the tree shape, listed first: where an item LIVES is a
  // property of the hierarchy, not of the item, so it is arbitrated once
  // as a whole rather than item by item. Only reachable with a common
  // ancestor — without it there is no way to tell who moved what.
  const oursItems = parseProjectYaml(versions.ours, rehydrate)
  const theirsItems = parseProjectYaml(versions.theirs, rehydrate)
  const baseItems = parseProjectYaml(versions.base, rehydrate)
  const moved = versions.base === null ? [] : conflictingMoves(baseItems, oursItems, theirsItems)
  if (moved.length > 0) {
    conflicts.unshift({
      id: TREE_STRUCTURE_CONFLICT_ID,
      kind: 'folder',
      name: treeConflictName,
      ours: { id: TREE_STRUCTURE_CONFLICT_ID, name: treeConflictName, tags: [], configuration: {}, items: oursItems } as unknown as FolderItem,
      theirs: { id: TREE_STRUCTURE_CONFLICT_ID, name: treeConflictName, tags: [], configuration: {}, items: theirsItems } as unknown as FolderItem,
      base: { id: TREE_STRUCTURE_CONFLICT_ID, name: treeConflictName, tags: [], configuration: {}, items: baseItems } as unknown as FolderItem,
      pathSegments: [],
      movedItemIds: moved
    })
  }
  return conflicts
}
