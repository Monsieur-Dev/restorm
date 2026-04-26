/**
 * Integration tests for `useDebouncedValue` from
 * `electron-core-ui/renderer`.
 *
 * The hook lives in core-ui but restorm owns the only jsdom +
 * @testing-library/react harness in the monorepo, so the behavioural
 * tests live here (same pattern as `usePersistedState.test.ts`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedValue } from '../../../electron-core-ui/src/renderer/hooks/useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value synchronously on first render', () => {
    const { result } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'hello' }
    })
    expect(result.current).toBe('hello')
  })

  it('does not update before the delay elapses', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' }
    })

    rerender({ value: 'b' })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('a')

    act(() => { vi.advanceTimersByTime(150) })
    expect(result.current).toBe('b')
  })

  it('coalesces rapid changes into a single update', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: 'a' }
    })

    rerender({ value: 'ab' })
    act(() => { vi.advanceTimersByTime(50) })
    rerender({ value: 'abc' })
    act(() => { vi.advanceTimersByTime(50) })
    rerender({ value: 'abcd' })
    act(() => { vi.advanceTimersByTime(50) })
    rerender({ value: 'abcde' })

    // Still under the 250ms quiet window — should still be the original.
    expect(result.current).toBe('a')

    act(() => { vi.advanceTimersByTime(250) })
    expect(result.current).toBe('abcde')
  })

  it('cancels the pending update on unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }) => useDebouncedValue(value, 250),
      { initialProps: { value: 'a' } }
    )

    rerender({ value: 'b' })
    unmount()
    // Advancing timers after unmount must not throw and must not write
    // back into the now-detached hook.
    expect(() => { act(() => { vi.advanceTimersByTime(500) }) }).not.toThrow()
    expect(result.current).toBe('a')
  })
})
