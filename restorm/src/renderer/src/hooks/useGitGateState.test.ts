// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import type { GitState } from 'electron-core-ui/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { useGitStateMock } = vi.hoisted(() => ({
  useGitStateMock: vi.fn<() => GitState>()
}))
vi.mock('electron-core-ui/renderer', () => ({
  useGitState: () => useGitStateMock()
}))

const { useCapabilityMock } = vi.hoisted(() => ({
  useCapabilityMock: vi.fn<() => boolean>()
}))
vi.mock('./useCapability', () => ({
  useCapability: () => useCapabilityMock()
}))

import { useGitGateState } from './useGitGateState'

const HAS_REPO: GitState = { isRepo: true, gitInstalled: true, status: { branch: 'main', ahead: 0, behind: 0, files: [] }, remoteHasNewerVersion: false, hasConflicts: false }
const NO_REPO: GitState = { isRepo: false, gitInstalled: true, status: null, remoteHasNewerVersion: false, hasConflicts: false }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useGitGateState', () => {
  it('Community (regardless of the folder being a git repo) → locked, standard upsell, subscribe link shown', () => {
    useCapabilityMock.mockReturnValue(false)
    useGitStateMock.mockReturnValue(HAS_REPO)
    const { result } = renderHook(() => useGitGateState())
    expect(result.current).toEqual({ kind: 'community', locked: true, showSubscribeLink: true })
  })

  it('Community + no git repo → STILL the community upsell state, not the init-git message', () => {
    useCapabilityMock.mockReturnValue(false)
    useGitStateMock.mockReturnValue(NO_REPO)
    const { result } = renderHook(() => useGitGateState())
    expect(result.current.kind).toBe('community')
  })

  it('Pro + no git repo → locked, informational init-git message, no subscribe link', () => {
    useCapabilityMock.mockReturnValue(true)
    useGitStateMock.mockReturnValue(NO_REPO)
    const { result } = renderHook(() => useGitGateState())
    expect(result.current).toEqual({
      kind: 'no-git-folder',
      locked: true,
      message: 'git.gate.initGitFolder',
      showSubscribeLink: false
    })
  })

  it('Pro + git repo → enabled, not locked', () => {
    useCapabilityMock.mockReturnValue(true)
    useGitStateMock.mockReturnValue(HAS_REPO)
    const { result } = renderHook(() => useGitGateState())
    expect(result.current).toEqual({ kind: 'enabled', locked: false, showSubscribeLink: true })
  })
})
