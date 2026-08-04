// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { Toast, ToastInput } from '../components/Toaster/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options ? `${key}|${String(options['error'])}` : key) })
}))

/**
 * A toaster stub that actually STORES what it is given. The hook decides
 * whether to push by reading the toaster back, so a mock that only
 * records calls would let a broken state machine pass: every transition
 * here depends on the store reflecting the previous one.
 */
const { toasterStub, pushMock, dismissMock, resetToaster, closeToast, startExit } = vi.hoisted(() => {
  let toasts: { id: string; exiting: boolean }[] = []
  const pushMock = vi.fn((_toasterId: string, input: ToastInput) => {
    const id = input.id ?? 'generated'
    toasts = [...toasts.filter((t) => t.id !== id), { id, exiting: false }]
    return id
  })
  const dismissMock = vi.fn((_toasterId: string, toastId: string) => {
    toasts = toasts.filter((t) => t.id !== toastId)
  })
  return {
    toasterStub: {
      push: pushMock,
      dismiss: dismissMock,
      getToasts: (): Toast[] => toasts as unknown as Toast[]
    },
    pushMock,
    dismissMock,
    resetToaster: (): void => { toasts = [] },
    /** The user clicked the toast's close button. */
    closeToast: (id: string): void => { toasts = toasts.filter((t) => t.id !== id) },
    /** The close animation is running but the toast is not gone yet. */
    startExit: (id: string): void => {
      toasts = toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    }
  }
})
vi.mock('../components/Toaster/ToasterService', () => ({ toasterService: toasterStub }))

import { useSaveFailureToast } from './useSaveFailureToast'

const TOAST_ID = 'file-save-failed'

interface MockFileApi {
  onFileSaveFailed: (callback: (payload: { path: string | null; reason: string; detail: string }) => void) => () => void
  onFileSaveSucceeded: (callback: (payload: { path: string | null }) => void) => () => void
  fail: (reason?: string, path?: string | null) => void
  succeed: () => void
}

function makeFileApi(): MockFileApi {
  let onFail: ((payload: { path: string | null; reason: string; detail: string }) => void) | null = null
  let onOk: ((payload: { path: string | null }) => void) | null = null
  return {
    onFileSaveFailed: vi.fn((callback: (payload: { path: string | null; reason: string; detail: string }) => void) => {
      onFail = callback
      return () => { onFail = null }
    }),
    onFileSaveSucceeded: vi.fn((callback: (payload: { path: string | null }) => void) => {
      onOk = callback
      return () => { onOk = null }
    }),
    fail: (reason = 'read-only-file', path: string | null = '/tmp/project.restorm') => {
      onFail?.({ path, reason, detail: 'EACCES: permission denied' })
    },
    succeed: () => { onOk?.({ path: '/tmp/project.restorm' }) }
  }
}

function mountWith(api: MockFileApi): ReturnType<typeof renderHook> {
  ;(window as unknown as { api: { file: MockFileApi } }).api = { file: api }
  return renderHook(() => { useSaveFailureToast() })
}

describe('useSaveFailureToast — the four transitions', () => {
  beforeEach(() => {
    pushMock.mockClear()
    dismissMock.mockClear()
    resetToaster()
  })
  afterEach(() => { cleanup() })

  it('1. a failure with nothing showing pushes exactly one toast, naming the cause', () => {
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.fail('disk-full') })

    expect(pushMock).toHaveBeenCalledTimes(1)
    const [toasterId, input] = pushMock.mock.calls[0] as unknown as [string, ToastInput]
    expect(toasterId).toBe('app')
    expect(input.id).toBe(TOAST_ID)
    expect(input.title).toBe('file.saveFailed.title')
    // No auto-dismiss: the warning stays true until a save gets through.
    expect(input.durationMs).toBeUndefined()
  })

  it('2. a second failure while the toast is still showing pushes NOTHING', () => {
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.fail() })
    act(() => { api.fail() })
    act(() => { api.fail() })

    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('3. a failure after the user closed the toast pushes a new one', () => {
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.fail() })
    act(() => { closeToast(TOAST_ID) })
    act(() => { api.fail() })

    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('4. a save that succeeds dismisses the toast', () => {
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.fail() })
    act(() => { api.succeed() })

    expect(dismissMock).toHaveBeenCalledWith('app', TOAST_ID)
    // And the state machine is back to square one: the next failure is
    // announced again rather than swallowed as a duplicate.
    act(() => { api.fail() })
    expect(pushMock).toHaveBeenCalledTimes(2)
  })
})

describe('useSaveFailureToast', () => {
  beforeEach(() => {
    pushMock.mockClear()
    dismissMock.mockClear()
    resetToaster()
  })
  afterEach(() => { cleanup() })

  it('renders the message for the reported cause, not a generic one', () => {
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.fail('read-only-file') })

    const [, input] = pushMock.mock.calls[0] as unknown as [string, ToastInput]
    expect(JSON.stringify(input.body)).toContain('file.saveFailed.reason.readOnlyFile')
  })

  it('renders a different message for a different cause', () => {
    // The causes must not collapse into one label: a locked directory and
    // a read-only file need different remedies.
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.fail('permission-denied') })

    const [, input] = pushMock.mock.calls[0] as unknown as [string, ToastInput]
    expect(JSON.stringify(input.body)).toContain('file.saveFailed.reason.permissionDenied')
  })

  it('an unrecognised cause carries the raw error text', () => {
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.fail('unknown') })

    const [, input] = pushMock.mock.calls[0] as unknown as [string, ToastInput]
    expect(JSON.stringify(input.body)).toContain('file.saveFailed.reason.unknown|EACCES: permission denied')
  })

  it('a toast mid-close-animation does not suppress the next failure', () => {
    // `exiting` means the user already dismissed it: it is on its way out
    // and can no longer be read, so it is not "the user has been told".
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.fail() })
    act(() => { startExit(TOAST_ID) })
    act(() => { api.fail() })

    expect(pushMock).toHaveBeenCalledTimes(2)
  })

  it('a success with no toast showing is harmless', () => {
    const api = makeFileApi()
    mountWith(api)

    act(() => { api.succeed() })

    expect(pushMock).not.toHaveBeenCalled()
  })

  it('unsubscribes from both channels on unmount', () => {
    const unsubFail = vi.fn()
    const unsubOk = vi.fn()
    const api = {
      onFileSaveFailed: vi.fn(() => unsubFail),
      onFileSaveSucceeded: vi.fn(() => unsubOk),
      fail: () => { /* unused */ },
      succeed: () => { /* unused */ }
    } as unknown as MockFileApi

    const { unmount } = mountWith(api)
    unmount()

    expect(unsubFail).toHaveBeenCalled()
    expect(unsubOk).toHaveBeenCalled()
  })
})
