import { parse as yamlParse } from 'yaml'
import type { FolderItem } from '../types/folderTypes'
import { isEnvironmentFolder, isFolder, isScenario, isApiDesign, isRecordingSession } from '../types/folderTypes'
import { prepareForSerialization, stripIds } from '../utils/serialization'

/**
 * `document` is not a tree item: it stands for the fields carried by the
 * DOCUMENT ITSELF — today `fileFormatVersion`, tomorrow whatever joins it
 * at the root, next to `collections`.
 *
 * Those fields belong to the file and to nothing inside it, so before this
 * kind existed they were in the file but present in no model: a save that
 * changed only them produced a git diff nobody could describe, a push
 * modal listing no changes, and a Push button disabled on a project git
 * reported as modified. Giving them a kind is what puts a format change
 * in the commit message a reader will later use to understand why a file
 * moved — which is the whole point of stamping a version in the first
 * place.
 */
export type GitEntityKind = 'folder' | 'environmentFolder' | 'request' | 'scenario' | 'design' | 'recording' | 'document'
export type GitChangeAction = 'added' | 'modified' | 'moved' | 'deleted' | 'reordered'

export interface GitEntityChange {
  kind: GitEntityKind
  name: string
  action: GitChangeAction
}

/**
 * An entity's id as the RUNTIME can actually deliver it. `FolderItem`
 * declares `id` as always present, and for anything the app itself builds
 * that holds — but these walks also run on the raw output of a YAML parse
 * (a HEAD blob, a merge stage), where a hand-written or script-generated
 * document simply may not carry one. The optional return type is what lets
 * the id-keyed maps below refuse such an entity instead of filing it under
 * the JS value `undefined`.
 */
export function entityId(item: FolderItem): string | undefined {
  return (item as { id?: string }).id
}

/**
 * The document's own fields, as read from the root of a project file —
 * NOT from anything inside `collections`.
 *
 * `fileFormatVersion` is `undefined` for a document that declares none.
 * That is a real, meaningful state and not a missing value to default
 * away: a file predating the field reads as "unversioned", and the first
 * save this app performs stamps it. Collapsing it to the current version
 * here would hide exactly the transition this type exists to report.
 */
export interface ProjectDocumentFields {
  fileFormatVersion?: number | undefined
}

/**
 * Read a project file's DOCUMENT-level fields from raw YAML text. A
 * sibling of {@link parseProjectYaml}, which reads the same text for the
 * items — the two halves of one file.
 */
export function parseProjectDocumentFields(rawYaml: string | null): ProjectDocumentFields {
  if (rawYaml === null) return {}
  const parsed = yamlParse(rawYaml) as { fileFormatVersion?: unknown } | null
  const declared = parsed?.fileFormatVersion
  return typeof declared === 'number' ? { fileFormatVersion: declared } : {}
}

/**
 * One change line for the document itself, or `null` when its fields are
 * identical.
 *
 * The `name` carries the TRANSITION rather than an entity name, because
 * that is what a reader of the history needs: "which format did this file
 * move from, and to what". An unversioned "before" renders as an arrow
 * with no left side — the file did not declare one, and inventing the
 * current version there would claim a stamp that was never in the file.
 */
export function diffDocumentFields(
  before: ProjectDocumentFields,
  after: ProjectDocumentFields
): GitEntityChange | null {
  if (before.fileFormatVersion === after.fileFormatVersion) return null
  if (after.fileFormatVersion === undefined) return null
  const from = before.fileFormatVersion
  return {
    kind: 'document',
    name: from === undefined ? `${after.fileFormatVersion}` : `${from} → ${after.fileFormatVersion}`,
    action: from === undefined ? 'added' : 'modified'
  }
}

export function kindOf(item: FolderItem): GitEntityKind {
  if (isEnvironmentFolder(item)) return 'environmentFolder'
  if (isFolder(item)) return 'folder'
  if (isScenario(item)) return 'scenario'
  if (isApiDesign(item)) return 'design'
  if (isRecordingSession(item)) return 'recording'
  return 'request'
}

/**
 * Flatten a project tree into a `Map<id, entity>` — every request,
 * scenario, folder, and environment-folder at any depth, keyed by its
 * persisted id. Shared by `diffProjectEntities` (which only needs the
 * `kind`/`name`/an own-fields snapshot for comparison) and the conflict
 * model (`gitConflictModel.ts`, which needs the actual `FolderItem` to
 * hand to an entity panel).
 *
 * An entity carrying NO id is left OUT of the map. Not defensive noise:
 * `undefined` is a perfectly good `Map` key, so without the guard every
 * id-less entity in a tree lands in the SAME slot and the last one wins.
 * The two sides of a comparison then hold different entities under that
 * one phantom key and get compared against each other — a difference
 * between two unrelated entities, reported as a change to whichever landed
 * there last. An entity with no id has nothing stable to pair on, so it
 * takes no part; there is no honest fallback, because an id invented here
 * would differ between two independent parses of the same bytes and break
 * the pairing in a new way. Its CHILDREN still walk — they carry their own
 * ids, and dropping them would turn one malformed parent into silently
 * unreported work loss across a whole subtree.
 */
export function flattenEntities(items: FolderItem[]): Map<string, { kind: GitEntityKind, name: string, item: FolderItem, path: string[] }> {
  const out = new Map<string, { kind: GitEntityKind, name: string, item: FolderItem, path: string[] }>()
  const walk = (nodes: FolderItem[], ancestors: string[]): void => {
    for (const item of nodes) {
      const id = entityId(item)
      // `path` = the ANCESTOR names, root-first, self excluded — the
      // conflict modal's breadcrumb band is the consumer.
      if (id) out.set(id, { kind: kindOf(item), name: item.name, item, path: ancestors })
      const children = (item as FolderItem & { items?: FolderItem[] }).items
      if (children && children.length > 0) {
        walk(children, [...ancestors, item.name])
      }
    }
  }
  walk(items, [])
  return out
}

/**
 * JSON snapshot of an entity's OWN fields, with its child-container
 * (`items` — a folder/env-folder/scenario's nested requests/sub-folders)
 * excluded. Shared by the diff engine and the conflict model: a child
 * add/remove/change is always reported as its OWN separate entity change,
 * never bubbled up as "the parent folder was modified". A scenario's
 * `nodes`/`edges` are NOT a child container in this sense — they stay
 * part of the scenario's own snapshot, matching AC's decision that
 * scenario conflicts are shown (not field-diffed) as a whole.
 *
 * `stripIds` clears the runtime-only ids `processAfterDeserialization`
 * assigns to key-value rows (headers / params / pathParams /
 * producedHeaders) on EVERY independent parse. Those ids are DERIVED from
 * the row's position in the document (`shared/utils/stableId.ts`), so two
 * parses of the same bytes agree — but the derivation path includes the
 * owning folder chain, so the SAME request compared across a move carries
 * different key-value ids on the two sides. Without `stripIds` the raw
 * JSON.stringify would then report a spurious diff on any request that
 * merely HAS headers, whether or not their content actually changed.
 * `diffProjectEntities` below dodges this by running its two in-memory
 * sides through the full `prepareForSerialization` upstream;
 * `identifyConflictingEntities` (`gitConflictModel.ts`) hands
 * `flattenEntities` the freshly-parsed items (ids intact, so
 * `RestormKeyValueTable` rows keep stable React keys when rendered) and
 * relies on THIS function to normalize away the id churn for comparison
 * only — the returned `FolderItem` itself is never mutated.
 */
export function ownFieldsSnapshot(item: FolderItem): string {
  const { items: _children, ...own } = item as FolderItem & { items?: FolderItem[] }
  return canonicalStringify(stripIds(own))
}

/**
 * `JSON.stringify` with object keys sorted at every depth, so the result
 * depends on an entity's CONTENT and never on the order its fields happen
 * to sit in.
 *
 * That distinction is not academic: the project file is rewritten on
 * every save, and the key order it comes back with is not stable. A plain
 * stringify therefore reports two identical entities as different the
 * moment one of them has been through a save — which, in the conflict
 * flow, means the user is asked to arbitrate entities NOBODY touched.
 * Reordering fields is not an edit, and this snapshot must not pretend
 * otherwise.
 *
 * Array order is deliberately preserved: for headers, params and
 * path-params it IS meaningful content, not incidental layout.
 */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    out[key] = canonicalize(source[key])
  }
  return out
}

interface CollectedEntity {
  kind: GitEntityKind
  name: string
  /** JSON of the entity's OWN fields (children container excluded — a
   * child add/remove/change is reported as its own separate entity
   * change, never bubbled up as "the parent folder was modified"). */
  ownSnapshot: string
  /** Which container the entity sits in. Moving an item changes nothing
   * about the item itself, so without this a reorganisation looks like an
   * unchanged project — and the publish flow refuses to commit work that
   * is genuinely on disk. */
  parentId: string | null
}

/** Same id-keyed map, same phantom-`undefined` hazard, same handling — see
 * {@link flattenEntities} for why an id-less entity is skipped while its
 * children keep walking. Their `parentId` becomes `null` rather than the
 * parent's absent id: both sides of a comparison agree on it, so a move is
 * never invented, and no side records a parent that is not in the map. */
function collectEntities(items: FolderItem[], out: Map<string, CollectedEntity>, parentId: string | null = null): void {
  for (const item of items) {
    const children = (item as FolderItem & { items?: FolderItem[] }).items
    const id = entityId(item)
    if (id) out.set(id, { kind: kindOf(item), name: item.name, ownSnapshot: ownFieldsSnapshot(item), parentId })
    if (children && children.length > 0) {
      collectEntities(children, out, id ?? null)
    }
  }
}

/**
 * Deterministic structural diff of the Restorm project — the semantic
 * differ restorm injects into ECUI's generic commit-message engine (see
 * `docs/Git/README.md`). Grouped ONE line per changed entity (never per
 * field, never per scenario-node reposition): a request / scenario /
 * folder / environment-folder is either added, modified (any of its own
 * fields changed), or deleted. Diffed by the entity's `id` — never by
 * array position or index — so reordering items alone is never reported as
 * a change. On a project whose ids are not persisted yet, the two sides are
 * paired by the id the loader DERIVES from the document
 * (`shared/utils/stableId.ts`), which two independent parses of the same
 * bytes agree on.
 *
 * Both sides are run through `prepareForSerialization` first so the
 * comparison ignores exactly the fields a real save would already strip
 * (volatile key-value-list ids, unresolved secret plaintext, …) — the
 * same normalization the "before" side already went through when it was
 * last written to disk.
 */
export function diffProjectEntities(
  beforeItems: FolderItem[],
  afterItems: FolderItem[],
  documents?: { before: ProjectDocumentFields; after: ProjectDocumentFields }
): GitEntityChange[] {
  const before = new Map<string, CollectedEntity>()
  const after = new Map<string, CollectedEntity>()
  collectEntities(prepareForSerialization(beforeItems), before)
  collectEntities(prepareForSerialization(afterItems), after)

  const changes: GitEntityChange[] = []
  for (const [id, entity] of after) {
    const prior = before.get(id)
    if (!prior) {
      changes.push({ kind: entity.kind, name: entity.name, action: 'added' })
    } else if (prior.ownSnapshot !== entity.ownSnapshot) {
      changes.push({ kind: entity.kind, name: entity.name, action: 'modified' })
    } else if (prior.parentId !== entity.parentId) {
      // Same content, different container: a reorganisation. Reported on
      // its own rather than as "modified", because nothing about the
      // entity itself changed and the commit message should say so.
      changes.push({ kind: entity.kind, name: entity.name, action: 'moved' })
    }
  }
  for (const [id, entity] of before) {
    if (!after.has(id)) {
      changes.push({ kind: entity.kind, name: entity.name, action: 'deleted' })
    }
  }

  // Reorder — reported at the CONTAINER level, one line per folder whose
  // children changed order (same set, different sequence). Reordering used
  // to be invisible (the diff keys on id, not position), so publishing a
  // pure reorganisation produced no message line; now the folder that was
  // reorganised is named. A container whose membership changed (add / move /
  // delete) is NOT reported here — that churn is already covered by the
  // per-entity lines above.
  const orderedChildIds = (items: FolderItem[]): Map<string, string[]> => {
    const out = new Map<string, string[]>()
    const walk = (nodes: FolderItem[]): void => {
      for (const node of nodes) {
        const children = (node as FolderItem & { items?: FolderItem[] }).items
        if (children && children.length > 0) {
          out.set(node.id, children.map((c) => c.id))
          walk(children)
        }
      }
    }
    walk(items)
    return out
  }
  const beforeOrder = orderedChildIds(prepareForSerialization(beforeItems))
  const afterOrder = orderedChildIds(prepareForSerialization(afterItems))
  const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i])
  const sameSeq = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
  for (const [folderId, afterKids] of afterOrder) {
    const beforeKids = beforeOrder.get(folderId)
    if (!beforeKids) continue
    if (sameSet(beforeKids, afterKids) && !sameSeq(beforeKids, afterKids)) {
      const entity = after.get(folderId)
      if (entity && (entity.kind === 'folder' || entity.kind === 'environmentFolder')) {
        changes.push({ kind: entity.kind, name: entity.name, action: 'reordered' })
      }
    }
  }

  // The document's own fields, compared last but sorted to the top below:
  // a format change is the first thing a reader of the history needs, since
  // it explains why the rest of the file may look different at all.
  if (documents) {
    const change = diffDocumentFields(documents.before, documents.after)
    if (change) changes.push(change)
  }

  // Deterministic order — the same diff always renders the same commit
  // body, independent of the two Maps' insertion order.
  const kindOrder: Record<GitEntityKind, number> = { document: -1, folder: 0, environmentFolder: 1, request: 2, scenario: 3, design: 4, recording: 5 }
  const actionOrder: Record<GitChangeAction, number> = { added: 0, modified: 1, moved: 2, reordered: 3, deleted: 4 }
  changes.sort((a, b) =>
    kindOrder[a.kind] - kindOrder[b.kind] ||
    actionOrder[a.action] - actionOrder[b.action] ||
    a.name.localeCompare(b.name)
  )
  return changes
}

/**
 * Parse a project's raw single-file YAML text (e.g. `window.api.git.
 * getFileAtHead`'s blob content, or the same call's main-process
 * `GitService.getFileAtHead` equivalent) into the same `FolderItem[]`
 * shape the live editor holds — the read-only "before" snapshot side of
 * the diff. Returns `[]` for a `null` blob (the file didn't exist at that
 * commit yet, e.g. the project's very first commit).
 *
 * `rehydrate` turns the raw parsed POJOs into whatever shape the CALLER
 * needs and defaults to a no-op — this module is shared by both processes
 * (see `docs/Git/README.md`), and only the renderer's UI-facing call
 * sites (`usePushModal`, `useGitPullConflict`) need real `ValueType` class
 * instances (`processAfterDeserialization`, which pulls in
 * `normalizeValueType` — a renderer-only dependency chain). A main-process
 * caller (the git MCP tools) only needs JSON-safe data for a diff summary
 * or a conflict payload and passes nothing.
 */
export function parseProjectYaml(rawYaml: string | null, rehydrate: (items: FolderItem[]) => FolderItem[] = (items) => items): FolderItem[] {
  if (rawYaml === null) return []
  const parsed = yamlParse(rawYaml) as { collections?: unknown } | null
  const collections = Array.isArray(parsed?.collections) ? (parsed.collections as FolderItem[]) : []
  return rehydrate(collections)
}
