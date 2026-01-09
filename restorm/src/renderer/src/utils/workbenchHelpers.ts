/**
 * Utility functions for manipulating the workbench tree structure
 */

import type { GroupNode, TabGroupNode } from 'electron-core-ui/renderer'
import { isTabGroupNode, isContainerNode } from 'electron-core-ui/renderer'

/** Find the ID of the first tab group in a potentially nested workbench tree */
export function findFirstTabGroupId(nodes: GroupNode[]): string | null {
  for (const node of nodes) {
    if (isTabGroupNode(node)) {
      return node.id
    }
    if (isContainerNode(node)) {
      const childId = findFirstTabGroupId(node.groups)
      if (childId) return childId
    }
  }
  return null
}

/** Check if a group with the given ID exists anywhere in the tree */
export function hasGroupWithId(nodes: GroupNode[], groupId: string): boolean {
  for (const node of nodes) {
    if (isTabGroupNode(node)) {
      if (node.id === groupId) return true
    } else if (isContainerNode(node)) {
      if (hasGroupWithId(node.groups, groupId)) return true
    }
  }
  return false
}

/** Find the ID of the group containing a tab with the given ID */
export function findGroupIdForTab(nodes: GroupNode[], tabId: string): string | null {
  for (const node of nodes) {
    if (isTabGroupNode(node)) {
      if (node.tabs.some((tab) => tab.id === tabId)) {
        return node.id
      }
    } else if (isContainerNode(node)) {
      const childId = findGroupIdForTab(node.groups, tabId)
      if (childId) return childId
    }
  }
  return null
}

/** Update a specific tab group by ID anywhere in the tree */
export function updateGroupById(
  nodes: GroupNode[],
  groupId: string,
  updater: (group: TabGroupNode) => TabGroupNode
): GroupNode[] {
  return nodes.map((node) => {
    if (isTabGroupNode(node)) {
      if (node.id === groupId) {
        return updater(node)
      }
      return node
    }
    if (isContainerNode(node)) {
      return {
        ...node,
        groups: updateGroupById(node.groups, groupId, updater)
      }
    }
    return node
  })
}
