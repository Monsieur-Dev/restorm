// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))
vi.mock('../components/Toaster/ToasterService', () => ({
  toasterService: { push: pushMock }
}))

import { useGitCliMissingToast } from './useGitCliMissingToast'

interface MockGitApi {
  onCliMissing: (callback: () => void) => () => void
  fire: () => void
}

function makeGitApi(): MockGitApi {
  let listener: (() => void) | null = null
  return {
    onCliMissing: vi.fn((callback: () => void) => {
      listener = callback
      return () => { listener = null }
    }),
    fire: () => { listener?.() }
  }
}

describe('useGitCliMissingToast', () => {
  beforeEach(() => {
    pushMock.mockClear()
  })

  it('pushes an app-toaster toast when git:cli-missing fires', () => {
    const api = makeGitApi()
    ;(window as unknown as { api: { git: MockGitApi } }).api = { git: api }

    renderHook(() => { useGitCliMissingToast() })
    api.fire()

    expect(pushMock).toHaveBeenCalledWith('app', { title: 'git.cliMissing.title', body: 'git.cliMissing.body' })
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    const api: MockGitApi = { onCliMissing: vi.fn(() => unsubscribe), fire: () => { /* unused in this test */ } }
    ;(window as unknown as { api: { git: MockGitApi } }).api = { git: api }

    const { unmount } = renderHook(() => { useGitCliMissingToast() })
    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
