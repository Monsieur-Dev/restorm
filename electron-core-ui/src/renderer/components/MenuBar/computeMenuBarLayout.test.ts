import { describe, it, expect } from 'vitest'
import { computeMenuBarLayout } from './computeMenuBarLayout'

describe('computeMenuBarLayout', () => {
  it('returns full + every item visible while measurements are pending', () => {
    expect(
      computeMenuBarLayout({
        containerWidth: null,
        itemWidths: [50, 60, 70],
        hamburgerBelowPx: 200,
        overflowButtonWidth: 40
      })
    ).toEqual({ mode: 'full', visibleCount: 3 })
  })

  it('returns full when item widths array is empty (children pending)', () => {
    expect(
      computeMenuBarLayout({
        containerWidth: 1000,
        itemWidths: [],
        hamburgerBelowPx: 200,
        overflowButtonWidth: 40
      })
    ).toEqual({ mode: 'full', visibleCount: 0 })
  })

  it('returns full when total item width fits in the container', () => {
    expect(
      computeMenuBarLayout({
        containerWidth: 500,
        itemWidths: [60, 70, 80, 90],
        hamburgerBelowPx: 200,
        overflowButtonWidth: 40
      })
    ).toEqual({ mode: 'full', visibleCount: 4 })
  })

  it('returns hamburger when container falls below the threshold', () => {
    expect(
      computeMenuBarLayout({
        containerWidth: 199,
        itemWidths: [60, 70, 80],
        hamburgerBelowPx: 200,
        overflowButtonWidth: 40
      })
    ).toEqual({ mode: 'hamburger', visibleCount: 0 })
  })

  it('hamburger threshold is exclusive on the lower bound', () => {
    // Exactly at hamburgerBelowPx — should NOT be hamburger.
    expect(
      computeMenuBarLayout({
        containerWidth: 200,
        itemWidths: [60, 70, 80],
        hamburgerBelowPx: 200,
        overflowButtonWidth: 40
      }).mode
    ).not.toBe('hamburger')
  })

  it('returns overflow with leading items that fit alongside the button', () => {
    // Container 220, items [60, 60, 60, 60] total 240 (doesn't fit),
    // button 40 → budget 180 → 3 items fit (60*3=180), 4th doesn't.
    expect(
      computeMenuBarLayout({
        containerWidth: 220,
        itemWidths: [60, 60, 60, 60],
        hamburgerBelowPx: 100,
        overflowButtonWidth: 40
      })
    ).toEqual({ mode: 'overflow', visibleCount: 3 })
  })

  it('overflow mode can keep zero items inline if even one is too wide', () => {
    // Container 60, item 50, button 40 → budget 20 → 50 doesn't fit → 0 visible.
    expect(
      computeMenuBarLayout({
        containerWidth: 60,
        itemWidths: [50, 50, 50],
        hamburgerBelowPx: 50,
        overflowButtonWidth: 40
      })
    ).toEqual({ mode: 'overflow', visibleCount: 0 })
  })

  it('respects item order — items overflow right-to-left, never out of sequence', () => {
    // [80, 30, 30] total 140, container 100, button 30 → budget 70 →
    // first item (80) doesn't fit → visibleCount=0, NOT 2 even though
    // the smaller items would.
    expect(
      computeMenuBarLayout({
        containerWidth: 100,
        itemWidths: [80, 30, 30],
        hamburgerBelowPx: 50,
        overflowButtonWidth: 30
      })
    ).toEqual({ mode: 'overflow', visibleCount: 0 })
  })

  it('handles negative budget (button wider than container) by visibleCount=0', () => {
    expect(
      computeMenuBarLayout({
        containerWidth: 30,
        itemWidths: [40, 40],
        hamburgerBelowPx: 0,
        overflowButtonWidth: 50
      })
    ).toEqual({ mode: 'overflow', visibleCount: 0 })
  })

  it('hamburger wins over overflow when both conditions could apply', () => {
    // Container 150, items don't fit → would be overflow, but
    // 150 < hamburgerBelowPx=200 → hamburger first.
    expect(
      computeMenuBarLayout({
        containerWidth: 150,
        itemWidths: [60, 60, 60],
        hamburgerBelowPx: 200,
        overflowButtonWidth: 40
      })
    ).toEqual({ mode: 'hamburger', visibleCount: 0 })
  })

  it('full mode when container exactly matches the items total', () => {
    expect(
      computeMenuBarLayout({
        containerWidth: 200,
        itemWidths: [50, 50, 50, 50],
        hamburgerBelowPx: 100,
        overflowButtonWidth: 40
      })
    ).toEqual({ mode: 'full', visibleCount: 4 })
  })
})
