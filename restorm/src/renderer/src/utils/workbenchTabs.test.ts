import { describe, it, expect, vi } from 'vitest'
import type { GroupNode, EditorTab } from 'electron-core-ui/renderer'

// The real `electron-core-ui/renderer` barrel pulls in CSS/effects that the
// vitest transform can't resolve. The util only needs the two structural node
// guards, so stub them — they're a plain `'key' in node` check.
vi.mock('electron-core-ui/renderer', () => ({
  isContainerNode: (node: object) => 'groups' in node,
  isTabGroupNode: (node: object) => 'tabs' in node
}))

import { mapAllWorkbenchTabs } from './workbenchTabs'

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
