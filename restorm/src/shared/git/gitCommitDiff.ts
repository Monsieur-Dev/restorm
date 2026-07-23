import { parse as yamlParse } from 'yaml'
import type { FolderItem } from '../types/folderTypes'
import { isEnvironmentFolder, isFolder, isScenario } from '../types/folderTypes'
import { prepareForSerialization, stripIds } from '../utils/serialization'

export type GitEntityKind = 'folder' | 'environmentFolder' | 'request' | 'scenario'
export type GitChangeAction = 'added' | 'modified' | 'moved' | 'deleted' | 'reordered'

export interface GitEntityChange {
  kind: GitEntityKind
  name: string
  action: GitChangeAction
}

export function kindOf(item: FolderItem): GitEntityKind {
  if (isEnvironmentFolder(item)) return 'environmentFolder'
  if (isFolder(item)) return 'folder'
  if (isScenario(item)) return 'scenario'
  return 'request'
}

/**
 * Flatten a project tree into a `Map<id, entity>` — every request,
 * scenario, folder, and environment-folder at any depth, keyed by its
 * persisted id. Shared by `diffProjectEntities` (which only needs the
 * `kind`/`name`/an own-fields snapshot for comparison) and the conflict
 * model (`gitConflictModel.ts`, which needs the actual `FolderItem` to
 * hand to an entity panel).
 */
export function flattenEntities(items: FolderItem[]): Map<string, { kind: GitEntityKind, name: string, item: FolderItem, path: string[] }> {
  const out = new Map<string, { kind: GitEntityKind, name: string, item: FolderItem, path: string[] }>()
  const walk = (nodes: FolderItem[], ancestors: string[]): void => {
    for (const item of nodes) {
      // `path` = the ANCESTOR names, root-first, self excluded — the
      // conflict modal's breadcrumb band is the consumer.
      out.set(item.id, { kind: kindOf(item), name: item.name, item, path: ancestors })
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
 * producedHeaders) on EVERY independent parse — without it, two byte-
 * identical requests parsed from `ours`/`theirs` YAML each get their own
 * `crypto.randomUUID()` per header row, so the raw JSON.stringify would
 * report a spurious diff on any request that merely HAS headers, whether
 * or not their content actually changed. `diffProjectEntities` below
 * dodges this by running its two in-memory sides through the full
 * `prepareForSerialization` upstream; `identifyConflictingEntities`
 * (`gitConflictModel.ts`) hands `flattenEntities` the freshly-parsed
 * items (ids intact, so `RestormKeyValueTable` rows keep stable React
 * keys when rendered) and relies on THIS function to normalize away the
 * id churn for comparison only — the returned `FolderItem` itself is
 * never mutated.
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

function collectEntities(items: FolderItem[], out: Map<string, CollectedEntity>, parentId: string | null = null): void {
  for (const item of items) {
    const children = (item as FolderItem & { items?: FolderItem[] }).items
    out.set(item.id, { kind: kindOf(item), name: item.name, ownSnapshot: ownFieldsSnapshot(item), parentId })
    if (children && children.length > 0) {
      collectEntities(children, out, item.id)
    }
  }
}

/**
 * Deterministic structural diff of the Restorm project — the semantic
 * differ restorm injects into ECUI's generic commit-message engine (see
 * `docs/Git/README.md`). Grouped ONE line per changed entity (never per
 * field, never per scenario-node reposition): a request / scenario /
 * folder / environment-folder is either added, modified (any of its own
 * fields changed), or deleted. Diffed by the entity's persisted `id` —
 * never by array position or index — so reordering items alone is never
 * reported as a change.
 *
 * Both sides are run through `prepareForSerialization` first so the
 * comparison ignores exactly the fields a real save would already strip
 * (volatile key-value-list ids, unresolved secret plaintext, …) — the
 * same normalization the "before" side already went through when it was
 * last written to disk.
 */
export function diffProjectEntities(beforeItems: FolderItem[], afterItems: FolderItem[]): GitEntityChange[] {
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

  // Deterministic order — the same diff always renders the same commit
  // body, independent of the two Maps' insertion order.
  const kindOrder: Record<GitEntityKind, number> = { folder: 0, environmentFolder: 1, request: 2, scenario: 3 }
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
