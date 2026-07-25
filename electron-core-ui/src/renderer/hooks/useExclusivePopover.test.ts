// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

import { useExclusivePopover } from './useExclusivePopover'

afterEach(() => { cleanup() })

describe('useExclusivePopover', () => {
  it('closes a sibling popover when a second one opens', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()

    const { rerender: rerenderA } = renderHook(
      ({ open }) => { useExclusivePopover(open, closeA) },
      { initialProps: { open: false } }
    )
    const { rerender: rerenderB } = renderHook(
      ({ open }) => { useExclusivePopover(open, closeB) },
      { initialProps: { open: false } }
    )

    act(() => { rerenderA({ open: true }) })
    expect(closeA).not.toHaveBeenCalled()

    act(() => { rerenderB({ open: true }) })
    expect(closeA).toHaveBeenCalledTimes(1)
    expect(closeB).not.toHaveBeenCalled()
  })

  it('does not close itself when it announces its own opening', () => {
    const close = vi.fn()
    const { rerender } = renderHook(
      ({ open }) => { useExclusivePopover(open, close) },
      { initialProps: { open: false } }
    )

    act(() => { rerender({ open: true }) })

    expect(close).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted, so a later sibling open is a no-op', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()

    const { rerender: rerenderA, unmount: unmountA } = renderHook(
      ({ open }) => { useExclusivePopover(open, closeA) },
      { initialProps: { open: false } }
    )
    const { rerender: rerenderB } = renderHook(
      ({ open }) => { useExclusivePopover(open, closeB) },
      { initialProps: { open: false } }
    )

    act(() => { rerenderA({ open: true }) })
    unmountA()

    act(() => { rerenderB({ open: true }) })
    expect(closeA).not.toHaveBeenCalled()
  })

  it('does not announce (and cannot be closed by a sibling) while closed', () => {
    const closeA = vi.fn()
    const closeB = vi.fn()

    renderHook(({ open }) => { useExclusivePopover(open, closeA) }, { initialProps: { open: false } })
    const { rerender: rerenderB } = renderHook(
      ({ open }) => { useExclusivePopover(open, closeB) },
      { initialProps: { open: false } }
    )

    act(() => { rerenderB({ open: true }) })

    expect(closeA).not.toHaveBeenCalled()
  })

  it('uses the latest close callback without re-announcing', () => {
    const closeA = vi.fn()
    const closeAReplaced = vi.fn()
    const closeB = vi.fn()

    const { rerender: rerenderA } = renderHook(
      ({ open, close }) => { useExclusivePopover(open, close) },
      { initialProps: { open: false, close: closeA } }
    )
    const { rerender: rerenderB } = renderHook(
      ({ open }) => { useExclusivePopover(open, closeB) },
      { initialProps: { open: false } }
    )

    act(() => { rerenderA({ open: true, close: closeA }) })
    // A fresh closure on a later render must not re-announce (which would
    // close B) — it only swaps which callback a future sibling triggers.
    act(() => { rerenderA({ open: true, close: closeAReplaced }) })
    expect(closeB).not.toHaveBeenCalled()

    act(() => { rerenderB({ open: true }) })
    expect(closeAReplaced).toHaveBeenCalledTimes(1)
    expect(closeA).not.toHaveBeenCalled()
  })
})
