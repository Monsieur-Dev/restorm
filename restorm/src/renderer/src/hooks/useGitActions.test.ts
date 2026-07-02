// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// `useGitActions` only needs `toasterService` + `useTranslation` — avoid the
// `electron-core-ui/renderer` barrel (transitively loads Monaco, which jsdom
// can't run) by mocking just the one export it uses.
const { toasterPushMock } = vi.hoisted(() => ({ toasterPushMock: vi.fn() }))

vi.mock('electron-core-ui/renderer', () => ({
  toasterService: { push: toasterPushMock }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useGitActions } from './useGitActions'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as { api?: unknown }).api
})

function stubGitApi(pullResult?: {
  success: boolean
  conflicted: boolean
  conflictFiles: string[]
  error?: string
}): { pull: ReturnType<typeof vi.fn> } {
  const pull = vi
    .fn()
    .mockResolvedValue(pullResult ?? { success: true, conflicted: false, conflictFiles: [] })
  ;(window as unknown as { api: unknown }).api = { git: { pull } }
  return { pull }
}

describe('useGitActions', () => {
  it('onPush shows the "not available yet" toast instead of calling git.push', () => {
    const { result } = renderHook(() => useGitActions('/home/user/demo/api.restorm'))
    act(() => { result.current.onPush() })
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pushComingSoonTitle',
      body: 'git.pushComingSoonBody'
    })
  })

  it('onPull calls window.api.git.pull with the folder derived from the open .restorm file', () => {
    const { pull } = stubGitApi()
    const { result } = renderHook(() => useGitActions('/home/user/demo/api.restorm'))
    act(() => { result.current.onPull() })
    expect(pull).toHaveBeenCalledWith('/home/user/demo')
  })

  it('onPull is a no-op when no file is open (no folder to pull into)', () => {
    const { pull } = stubGitApi()
    const { result } = renderHook(() => useGitActions(null))
    act(() => { result.current.onPull() })
    expect(pull).not.toHaveBeenCalled()
  })

  it('onPull shows a failure toast with the git error when the pull fails', async () => {
    stubGitApi({ success: false, conflicted: false, conflictFiles: [], error: 'fatal: could not read from remote' })
    const { result } = renderHook(() => useGitActions('/home/user/demo/api.restorm'))
    act(() => { result.current.onPull() })
    await act(async () => { await Promise.resolve() })
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pullFailedTitle',
      body: 'fatal: could not read from remote',
      durationMs: 10000
    })
  })

  it('onPull falls back to a generic failure body when the git error is missing', async () => {
    stubGitApi({ success: false, conflicted: false, conflictFiles: [] })
    const { result } = renderHook(() => useGitActions('/home/user/demo/api.restorm'))
    act(() => { result.current.onPull() })
    await act(async () => { await Promise.resolve() })
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pullFailedTitle',
      body: 'git.pullFailedBody',
      durationMs: 10000
    })
  })

  it('onPull shows no toast on success', async () => {
    stubGitApi({ success: true, conflicted: false, conflictFiles: [] })
    const { result } = renderHook(() => useGitActions('/home/user/demo/api.restorm'))
    act(() => { result.current.onPull() })
    await act(async () => { await Promise.resolve() })
    expect(toasterPushMock).not.toHaveBeenCalled()
  })
})
