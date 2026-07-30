import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react'
import { createElement, type ReactElement, type ReactNode } from 'react'
import type { UpdateState } from '../../../shared/update/updateTypes'

// Spy on the app toaster + stub the ECUI primitives the component renders.
const pushMock = vi.fn()
// Capture the eventBus subscriber so a test can drive the Help-menu open path.
const busCapture: { handler: ((p: { mode: string }) => void) | null } = { handler: null }
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
    createElement('div', { 'data-testid': 'md' }, props.value),
  // Surfaces the scroll options so a test can assert the note actually scrolls
  // rather than merely being wrapped in something.
  ScrollableElement: (props: {
    children?: ReactNode
    className?: string
    style?: { maxHeight?: string | number }
    options?: { vertical?: string; horizontal?: string; fitContent?: boolean }
  }): ReactNode =>
    createElement(
      'div',
      {
        'data-testid': 'scrollable',
        'data-vertical': props.options?.vertical ?? '',
        'data-horizontal': props.options?.horizontal ?? '',
        'data-fit-content': props.options?.fitContent ? 'true' : 'false',
        // Under `fitContent` the component copies `style.maxHeight` onto the
        // element that actually scrolls, so the cap MUST arrive this way — a
        // stylesheet cap leaves the scrolling element uncapped and the wheel
        // dead. Surfaced here so a regression fails the test instead of only
        // showing up under a live mouse wheel.
        'data-max-height': String(props.style?.maxHeight ?? ''),
        className: props.className
      },
      props.children
    ),
  ReleaseNotesModal: (props: {
    isOpen?: boolean
    loading?: boolean
    sections?: { version: string }[]
    initialCount?: number
  }): ReactNode =>
    createElement('div', {
      'data-testid': 'release-notes-modal',
      'data-is-open': props.isOpen ? 'true' : 'false',
      'data-loading': props.loading ? 'true' : 'false',
      'data-versions': (props.sections ?? []).map((s) => s.version).join(','),
      'data-initial-count': String(props.initialCount ?? '')
    }),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  eventBus: {
    subscribe: (_event: string, cb: (p: { mode: string }) => void): { unsubscribe: () => void } => {
      busCapture.handler = cb
      return { unsubscribe: vi.fn() }
    },
    emitLocalSync: vi.fn()
  }
}))

// t echoes the key, and appends any interpolation options so a test can tell
// "titled by key alone" apart from "titled with a version interpolated in".
// `i18n.language` feeds the localized "What's new" lookup.
vi.mock('react-i18next', () => ({
  useTranslation: (): {
    t: (key: string, opts?: Record<string, unknown>) => string
    i18n: { language: string }
  } => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: 'en' }
  })
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
  opts: {
    lastSeen?: string | null
    changelog?: string
    releaseNotes?: { version: string; markdown: string }[]
    /** Withhold the release notes until the returned resolver is called. */
    deferReleaseNotes?: boolean
  } = {}
): {
  markVersionSeen: ReturnType<typeof vi.fn>
  resolveReleaseNotes: () => void
} {
  stateListener = null
  const markVersionSeen = vi.fn(() => Promise.resolve())
  const notes = opts.releaseNotes ?? []
  let release: () => void = () => { throw new Error('release notes were not deferred') }
  const pending = new Promise<typeof notes>((resolve) => {
    release = () => { resolve(notes) }
  })
  ;(window as unknown as { api: unknown }).api = {
    update: {
      getState: vi.fn(() => Promise.resolve(baseState())),
      getSettings: vi.fn(() =>
        Promise.resolve({ autoCheckEnabled: true, currentVersion: '1.2.0', autoUpdateSupported: true })
      ),
      getLastSeenVersion: vi.fn(() => Promise.resolve(opts.lastSeen ?? '1.2.0')),
      getChangelogSince: vi.fn(() => Promise.resolve(opts.changelog ?? '')),
      getReleaseNotes: vi.fn(() => (opts.deferReleaseNotes === true ? pending : Promise.resolve(notes))),
      markVersionSeen,
      quitAndInstall: vi.fn(() => Promise.resolve()),
      onStateChanged: vi.fn((cb: (s: UpdateState) => void) => {
        stateListener = cb
        return vi.fn()
      })
    }
  }
  return { markVersionSeen, resolveReleaseNotes: () => { release() } }
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

/** Render a captured toast body so its structure can be queried. */
function renderToastBody(input: ToastInput): HTMLElement {
  return render(input.body as ReactNode).container
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

  it('the update-ready toast offers a "see release notes" action that opens the modal', async () => {
    installApi()
    const view = render(<UpdateNotifications />)
    await waitFor(() => { expect(stateListener).not.toBeNull() })
    await emit(baseState({ phase: 'downloaded', version: '1.3.0' }))

    // The modal starts closed.
    expect(view.getByTestId('release-notes-modal').getAttribute('data-is-open')).toBe('false')

    // Render the ready toast's body and click the "see release notes" action.
    const ready = findToast((i) => i.id === 'restorm:update-ready')
    const body = render(ready.body as ReactElement)
    await act(async () => {
      fireEvent.click(body.getByText('updates.seeReleaseNotes'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(view.getByTestId('release-notes-modal').getAttribute('data-is-open')).toBe('true')
    })
  })

  it('opens the modal on the Help-menu release-notes event', async () => {
    installApi()
    const view = render(<UpdateNotifications />)
    await waitFor(() => { expect(busCapture.handler).not.toBeNull() })

    await act(async () => {
      busCapture.handler?.({ mode: 'recent' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(view.getByTestId('release-notes-modal').getAttribute('data-is-open')).toBe('true')
    })
  })

  it('opens immediately in a loading state instead of waiting on the fetch', async () => {
    // The notes come off the release feed; blocking the open on that request is
    // what makes the trigger look dead on a slow or unreachable feed.
    const { resolveReleaseNotes } = installApi({
      deferReleaseNotes: true,
      releaseNotes: [
        { version: '1.3.0', markdown: '## v1.3.0' },
        { version: '1.2.0', markdown: '## v1.2.0' }
      ]
    })
    const view = render(<UpdateNotifications />)
    await waitFor(() => { expect(busCapture.handler).not.toBeNull() })

    await act(async () => {
      busCapture.handler?.({ mode: 'recent' })
      await Promise.resolve()
    })

    // Open and showing the loading placeholder, with the fetch still pending.
    const modal = (): HTMLElement => view.getByTestId('release-notes-modal')
    await waitFor(() => { expect(modal().getAttribute('data-is-open')).toBe('true') })
    expect(modal().getAttribute('data-loading')).toBe('true')
    expect(modal().getAttribute('data-versions')).toBe('')

    await act(async () => {
      resolveReleaseNotes()
      await Promise.resolve()
    })

    await waitFor(() => { expect(modal().getAttribute('data-loading')).toBe('false') })
    expect(modal().getAttribute('data-versions')).toBe('1.3.0,1.2.0')
  })

  it('reveals only the versions newer than the running one when opened before updating', async () => {
    // Running 1.2.0, update 1.4.0 ready: 1.4.0 + 1.3.0 show up front, the
    // already-installed 1.2.0 and 1.1.0 sit behind "show more".
    installApi({
      releaseNotes: [
        { version: '1.4.0', markdown: '## v1.4.0' },
        { version: '1.3.0', markdown: '## v1.3.0' },
        { version: '1.2.0', markdown: '## v1.2.0' },
        { version: '1.1.0', markdown: '## v1.1.0' }
      ]
    })
    const view = render(<UpdateNotifications />)
    await waitFor(() => { expect(stateListener).not.toBeNull() })
    await emit(baseState({ phase: 'downloaded', version: '1.4.0' }))

    const body = render(findToast((i) => i.id === 'restorm:update-ready').body as ReactElement)
    await act(async () => {
      fireEvent.click(body.getByText('updates.seeReleaseNotes'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(view.getByTestId('release-notes-modal').getAttribute('data-initial-count')).toBe('2')
    })
  })

  it('reveals the most recent versions when the previously-installed one is unknown', async () => {
    installApi({
      releaseNotes: Array.from({ length: 14 }, (_, i) => ({
        version: `1.${14 - i}.0`,
        markdown: `## v1.${14 - i}.0`
      }))
    })
    const view = render(<UpdateNotifications />)
    await waitFor(() => { expect(busCapture.handler).not.toBeNull() })

    await act(async () => {
      busCapture.handler?.({ mode: 'recent' })
      await Promise.resolve()
    })

    // Capped at the 10 most recent, the rest behind "show more".
    await waitFor(() => {
      expect(view.getByTestId('release-notes-modal').getAttribute('data-initial-count')).toBe('10')
    })
  })

  it('puts the note in a vertical scroll container so a long span stays readable', async () => {
    installApi({
      lastSeen: '1.0.0',
      changelog: '## v1.2.0\n\n- a\n\n## v1.1.0\n\n- b\n\n## v1.0.5\n\n- c\n'
    })
    render(<UpdateNotifications />)
    await waitFor(() => {
      expect(pushedId('restorm:whats-new')).toBe(true)
    })

    const body = renderToastBody(findToast((i) => i.id === 'restorm:whats-new'))
    const scrollable = body.querySelector('[data-testid="scrollable"]')
    expect(scrollable).not.toBeNull()
    expect(scrollable?.getAttribute('data-vertical')).toBe('auto')
    expect(scrollable?.getAttribute('data-horizontal')).toBe('hidden')
    // A short note must sit at its natural height, not padded out to the cap.
    expect(scrollable?.getAttribute('data-fit-content')).toBe('true')
    // The cap must reach the component as a style, or the scrolling element is
    // never capped and the wheel has nothing to move.
    expect(scrollable?.getAttribute('data-max-height')).toBe('min(40vh, 220px)')

    // Every version since the last run stays in the note...
    const md = scrollable?.querySelector('[data-testid="md"]')
    expect(md?.textContent).toContain('- a')
    expect(md?.textContent).toContain('- b')
    expect(md?.textContent).toContain('- c')
    // ...and the modal link sits OUTSIDE the scroll area, so scrolling can never
    // put it out of reach the way the previous clipped layout could.
    expect(scrollable?.textContent).not.toContain('updates.seeReleaseNotes')
    expect(body.textContent).toContain('updates.seeReleaseNotes')
  })

  it('titles the note without a version number', async () => {
    installApi({ lastSeen: '1.1.0', changelog: '## v1.2.0\n- New' })
    render(<UpdateNotifications />)
    await waitFor(() => {
      expect(pushedId('restorm:whats-new')).toBe(true)
    })
    // t echoes interpolation options, so a re-added version would show up here.
    expect(findToast((i) => i.id === 'restorm:whats-new').title).toBe('updates.whatsNewTitle')
  })
})
