import { describe, it, expect } from 'vitest'
import { computeTabDisplay } from './WorkbenchResizeContext'

describe('computeTabDisplay', () => {
  it('returns flex for the active tab at rest', () => {
    expect(computeTabDisplay(true, false)).toBe('flex')
  })

  it('returns none for an inactive tab at rest', () => {
    expect(computeTabDisplay(false, false)).toBe('none')
  })

  it('returns none for every tab — including the active one — while a sash is dragging', () => {
    // The whole point of the workbench-wide resize signal: even the
    // currently visible tab is hidden so its body (Monaco, webviews,
    // chart libs reacting to ResizeObserver) doesn't relayout on every
    // mousemove. The reveal happens in one shot on mouseup.
    expect(computeTabDisplay(true, true)).toBe('none')
    expect(computeTabDisplay(false, true)).toBe('none')
  })
})
