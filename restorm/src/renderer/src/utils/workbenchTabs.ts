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
