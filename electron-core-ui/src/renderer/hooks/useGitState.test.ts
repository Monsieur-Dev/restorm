// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useGitState } from './useGitState'
import { NO_GIT_STATE } from '../../types/git'
import type { GitState } from '../../types/git'

interface MockGitApi {
  getState: () => Promise<GitState>
  onStateChanged: (callback: (state: GitState) => void) => () => void
  fire: (state: GitState) => void
}

function makeGitApi(initial: GitState): MockGitApi {
  let listener: ((state: GitState) => void) | null = null
  return {
    getState: vi.fn(() => Promise.resolve(initial)),
    onStateChanged: vi.fn((callback: (state: GitState) => void) => {
      listener = callback
      return () => { listener = null }
    }),
    fire: (state: GitState) => { listener?.(state) }
  } as MockGitApi
}

describe('useGitState', () => {
  beforeEach(() => {
    (window as unknown as { api: Record<string, unknown> }).api = {}
  })

  it('starts at NO_GIT_STATE before the initial fetch resolves', () => {
    const api = makeGitApi({ ...NO_GIT_STATE, isRepo: true })
    ;(window as unknown as { api: { git: MockGitApi } }).api.git = api
    const { result } = renderHook(() => useGitState())
    expect(result.current).toEqual(NO_GIT_STATE)
  })

  it('adopts the initial snapshot once getState() resolves', async () => {
    const snapshot: GitState = {
      ...NO_GIT_STATE,
      isRepo: true,
      status: { branch: 'main', ahead: 0, behind: 0, files: [] }
    }
    const api = makeGitApi(snapshot)
    ;(window as unknown as { api: { git: MockGitApi } }).api.git = api

    const { result } = renderHook(() => useGitState())

    await waitFor(() => { expect(result.current).toEqual(snapshot) })
  })

  it('re-renders on every git:state-changed push', async () => {
    const api = makeGitApi({ ...NO_GIT_STATE })
    ;(window as unknown as { api: { git: MockGitApi } }).api.git = api

    const { result } = renderHook(() => useGitState())
    await waitFor(() => { expect(result.current).toEqual(NO_GIT_STATE) })

    const next: GitState = { ...NO_GIT_STATE, isRepo: true, remoteHasNewerVersion: true }
    act(() => { api.fire(next) })

    expect(result.current).toEqual(next)
  })

  it('unsubscribes on unmount', async () => {
    const api = makeGitApi({ ...NO_GIT_STATE })
    ;(window as unknown as { api: { git: MockGitApi } }).api.git = api

    const { unmount, result } = renderHook(() => useGitState())
    await waitFor(() => { expect(result.current).toEqual(NO_GIT_STATE) })
    unmount()

    // The hook's cleanup nulls the internal listener — firing after
    // unmount must be a silent no-op, not a "set state on unmounted
    // component" crash.
    expect(() => { api.fire({ ...NO_GIT_STATE, isRepo: true }) }).not.toThrow()
  })
})
