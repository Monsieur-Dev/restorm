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
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { ListView, LIST_VIEW_DRAG_MIME } from './ListView'
import type { ListViewItemData } from './types'

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
