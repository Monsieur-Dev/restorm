import { describe, it, expect, vi } from 'vitest'
import type { GroupNode, EditorTab } from 'electron-core-ui/renderer'

// The real `electron-core-ui/renderer` barrel pulls in CSS/effects that the
// vitest transform can't resolve. The util only needs the two structural node
// guards, so stub them — they're a plain `'key' in node` check.
vi.mock('electron-core-ui/renderer', () => ({
  isContainerNode: (node: object) => 'groups' in node,
  isTabGroupNode: (node: object) => 'tabs' in node
}))

import { mapAllWorkbenchTabs, pruneOrphanTabs, collectTreeItemIds, tabBackingItemId } from './workbenchTabs'

// Minimal tab stub — the mapper only ever spreads tabs and calls mapTab, so a
// bare id is enough for these structural tests.
function tab(id: string): EditorTab {
  return { id, title: id } as unknown as EditorTab
}

// Tag a tab so we can assert mapTab actually ran on it.
const markVisited = (t: EditorTab): EditorTab =>
  ({ ...(t as object), visited: true }) as unknown as EditorTab

describe('mapAllWorkbenchTabs', () => {
  it('preserves a side-by-side split — every top-level group survives', () => {
    // Two top-level tab groups (the side-by-side layout from the bug report).
    const groups: GroupNode[] = [
      { id: 'left', tabs: [tab('a'), tab('b')], activeTabId: 'a' },
      { id: 'right', tabs: [tab('health')], activeTabId: 'health' }
    ]

    const out = mapAllWorkbenchTabs(groups, markVisited)

    // Regression: the old breadcrumb refresh kept only groups[0], dropping the
    // second pane. Both groups must remain.
    expect(out.map((g) => g.id)).toEqual(['left', 'right'])
    for (const g of out) {
      if ('tabs' in g) {
        expect(g.tabs.every((t) => (t as { visited?: boolean }).visited)).toBe(true)
      }
    }
  })

  it('recurses into container nodes and keeps their structure + sizes', () => {
    const groups: GroupNode[] = [
      {
        id: 'container',
        orientation: 'horizontal',
        sizes: [0.6, 0.4],
        groups: [
          { id: 'pane-1', tabs: [tab('x')], activeTabId: 'x' },
          { id: 'pane-2', tabs: [tab('y')], activeTabId: 'y' }
        ]
      }
    ]

    const out = mapAllWorkbenchTabs(groups, markVisited)

    expect(out).toHaveLength(1)
    const container = out[0]
    if (!container || !('groups' in container)) throw new Error('expected a container node')
    expect(container.sizes).toEqual([0.6, 0.4])
    expect(container.groups.map((g) => g.id)).toEqual(['pane-1', 'pane-2'])
    for (const pane of container.groups) {
      if ('tabs' in pane) {
        expect(pane.tabs.every((t) => (t as { visited?: boolean }).visited)).toBe(true)
      }
    }
  })

  it('returns a new array without mutating the input groups', () => {
    const groups: GroupNode[] = [{ id: 'g', tabs: [tab('a')], activeTabId: 'a' }]
    const out = mapAllWorkbenchTabs(groups, markVisited)
    expect(out).not.toBe(groups)
    // original tab untouched
    expect((groups[0] as { tabs: EditorTab[] }).tabs[0]).not.toHaveProperty('visited')
  })
})

// Item-backed tab: a workbench tab tied to a tree item carries the id on
// `request` / `folder` / `scenario` depending on kind.
function backedTab(id: string, kind: 'request' | 'folder' | 'scenario', itemId: string): EditorTab {
  return { id, title: id, [kind]: { id: itemId } } as unknown as EditorTab
}

describe('collectTreeItemIds', () => {
  it('collects ids across folders, nested items and scenarios', () => {
    const tree = [
      { id: 'env', items: [
        { id: 'folder', items: [{ id: 'req-1' }, { id: 'req-2' }] },
        { id: 'scenario', items: [{ id: 'child-req' }] }
      ] }
    ]
    expect(collectTreeItemIds(tree)).toEqual(new Set(['env', 'folder', 'req-1', 'req-2', 'scenario', 'child-req']))
  })
})

describe('tabBackingItemId', () => {
  it('reads request / folder / scenario id, undefined for a non-item tab', () => {
    expect(tabBackingItemId(backedTab('t', 'request', 'r1'))).toBe('r1')
    expect(tabBackingItemId(backedTab('t', 'folder', 'f1'))).toBe('f1')
    expect(tabBackingItemId(backedTab('t', 'scenario', 's1'))).toBe('s1')
    expect(tabBackingItemId(tab('project'))).toBeUndefined()
  })
})

describe('pruneOrphanTabs', () => {
  it('closes a tab whose backing item was deleted, keeps the live ones', () => {
    // Repro: an MCP delete_item removed request "gone"; its tab must close.
    const groups: GroupNode[] = [
      { id: 'g', tabs: [backedTab('t-live', 'request', 'live'), backedTab('t-gone', 'request', 'gone')], activeTabId: 't-gone' }
    ]
    const out = pruneOrphanTabs(groups, new Set(['live']))
    expect(out).toHaveLength(1)
    const g = out[0] as { tabs: EditorTab[]; activeTabId: string }
    expect(g.tabs.map((t) => t.id)).toEqual(['t-live'])
    // Active tab followed off the closed tab onto the survivor.
    expect(g.activeTabId).toBe('t-live')
  })

  it('never prunes a tab not backed by a tree item (project/settings tab)', () => {
    const groups: GroupNode[] = [{ id: 'g', tabs: [tab('settings')], activeTabId: 'settings' }]
    const out = pruneOrphanTabs(groups, new Set())
    expect((out[0] as { tabs: EditorTab[] }).tabs.map((t) => t.id)).toEqual(['settings'])
  })

  it('drops an emptied group and recurses into split containers', () => {
    const groups: GroupNode[] = [
      { id: 'left', tabs: [backedTab('t-gone', 'request', 'gone')], activeTabId: 't-gone' },
      { id: 'container', orientation: 'horizontal', sizes: [0.5, 0.5], groups: [
        { id: 'p1', tabs: [backedTab('t-keep', 'folder', 'keep')], activeTabId: 't-keep' },
        { id: 'p2', tabs: [backedTab('t-gone2', 'scenario', 'gone2')], activeTabId: 't-gone2' }
      ] }
    ]
    const out = pruneOrphanTabs(groups, new Set(['keep']))
    // 'left' emptied → dropped; container keeps only the surviving pane.
    expect(out).toHaveLength(1)
    const container = out[0]
    if (!container || !('groups' in container)) throw new Error('expected a container node')
    expect(container.groups.map((g) => g.id)).toEqual(['p1'])
  })
})
