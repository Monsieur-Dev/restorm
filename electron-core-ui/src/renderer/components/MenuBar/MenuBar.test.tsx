// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { MenuBar } from './MenuBar'
import { MenuBarItem } from './MenuBarItem'

// jsdom has no ResizeObserver; the layout-mode effect only needs `observe`/
// `disconnect` to exist, it never asserts on resize callbacks in these tests.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe(): void { /* no-op */ }
      unobserve(): void { /* no-op */ }
      disconnect(): void { /* no-op */ }
    }
  }
  // jsdom's getBoundingClientRect always returns a zero rect, which would
  // otherwise measure a 0px-wide container and force `hamburger` mode on
  // every render (see computeMenuBarLayout). Stub it so the mirrored items
  // measure small and the container measures wide, landing in `full` mode
  // — these tests exercise the real top-level `MenuBarItem`s, not the
  // collapsed hamburger/overflow bucket. Left stubbed for the whole file
  // (not restored) — each test file gets a fresh jsdom global, same as the
  // ResizeObserver stub above.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const width = this.hasAttribute('data-mirror-index') ? 60 : 1000
    return { width, height: 30, top: 0, left: 0, right: width, bottom: 30, x: 0, y: 0, toJSON() { return {} } }
  }
})

afterEach(() => { cleanup() })

// Every item here is deliberately childless: these tests only assert on the
// top-level roving-tabindex machinery (which item is `tabIndex={0}`,
// `data-is-open`/`data-active-menu-index`), never on dropdown content, so
// keeping them childless means `{children && isActive && (...)}` never
// renders the ScrollableElement-based dropdown — the real "does opening a
// menu focus its first real item" behaviour is proven end-to-end by the
// demo e2e suite instead.
function renderBasicBar(): ReturnType<typeof render> {
  return render(
    <MenuBar data-testid="mb">
      <MenuBarItem data-testid="mb-file" title="File" />
      <MenuBarItem data-testid="mb-edit" title="Edit" />
      <MenuBarItem data-testid="mb-view" title="View" />
    </MenuBar>
  )
}

function tabIndexOf(getByTestId: (id: string) => HTMLElement, testId: string): string | null {
  return getByTestId(testId).getAttribute('tabindex')
}

describe('MenuBar roving tabindex', () => {
  it('the first item is the sole Tab stop on initial render; the root carries no tabindex', () => {
    const { getByTestId } = renderBasicBar()
    expect(tabIndexOf(getByTestId, 'mb-file')).toBe('0')
    expect(tabIndexOf(getByTestId, 'mb-edit')).toBe('-1')
    expect(tabIndexOf(getByTestId, 'mb-view')).toBe('-1')
    expect(getByTestId('mb').getAttribute('tabindex')).toBeNull()
  })

  it('clicking a different top-level item moves the roving tab stop to it, and it survives Escape', () => {
    const { getByTestId } = renderBasicBar()
    fireEvent.click(getByTestId('mb-edit'))
    expect(tabIndexOf(getByTestId, 'mb-edit')).toBe('0')
    expect(tabIndexOf(getByTestId, 'mb-file')).toBe('-1')

    fireEvent.keyDown(getByTestId('mb'), { key: 'Escape' })
    // Escape closes the open menu but must not forget which item was last
    // active — otherwise re-entering the bar via Tab would land back on
    // "File" instead of resuming on "Edit".
    expect(tabIndexOf(getByTestId, 'mb-edit')).toBe('0')
    expect(getByTestId('mb').getAttribute('data-is-open')).toBe('false')
  })

  it('clicking outside also preserves the roving tab stop', () => {
    const { getByTestId } = renderBasicBar()
    fireEvent.click(getByTestId('mb-view'))
    expect(tabIndexOf(getByTestId, 'mb-view')).toBe('0')

    fireEvent.pointerDown(document.body)
    expect(tabIndexOf(getByTestId, 'mb-view')).toBe('0')
  })

  it('ArrowRight/ArrowLeft move the roving tab stop between top-level items', () => {
    const { getByTestId } = renderBasicBar()
    const bar = getByTestId('mb')

    // First press "confirms" the already-focused item (index 0) rather than
    // skipping past it — DOM focus already sits there via the native Tab
    // stop, nothing has moved yet.
    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(tabIndexOf(getByTestId, 'mb-file')).toBe('0')

    fireEvent.keyDown(bar, { key: 'ArrowRight' })
    expect(tabIndexOf(getByTestId, 'mb-edit')).toBe('0')
    expect(tabIndexOf(getByTestId, 'mb-file')).toBe('-1')

    fireEvent.keyDown(bar, { key: 'ArrowLeft' })
    expect(tabIndexOf(getByTestId, 'mb-file')).toBe('0')
  })

  it('does not intercept Tab — no keyboard trap', () => {
    const { getByTestId } = renderBasicBar()
    fireEvent.click(getByTestId('mb-edit'))
    expect(tabIndexOf(getByTestId, 'mb-edit')).toBe('0')
    expect(getByTestId('mb').getAttribute('data-focused-menu-index')).toBe('1')

    fireEvent.keyDown(getByTestId('mb'), { key: 'Tab' })
    // An earlier implementation intercepted Tab to cycle through items —
    // that would trap keyboard focus inside the bar forever. With the
    // roving tabindex, Tab must be a no-op here (state unchanged): the
    // browser's native handling, untouched by this handler, is what
    // actually moves focus to the next/previous element outside the bar.
    expect(tabIndexOf(getByTestId, 'mb-edit')).toBe('0')
    expect(getByTestId('mb').getAttribute('data-focused-menu-index')).toBe('1')
  })

  it('ArrowDown opens the focused menu (mouse-click behaviour is unaffected)', () => {
    const { getByTestId } = renderBasicBar()
    const bar = getByTestId('mb')

    fireEvent.keyDown(bar, { key: 'ArrowRight' }) // confirm focus on "File"
    fireEvent.keyDown(bar, { key: 'ArrowDown' })
    expect(getByTestId('mb').getAttribute('data-is-open')).toBe('true')
    expect(getByTestId('mb').getAttribute('data-active-menu-index')).toBe('0')

    // Non-regression: click-to-open/close still works exactly as before.
    fireEvent.click(getByTestId('mb-file'))
    expect(getByTestId('mb').getAttribute('data-is-open')).toBe('false')
  })
})
