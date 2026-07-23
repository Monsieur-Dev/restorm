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
const onCleanPull = vi.fn()
const onUpdateRequired = vi.fn()
// Default: the pre-pull save succeeds (nothing to save, or saved cleanly).
const saveBeforePull = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)

/** A single-file project with one request, used as the common ancestor. */
const BASE = `_projectUuid: p
collections:
  - id: env
    name: Project
    tags: []
    configuration: {}
    folderType: environment
    environments: []
    items:
      - id: r1
        name: Base name
        type: http
        tags: []
        method: GET
        url: https://base
        headers: []
        params: []
        pathParams: []
`

// The chain is several microtask turns deep (save → fetch → three reads →
// merge/write). Drain generously: an under-drained flush reads as "the hook
// did nothing" and fails like a logic bug.
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
}

function render(filePath: string | null): ReturnType<typeof renderHook<ReturnType<typeof useGitActions>, unknown>> {
  return renderHook(() =>
    useGitActions(filePath, onOpenPush, saveBeforePull, onCleanPull, onUpdateRequired)
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  saveBeforePull.mockResolvedValue(true)
  delete (window as { api?: unknown }).api
})

interface GitStub {
  fetchAndCompare: ReturnType<typeof vi.fn>
  getFileAtMergeBase: ReturnType<typeof vi.fn>
  getConflictCommitTimestamps: ReturnType<typeof vi.fn>
  getFileAtRemote: ReturnType<typeof vi.fn>
  resetToRemoteKeepingWorkingTree: ReturnType<typeof vi.fn>
  resetHardToRemote: ReturnType<typeof vi.fn>
  writeResolvedConflict: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
}

/** `behind` drives whether there is anything to update at all; `ours` and
 * `theirs` decide whether the update is contested. */
function stubGitApi(opts: {
  behind?: number
  error?: string
  ours?: string
  theirs?: string
} = {}): GitStub {
  const stub: GitStub = {
    fetchAndCompare: vi.fn().mockResolvedValue(
      opts.error !== undefined
        ? { remoteHasNewerVersion: false, behind: 0, error: opts.error }
        : { remoteHasNewerVersion: (opts.behind ?? 0) > 0, behind: opts.behind ?? 0 }
    ),
    getFileAtMergeBase: vi.fn().mockResolvedValue(BASE),
    getConflictCommitTimestamps: vi.fn().mockResolvedValue({ ours: null, theirs: null }),
    getFileAtRemote: vi.fn().mockResolvedValue(opts.theirs ?? BASE),
    resetToRemoteKeepingWorkingTree: vi.fn().mockResolvedValue({ success: true }),
    resetHardToRemote: vi.fn().mockResolvedValue({ success: true }),
    writeResolvedConflict: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(opts.ours ?? BASE)
  }
  ;(window as unknown as { api: unknown }).api = {
    git: {
      fetchAndCompare: stub.fetchAndCompare,
      getFileAtMergeBase: stub.getFileAtMergeBase,
      getConflictCommitTimestamps: stub.getConflictCommitTimestamps,
      getFileAtRemote: stub.getFileAtRemote,
      resetToRemoteKeepingWorkingTree: stub.resetToRemoteKeepingWorkingTree,
      resetHardToRemote: stub.resetHardToRemote,
      writeResolvedConflict: stub.writeResolvedConflict,
      getWorkingTreeFile: stub.readFile,
      getStatus: vi.fn().mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, files: [{ path: 'api.restorm', state: 'modified' }] })
    }
  }
  return stub
}

describe('useGitActions', () => {
  it('onPush delegates to the injected openPushModal callback', () => {
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPush() })
    expect(onOpenPush).toHaveBeenCalledTimes(1)
  })

  it('onPull saves the live tree to disk BEFORE looking at the remote', async () => {
    const stub = stubGitApi()
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()

    expect(saveBeforePull).toHaveBeenCalledTimes(1)
    const saveOrder = saveBeforePull.mock.invocationCallOrder[0] ?? Infinity
    const fetchOrder = stub.fetchAndCompare.mock.invocationCallOrder[0] ?? -Infinity
    expect(saveOrder).toBeLessThan(fetchOrder)
  })

  it('onPull refreshes the open file and writes nothing when already up to date', async () => {
    const stub = stubGitApi({ behind: 0 })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()

    expect(onCleanPull).toHaveBeenCalledTimes(1)
    expect(stub.resetToRemoteKeepingWorkingTree).not.toHaveBeenCalled()
    expect(stub.writeResolvedConflict).not.toHaveBeenCalled()
    expect(onUpdateRequired).not.toHaveBeenCalled()
  })

  it('onPull updates silently — no prompt — when nothing is contested', async () => {
    // They renamed the request; we changed nothing. One-sided, so there is
    // no decision for the user to make.
    const stub = stubGitApi({
      behind: 2,
      ours: BASE,
      theirs: BASE.replace('Base name', 'Their name')
    })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()

    expect(onUpdateRequired).not.toHaveBeenCalled()
    expect(stub.resetToRemoteKeepingWorkingTree).toHaveBeenCalledWith('/home/user/demo')
    expect(stub.writeResolvedConflict).toHaveBeenCalled()
    expect(onCleanPull).toHaveBeenCalledTimes(1)
  })

  it('onPull raises the prompt in PULL mode — and writes nothing — when contested', async () => {
    const stub = stubGitApi({
      behind: 1,
      ours: BASE.replace('https://base', 'https://mine'),
      theirs: BASE.replace('https://base', 'https://theirs')
    })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()

    expect(onUpdateRequired).toHaveBeenCalledTimes(1)
    const pending = onUpdateRequired.mock.calls[0]?.[0] as { mode: string; conflicts: unknown[] }
    // Pull must never publish afterwards — that distinction rides on the mode.
    expect(pending.mode).toBe('pull')
    expect(pending.conflicts).toHaveLength(1)
    // Nothing may be written before the user has decided.
    expect(stub.resetToRemoteKeepingWorkingTree).not.toHaveBeenCalled()
    expect(stub.writeResolvedConflict).not.toHaveBeenCalled()
  })

  it('onPull is a no-op when no file is open (no folder to pull into)', async () => {
    const stub = stubGitApi()
    const { result } = render(null)
    act(() => { result.current.onPull() })
    await flush()
    expect(stub.fetchAndCompare).not.toHaveBeenCalled()
  })

  it('onPull is a no-op for a legacy folder-mode project (no single project file)', async () => {
    const stub = stubGitApi()
    const { result } = render('/home/user/demo/collection.json')
    act(() => { result.current.onPull() })
    await flush()
    expect(stub.fetchAndCompare).not.toHaveBeenCalled()
  })

  it('onPull skips everything and shows a toast when the pre-pull save fails', async () => {
    const stub = stubGitApi()
    saveBeforePull.mockResolvedValue(false)
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()

    expect(stub.fetchAndCompare).not.toHaveBeenCalled()
    expect(toasterPushMock).toHaveBeenCalledWith('app', expect.objectContaining({
      title: 'git.pullFailedTitle',
      body: 'git.pullSaveFailedBody'
    }))
  })

  it('onPull surfaces the remote error instead of pretending it is up to date', async () => {
    stubGitApi({ error: 'host unreachable' })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()

    expect(onCleanPull).not.toHaveBeenCalled()
    expect(toasterPushMock).toHaveBeenCalledWith('app', expect.objectContaining({
      title: 'git.pullFailedTitle',
      body: 'host unreachable'
    }))
  })

  it('onPull reports a failed update rather than silently leaving the file behind', async () => {
    const stub = stubGitApi({
      behind: 1,
      ours: BASE,
      theirs: BASE.replace('Base name', 'Their name')
    })
    stub.resetToRemoteKeepingWorkingTree.mockResolvedValue({ success: false, error: 'no upstream branch' })
    const { result } = render('/home/user/demo/api.restorm')
    act(() => { result.current.onPull() })
    await flush()

    expect(toasterPushMock).toHaveBeenCalledWith('app', expect.objectContaining({
      title: 'gitUpdate.updateFailedTitle',
      body: 'no upstream branch'
    }))
    expect(onCleanPull).not.toHaveBeenCalled()
  })
})
