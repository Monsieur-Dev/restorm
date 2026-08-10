// @vitest-environment jsdom
/**
 * `disableDrag` has to remove the drag at its SOURCE, not merely ignore the
 * drop.
 *
 * A row that stays draggable still starts a real HTML5 drag carrying the
 * ListView marker MIME, and any surrounding drop target watching for that
 * marker will claim the gesture — a list with no drop handler of its own is
 * not therefore inert. So the guarantee under test is that the rows are not
 * draggable and stamp nothing, not just that `onItemDrop` goes uncalled.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ListView, LIST_VIEW_DRAG_MIME, LIST_VIEW_MULTI_DRAG_MIME } from './ListView'
import type { ListViewItemData, ListViewDropEventPayload } from './types'

/** jsdom implements no `DataTransfer`; only the parts a drag start touches. */
class FakeDataTransfer {
  effectAllowed = 'none'
  private readonly data = new Map<string, string>()
  get types(): readonly string[] { return Array.from(this.data.keys()) }
  setData(format: string, value: string): void { this.data.set(format, value) }
  getData(format: string): string { return this.data.get(format) ?? '' }
  setDragImage(): void { /* no-op: the custom preview is drawn separately */ }
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  cleanup()
})

const items: ListViewItemData[] = [
  { id: 'first', title: 'First' },
  { id: 'second', title: 'Second' }
]

function row(container: HTMLElement, itemId: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`.list-view-row[data-item-id="${itemId}"]`)
  if (!found) throw new Error(`row not found: ${itemId}`)
  return found
}

describe('ListView drag', () => {
  it('marks rows draggable by default and stamps the marker MIME', () => {
    const { container } = render(<ListView items={items} data-testid="list" />)
    const dataTransfer = new FakeDataTransfer() as unknown as DataTransfer

    expect(row(container, 'first').getAttribute('draggable')).toBe('true')
    fireEvent.dragStart(row(container, 'first'), { dataTransfer })
    expect(Array.from(dataTransfer.types)).toContain(LIST_VIEW_DRAG_MIME)
    expect(dataTransfer.getData('text/plain')).toBe('first')
  })

  it('makes rows undraggable when disableDrag is set', () => {
    const { container } = render(<ListView items={items} disableDrag data-testid="list" />)

    expect(row(container, 'first').getAttribute('draggable')).toBe('false')
    expect(row(container, 'second').getAttribute('draggable')).toBe('false')
  })

  it('stamps no drag payload when disableDrag is set, so no drop target can claim the gesture', () => {
    const { container } = render(<ListView items={items} disableDrag data-testid="list" />)
    const dataTransfer = new FakeDataTransfer() as unknown as DataTransfer

    fireEvent.dragStart(row(container, 'first'), { dataTransfer })

    expect(Array.from(dataTransfer.types)).toEqual([])
  })
})

const threeItems: ListViewItemData[] = [
  { id: 'a', title: 'A' },
  { id: 'b', title: 'B' },
  { id: 'c', title: 'C' }
]

describe('ListView multi-selection', () => {
  it('ctrl+click toggles rows into and out of the selection', () => {
    const onSelectionChange = vi.fn()
    const { container } = render(
      <ListView items={threeItems} selectionMode="multiple" onSelectionChange={onSelectionChange} data-testid="list" />
    )

    fireEvent.click(row(container, 'a'))
    fireEvent.click(row(container, 'c'), { ctrlKey: true })
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.arrayContaining(['a', 'c']), expect.anything())
    expect(row(container, 'a').getAttribute('aria-selected')).toBe('true')
    expect(row(container, 'c').getAttribute('aria-selected')).toBe('true')

    fireEvent.click(row(container, 'a'), { ctrlKey: true })
    expect(row(container, 'a').getAttribute('aria-selected')).toBe('false')
    expect(row(container, 'c').getAttribute('aria-selected')).toBe('true')
  })

  it('shift+click selects the range from the active row', () => {
    const { container } = render(
      <ListView items={threeItems} selectionMode="multiple" data-testid="list" />
    )

    fireEvent.click(row(container, 'a'))
    fireEvent.click(row(container, 'c'), { shiftKey: true })
    for (const id of ['a', 'b', 'c']) {
      expect(row(container, id).getAttribute('aria-selected')).toBe('true')
    }
  })

  it('ctrl+A selects every visible selectable row', () => {
    const onSelectionChange = vi.fn()
    const { container } = render(
      <ListView items={threeItems} selectionMode="multiple" onSelectionChange={onSelectionChange} data-testid="list" />
    )

    fireEvent.click(row(container, 'a'))
    // Keyboard handling is bound to the content wrapper (role=tree), not the
    // scrollable container.
    const tree = container.querySelector('[role="tree"]')
    if (!tree) throw new Error('tree root not found')
    fireEvent.keyDown(tree, { key: 'a', ctrlKey: true })

    for (const id of ['a', 'b', 'c']) {
      expect(row(container, id).getAttribute('aria-selected')).toBe('true')
    }
  })

  it('does NOT let an identity-churned same-content controlled prop reset the selection', () => {
    // A parent that echoes the selection back through `selectedIds` rebuilds
    // the ARRAY every render. Without the content guard, each fresh identity
    // re-fired the mirror effect and reset the internal Set mid-interaction.
    // (A prop whose CONTENT differs still wins — that is what controlled
    // selection means.)
    const { container, rerender } = render(
      <ListView items={threeItems} selectionMode="multiple" selectedIds={['a', 'c']} data-testid="list" />
    )
    expect(row(container, 'c').getAttribute('aria-selected')).toBe('true')
    // New array identity, same content — must be a no-op.
    rerender(<ListView items={threeItems} selectionMode="multiple" selectedIds={['a', 'c']} data-testid="list" />)
    expect(row(container, 'a').getAttribute('aria-selected')).toBe('true')
    expect(row(container, 'c').getAttribute('aria-selected')).toBe('true')
    // Different content still wins.
    rerender(<ListView items={threeItems} selectionMode="multiple" selectedIds={['b']} data-testid="list" />)
    expect(row(container, 'c').getAttribute('aria-selected')).toBe('false')
    expect(row(container, 'b').getAttribute('aria-selected')).toBe('true')
  })
})

describe('ListView multi-drag', () => {
  function selectAAndC(container: HTMLElement): void {
    fireEvent.click(row(container, 'a'))
    fireEvent.click(row(container, 'c'), { ctrlKey: true })
  }

  it('a drag started on a selected row carries the whole selection (multi MIME + sources)', () => {
    const onItemDrop = vi.fn()
    const { container } = render(
      <ListView items={threeItems} selectionMode="multiple" onItemDrop={onItemDrop} data-testid="list" />
    )
    selectAAndC(container)

    const dataTransfer = new FakeDataTransfer() as unknown as DataTransfer
    fireEvent.dragStart(row(container, 'a'), { dataTransfer })

    expect(Array.from(dataTransfer.types)).toContain(LIST_VIEW_MULTI_DRAG_MIME)
    expect(JSON.parse(dataTransfer.getData(LIST_VIEW_MULTI_DRAG_MIME))).toEqual(['a', 'c'])
    // anchor stays on text/plain for single-item consumers
    expect(dataTransfer.getData('text/plain')).toBe('a')

    fireEvent.dragOver(row(container, 'b'), { dataTransfer, clientY: 0 })
    fireEvent.drop(row(container, 'b'), { dataTransfer, clientY: 0 })
    const payload = onItemDrop.mock.calls[0]?.[0] as ListViewDropEventPayload
    expect(payload.sources.map((s) => s.item.id)).toEqual(['a', 'c'])
    expect(payload.source.id).toBe('a')
  })

  it('a drag started OUTSIDE the selection carries only the grabbed row', () => {
    const { container } = render(
      <ListView items={threeItems} selectionMode="multiple" data-testid="list" />
    )
    selectAAndC(container)

    const dataTransfer = new FakeDataTransfer() as unknown as DataTransfer
    fireEvent.dragStart(row(container, 'b'), { dataTransfer })

    expect(Array.from(dataTransfer.types)).not.toContain(LIST_VIEW_MULTI_DRAG_MIME)
    expect(dataTransfer.getData('text/plain')).toBe('b')
  })

  it('canDrop=false suppresses the indicator and blocks the drop', () => {
    const onItemDrop = vi.fn()
    const { container } = render(
      <ListView
        items={threeItems}
        selectionMode="multiple"
        onItemDrop={onItemDrop}
        canDrop={() => false}
        data-testid="list"
      />
    )

    const dataTransfer = new FakeDataTransfer() as unknown as DataTransfer
    fireEvent.dragStart(row(container, 'a'), { dataTransfer })
    fireEvent.dragOver(row(container, 'b'), { dataTransfer, clientY: 0 })
    expect(row(container, 'b').className).not.toMatch(/drop-(before|after|into)/)

    fireEvent.drop(row(container, 'b'), { dataTransfer, clientY: 0 })
    expect(onItemDrop).not.toHaveBeenCalled()
  })

  it('right-click outside a multi-selection collapses it to the clicked row', () => {
    const onSelectionChange = vi.fn()
    const { container } = render(
      <ListView items={threeItems} selectionMode="multiple" onSelectionChange={onSelectionChange} data-testid="list" />
    )
    selectAAndC(container)

    fireEvent.contextMenu(row(container, 'b'))
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b'], expect.anything())
  })
})
