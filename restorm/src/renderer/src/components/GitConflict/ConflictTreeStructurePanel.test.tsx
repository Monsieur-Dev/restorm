// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

// The real ListView is the point of this component, but it drags in the
// whole ECUI barrel; a marker that echoes what it was handed proves the
// SAME conversion pipeline is used and that nothing was re-invented.
vi.mock('electron-core-ui/renderer', () => ({
  ListView: ({ items, 'data-testid': testId }: { items: { id: string, title?: unknown, children?: unknown[] }[], 'data-testid'?: string }) => (
    <div data-testid={testId} data-item-ids={items.map((i) => i.id).join(',')} data-child-count={String(items[0]?.children?.length ?? 0)} />
  )
}))
vi.mock('../common/Badge', () => ({ Badge: () => <span /> }))
vi.mock('../common/RegistryBadge', () => ({ RegistryBadge: () => <span /> }))

import { ConflictTreeStructurePanel } from './ConflictTreeStructurePanel'
import type { FolderItem } from '../../../../shared/types/folderTypes'

afterEach(() => { cleanup() })

const tree = [
  {
    id: 'f1', name: 'Folder A', tags: [], configuration: {},
    items: [{ id: 'r1', name: 'Find pet', type: 'http', method: 'GET', tags: [], url: 'https://example.com', headers: [], params: [], pathParams: [] }]
  },
  { id: 'f2', name: 'Folder B', tags: [], configuration: {}, items: [] }
] as unknown as FolderItem[]

describe('ConflictTreeStructurePanel', () => {
  it('feeds the sidebar ListView with the sidebar conversion, nesting included', () => {
    render(<ConflictTreeStructurePanel items={tree} movedItemIds={[]} />)

    const list = screen.getByTestId('conflict-tree-structure-list')
    expect(list.getAttribute('data-item-ids')).toBe('f1,f2')
    expect(list.getAttribute('data-child-count')).toBe('1')
  })

  it('outlines exactly the rows that moved, by row id', () => {
    render(<ConflictTreeStructurePanel items={tree} movedItemIds={['r1']} />)

    const panel = screen.getByTestId('conflict-tree-structure')
    const rule = panel.querySelector('style')?.textContent ?? ''
    expect(rule).toContain('[data-item-id="r1"]')
    expect(rule).not.toContain('[data-item-id="f1"]')
  })

  it('adds no styling at all when nothing moved', () => {
    render(<ConflictTreeStructurePanel items={tree} movedItemIds={[]} />)
    expect(screen.getByTestId('conflict-tree-structure').querySelector('style')).toBeNull()
  })
})
