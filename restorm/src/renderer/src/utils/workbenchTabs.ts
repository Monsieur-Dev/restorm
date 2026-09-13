import { isContainerNode, isTabGroupNode } from 'electron-core-ui/renderer'
import type { GroupNode, EditorTab } from 'electron-core-ui/renderer'
import { isSingletonTabId } from '../../../shared/types/editor'
export { collectTreeItemIds } from './treeItemIds'

/**
 * Map every tab in a workbench `groups` array, recursing into the container
 * nodes of split-pane layouts, and return a new groups array with the SAME
 * structure — every pane preserved.
 *
 * Handlers that refresh tab data after a tree mutation (breadcrumb recompute,
 * tag/colour bumps, …) must go through this rather than rebuilding only
 * `groups[0]`: a naive `return { ...tree, groups: [{ ...groups[0], tabs }] }`
 * silently drops every other pane, so any such refresh fired while a
 * side-by-side split is open collapses the second group.
 */
export function mapAllWorkbenchTabs(
  groups: readonly GroupNode[],
  mapTab: (tab: EditorTab) => EditorTab
): GroupNode[] {
  return groups.map((node) => {
    if (isContainerNode(node)) return { ...node, groups: mapAllWorkbenchTabs(node.groups, mapTab) }
    if (isTabGroupNode(node)) return { ...node, tabs: node.tabs.map(mapTab) }
    return node
  })
}

/** A workbench tab backed by a tree item carries the item's id on one of
 * `request` / `folder` / `scenario` depending on its kind. */
type ItemBackedTab = EditorTab & {
  request?: { id?: string }
  folder?: { id?: string }
  scenario?: { id?: string }
  design?: { id?: string }
  session?: { id?: string }
  breadcrumbs?: { id?: string }[]
}

/**
 * True when a workbench tab is backed by (or nested under) the tree item
 * `itemId`. A tab is backed by a request (any protocol), a (env-)folder,
 * OR a scenario — each puts the id on a different field — and an item can
 * also appear in a tab's breadcrumb trail (a child of the deleted folder).
 * Matching all of these is what lets delete/close/reveal-by-id work for
 * scenario-editor tabs and non-HTTP request tabs, not just http-request /
 * folder tabs.
 */
export function tabReferencesItem(tab: EditorTab, itemId: string): boolean {
  const t = tab as ItemBackedTab
  if (t.request?.id === itemId) return true
  if (t.folder?.id === itemId) return true
  if (t.scenario?.id === itemId) return true
  if (t.design?.id === itemId) return true
  if (t.session?.id === itemId) return true
  if (t.breadcrumbs?.some((bc) => bc.id === itemId)) return true
  return false
}

/**
 * True when a workbench tab IS the tab addressed by `itemId` — the narrower
 * sibling of {@link tabReferencesItem}, which also matches breadcrumb
 * ancestors. Used by the close / activate / reveal handlers, where matching an
 * ancestor would act on the wrong tab.
 *
 * A singleton tab (Console, Settings, Firewall, Mini browser, MCP logs) backs
 * onto no tree item at all, so its own stable tab id is the only handle a
 * caller has for it — match that directly, or those tabs are unaddressable.
 */
export function tabMatchesItem(tab: EditorTab, itemId: string): boolean {
  if (isSingletonTabId(itemId)) return tab.id === itemId
  const t = tab as ItemBackedTab
  return t.request?.id === itemId || t.folder?.id === itemId || t.scenario?.id === itemId || t.design?.id === itemId || t.session?.id === itemId
}

/**
 * The id of the tree item a tab is primarily backed by (request / folder /
 * scenario), or `undefined` for tabs not backed by a tree item at all (a
 * project-file / settings / scratch tab, which must NEVER be pruned by the
 * orphan sweep). Breadcrumb ancestors are deliberately ignored here: when a
 * folder is deleted its descendants leave the tree too, so their own backing
 * id already disappears from the "existing ids" set.
 */
export function tabBackingItemId(tab: EditorTab): string | undefined {
  const t = tab as ItemBackedTab
  return t.request?.id ?? t.folder?.id ?? t.scenario?.id ?? t.design?.id ?? t.session?.id
}

/**
 * Drop every tab whose backing tree item is no longer present in
 * `existingIds`, in EVERY pane (recursing into split containers), pruning
 * emptied tab-groups + emptied containers and re-picking each surviving
 * group's active tab. Tabs not backed by a tree item (project/settings)
 * are always kept. Mirrors the delete-path pruning so the invariant
 * "every open tab maps to a live sidebar item" also holds after a
 * main-driven (MCP) tree replacement, not only after a UI delete.
 */
export function pruneOrphanTabs(groups: readonly GroupNode[], existingIds: Set<string>): GroupNode[] {
  const result: GroupNode[] = []
  for (const node of groups) {
    if (isContainerNode(node)) {
      const prunedChildren = pruneOrphanTabs(node.groups, existingIds)
      if (prunedChildren.length > 0) result.push({ ...node, groups: prunedChildren })
      continue
    }
    if (!isTabGroupNode(node)) {
      result.push(node)
      continue
    }
    const filteredTabs = node.tabs.filter((tab) => {
      const backingId = tabBackingItemId(tab)
      return backingId === undefined || existingIds.has(backingId)
    })
    if (filteredTabs.length === 0) continue
    let newActiveTabId: string = node.activeTabId ?? ''
    if (!filteredTabs.some((t) => t.id === node.activeTabId)) {
      newActiveTabId = filteredTabs[0]?.id ?? ''
    }
    result.push({ ...node, tabs: filteredTabs, activeTabId: newActiveTabId })
  }
  return result
}
