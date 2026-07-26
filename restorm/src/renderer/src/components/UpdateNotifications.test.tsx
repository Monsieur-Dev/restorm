import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import type { UpdateState } from '../../../shared/update/updateTypes'

// Spy on the app toaster + stub the ECUI primitives the component renders.
const pushMock = vi.fn()
vi.mock('electron-core-ui/renderer', () => ({
  toasterService: {
    push: (id: string, input: unknown): string => {
      pushMock(id, input)
      return 'toast'
    }
  },
  Button: (props: { children?: ReactNode; onClick?: () => void }): ReactNode =>
    createElement('button', { onClick: props.onClick }, props.children),
  MarkdownViewer: (props: { value?: string }): ReactNode =>
    createElement('div', { 'data-testid': 'md' }, props.value)
}))

// t returns the key so assertions can match on it directly.
vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key })
}))

import { UpdateNotifications } from './UpdateNotifications'

const baseState = (over: Partial<UpdateState> = {}): UpdateState => ({
  phase: 'idle',
  version: null,
  currentVersion: '1.2.0',
  percent: null,
  lastCheckedAt: null,
  error: null,
  trigger: null,
  ...over
})

let stateListener: ((s: UpdateState) => void) | null = null

function installApi(
  opts: { lastSeen?: string | null; changelog?: string } = {}
): { markVersionSeen: ReturnType<typeof vi.fn> } {
  stateListener = null
  const markVersionSeen = vi.fn(() => Promise.resolve())
  ;(window as unknown as { api: unknown }).api = {
    update: {
      getState: vi.fn(() => Promise.resolve(baseState())),
      getSettings: vi.fn(() =>
        Promise.resolve({ autoCheckEnabled: true, currentVersion: '1.2.0' })
      ),
      getLastSeenVersion: vi.fn(() => Promise.resolve(opts.lastSeen ?? '1.2.0')),
      getChangelogSince: vi.fn(() => Promise.resolve(opts.changelog ?? '')),
      markVersionSeen,
      quitAndInstall: vi.fn(() => Promise.resolve()),
      onStateChanged: vi.fn((cb: (s: UpdateState) => void) => {
        stateListener = cb
        return vi.fn()
      })
    }
  }
  return { markVersionSeen }
}

interface ToastInput {
  id?: string
  title?: string
  durationMs?: number
  body?: unknown
}

/** Find the input of a pushed toast matching `pred`, or throw (fails the test). */
function findToast(pred: (input: ToastInput) => boolean): ToastInput {
  const call = pushMock.mock.calls.find((c) => pred(c[1] as ToastInput))
  if (!call) throw new Error('expected toast was not pushed')
  return call[1] as ToastInput
}

function pushedTitle(title: string): boolean {
  return pushMock.mock.calls.some((c) => (c[1] as ToastInput).title === title)
}

function pushedId(id: string): boolean {
  return pushMock.mock.calls.some((c) => (c[1] as ToastInput).id === id)
}

beforeEach(() => {
  pushMock.mockClear()
})
afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

async function emit(state: UpdateState): Promise<void> {
  await act(async () => {
    stateListener?.(state)
    await Promise.resolve()
  })
}

async function mount(): Promise<void> {
  render(<UpdateNotifications />)
  await waitFor(() => {
    expect(stateListener).not.toBeNull()
  })
}

describe('UpdateNotifications', () => {
  it('shows the "update ready" toast (indefinite) when a download completes', async () => {
    installApi()
    await mount()
    await emit(baseState({ phase: 'downloaded', version: '1.3.0' }))

    const ready = findToast((i) => i.id === 'restorm:update-ready')
    expect(ready.title).toBe('updates.readyTitle')
    expect(ready.durationMs).toBeUndefined()
  })

  it('shows a 5s "check failed" toast only for a MANUAL error', async () => {
    installApi()
    await mount()
    await emit(baseState({ phase: 'error', error: { trigger: 'manual', message: 'x' } }))
    const failed = findToast((i) => i.title === 'updates.checkFailedTitle')
    expect(failed.durationMs).toBe(5000)
  })

  it('does NOT toast on an auto error', async () => {
    installApi()
    await mount()
    await emit(baseState({ phase: 'error', error: { trigger: 'auto', message: 'x' } }))
    expect(pushedTitle('updates.checkFailedTitle')).toBe(false)
  })

  it('shows "up to date" after a MANUAL check finds nothing', async () => {
    installApi()
    await mount()
    await emit(baseState({ phase: 'checking', trigger: 'manual' }))
    await emit(baseState({ phase: 'idle', trigger: 'manual' }))
    expect(pushedTitle('updates.upToDateTitle')).toBe(true)
  })

  it('shows "What\'s new" once when the version advanced past lastSeen', async () => {
    const { markVersionSeen } = installApi({ lastSeen: '1.1.0', changelog: '## v1.2.0\n- New' })
    render(<UpdateNotifications />)
    await waitFor(() => {
      expect(pushedId('restorm:whats-new')).toBe(true)
    })
    await waitFor(() => {
      expect(markVersionSeen).toHaveBeenCalledWith('1.2.0')
    })
  })

  it('does NOT show "What\'s new" on a fresh install (lastSeen == current)', async () => {
    installApi({ lastSeen: '1.2.0' })
    await mount()
    expect(pushedId('restorm:whats-new')).toBe(false)
  })
})
