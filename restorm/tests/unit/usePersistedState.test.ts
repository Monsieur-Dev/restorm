/**
 * Integration tests for `usePersistedState` from `electron-core-ui/renderer`.
 *
 * The hook lives in the core-ui library, but restorm owns the only
 * jsdom + @testing-library/react test harness in the monorepo, so the
 * behavioural tests live here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
// Reach into the library source directly. The renderer barrel
// (`electron-core-ui/renderer`) lazy-loads `jsoncrack-react`, which the
// vite-driven test bundler can't resolve at unit-test time; importing the
// hook module avoids pulling in that unrelated component graph.
import { usePersistedState } from '../../../electron-core-ui/src/renderer/hooks/usePersistedState'

type FakeStore = Map<string, unknown>

function installFakeStorage(store: FakeStore): { getSpy: ReturnType<typeof vi.fn>; setSpy: ReturnType<typeof vi.fn> } {
  const getSpy = vi.fn((key: string) => Promise.resolve(store.get(key)))
  const setSpy = vi.fn((key: string, value: unknown) => {
    store.set(key, value)
    return Promise.resolve(true)
  })
  const deleteSpy = vi.fn((key: string) => {
    store.delete(key)
    return Promise.resolve(true)
  })
  ;(window as unknown as { api?: unknown }).api = {
    storage: { get: getSpy, set: setSpy, delete: deleteSpy }
  }
  return { getSpy, setSpy }
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('usePersistedState', () => {
  let store: FakeStore

  beforeEach(() => {
    store = new Map()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { api?: unknown }).api
  })

  it('is a plain useState when key is null', async () => {
    installFakeStorage(store)
    const { result } = renderHook(() => usePersistedState<number>(null, 42))
    await flushMicrotasks()
    expect(result.current[0]).toBe(42)
    act(() => { result.current[1](100) })
    expect(result.current[0]).toBe(100)
    // No IO should have happened — fake store must still be empty.
    expect(store.size).toBe(0)
  })

  it('restores a stored value on first read', async () => {
    store.set('key-a', ['x', 'y'])
    installFakeStorage(store)
    const { result } = renderHook(() =>
      usePersistedState<string[]>('key-a', [])
    )
    await flushMicrotasks()
    expect(result.current[0]).toEqual(['x', 'y'])
  })

  it('passes stored values through onRestore (and uses the latest closure)', async () => {
    store.set('key-b', ['a', 'stale', 'b'])
    installFakeStorage(store)
    const knownRef = { current: new Set(['a', 'b']) }
    const { result } = renderHook(() =>
      usePersistedState<string[]>('key-b', [], {
        onRestore: (stored) => stored.filter((id) => knownRef.current.has(id))
      })
    )
    await flushMicrotasks()
    expect(result.current[0]).toEqual(['a', 'b'])
  })

  it('invokes onMissing when no entry exists for the key', async () => {
    installFakeStorage(store)
    const onMissing = vi.fn(() => ['default-1', 'default-2'])
    const { result } = renderHook(() =>
      usePersistedState<string[]>('key-c', [], { onMissing })
    )
    await flushMicrotasks()
    expect(onMissing).toHaveBeenCalledTimes(1)
    expect(result.current[0]).toEqual(['default-1', 'default-2'])
  })

  it('does not call onMissing when stored data exists', async () => {
    store.set('key-d', ['stored'])
    installFakeStorage(store)
    const onMissing = vi.fn(() => ['fallback'])
    const { result } = renderHook(() =>
      usePersistedState<string[]>('key-d', [], { onMissing })
    )
    await flushMicrotasks()
    expect(onMissing).not.toHaveBeenCalled()
    expect(result.current[0]).toEqual(['stored'])
  })

  it('debounces writes and does not rewrite the freshly-restored value', async () => {
    store.set('key-e', ['initial'])
    const { setSpy } = installFakeStorage(store)
    const { result } = renderHook(() =>
      usePersistedState<string[]>('key-e', [])
    )
    await flushMicrotasks()
    expect(result.current[0]).toEqual(['initial'])
    // Advance past the debounce; the restore alone must NOT schedule a write.
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(setSpy).not.toHaveBeenCalled()

    // Explicit state change → one debounced write after 300ms.
    act(() => { result.current[1](['updated']) })
    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    expect(setSpy).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledWith('key-e', ['updated'])
  })

  it('coalesces rapid updates into a single write', async () => {
    const { setSpy } = installFakeStorage(store)
    const { result } = renderHook(() =>
      usePersistedState<number[]>('key-f', [])
    )
    await flushMicrotasks()

    act(() => { result.current[1]([1]) })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    act(() => { result.current[1]([1, 2]) })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    act(() => { result.current[1]([1, 2, 3]) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })

    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenLastCalledWith('key-f', [1, 2, 3])
  })

  it('cancels pending writes and re-reads when the key changes', async () => {
    store.set('key-g1', ['one'])
    store.set('key-g2', ['two'])
    const { setSpy } = installFakeStorage(store)
    const { result, rerender } = renderHook(
      ({ k }: { k: string }) => usePersistedState<string[]>(k, []),
      { initialProps: { k: 'key-g1' } }
    )
    await flushMicrotasks()
    expect(result.current[0]).toEqual(['one'])

    act(() => { result.current[1](['one', 'dirty']) })
    // Switch key before the debounce fires.
    rerender({ k: 'key-g2' })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    await flushMicrotasks()
    // The pending write under key-g1 must have been cancelled, and the
    // restored value for key-g2 must be applied.
    expect(setSpy).not.toHaveBeenCalledWith('key-g1', expect.anything())
    expect(result.current[0]).toEqual(['two'])
  })
})
