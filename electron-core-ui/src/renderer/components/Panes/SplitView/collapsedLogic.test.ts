import { describe, it, expect } from 'vitest'
import { isFullyControlled, computeCollapsedArray } from './collapsedLogic'

describe('isFullyControlled', () => {
  it('returns false for zero panes', () => {
    expect(isFullyControlled([])).toBe(false)
  })

  it('returns true when every pane provides an explicit boolean `collapsed`', () => {
    expect(isFullyControlled([{ collapsed: true }, { collapsed: false }])).toBe(true)
  })

  it('returns false when at least one pane omits `collapsed`', () => {
    // Even one un-controlled pane is enough to drop to uncontrolled
    // mode — partial control would be ambiguous on re-mount.
    expect(isFullyControlled([{ collapsed: true }, {}])).toBe(false)
    expect(isFullyControlled([{ collapsed: false }, { defaultCollapsed: true }])).toBe(false)
  })

  it('treats `collapsed: undefined` as "not provided"', () => {
    expect(isFullyControlled([{ collapsed: undefined }, { collapsed: true }])).toBe(false)
  })
})

describe('computeCollapsedArray', () => {
  const emptyState = { forCount: 0, values: [] }

  describe('controlled mode', () => {
    it('reads `pane.collapsed` directly when every pane provides it', () => {
      // Internal state is empty (post-remount scenario); controlled
      // mode must ignore it entirely and return the props verbatim.
      expect(
        computeCollapsedArray(
          [{ collapsed: true }, { collapsed: false }, { collapsed: true }],
          emptyState
        )
      ).toEqual([true, false, true])
    })

    it('ignores internal state even when it has matching forCount', () => {
      // The whole point of controlled mode: the parent's prop is the
      // truth, even if the SplitView had previously stored an opposite
      // internal state. This is what makes remount-survival work.
      expect(
        computeCollapsedArray(
          [{ collapsed: true }, { collapsed: true }],
          { forCount: 2, values: [false, false] }
        )
      ).toEqual([true, true])
    })
  })

  describe('uncontrolled mode (legacy semantics)', () => {
    it('falls back to internal state when forCount + length match', () => {
      // No pane provides `collapsed` → uncontrolled → internal state
      // wins once it has been populated for the current pane count.
      expect(
        computeCollapsedArray(
          [{ defaultCollapsed: true }, {}],
          { forCount: 2, values: [false, true] }
        )
      ).toEqual([false, true])
    })

    it('falls back to `pane.collapsed` as initial when internal state is empty', () => {
      // First render (no prior toggle): the (partial) `collapsed`
      // prop seeds the initial value.
      expect(
        computeCollapsedArray(
          [{ collapsed: true }, {}],
          emptyState
        )
      ).toEqual([true, false])
    })

    it('falls back to `pane.defaultCollapsed` when neither internal state nor `collapsed` is set', () => {
      expect(
        computeCollapsedArray(
          [{ defaultCollapsed: true }, { defaultCollapsed: false }, {}],
          emptyState
        )
      ).toEqual([true, false, false])
    })

    it('honours per-pane internal state when forCount partially matches', () => {
      // Mid-resize edge case: internal state has values for some
      // panes but not all — read what you can, fall back per-pane
      // for the rest.
      expect(
        computeCollapsedArray(
          [{ collapsed: true }, { collapsed: false }, { defaultCollapsed: true }],
          { forCount: 2, values: [false] }
        )
      ).toEqual([false, false, true])
    })
  })
})
