import { describe, it, expect } from 'vitest'
import { removeTab, normalizeTree, cloneTree, moveTabToAdjacentGroup } from './tree'
import type { WorkbenchTree, TabGroupNode, EditorTab } from './types'
import { isTabGroupNode } from './types'

// Helper: create a simple tab
function tab(id: string): EditorTab {
  return { id, title: id }
}

// Helper: simulate same-group reorder (mirrors handleMoveWithinGroup logic from EditorWorkbench)
function reorderWithinGroup(
  tree: WorkbenchTree,
  groupId: string,
  tabId: string,
  toIndex: number
): WorkbenchTree {
  const next = cloneTree(tree)
  for (const n of next.groups) {
    if (isTabGroupNode(n) && n.id === groupId) {
      const moving = n.tabs.find(t => t.id === tabId)
      if (!moving) return next
      const rest = n.tabs.filter(t => t.id !== tabId)
      const idx = Math.max(0, Math.min(toIndex, rest.length))
      n.tabs = [...rest.slice(0, idx), moving, ...rest.slice(idx)]
      return next
    }
  }
  return next
}

// Helper: simulate inter-group move (mirrors handleMoveWithinGroup logic from EditorWorkbench)
function moveToOtherGroup(
  tree: WorkbenchTree,
  fromGroupId: string,
  tabId: string,
  toGroupId: string,
  toIndex: number
): WorkbenchTree {
  const removed = removeTab(tree, fromGroupId, tabId)
  const movingTab = removed.tab
  if (!movingTab) return removed.tree
  const next = cloneTree(removed.tree)

  for (const n of next.groups) {
    if (isTabGroupNode(n) && n.id === toGroupId) {
      const idx = Math.max(0, Math.min(toIndex, n.tabs.length))
      n.tabs = [...n.tabs.slice(0, idx), movingTab, ...n.tabs.slice(idx)]
      n.activeTabId = movingTab.id
      return normalizeTree(next)
    }
  }
  return normalizeTree(next)
}

describe('tab reordering within the same group', () => {
  it('should move first tab to second position (drag tab A before tab B)', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' }
      ]
    }

    const result = reorderWithinGroup(tree, 'g1', 'A', 1)
    const group = result.groups[0] as TabGroupNode
    expect(group.tabs.map(t => t.id)).toEqual(['B', 'A'])
  })

  it('should move second tab to first position (drag tab B before tab A)', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' }
      ]
    }

    const result = reorderWithinGroup(tree, 'g1', 'B', 0)
    const group = result.groups[0] as TabGroupNode
    expect(group.tabs.map(t => t.id)).toEqual(['B', 'A'])
  })

  it('should move a tab from position 0 to position 2 in a 3-tab group', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A'), tab('B'), tab('C')], activeTabId: 'A' }
      ]
    }

    const result = reorderWithinGroup(tree, 'g1', 'A', 2)
    const group = result.groups[0] as TabGroupNode
    expect(group.tabs.map(t => t.id)).toEqual(['B', 'C', 'A'])
  })

  it('should not change order when dropping a tab at its current position', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A'), tab('B'), tab('C')], activeTabId: 'A' }
      ]
    }

    const result = reorderWithinGroup(tree, 'g1', 'B', 1)
    const group = result.groups[0] as TabGroupNode
    expect(group.tabs.map(t => t.id)).toEqual(['A', 'B', 'C'])
  })

  it('should not mutate the original tree', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' }
      ]
    }

    reorderWithinGroup(tree, 'g1', 'A', 1)
    const group = tree.groups[0] as TabGroupNode
    expect(group.tabs.map(t => t.id)).toEqual(['A', 'B'])
  })
})

describe('tab move between groups (inter-group)', () => {
  it('should move a tab from one group to another at index 0', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' },
        { id: 'g2', tabs: [tab('C')], activeTabId: 'C' }
      ]
    }

    const result = moveToOtherGroup(tree, 'g2', 'C', 'g1', 0)
    // g2 becomes empty and is removed by normalizeTree
    expect(result.groups).toHaveLength(1)
    const group = result.groups[0] as TabGroupNode
    expect(group.tabs.map(t => t.id)).toEqual(['C', 'A', 'B'])
    expect(group.activeTabId).toBe('C')
  })

  it('should move a tab from one group to another at the end', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' },
        { id: 'g2', tabs: [tab('C'), tab('D')], activeTabId: 'C' }
      ]
    }

    const result = moveToOtherGroup(tree, 'g2', 'C', 'g1', 2)
    const g1 = result.groups[0] as TabGroupNode
    const g2 = result.groups[1] as TabGroupNode
    expect(g1.tabs.map(t => t.id)).toEqual(['A', 'B', 'C'])
    expect(g1.activeTabId).toBe('C')
    expect(g2.tabs.map(t => t.id)).toEqual(['D'])
  })

  it('should not mutate the original tree', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A')], activeTabId: 'A' },
        { id: 'g2', tabs: [tab('B')], activeTabId: 'B' }
      ]
    }

    moveToOtherGroup(tree, 'g2', 'B', 'g1', 0)
    expect(tree.groups).toHaveLength(2)
    const g2 = tree.groups[1] as TabGroupNode
    expect(g2.tabs).toHaveLength(1)
  })
})

// Helper: snapshot the tree as a string — each group rendered as
// `[tab1,tab2,...]` with the active tab marked `*`.
function snapshot(tree: WorkbenchTree): string {
  return tree.groups
    .filter(isTabGroupNode)
    .map((g) => {
      const ids = g.tabs.map((t) => (g.activeTabId === t.id ? `${t.id}*` : t.id))
      return `[${ids.join(',')}]`
    })
    .join('')
}

describe('moveTabToAdjacentGroup — Ctrl+Alt+Left/Right', () => {
  it('[A*,B] right → [B*][A*]: creates a new group on the right when none exists', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [{ id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' }]
    }
    const { tree: next, destGroupId } = moveTabToAdjacentGroup(tree, 'g1', 'A', 'right')
    expect(snapshot(next)).toBe('[B*][A*]')
    expect(destGroupId).toBeTruthy()
  })

  it('[B][A*] left → [B,A*]: moves the tab to the end of the left sibling', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('B')], activeTabId: 'B' },
        { id: 'g2', tabs: [tab('A')], activeTabId: 'A' }
      ]
    }
    const { tree: next, destGroupId } = moveTabToAdjacentGroup(tree, 'g2', 'A', 'left')
    expect(snapshot(next)).toBe('[B,A*]')
    expect(destGroupId).toBe('g1')
  })

  it('[B,A*] left → [A*][B*]: creates a new left group when none exists', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [{ id: 'g1', tabs: [tab('B'), tab('A')], activeTabId: 'A' }]
    }
    const { tree: next } = moveTabToAdjacentGroup(tree, 'g1', 'A', 'left')
    expect(snapshot(next)).toBe('[A*][B*]')
  })

  it('[A*,B][C] right → [B*][C,A*]: appends to the existing right group', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' },
        { id: 'g2', tabs: [tab('C')], activeTabId: 'C' }
      ]
    }
    const { tree: next, destGroupId } = moveTabToAdjacentGroup(tree, 'g1', 'A', 'right')
    expect(snapshot(next)).toBe('[B*][C,A*]')
    expect(destGroupId).toBe('g2')
  })

  it('[B][C,A*] right → [B*][C*][A*]: creates a new rightmost group', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('B')], activeTabId: 'B' },
        { id: 'g2', tabs: [tab('C'), tab('A')], activeTabId: 'A' }
      ]
    }
    const { tree: next } = moveTabToAdjacentGroup(tree, 'g2', 'A', 'right')
    expect(snapshot(next)).toBe('[B*][C*][A*]')
  })

  it('[B][C][A*] right → no-op when no destination and source has a single tab', () => {
    const tree: WorkbenchTree = {
      orientation: 'vertical',
      groups: [
        { id: 'g1', tabs: [tab('B')], activeTabId: 'B' },
        { id: 'g2', tabs: [tab('C')], activeTabId: 'C' },
        { id: 'g3', tabs: [tab('A')], activeTabId: 'A' }
      ]
    }
    const { tree: next, destGroupId } = moveTabToAdjacentGroup(tree, 'g3', 'A', 'right')
    expect(snapshot(next)).toBe('[B*][C*][A*]')
    expect(next).toBe(tree) // unchanged reference
    expect(destGroupId).toBeNull()
  })
})
