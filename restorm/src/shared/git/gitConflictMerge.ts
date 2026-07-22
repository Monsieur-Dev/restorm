import type { FolderItem } from '../types/folderTypes'
import { isEnvironmentFolder } from '../types/folderTypes'
import type { QuickConfig } from '../types/requests/QuickConfig'
import { resolveApiDocumentationConflict, type ApiDocumentationCommitTimestamps } from './apiDocumentationConflict'
import { flattenEntities, ownFieldsSnapshot } from './gitCommitDiff'

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
/**
 * A request's own `documentation` auto-resolves too — same reasoning as
 * the env-folder's `apiDocumentation` (imported content the user does not
 * author, so it is never theirs to arbitrate), and it is excluded from
 * the conflict snapshot for that reason.
 *
 * There is no version number to compare on a request, so the rule is the
 * timestamp half of it: the newer commit's documentation wins. With no
 * timestamps, or a tie, `ours` stands — the stable default used
 * everywhere else here.
 */
function mergeRequestDocumentation(
  base: FolderItem,
  oursCounterpart: FolderItem | undefined,
  theirsCounterpart: FolderItem | undefined,
  commitTimestamps?: ApiDocumentationCommitTimestamps
): FolderItem {
  if (!oursCounterpart || !theirsCounterpart) return base
  const oursDoc = (oursCounterpart as FolderItem & { documentation?: unknown }).documentation
  const theirsDoc = (theirsCounterpart as FolderItem & { documentation?: unknown }).documentation
  if (JSON.stringify(oursDoc) === JSON.stringify(theirsDoc)) return base
  const ourTime = commitTimestamps?.ours ?? null
  const theirTime = commitTimestamps?.theirs ?? null
  const theirsIsNewer = ourTime !== null && theirTime !== null && theirTime > ourTime
  const winner = theirsIsNewer ? theirsDoc : oursDoc
  // `documentation` is not on the typed union (same unmodeled-field gap as
  // `quickConfigs` above), so name it as an explicit intersection rather
  // than casting the whole item through `unknown`.
  const merged: FolderItem & { documentation?: unknown } = { ...base, documentation: winner }
  return merged
}

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
  commitTimestamps?: ApiDocumentationCommitTimestamps,
  baseItems?: FolderItem[]
): FolderItem[] {
  const oursById = flattenEntities(oursItems)
  const theirsById = flattenEntities(theirsItems)
  // The common ancestor, when the caller can supply it, is what makes a
  // one-sided change resolvable without asking: an entity we never
  // touched but they did must take THEIR version. The merged tree is
  // walked from OUR side, so without this that change is silently
  // dropped — the entity isn't a conflict (nobody contested it), so no
  // resolution pick exists to bring it back.
  const baseById = baseItems ? flattenEntities(baseItems) : null

  function childrenOf(item: FolderItem): FolderItem[] {
    return (item as FolderItem & { items?: FolderItem[] }).items ?? []
  }

  /**
   * Own-fields arbitration for an entity NOBODY flagged as a conflict:
   * when our side still matches the common ancestor and theirs moved,
   * their edit is the only edit — adopt it. Every other case keeps ours
   * (we changed it and they didn't, or neither did). Children are not
   * touched here; `mergeList` handles the tree shape.
   */
  function takeTheirsIfOnlyTheyChanged(item: FolderItem): FolderItem {
    if (!baseById) return item
    const baseEntry = baseById.get(item.id)
    const theirsEntry = theirsById.get(item.id)
    if (!baseEntry || !theirsEntry) return item
    const oursUnchanged = ownFieldsSnapshot(item) === ownFieldsSnapshot(baseEntry.item)
    if (!oursUnchanged) return item
    const theirsChanged = ownFieldsSnapshot(theirsEntry.item) !== ownFieldsSnapshot(baseEntry.item)
    return theirsChanged ? theirsEntry.item : item
  }

  function mergeItem(item: FolderItem): FolderItem {
    const resolved = resolvedById[item.id]
    const base = resolved ?? takeTheirsIfOnlyTheyChanged(item)
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
      const withRequestDocumentation = mergeRequestDocumentation(base, oursCounterpart, theirsCounterpart, commitTimestamps)
      return mergeQuickConfigs(withRequestDocumentation, theirsCounterpart)
    }
    const withDocumentation = mergeApiDocumentation(base, oursCounterpart, theirsCounterpart, commitTimestamps)
    const theirsChildren = theirsCounterpart ? childrenOf(theirsCounterpart) : []
    return { ...withDocumentation, items: mergeList(ownChildren, theirsChildren) } as FolderItem
  }

  /**
   * Deletion semantics, both directions (Yoann's rule): a deletion the
   * other side never contested is honoured, and a deletion that races an
   * edit loses — the edited entity survives and comes back for whoever
   * deleted it. Work is never destroyed silently; an uncontested
   * housekeeping delete is never silently undone either.
   *
   * Both need the common ancestor to tell "they deleted it" from "it was
   * never there". Without `baseItems` the previous behaviour stands:
   * every entity present on either side is kept.
   */
  /**
   * "Untouched" for a deletion decision has to mean the whole subtree,
   * not just the entity's own fields — `ownFieldsSnapshot` drops
   * `items`, so a folder whose every request the other side rewrote
   * still looks pristine, and honouring the deletion would take their
   * work down with the folder without a word.
   *
   * Deleting is cheap to redo and impossible to undo, so when a subtree
   * diverges the surviving side wins and the deletion is not applied.
   */
  function subtreeSnapshot(item: FolderItem): string {
    const children = (item as FolderItem & { items?: FolderItem[] }).items ?? []
    return [ownFieldsSnapshot(item), ...children.map(subtreeSnapshot)].join('\u0000')
  }

  function theyDeletedAndWeLeftItAlone(item: FolderItem): boolean {
    if (!baseById) return false
    const baseEntry = baseById.get(item.id)
    // Not in the ancestor = we ADDED it; there is nothing for them to
    // have deleted.
    if (!baseEntry || theirsById.has(item.id)) return false
    return subtreeSnapshot(item) === subtreeSnapshot(baseEntry.item)
  }

  function weDeletedAndTheyLeftItAlone(theirsItem: FolderItem): boolean {
    if (!baseById) return false
    const baseEntry = baseById.get(theirsItem.id)
    // Not in the ancestor = they ADDED it, so it is new work, not a
    // resurrection of something we removed.
    if (!baseEntry) return false
    return subtreeSnapshot(theirsItem) === subtreeSnapshot(baseEntry.item)
  }

  function mergeList(oursList: FolderItem[], theirsList: FolderItem[]): FolderItem[] {
    const merged = oursList.filter((item) => !theyDeletedAndWeLeftItAlone(item)).map(mergeItem)
    const oursIds = new Set(oursList.map((item) => item.id))
    for (const theirsItem of theirsList) {
      if (oursIds.has(theirsItem.id) || oursById.has(theirsItem.id)) continue
      if (weDeletedAndTheyLeftItAlone(theirsItem)) continue
      merged.push(theirsItem)
    }
    return merged
  }

  return mergeList(oursItems, theirsItems)
}
