import { isContainerNode, isTabGroupNode } from 'electron-core-ui/renderer'
import type { GroupNode, EditorTab } from 'electron-core-ui/renderer'

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
  if (t.breadcrumbs?.some((bc) => bc.id === itemId)) return true
  return false
}
