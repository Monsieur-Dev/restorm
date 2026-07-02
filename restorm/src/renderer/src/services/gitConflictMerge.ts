import type { FolderItem } from '../../../shared/types/folderTypes'
import { isEnvironmentFolder } from '../../../shared/types/folderTypes'
import type { QuickConfig } from '../../../shared/types/requests/QuickConfig'
import { resolveApiDocumentationConflict, type ApiDocumentationCommitTimestamps } from './apiDocumentationConflict'
import { flattenEntities } from './gitCommitDiff'

/** `quickConfigs` is an ad-hoc field on the reactive request proxy (see
 * `requestQuickConfigStore.ts`), not part of the typed `FolderItem`/
 * `Request` union — same gap `conflictFieldDiff.ts`'s
 * `projectQuickConfigsOf` documents. Naming the gap as an explicit
 * intersection (rather than casting through `unknown`) keeps the merge
 * below checked against the REST of `FolderItem`'s shape — only the one
 * genuinely-unmodeled field is widened. */
type FolderItemWithQuickConfigs = FolderItem & { quickConfigs?: QuickConfig[] }

/**
 * Whole-config pick-ours/theirs granularity (Yoann's locked decision): a
 * project-target quick config (the only kind stored on the request itself
 * — see `requestQuickConfigStore.ts`; the user-settings backend never
 * touches this field) that exists on only ONE side merges in
 * automatically, by name. A same-named config that differs on both sides
 * is a real conflict with no dedicated resolver UI yet (the live
 * `RequestQuickSettingsButton` isn't mounted inside the conflict panel) —
 * it's left exactly as `base` (the resolved pick) already has it, never
 * silently overwritten.
 */
function mergeQuickConfigs(base: FolderItem, theirsCounterpart: FolderItem | undefined): FolderItem {
  const baseWithConfigs = base as FolderItemWithQuickConfigs
  const baseConfigs = baseWithConfigs.quickConfigs
  const theirsConfigs = (theirsCounterpart as FolderItemWithQuickConfigs | undefined)?.quickConfigs
  if (!theirsConfigs || theirsConfigs.length === 0) return base
  const baseNames = new Set((baseConfigs ?? []).map((c) => c.name))
  const theirsOnly = theirsConfigs.filter((c) => !baseNames.has(c.name))
  if (theirsOnly.length === 0) return base
  const merged: FolderItemWithQuickConfigs = { ...baseWithConfigs, quickConfigs: [...(baseConfigs ?? []), ...theirsOnly] }
  return merged
}

/**
 * AC#6: an environment-folder's `apiDocumentation` auto-resolves at
 * write-back — independently of `resolvedById` / whatever the user
 * picked for the entity's OTHER fields (`gitConflictModel.ts` already
 * excludes it from deciding whether this entity is a manual conflict at
 * all — see that file's `conflictSnapshot`). Compares the RAW ours/theirs
 * counterparts (not `base`, which may already be a resolved pick that
 * only ever reflects one side) so the winner is chosen the same way
 * regardless of which side the user happened to keep for `notes`, etc.
 */
function mergeApiDocumentation(
  base: FolderItem,
  oursCounterpart: FolderItem | undefined,
  theirsCounterpart: FolderItem | undefined,
  commitTimestamps?: ApiDocumentationCommitTimestamps
): FolderItem {
  if (!isEnvironmentFolder(base) || !oursCounterpart || !theirsCounterpart) return base
  if (!isEnvironmentFolder(oursCounterpart) || !isEnvironmentFolder(theirsCounterpart)) return base
  const resolved = resolveApiDocumentationConflict(oursCounterpart.apiDocumentation, theirsCounterpart.apiDocumentation, commitTimestamps)
  if (resolved === base.apiDocumentation) return base
  return { ...base, apiDocumentation: resolved } as FolderItem
}

/**
 * Reconstruct the single merged project tree after conflict resolution:
 * walk `oursItems`, substitute each conflicting entity with its resolved
 * pick (`resolvedById`, keyed by entity id — from `useConflictResolution`),
 * and fold in every entity that exists ONLY on `theirsItems`' side (added
 * there, absent from ours — same "added on one side auto-merges" rule
 * `gitConflictModel.ts` uses to decide what's a conflict in the first
 * place, applied here to actually build the combined tree).
 *
 * Does not attempt a general 3-way tree merge: a theirs-only entity is
 * folded in as a SIBLING of its theirs-side parent's matching ours-side
 * folder. If the parent folder itself doesn't exist on our side at all
 * (the whole folder is new on theirs), it is NOT recovered here — a known
 * v1 limitation of the single-file conflict flow, not attempted.
 */
export function buildMergedProjectTree(
  oursItems: FolderItem[],
  theirsItems: FolderItem[],
  resolvedById: Record<string, FolderItem>,
  commitTimestamps?: ApiDocumentationCommitTimestamps
): FolderItem[] {
  const oursById = flattenEntities(oursItems)
  const theirsById = flattenEntities(theirsItems)

  function childrenOf(item: FolderItem): FolderItem[] {
    return (item as FolderItem & { items?: FolderItem[] }).items ?? []
  }

  function mergeItem(item: FolderItem): FolderItem {
    const resolved = resolvedById[item.id]
    const base = resolved ?? item
    // The child SET always walks from `item` (the ours-side node this
    // recursion is visiting), never from `base` (the user's field-level
    // pick for THIS entity's own fields, e.g. notes). Picking "theirs" for
    // a folder's own fields must not also swap in theirs' child list —
    // that would silently drop ours-only children that were never part of
    // the conflict at all (they auto-merge in via `mergeList`'s
    // theirs-only fold below, same as any other one-side addition).
    const ownChildren = childrenOf(item)
    const oursCounterpart = oursById.get(item.id)?.item
    const theirsCounterpart = theirsById.get(item.id)?.item
    if (ownChildren.length === 0 && !('items' in base)) {
      return mergeQuickConfigs(base, theirsCounterpart)
    }
    const withDocumentation = mergeApiDocumentation(base, oursCounterpart, theirsCounterpart, commitTimestamps)
    const theirsChildren = theirsCounterpart ? childrenOf(theirsCounterpart) : []
    return { ...withDocumentation, items: mergeList(ownChildren, theirsChildren) } as FolderItem
  }

  function mergeList(oursList: FolderItem[], theirsList: FolderItem[]): FolderItem[] {
    const merged = oursList.map(mergeItem)
    const oursIds = new Set(oursList.map((item) => item.id))
    for (const theirsItem of theirsList) {
      if (!oursIds.has(theirsItem.id) && !oursById.has(theirsItem.id)) {
        merged.push(theirsItem)
      }
    }
    return merged
  }

  return mergeList(oursItems, theirsItems)
}
