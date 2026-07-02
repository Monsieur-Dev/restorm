// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { pushMock, dismissMock } = vi.hoisted(() => ({ pushMock: vi.fn(), dismissMock: vi.fn() }))
vi.mock('../components/Toaster/ToasterService', () => ({
  toasterService: { push: pushMock, dismiss: dismissMock }
}))

import { useGitPullAvailableToast } from './useGitPullAvailableToast'

interface MockGitApi {
  onPullAvailable: (callback: () => void) => () => void
  fire: () => void
}

function makeGitApi(): MockGitApi {
  let listener: (() => void) | null = null
  return {
    onPullAvailable: vi.fn((callback: () => void) => {
      listener = callback
      return () => { listener = null }
    }),
    fire: () => { listener?.() }
  }
}

describe('useGitPullAvailableToast', () => {
  beforeEach(() => {
    pushMock.mockClear()
    dismissMock.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('pushes an app-toaster toast with a fixed id when git:pull-available fires', () => {
    const api = makeGitApi()
    ;(window as unknown as { api: { git: MockGitApi } }).api = { git: api }

    renderHook(() => { useGitPullAvailableToast(vi.fn()) })
    api.fire()

    expect(pushMock).toHaveBeenCalledTimes(1)
    const call = pushMock.mock.calls[0] as [string, { id: string, title: string, body: unknown }]
    expect(call[0]).toBe('app')
    expect(call[1].id).toBe('git-pull-available')
    expect(call[1].title).toBe('git.pullAvailable.title')
  })

  it('a second detection updates the SAME toast id rather than stacking a duplicate', () => {
    const api = makeGitApi()
    ;(window as unknown as { api: { git: MockGitApi } }).api = { git: api }

    renderHook(() => { useGitPullAvailableToast(vi.fn()) })
    api.fire()
    api.fire()

    expect(pushMock).toHaveBeenCalledTimes(2)
    const [firstCall, secondCall] = pushMock.mock.calls as [string, { id: string }][][]
    expect((firstCall as unknown as [string, { id: string }])[1].id).toBe((secondCall as unknown as [string, { id: string }])[1].id)
  })

  it('clicking "Pull now" calls the injected onPull and dismisses the toast', () => {
    const api = makeGitApi()
    ;(window as unknown as { api: { git: MockGitApi } }).api = { git: api }
    const onPull = vi.fn()

    renderHook(() => { useGitPullAvailableToast(onPull) })
    act(() => { api.fire() })

    const call = pushMock.mock.calls[0] as [string, { body: React.ReactElement }]
    const body = call[1].body
    // The body is a small tree (text + a Button); grab the onClick handler
    // straight off the rendered element props rather than mounting it —
    // cheaper and avoids pulling ECUI's full Button implementation into
    // this hook-focused test.
    const buttonElement = findButton(body)
    expect(buttonElement).toBeTruthy()
    act(() => { (buttonElement?.props as { onClick: () => void }).onClick() })

    expect(onPull).toHaveBeenCalledTimes(1)
    expect(dismissMock).toHaveBeenCalledWith('app', 'git-pull-available')
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    const api: MockGitApi = { onPullAvailable: vi.fn(() => unsubscribe), fire: () => { /* unused in this test */ } }
    ;(window as unknown as { api: { git: MockGitApi } }).api = { git: api }

    const { unmount } = renderHook(() => { useGitPullAvailableToast(vi.fn()) })
    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})

// Minimal React-element tree walk to find the `Button` child without
// mounting — the body's own top-level `div` wraps a text `div` + the
// `Button`, both plain `React.createElement` results.
function findButton(node: unknown): { props: unknown } | null {
  if (node === null || typeof node !== 'object') return null
  const element = node as { type?: unknown, props?: { children?: unknown } }
  if (typeof element.type === 'function' && element.type.name === 'Button') {
    return element as { props: unknown }
  }
  const children = element.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findButton(child)
      if (found) return found
    }
  } else if (children !== undefined) {
    return findButton(children)
  }
  return null
}
