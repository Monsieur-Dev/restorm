// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

// The merge write-back is exercised on its own; here only the ROUTE taken
// (hard reset vs move-and-merge) is under test.
vi.mock('../services/mergedProjectYaml', () => ({
  buildMergedProjectYaml: () => 'merged: true\n'
}))

import { useGitUpdateActions } from './useGitUpdateActions'

const VERSIONS = { path: 'api.restorm', base: null, ours: 'collections: []', theirs: 'collections: []' }

function stubGit(status: { files: { path: string }[], ahead: number }): {
  getStatus: ReturnType<typeof vi.fn>
  getConflictCommitTimestamps: ReturnType<typeof vi.fn>
  resetHardToRemote: ReturnType<typeof vi.fn>
  resetToRemoteKeepingWorkingTree: ReturnType<typeof vi.fn>
  writeResolvedConflict: ReturnType<typeof vi.fn>
} {
  const api = {
    getStatus: vi.fn().mockResolvedValue(status),
    getConflictCommitTimestamps: vi.fn().mockResolvedValue({ ours: 100, theirs: 200 }),
    resetHardToRemote: vi.fn().mockResolvedValue({ success: true }),
    resetToRemoteKeepingWorkingTree: vi.fn().mockResolvedValue({ success: true }),
    writeResolvedConflict: vi.fn().mockResolvedValue(undefined)
  }
  ;(window as unknown as { api: unknown }).api = { git: api }
  return api
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => {
  cleanup()
  delete (window as { api?: unknown }).api
})

describe('updateKeepingMine', () => {
  it('fast-forwards with a hard reset when we have nothing of our own', async () => {
    const api = stubGit({ files: [], ahead: 0 })
    const { result } = renderHook(() => useGitUpdateActions())

    await act(async () => { await result.current.updateKeepingMine('/proj', 'api.restorm', VERSIONS) })

    expect(api.resetHardToRemote).toHaveBeenCalledWith('/proj')
    expect(api.writeResolvedConflict).not.toHaveBeenCalled()
  })

  it('merges instead of resetting when the file is edited in the working tree', async () => {
    const api = stubGit({ files: [{ path: 'api.restorm' }], ahead: 0 })
    const { result } = renderHook(() => useGitUpdateActions())

    await act(async () => { await result.current.updateKeepingMine('/proj', 'api.restorm', VERSIONS) })

    expect(api.resetHardToRemote).not.toHaveBeenCalled()
    expect(api.resetToRemoteKeepingWorkingTree).toHaveBeenCalledWith('/proj')
    expect(api.writeResolvedConflict).toHaveBeenCalledWith('/proj', 'api.restorm', 'merged: true\n')
  })

  it('merges instead of resetting when we hold a commit the remote does not have', async () => {
    // A clean working tree is NOT proof there is nothing to lose: a
    // commit of ours that was never pushed lives only in the branch, and
    // a hard reset drops it with no warning and no way back short of the
    // reflog — while the flow reports "your changes were kept".
    const api = stubGit({ files: [], ahead: 1 })
    const { result } = renderHook(() => useGitUpdateActions())

    await act(async () => { await result.current.updateKeepingMine('/proj', 'api.restorm', VERSIONS) })

    expect(api.resetHardToRemote).not.toHaveBeenCalled()
    expect(api.resetToRemoteKeepingWorkingTree).toHaveBeenCalledWith('/proj')
    expect(api.writeResolvedConflict).toHaveBeenCalled()
  })
})

describe('imported documentation on the silent-update path', () => {
  it('fetches the commit timestamps, so "newest wins" still applies', () => {
    // Without them the rule degrades to "ours always wins" and the other
    // side's newer documentation is dropped on every uncontested update —
    // silently, since documentation is never put to the user.
    const api = stubGit({ files: [{ path: 'api.restorm' }], ahead: 0 })
    const { result } = renderHook(() => useGitUpdateActions())

    return act(async () => {
      await result.current.updateKeepingMine('/proj', 'api.restorm', VERSIONS)
      expect(api.getConflictCommitTimestamps).toHaveBeenCalledWith('/proj')
    })
  })
})
