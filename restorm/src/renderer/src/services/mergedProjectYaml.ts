import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import type { GitConflictVersions, GitConflictCommitTimestamps } from 'electron-core-ui/renderer'
import type { FolderItem } from '../../../shared/types/folderTypes'
import { parseProjectYaml } from '../../../shared/git/gitCommitDiff'
import { buildMergedProjectTree } from '../../../shared/git/gitConflictMerge'
import { TREE_STRUCTURE_CONFLICT_ID } from '../../../shared/git/gitConflictModel'
import { flattenEntities } from '../../../shared/git/gitCommitDiff'
import { prepareForSerialization, processAfterDeserialization } from '../utils/serialization'

/**
 * Produce the YAML text of the merged single-file project, from the three
 * versions of it plus (optionally) the user's per-entity picks.
 *
 * Shared by both write-back paths so they can never drift apart: the
 * 4-panel resolution flow passes the picks it collected, while the
 * update-before-publish flow passes NO picks at all — with an empty
 * `resolvedById` the merge keeps our side wherever the two disagree and
 * folds in every change only the other side made, which is exactly
 * "update to the latest version, keeping my work".
 *
 * The merged collections are spliced into the FULL `ours` document
 * rather than rebuilt as `{ collections }`: that document carries
 * top-level project fields beyond `collections` (notably `_projectUuid`),
 * and this write-back bypasses the normal save path that would otherwise
 * re-stamp them. Dropping the uuid would make the next open regenerate a
 * fresh one, orphaning the draft store and changing the project's
 * identity.
 */
export interface QuickConfigResolution {
  requestId: string
  configName: string
  /** The request as the user settled it for THIS saved configuration; its
   * configured fields become the config's new snapshot. */
  resolved: FolderItem
}

export function buildMergedProjectYaml(
  versions: GitConflictVersions,
  resolvedById: Record<string, FolderItem> = {},
  commitTimestamps?: GitConflictCommitTimestamps,
  quickConfigResolutions: QuickConfigResolution[] = []
): string {
  const oursItems = parseProjectYaml(versions.ours, processAfterDeserialization)
  const theirsItems = parseProjectYaml(versions.theirs, processAfterDeserialization)
  // The common ancestor is what lets the merge adopt a change only THEY
  // made on an entity nobody contested: the tree is walked from our side,
  // so without it that edit has no pick to bring it back and is lost.
  const baseItems = parseProjectYaml(versions.base, processAfterDeserialization)

  // The tree-structure entry arbitrates WHERE things live, so its pick
  // selects which side's hierarchy the merge walks. It is not an entity:
  // leaving it in `resolvedById` would have the merge look for an item
  // with that id and find nothing.
  const { [TREE_STRUCTURE_CONFLICT_ID]: treePick, ...entityPicks } = resolvedById
  const treeSideItems = treePick
    ? ((treePick as FolderItem & { items?: FolderItem[] }).items ?? oursItems)
    : oursItems
  const merged = buildMergedProjectTree(treeSideItems, theirsItems, entityPicks, commitTimestamps, baseItems)
  applyQuickConfigResolutions(merged, quickConfigResolutions)

  // `versions.ours` is `null` only when the file didn't exist at HEAD —
  // no document to preserve top-level fields from in that case.
  const oursDocument = versions.ours !== null ? (yamlParse(versions.ours) as Record<string, unknown> | null) : null
  const mergedDocument = { ...(oursDocument ?? {}), collections: merged }
  return yamlStringify(prepareForSerialization(mergedDocument))
}

/**
 * Write each settled saved-configuration back into its request.
 *
 * A quick-config conflict is presented as a request diff (the config IS a
 * whole-request snapshot), so its resolution comes back as a request — but
 * it must land in `quickConfigs[name].fields`, not on the request's live
 * fields. Without this the user's choice is collected, displayed as
 * settled, and then silently dropped at write-back.
 *
 * Only the keys the config already captured are taken from the resolved
 * request: a snapshot never carries identity fields, and widening it here
 * would quietly turn a configuration into a full request copy.
 */
function applyQuickConfigResolutions(items: FolderItem[], resolutions: QuickConfigResolution[]): void {
  if (resolutions.length === 0) return
  const byId = flattenEntities(items)
  for (const resolution of resolutions) {
    const request = byId.get(resolution.requestId)?.item as (FolderItem & { quickConfigs?: { name?: string, fields?: Record<string, unknown> }[] }) | undefined
    const config = request?.quickConfigs?.find((c) => c.name === resolution.configName)
    if (!config?.fields) continue
    const resolvedRecord = resolution.resolved as unknown as Record<string, unknown>
    const nextFields: Record<string, unknown> = {}
    for (const key of Object.keys(config.fields)) {
      nextFields[key] = resolvedRecord[key]
    }
    config.fields = nextFields
  }
}
