import { parse as yamlParse } from 'yaml'
import type { FolderItem } from '../../../shared/types/folderTypes'
import { isEnvironmentFolder, isFolder, isScenario } from '../../../shared/types/folderTypes'
import { prepareForSerialization, processAfterDeserialization } from '../utils/serialization'

export type GitEntityKind = 'folder' | 'environmentFolder' | 'request' | 'scenario'
export type GitChangeAction = 'added' | 'modified' | 'deleted'

export interface GitEntityChange {
  kind: GitEntityKind
  name: string
  action: GitChangeAction
}

function kindOf(item: FolderItem): GitEntityKind {
  if (isEnvironmentFolder(item)) return 'environmentFolder'
  if (isFolder(item)) return 'folder'
  if (isScenario(item)) return 'scenario'
  return 'request'
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
    const { items: children, ...own } = item as FolderItem & { items?: FolderItem[] }
    out.set(item.id, { kind: kindOf(item), name: item.name, ownSnapshot: JSON.stringify(own) })
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
 * getFileAtHead`'s blob content) into the same `FolderItem[]` shape the
 * live editor holds — the read-only "before" snapshot side of the diff.
 * Returns `[]` for a `null` blob (the file didn't exist at that commit
 * yet, e.g. the project's very first commit).
 */
export function parseProjectYaml(rawYaml: string | null): FolderItem[] {
  if (rawYaml === null) return []
  const parsed = yamlParse(rawYaml) as { collections?: unknown } | null
  const collections = Array.isArray(parsed?.collections) ? (parsed.collections as FolderItem[]) : []
  return processAfterDeserialization(collections)
}
