/**
 * Integration tests for `useDebouncedCallback` from
 * `electron-core-ui/renderer`.
 *
 * Lives in restorm because the monorepo's only jsdom +
 * @testing-library/react harness is here (same pattern as
 * `usePersistedState.test.ts`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedCallback } from '../../../electron-core-ui/src/renderer/hooks/useDebouncedCallback'

describe('useDebouncedCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a stable callable across renders', () => {
    const fn = vi.fn()
    const { result, rerender } = renderHook(({ delay }) => useDebouncedCallback(fn, delay), {
      initialProps: { delay: 250 }
    })
    const first = result.current
    rerender({ delay: 500 })
    expect(result.current).toBe(first)
  })

  it('coalesces rapid calls into a single invocation with the latest args', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 250))

    act(() => { result.current('a') })
    act(() => { vi.advanceTimersByTime(50) })
    act(() => { result.current('b') })
    act(() => { vi.advanceTimersByTime(50) })
    act(() => { result.current('c') })

    expect(fn).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(250) })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('always calls the latest fn closure', () => {
    let captured = 0
    const { result, rerender } = renderHook(
      ({ tag }: { tag: number }) => useDebouncedCallback(() => { captured = tag }, 250),
      { initialProps: { tag: 1 } }
    )

    act(() => { result.current() })
    rerender({ tag: 2 })
    act(() => { vi.advanceTimersByTime(250) })

    expect(captured).toBe(2)
  })

  it('cancel() drops the pending invocation', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 250))

    act(() => { result.current('x') })
    act(() => { result.current.cancel() })
    act(() => { vi.advanceTimersByTime(500) })

    expect(fn).not.toHaveBeenCalled()
  })

  it('flush() fires the pending invocation immediately', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 250))

    act(() => { result.current('y') })
    act(() => { result.current.flush() })

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('y')

    act(() => { vi.advanceTimersByTime(500) })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancels the pending invocation on unmount', () => {
    const fn = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 250))

    act(() => { result.current('z') })
    unmount()
    act(() => { vi.advanceTimersByTime(500) })

    expect(fn).not.toHaveBeenCalled()
  })
})
