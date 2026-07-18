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

const onOpenPush = vi.fn()
const onConflict = vi.fn()
const onCleanPull = vi.fn()
// Default: the pre-pull save succeeds (nothing to save, or saved cleanly).
const saveBeforePull = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)

// `onPull` now awaits the pre-pull save before touching git, so the pull and
// its follow-up run on later microtask turns — flush a few rounds so the
// whole chain settles inside `act`.
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function render(filePath: string | null): ReturnType<typeof renderHook<ReturnType<typeof useGitActions>, unknown>> {
  return renderHook(() =>
    useGitActions(filePath, onOpenPush, onConflict, saveBeforePull, onCleanPull)
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  saveBeforePull.mockResolvedValue(true)
  delete (window as { api?: unknown }).api
})

function stubGitApi(
  pullResult?: {
    success: boolean
    conflicted: boolean
    conflictFiles: string[]
    error?: string
  },
  statusFiles: { path: string; state: string }[] = []
): { pull: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn> } {
  const pull = vi
    .fn()
    .mockResolvedValue(pullResult ?? { success: true, conflicted: false, conflictFiles: [] })
  // `onPull` reads the working-tree status on a non-conflicted failure to tell
  // "unpushed local changes blocked the merge" apart from any other git error.
  const getStatus = vi
    .fn()
    .mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, files: statusFiles })
  ;(window as unknown as { api: unknown }).api = { git: { pull, getStatus } }
  return { pull, getStatus }
}

describe('useGitActions', () => {
  it('onPush delegates to the injected openPushModal callback', () => {
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPush() })
    expect(onOpenPush).toHaveBeenCalledTimes(1)
  })

  it('onPull saves the live tree to disk BEFORE pulling', async () => {
    const { pull } = stubGitApi()
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()
    expect(saveBeforePull).toHaveBeenCalledTimes(1)
    expect(pull).toHaveBeenCalledTimes(1)
    // The save must complete before the pull runs — git merges on-disk content.
    const saveOrder = saveBeforePull.mock.invocationCallOrder[0] ?? Infinity
    const pullOrder = pull.mock.invocationCallOrder[0] ?? -Infinity
    expect(saveOrder).toBeLessThan(pullOrder)
  })

  it('onPull calls window.api.git.pull with the folder derived from the open .restorm file', async () => {
    const { pull } = stubGitApi()
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()
    expect(pull).toHaveBeenCalledWith('/home/user/demo')
  })

  it('onPull is a no-op when no file is open (no folder to pull into)', async () => {
    const { pull } = stubGitApi()
    const { result } = render(null)
    act(() => { result.current.onPull() })
    await flush()
    expect(pull).not.toHaveBeenCalled()
    expect(saveBeforePull).not.toHaveBeenCalled()
  })

  it('onPull is a no-op for a legacy folder-mode project (no single file to identify conflicts against)', async () => {
    const { pull } = stubGitApi()
    const { result } = render('/home/user/demo/folder')
    act(() => { result.current.onPull() })
    await flush()
    expect(pull).not.toHaveBeenCalled()
    expect(saveBeforePull).not.toHaveBeenCalled()
  })

  it('onPull skips the pull and shows a toast when the pre-pull save fails', async () => {
    const { pull } = stubGitApi()
    saveBeforePull.mockResolvedValue(false)
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()
    expect(pull).not.toHaveBeenCalled()
    expect(onCleanPull).not.toHaveBeenCalled()
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pullFailedTitle',
      body: 'git.pullSaveFailedBody',
      durationMs: 10000
    })
  })

  it('onPull refreshes the open file after a clean (success, non-conflicted) pull', async () => {
    stubGitApi({ success: true, conflicted: false, conflictFiles: [] })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()
    expect(onCleanPull).toHaveBeenCalledTimes(1)
    expect(toasterPushMock).not.toHaveBeenCalled()
  })

  it('onPull hands off to onConflict (with the derived folder + relative path) instead of a toast when the pull conflicts', async () => {
    stubGitApi({ success: false, conflicted: true, conflictFiles: ['api.restorm'] })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()
    expect(onConflict).toHaveBeenCalledWith('/home/user/demo', 'api.restorm')
    expect(onCleanPull).not.toHaveBeenCalled()
    expect(toasterPushMock).not.toHaveBeenCalled()
  })

  it('onPull shows a failure toast with the git error when the pull fails (working tree clean)', async () => {
    stubGitApi({ success: false, conflicted: false, conflictFiles: [], error: 'fatal: could not read from remote' })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()
    expect(onCleanPull).not.toHaveBeenCalled()
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pullFailedTitle',
      body: 'fatal: could not read from remote',
      durationMs: 10000
    })
  })

  it('onPull shows the "push first" message when the pull was refused by unpushed local changes', async () => {
    // git refuses to merge over uncommitted local changes; the working tree
    // still shows the project file modified after the failed pull.
    stubGitApi(
      { success: false, conflicted: false, conflictFiles: [], error: 'error: Your local changes would be overwritten' },
      [{ path: 'api.restorm', state: 'modified' }]
    )
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()
    expect(onCleanPull).not.toHaveBeenCalled()
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pullFailedTitle',
      body: 'git.pullUnpushedChangesBody',
      durationMs: 10000
    })
  })

  it('onPull falls back to a generic failure body when the git error is missing', async () => {
    stubGitApi({ success: false, conflicted: false, conflictFiles: [] })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()
    expect(toasterPushMock).toHaveBeenCalledWith('app', {
      title: 'git.pullFailedTitle',
      body: 'git.pullFailedBody',
      durationMs: 10000
    })
  })
})
