/**
 * Tests for `useApiUpdateNotifications` — subscribes to the
 * `apiUpdate:state-changed` IPC and pushes a toast each time a
 * folder transitions into `'available'`. Dedupes echoes; re-pushes
 * when a newer version arrives. Manual-check errors surface as
 * toasts; auto-check errors stay silent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ApiUpdateState } from '../../src/shared/types/baseTypes'

type StateChangedHandler = (data: { folderId: string; state: ApiUpdateState }) => void

const pushSpy = vi.fn()

vi.mock('electron-core-ui/renderer', () => ({
  toasterService: {
    push: (id: string, payload: unknown): void => { pushSpy(id, payload) }
  }
}))

import { useApiUpdateNotifications } from '../../src/renderer/src/hooks/useApiUpdateNotifications'

function installFakeApi(): { emit: StateChangedHandler } {
  let handler: StateChangedHandler | null = null
  ;(window as unknown as { restorm?: unknown }).restorm = {
    apiUpdate: {
      onStateChanged: (cb: StateChangedHandler): (() => void) => {
        handler = cb
        return () => { /* unsubscribed */ }
      }
    }
  }
  return {
    emit: (data) => { handler?.(data) }
  }
}

const t = ((key: string) => key) as Parameters<typeof useApiUpdateNotifications>[0]

describe('useApiUpdateNotifications', () => {
  beforeEach(() => {
    pushSpy.mockClear()
    delete (window as unknown as { restorm?: unknown }).restorm
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing when the IPC surface is missing', () => {
    renderHook(() => { useApiUpdateNotifications(t) })
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('pushes a toast on first transition into `available`', () => {
    const fake = installFakeApi()
    renderHook(() => { useApiUpdateNotifications(t) })
    fake.emit({ folderId: 'f-1', state: { kind: 'available', currentVersion: 'v1', availableVersion: 'v2' } })
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenCalledWith('app', expect.objectContaining({
      id: 'apiUpdate:f-1',
      body: expect.stringContaining('v1'),
      durationMs: 8000
    }))
  })

  it('dedupes echoes when the same version arrives twice', () => {
    const fake = installFakeApi()
    renderHook(() => { useApiUpdateNotifications(t) })
    fake.emit({ folderId: 'f-1', state: { kind: 'available', availableVersion: 'v2' } })
    fake.emit({ folderId: 'f-1', state: { kind: 'available', availableVersion: 'v2' } })
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('re-pushes when a newer version is detected for the same folder', () => {
    const fake = installFakeApi()
    renderHook(() => { useApiUpdateNotifications(t) })
    fake.emit({ folderId: 'f-1', state: { kind: 'available', availableVersion: 'v2' } })
    fake.emit({ folderId: 'f-1', state: { kind: 'available', availableVersion: 'v3' } })
    expect(pushSpy).toHaveBeenCalledTimes(2)
  })

  it('stays silent on idle / checking transitions', () => {
    const fake = installFakeApi()
    renderHook(() => { useApiUpdateNotifications(t) })
    fake.emit({ folderId: 'f-1', state: { kind: 'checking' } })
    fake.emit({ folderId: 'f-1', state: { kind: 'idle' } })
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('surfaces manual-check errors but stays silent on auto-check errors', () => {
    const fake = installFakeApi()
    renderHook(() => { useApiUpdateNotifications(t) })
    fake.emit({ folderId: 'f-1', state: { kind: 'error', error: 'Auto-check failed: HTTP 500' } })
    expect(pushSpy).not.toHaveBeenCalled()
    fake.emit({ folderId: 'f-2', state: { kind: 'error', error: 'HTTP 401' } })
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenCalledWith('app', expect.objectContaining({
      id: 'apiUpdate-error:f-2',
      body: 'HTTP 401'
    }))
  })

  it('keeps per-folder dedup state independent across folders', () => {
    const fake = installFakeApi()
    renderHook(() => { useApiUpdateNotifications(t) })
    fake.emit({ folderId: 'f-1', state: { kind: 'available', availableVersion: 'v2' } })
    fake.emit({ folderId: 'f-2', state: { kind: 'available', availableVersion: 'v2' } })
    // Two folders, two pushes — even on the same version string,
    // because the dedup key is per-folder.
    expect(pushSpy).toHaveBeenCalledTimes(2)
  })
})
