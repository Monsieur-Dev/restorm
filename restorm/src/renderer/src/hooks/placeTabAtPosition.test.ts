import { describe, it, expect, vi } from 'vitest'
import type { WorkbenchTree, EditorTab } from 'electron-core-ui/renderer'

// Re-route the ECUI renderer barrel to the workbench-tree module + node
// guards only. The full barrel pulls runtime effects that import `.css`,
// which the vitest transform can't resolve in a unit context; we just need
// the pure tree ops the placement logic delegates to.
vi.mock('electron-core-ui/renderer', async () => {
  // Import the pure tree module from ECUI SOURCE (no CSS deps) so vitest can
  // transform it; the dist barrel can't be imported here (CSS).
  const tree = await import('../../../../../electron-core-ui/src/renderer/components/Workbench/tree')
  const types = await import('../../../../../electron-core-ui/src/renderer/components/Workbench/types')
  return {
    insertTabAt: tree.insertTabAt,
    normalizeTree: tree.normalizeTree,
    removeTab: tree.removeTab,
    findGroup: tree.findGroup,
    isContainerNode: types.isContainerNode,
    isTabGroupNode: types.isTabGroupNode,
    computeChecksum: () => '',
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
  }
})

import { isContainerNode, isTabGroupNode } from 'electron-core-ui/renderer'
import { placeTabAtPosition } from './useWorkbenchTabs'

// Pure placement logic behind the sidebar→workbench split drop: the dragged
// item opens beside the drop target (4 edges split, center = stack), de-dupes
// an already-open copy, and falls back when the target group disappears.

const tab = (id: string, itemId?: string): EditorTab =>
  // `request.id` is how `placeTabAtPosition` recognises an open copy by item id.
  ({ id, title: id, titleString: id, ...(itemId ? { request: { id: itemId } } : {}) } as unknown as EditorTab)

const singleGroupTree = (): WorkbenchTree => ({
  orientation: 'horizontal',
  groups: [{ id: 'g1', tabs: [tab('request-id:A', 'A')], activeTabId: 'request-id:A' }]
})

/** Collect every tab group as { id, tabIds } in tree order. */
function groupsOf(tree: WorkbenchTree): { id: string; tabIds: string[] }[] {
  const out: { id: string; tabIds: string[] }[] = []
  const walk = (nodes: WorkbenchTree['groups']): void => {
    for (const n of nodes) {
      if (isTabGroupNode(n)) out.push({ id: n.id, tabIds: n.tabs.map((t) => t.id) })
      else if (isContainerNode(n)) walk(n.groups)
    }
  }
  walk(tree.groups)
  return out
}

describe('placeTabAtPosition', () => {
  it('center zone (full) stacks the tab in the target group', () => {
    const { tree, landedGroupId } = placeTabAtPosition(
      singleGroupTree(),
      'request-id:B',
      tab('request-id:B', 'B'),
      { targetGroupId: 'g1', zone: 'full' },
      'B'
    )
    expect(landedGroupId).toBe('g1')
    const groups = groupsOf(tree)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.tabIds).toEqual(['request-id:A', 'request-id:B'])
  })

  it('right zone splits into a second group beside the target', () => {
    const { tree } = placeTabAtPosition(
      singleGroupTree(),
      'request-id:B',
      tab('request-id:B', 'B'),
      { targetGroupId: 'g1', zone: 'right' },
      'B'
    )
    const groups = groupsOf(tree)
    expect(groups).toHaveLength(2)
    // The original group keeps A; a new group holds B, ordered after it.
    expect(groups[0]?.tabIds).toEqual(['request-id:A'])
    expect(groups[1]?.tabIds).toEqual(['request-id:B'])
  })

  it('left zone splits with the new group BEFORE the target', () => {
    const { tree } = placeTabAtPosition(
      singleGroupTree(),
      'request-id:B',
      tab('request-id:B', 'B'),
      { targetGroupId: 'g1', zone: 'left' },
      'B'
    )
    const groups = groupsOf(tree)
    expect(groups).toHaveLength(2)
    expect(groups[0]?.tabIds).toEqual(['request-id:B'])
    expect(groups[1]?.tabIds).toEqual(['request-id:A'])
  })

  it('is a no-op self-drop when the item is the sole tab of the target group', () => {
    // A is the only tab of g1; dropping A onto g1's own right edge would just
    // recreate the same single-pane layout, so the tree is left untouched
    // (mirrors the editor-tab self-drop block) — never two tabs sharing the id.
    const prev = singleGroupTree()
    const { tree, landedGroupId } = placeTabAtPosition(
      prev,
      'request-id:A',
      tab('request-id:A', 'A'),
      { targetGroupId: 'g1', zone: 'right' },
      'A'
    )
    expect(tree).toBe(prev)
    expect(landedGroupId).toBe('g1')
    const groups = groupsOf(tree)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.tabIds).toEqual(['request-id:A'])
  })

  it('moves an already-open tab into a split when its group has other tabs', () => {
    // g1 holds A + B; dropping A onto g1's right edge splits A out beside B —
    // A is removed from g1 first so it never appears twice.
    const prev: WorkbenchTree = {
      orientation: 'horizontal',
      groups: [{ id: 'g1', tabs: [tab('request-id:A', 'A'), tab('request-id:B', 'B')], activeTabId: 'request-id:A' }]
    }
    const { tree } = placeTabAtPosition(
      prev,
      'request-id:A',
      tab('request-id:A', 'A'),
      { targetGroupId: 'g1', zone: 'right' },
      'A'
    )
    const groups = groupsOf(tree)
    const allTabIds = groups.flatMap((g) => g.tabIds)
    expect(allTabIds.filter((id) => id === 'request-id:A')).toHaveLength(1)
    expect(groups).toHaveLength(2)
    expect(allTabIds).toContain('request-id:B')
  })

  it('de-dupes by item id when the tab id changed (item moved parents)', () => {
    // The open tab carries item id "A" under a legacy index-path tab id; the
    // new open uses the uuid tab id. They must collapse to one tab.
    const tree0: WorkbenchTree = {
      orientation: 'horizontal',
      groups: [
        { id: 'g1', tabs: [tab('request-idx:0.1', 'A')], activeTabId: 'request-idx:0.1' },
        { id: 'g2', tabs: [tab('request-id:C', 'C')], activeTabId: 'request-id:C' }
      ]
    }
    const { tree } = placeTabAtPosition(
      tree0,
      'request-id:A',
      tab('request-id:A', 'A'),
      { targetGroupId: 'g2', zone: 'bottom' },
      'A'
    )
    const allTabIds = groupsOf(tree).flatMap((g) => g.tabIds)
    expect(allTabIds).not.toContain('request-idx:0.1')
    expect(allTabIds.filter((id) => id === 'request-id:A')).toHaveLength(1)
  })

  it('is a no-op self-drop in a multi-group layout (sole tab onto its own group)', () => {
    // g2's only tab is B; dropping B back onto g2 leaves the whole layout
    // (both groups) untouched — the split would just recreate g2.
    const tree0: WorkbenchTree = {
      orientation: 'horizontal',
      groups: [
        { id: 'g1', tabs: [tab('request-id:A', 'A')], activeTabId: 'request-id:A' },
        { id: 'g2', tabs: [tab('request-id:B', 'B')], activeTabId: 'request-id:B' }
      ]
    }
    const { tree, landedGroupId } = placeTabAtPosition(
      tree0,
      'request-id:B',
      tab('request-id:B', 'B'),
      { targetGroupId: 'g2', zone: 'right' },
      'B'
    )
    expect(tree).toBe(tree0)
    expect(landedGroupId).toBe('g2')
    expect(groupsOf(tree)).toHaveLength(2)
  })

  it('splits an item open in ANOTHER group into the target group', () => {
    // B is open in g2; dropping it onto g1's bottom edge moves it beside g1's
    // tab as a new split, removed from g2 first (no duplicate).
    const tree0: WorkbenchTree = {
      orientation: 'horizontal',
      groups: [
        { id: 'g1', tabs: [tab('request-id:A', 'A'), tab('request-id:C', 'C')], activeTabId: 'request-id:A' },
        { id: 'g2', tabs: [tab('request-id:B', 'B')], activeTabId: 'request-id:B' }
      ]
    }
    const { tree } = placeTabAtPosition(
      tree0,
      'request-id:B',
      tab('request-id:B', 'B'),
      { targetGroupId: 'g1', zone: 'bottom' },
      'B'
    )
    const groups = groupsOf(tree)
    const allTabIds = groups.flatMap((g) => g.tabIds)
    expect(allTabIds.filter((id) => id === 'request-id:B')).toHaveLength(1)
    // g1's two tabs stay together; B is in its own new split group.
    const bGroup = groups.find((g) => g.tabIds.includes('request-id:B'))
    expect(bGroup?.tabIds).toEqual(['request-id:B'])
  })
})
