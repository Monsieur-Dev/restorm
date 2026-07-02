import { parse as yamlParse } from 'yaml'
import type { FolderItem } from '../types/folderTypes'
import { isEnvironmentFolder, isFolder, isScenario } from '../types/folderTypes'
import { prepareForSerialization, stripIds } from '../utils/serialization'

export type GitEntityKind = 'folder' | 'environmentFolder' | 'request' | 'scenario'
export type GitChangeAction = 'added' | 'modified' | 'deleted'

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
export function flattenEntities(items: FolderItem[]): Map<string, { kind: GitEntityKind, name: string, item: FolderItem }> {
  const out = new Map<string, { kind: GitEntityKind, name: string, item: FolderItem }>()
  const walk = (nodes: FolderItem[]): void => {
    for (const item of nodes) {
      out.set(item.id, { kind: kindOf(item), name: item.name, item })
      const children = (item as FolderItem & { items?: FolderItem[] }).items
      if (children && children.length > 0) {
        walk(children)
      }
    }
  }
  walk(items)
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
  return JSON.stringify(stripIds(own))
}

interface CollectedEntity {
  kind: GitEntityKind
  name: string
  /** JSON of the entity's OWN fields (children container excluded — a
   * child add/remove/change is reported as its own separate entity
   * change, never bubbled up as "the parent folder was modified"). */
  ownSnapshot: string
}

function collectEntities(items: FolderItem[], out: Map<string, CollectedEntity>): void {
  for (const item of items) {
    const children = (item as FolderItem & { items?: FolderItem[] }).items
    out.set(item.id, { kind: kindOf(item), name: item.name, ownSnapshot: ownFieldsSnapshot(item) })
    if (children && children.length > 0) {
      collectEntities(children, out)
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
    }
  }
  for (const [id, entity] of before) {
    if (!after.has(id)) {
      changes.push({ kind: entity.kind, name: entity.name, action: 'deleted' })
    }
  }

  // Deterministic order — the same diff always renders the same commit
  // body, independent of the two Maps' insertion order.
  const kindOrder: Record<GitEntityKind, number> = { folder: 0, environmentFolder: 1, request: 2, scenario: 3 }
  const actionOrder: Record<GitChangeAction, number> = { added: 0, modified: 1, deleted: 2 }
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
