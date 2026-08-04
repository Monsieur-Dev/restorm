// @vitest-environment jsdom
/**
 * A value the panel had to clip must stay readable — hovering it reveals the
 * whole thing. Just as important: a value that FITS must not pop a tooltip,
 * or every row of the inspector would flash one as the pointer crosses it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'

// Vitest stubs CSS modules (a `?raw` import comes back empty), so the
// stylesheet is read from disk. `process.cwd()` is the package root under every
// runner we use; a wrong cwd throws here rather than passing silently.
const scenarioCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/Scenario/ScenarioNodeBox.css'),
  'utf-8'
)

vi.hoisted(() => {
  // Importing the ECUI renderer entry pulls Monaco in, which probes this.
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
  class NoopObserver {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
    takeRecords(): [] { return [] }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: NoopObserver, configurable: true })
})

import { ScenarioTruncatedText } from './ScenarioTruncatedText'

/** The hover area of the rendered cell — the test fails loudly if it is absent
 * rather than silently hovering nothing. */
function hoverArea(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.scn-trunc-line')
  if (!el) throw new Error('the truncated line did not render')
  return el
}

/** jsdom lays nothing out, so overflow has to be declared. */
function stubWidths(scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth })
}

afterEach(() => {
  cleanup()
  stubWidths(0, 0)
})

describe('ScenarioTruncatedText', () => {
  it('reveals the whole value on hover when the row clips it', () => {
    stubWidths(500, 120)
    const { container } = render(<ScenarioTruncatedText text={'name: "Ana…"'} full={'name: "Anastasia"'} />)
    fireEvent.mouseEnter(hoverArea(container))
    expect(document.body.textContent).toContain('name: "Anastasia"')
  })

  it('falls back to the rendered text when no untruncated value was supplied', () => {
    stubWidths(500, 120)
    const { container } = render(<ScenarioTruncatedText text="a long enough label" />)
    fireEvent.mouseEnter(hoverArea(container))
    expect(document.querySelector('.scn-trunc-tooltip')?.textContent).toBe('a long enough label')
  })

  it('puts the value in a scrollable, so one taller than the height cap stays reachable', () => {
    // The tooltip is height-capped; without a scroller the tail of a long value
    // would be clipped a second time with no way to read it.
    stubWidths(500, 120)
    const { container } = render(<ScenarioTruncatedText text="clipped" full={'z'.repeat(4000)} />)
    fireEvent.mouseEnter(hoverArea(container))
    const scroller = document.querySelector('[data-testid="scenario-truncated-tooltip"]')
    expect(scroller).not.toBeNull()
    expect(scroller?.textContent).toBe('z'.repeat(4000))
  })

  it('closes on a delay, so the pointer can travel from the row into it', () => {
    vi.useFakeTimers()
    try {
      stubWidths(500, 120)
      const { container } = render(<ScenarioTruncatedText text="clipped" full="the whole value" />)
      fireEvent.mouseEnter(hoverArea(container))
      expect(document.querySelector('.scn-trunc-tooltip')).not.toBeNull()

      // Leaving does not dismiss it instantly — an immediate close would make
      // the scrollable unreachable however enterable it is.
      fireEvent.mouseLeave(hoverArea(container))
      act(() => { vi.advanceTimersByTime(50) })
      expect(document.querySelector('.scn-trunc-tooltip')).not.toBeNull()

      act(() => { vi.advanceTimersByTime(500) })
      expect(document.querySelector('.scn-trunc-tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // jsdom applies no stylesheet, so the three rules that decide whether a
  // capped value is REACHABLE can only be asserted against the source. None of
  // them is cosmetic, and each was verified against the running app:
  //  - without `pointer-events`, the tooltip cannot be entered at all;
  //  - without a cap on the scrollable's own CONTENT box, that box grows to the
  //    full content height and `scrollHeight === clientHeight`, i.e. a
  //    scrollable that cannot scroll — measured 858/858 before the fix, 592/858
  //    after, and a wheel then moves it to the end;
  //  - `overflow: hidden` on the tooltip itself would clip with no recourse.
  it('keeps the tooltip enterable and caps the SCROLLABLE CONTENT box, the only cap that can scroll', () => {
    const tooltip = /\.scn-trunc-tooltip\s*\{[^}]*\}/.exec(scenarioCss)?.[0] ?? ''
    expect(tooltip).toContain('pointer-events: auto')
    expect(tooltip).not.toContain('overflow: hidden')

    const contentBox = /\.scn-trunc-tooltip-scroll\s*>\s*\.scrollable-content\s*\{[^}]*\}/.exec(scenarioCss)?.[0] ?? ''
    expect(contentBox).toContain('max-height')
  })

  it('stays silent on hover when the value fits', () => {
    stubWidths(120, 120)
    const { container } = render(<ScenarioTruncatedText text="short" full="short" />)
    fireEvent.mouseEnter(hoverArea(container))
    expect(document.querySelector('.scn-trunc-tooltip')).toBeNull()
  })
})
