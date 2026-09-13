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

/**
 * Opt-in virtualisation: only the rows inside the viewport (+ overscan) are
 * mounted, spacers keep the scrollbar honest, and the window follows the
 * scroll offset. jsdom has no layout, so the viewport is injected by
 * defining `clientHeight` on the scroll content and firing a scroll event —
 * exactly the two signals the component reads.
 */
describe('ListView followTail', () => {
	const ROW = 20
	const rows = (n: number): ListViewItemData[] => Array.from({ length: n }, (_, i) => ({ id: `row-${String(i)}`, title: `Row ${String(i)}` }))
	function scrollContent(container: HTMLElement): HTMLElement {
		const el = container.querySelector<HTMLElement>('.list-view')
		if (!el) throw new Error('no list content')
		return el
	}
	/** jsdom has no layout: the scroll geometry is stubbed by hand. */
	function geometry(el: HTMLElement, clientHeight: number, scrollHeight: number): void {
		Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
		Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
	}

	it('scrolls to the new bottom when rows are appended while at the bottom', () => {
		const { container, rerender } = render(<ListView data-testid="tail" items={rows(5)} followTail virtualized rowHeight={ROW} />)
		const el = scrollContent(container)
		geometry(el, 100, 5 * ROW)
		fireEvent.scroll(el)
		geometry(el, 100, 50 * ROW)
		rerender(<ListView data-testid="tail" items={rows(50)} followTail virtualized rowHeight={ROW} />)
		expect(el.scrollTop).toBe(50 * ROW - 100)
	})

	it('stays put once the user scrolled up, and resumes at the bottom', () => {
		const { container, rerender } = render(<ListView data-testid="tail" items={rows(50)} followTail rowHeight={ROW} />)
		const el = scrollContent(container)
		geometry(el, 100, 50 * ROW)
		el.scrollTop = 200
		fireEvent.scroll(el)
		geometry(el, 100, 60 * ROW)
		rerender(<ListView data-testid="tail" items={rows(60)} followTail rowHeight={ROW} />)
		expect(el.scrollTop).toBe(200)
		// Back to the bottom: following resumes on the next append.
		el.scrollTop = 60 * ROW - 100
		fireEvent.scroll(el)
		geometry(el, 100, 70 * ROW)
		rerender(<ListView data-testid="tail" items={rows(70)} followTail rowHeight={ROW} />)
		expect(el.scrollTop).toBe(70 * ROW - 100)
	})

	it('does nothing without the option', () => {
		const { container, rerender } = render(<ListView data-testid="tail" items={rows(5)} rowHeight={ROW} />)
		const el = scrollContent(container)
		geometry(el, 100, 50 * ROW)
		rerender(<ListView data-testid="tail" items={rows(50)} rowHeight={ROW} />)
		expect(el.scrollTop).toBe(0)
	})
})

describe('ListView virtualisation', () => {
  const ROW = 26
  const many: ListViewItemData[] = Array.from({ length: 200 }, (_, i) => ({ id: `row-${String(i)}`, title: `Row ${String(i)}` }))

  function scrollContent(container: HTMLElement): HTMLElement {
    const el = container.querySelector<HTMLElement>('[data-testid="virt-scrollable-content"]')
    if (!el) throw new Error('scroll content not found')
    return el
  }
  function mountedRows(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.list-view-row'))
  }
  function spacers(container: HTMLElement): number[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.list-view-virtual-spacer')).map((s) => parseInt(s.style.height, 10))
  }
  function setViewport(el: HTMLElement, height: number, scrollTop: number): void {
    Object.defineProperty(el, 'clientHeight', { value: height, configurable: true })
    el.scrollTop = scrollTop
    fireEvent.scroll(el)
  }

  it('mounts every row while the viewport is unmeasured (jsdom, first paint)', () => {
    const { container } = render(<ListView data-testid="virt" items={many} virtualized rowHeight={ROW} />)
    expect(mountedRows(container)).toHaveLength(200)
    expect(spacers(container)).toEqual([])
  })

  it('mounts only the visible window plus the overscan, with spacers standing in for the rest', () => {
    const { container } = render(<ListView data-testid="virt" items={many} virtualized rowHeight={ROW} overscan={4} />)
    const content = scrollContent(container)
    setViewport(content, 10 * ROW, 0)
    // 10 visible + 4 overscan below (nothing above at the top).
    const rows = mountedRows(container)
    expect(rows).toHaveLength(14)
    expect(rows[0]?.dataset['itemId']).toBe('row-0')
    expect(rows[13]?.dataset['itemId']).toBe('row-13')
    expect(spacers(container)).toEqual([(200 - 14) * ROW])
    // Each mounted row is forced to the fixed height the window assumes.
    expect(rows[0]?.style.height).toBe(`${String(ROW)}px`)
  })

  it('follows the scroll offset and keeps the total height equal to rows × rowHeight', () => {
    const { container } = render(<ListView data-testid="virt" items={many} virtualized rowHeight={ROW} overscan={4} />)
    const content = scrollContent(container)
    setViewport(content, 10 * ROW, 100 * ROW)
    const rows = mountedRows(container)
    expect(rows[0]?.dataset['itemId']).toBe('row-96')
    expect(rows[rows.length - 1]?.dataset['itemId']).toBe('row-113')
    const [top, bottom] = spacers(container)
    expect(top).toBe(96 * ROW)
    expect(bottom).toBe((200 - 114) * ROW)
    expect((top ?? 0) + rows.length * ROW + (bottom ?? 0)).toBe(200 * ROW)
  })

  it('collapsing a container removes its children from the virtual set', () => {
    const tree: ListViewItemData[] = [
      { id: 'folder', title: 'Folder', children: Array.from({ length: 150 }, (_, i) => ({ id: `child-${String(i)}`, title: `Child ${String(i)}` })) },
      ...Array.from({ length: 50 }, (_, i) => ({ id: `tail-${String(i)}`, title: `Tail ${String(i)}` }))
    ]
    const { container } = render(<ListView data-testid="virt" items={tree} virtualized rowHeight={ROW} overscan={2} />)
    const content = scrollContent(container)
    setViewport(content, 5 * ROW, 0)
    // 1 folder + 150 children + 50 tail rows = 201 rows.
    expect(spacers(container)).toEqual([(201 - 7) * ROW])
    const expander = row(container, 'folder').querySelector<HTMLElement>('.list-view-expander')
    if (!expander) throw new Error('expander not found')
    fireEvent.click(expander)
    // 1 folder + 50 tail rows = 51 rows.
    expect(spacers(container)).toEqual([(51 - 7) * ROW])
    expect(mountedRows(container)[1]?.dataset['itemId']).toBe('tail-0')
  })

  it('keeps the row being renamed mounted even when scrolled out of the window', () => {
    const { container } = render(
      <ListView data-testid="virt" items={many} virtualized rowHeight={ROW} overscan={2} isRenameable editingItemId="row-150" />
    )
    const content = scrollContent(container)
    setViewport(content, 5 * ROW, 0)
    expect(container.querySelector('.list-view-row[data-item-id="row-150"] input')).not.toBeNull()
  })

  it('is off by default: every row stays mounted and no spacer is rendered', () => {
    const { container } = render(<ListView data-testid="virt" items={many} />)
    setViewport(scrollContent(container), 10 * 26, 0)
    expect(mountedRows(container)).toHaveLength(200)
    expect(spacers(container)).toEqual([])
  })
})
