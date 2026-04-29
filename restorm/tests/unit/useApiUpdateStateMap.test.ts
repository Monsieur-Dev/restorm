/**
 * Tests for `useApiUpdateStateMap` — subscribes to the
 * `apiUpdate:state-changed` IPC and exposes a live
 * `Record<folderId, ApiUpdateState>` to the renderer. Drives the
 * sidebar badges + the env-folder home page indicator.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ApiUpdateState } from '../../src/shared/types/baseTypes'
import { useApiUpdateStateMap } from '../../src/renderer/src/hooks/useApiUpdateStateMap'

type StateChangedHandler = (data: { folderId: string; state: ApiUpdateState }) => void

function installFakeApi(): {
  getSnapshot: ReturnType<typeof vi.fn>
  emit: (folderId: string, state: ApiUpdateState) => void
  unsubscribed: () => boolean
} {
  let handler: StateChangedHandler | null = null
  let unsub = false
  const getSnapshot = vi.fn(() => Promise.resolve({}))
  const onStateChanged = (cb: StateChangedHandler): (() => void) => {
    handler = cb
    return () => { unsub = true }
  }
  ;(window as unknown as { restorm?: unknown }).restorm = {
    apiUpdate: { getSnapshot, onStateChanged }
  }
  return {
    getSnapshot,
    emit: (folderId, state) => { handler?.({ folderId, state }) },
    unsubscribed: () => unsub
  }
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('useApiUpdateStateMap', () => {
  beforeEach(() => {
    delete (window as unknown as { restorm?: unknown }).restorm
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns an empty map when the IPC surface is missing', () => {
    const { result } = renderHook(() => useApiUpdateStateMap())
    expect(result.current).toEqual({})
  })

  it('seeds the map from `getSnapshot` on mount', async () => {
    const seed: Record<string, ApiUpdateState> = {
      'folder-1': { kind: 'available', availableVersion: 'v2', lastCheckedAt: 1 }
    }
    const getSnapshot = vi.fn(() => Promise.resolve(seed))
    ;(window as unknown as { restorm?: unknown }).restorm = {
      apiUpdate: { getSnapshot, onStateChanged: () => () => undefined }
    }
    const { result } = renderHook(() => useApiUpdateStateMap())
    await flushMicrotasks()
    expect(getSnapshot).toHaveBeenCalledTimes(1)
    expect(result.current['folder-1']?.kind).toBe('available')
  })

  it('updates the map when `onStateChanged` fires', async () => {
    const fake = installFakeApi()
    const { result } = renderHook(() => useApiUpdateStateMap())
    await flushMicrotasks()

    act(() => {
      fake.emit('folder-1', { kind: 'checking', lastCheckedAt: 100 })
    })
    expect(result.current['folder-1']?.kind).toBe('checking')

    act(() => {
      fake.emit('folder-1', { kind: 'available', availableVersion: 'v3', lastCheckedAt: 200 })
    })
    expect(result.current['folder-1']?.kind).toBe('available')
    expect(result.current['folder-1']?.availableVersion).toBe('v3')
  })

  it('keeps entries for unrelated folders when one folder transitions', async () => {
    const fake = installFakeApi()
    const { result } = renderHook(() => useApiUpdateStateMap())
    await flushMicrotasks()

    act(() => {
      fake.emit('folder-1', { kind: 'checking' })
      fake.emit('folder-2', { kind: 'available', availableVersion: 'v2' })
    })
    expect(Object.keys(result.current).sort()).toEqual(['folder-1', 'folder-2'])

    act(() => {
      fake.emit('folder-1', { kind: 'idle' })
    })
    expect(result.current['folder-1']?.kind).toBe('idle')
    // folder-2 must NOT be wiped by the folder-1 transition.
    expect(result.current['folder-2']?.kind).toBe('available')
  })

  it('unsubscribes on unmount so subsequent events do not leak', async () => {
    const fake = installFakeApi()
    const { unmount } = renderHook(() => useApiUpdateStateMap())
    await flushMicrotasks()
    expect(fake.unsubscribed()).toBe(false)
    unmount()
    expect(fake.unsubscribed()).toBe(true)
  })
})
