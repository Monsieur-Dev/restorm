// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { pushMock, dismissMock } = vi.hoisted(() => ({ pushMock: vi.fn(), dismissMock: vi.fn() }))
vi.mock('../components/Toaster/ToasterService', () => ({
  toasterService: { push: pushMock, dismiss: dismissMock }
}))

import { useGitMergeInProgressToast } from './useGitMergeInProgressToast'

const abortMerge = vi.fn()

beforeEach(() => {
  pushMock.mockClear()
  dismissMock.mockClear()
  abortMerge.mockClear()
  ;(window as unknown as { api: unknown }).api = { git: { abortMerge } }
})

afterEach(() => {
  cleanup()
})

/**
 * Cancelling the resolution screen aborts the merge itself, so this state
 * is only reachable by NOT cancelling — closing the window, a crash. There
 * is no way back into the resolution screen, so without the toast the user
 * is stranded somewhere nothing in the app mentions.
 */
describe('useGitMergeInProgressToast', () => {
  it('raises the toast while the repository is mid-merge', () => {
    renderHook(() => { useGitMergeInProgressToast('/repo', true) })

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0]?.[1]).toMatchObject({ id: 'git-merge-in-progress' })
  })

  it('stays quiet on a clean repository', () => {
    renderHook(() => { useGitMergeInProgressToast('/repo', false) })

    expect(pushMock).not.toHaveBeenCalled()
  })

  it('stays quiet when no project is open', () => {
    renderHook(() => { useGitMergeInProgressToast(null, true) })

    expect(pushMock).not.toHaveBeenCalled()
  })

  it('retracts the toast once the repository is clean again', () => {
    const { rerender } = renderHook(
      ({ conflicts }: { conflicts: boolean }) => { useGitMergeInProgressToast('/repo', conflicts) },
      { initialProps: { conflicts: true } }
    )
    dismissMock.mockClear()

    rerender({ conflicts: false })

    expect(dismissMock).toHaveBeenCalledWith('app', 'git-merge-in-progress')
  })

  it('aborts the merge on the folder it was raised for', () => {
    renderHook(() => { useGitMergeInProgressToast('/repo', true) })

    const body = pushMock.mock.calls[0]?.[1] as { body: React.ReactElement }
    const button = (body.body.props as { children: React.ReactElement[] }).children[1]
    ;(button?.props as { onClick: () => void }).onClick()

    expect(abortMerge).toHaveBeenCalledWith('/repo')
    expect(dismissMock).toHaveBeenCalledWith('app', 'git-merge-in-progress')
  })
})
