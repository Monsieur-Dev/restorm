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
  if (kind !== 'environmentFolder') return ownFieldsSnapshot(item)
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
  rehydrate: (items: FolderItem[]) => FolderItem[] = (items) => items
): ConflictEntity[] {
  const ours = flattenEntities(parseProjectYaml(versions.ours, rehydrate))
  const theirs = flattenEntities(parseProjectYaml(versions.theirs, rehydrate))
  const base = flattenEntities(parseProjectYaml(versions.base, rehydrate))

  const conflicts: ConflictEntity[] = []
  for (const [id, oursEntity] of ours) {
    const theirsEntity = theirs.get(id)
    if (!theirsEntity) continue
    if (conflictSnapshot(oursEntity.item, oursEntity.kind) === conflictSnapshot(theirsEntity.item, oursEntity.kind)) continue
    conflicts.push({
      id,
      kind: oursEntity.kind,
      name: oursEntity.name,
      ours: oursEntity.item,
      theirs: theirsEntity.item,
      base: base.get(id)?.item ?? null
    })
  }

  const kindOrder: Record<GitEntityKind, number> = { folder: 0, environmentFolder: 1, request: 2, scenario: 3 }
  conflicts.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name))
  return conflicts
}
