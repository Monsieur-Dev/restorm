import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.hoisted(() => {
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
  // The sash container measures itself; jsdom has no ResizeObserver.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub { observe(): void { /* noop */ } unobserve(): void { /* noop */ } disconnect(): void { /* noop */ } }
    Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, configurable: true })
  }
})

// The date format hook reads a user setting through the SettingsProvider —
// out of scope here, and the rows only need a deterministic label.
vi.mock('../../hooks/useUserDateFormat', () => ({
  useUserDateFormat: () => ({ formatUserDate: (date: Date) => date.toISOString() })
}))

import { CapturesView } from './CapturesView'
import { runRowId } from './capturesViewHelpers'
import { resetRecordingStatusStoreForTests } from '../../services/recordingStatusStore'
import type { RecordingSession } from '../../../../shared/types/collections'
import type { RecordedCallSummary, RecordingRun } from '../../../../shared/types/recordingCapture'

const session: RecordingSession = { type: 'recording', id: 's1', name: 'Petstore', url: 'http://localhost:8080/', protocols: ['http'], whitelist: [], blacklist: [] }
const run: RecordingRun = { id: 'r1', sessionId: 's1', url: 'http://localhost:8080/', startedAt: 1_700_000_000_000, endedAt: null }
const call = (id: string, url: string): RecordedCallSummary => ({ id, sessionId: 's1', runId: 'r1', protocol: 'http', timestamp: 1_700_000_001_000, method: 'GET', url, resourceType: 'fetch', status: 200 })

function bridge(runs: RecordingRun[], captures: RecordedCallSummary[]): { added: (s: RecordedCallSummary) => void } {
  let onAdded: ((s: RecordedCallSummary) => void) | null = null
  // The deduce button reads the plan through useAuthState → window.api.account.
  ;(window as unknown as { api: unknown }).api = {
    account: {
      getState: () => Promise.resolve({ signedIn: true, plan: 'pro', capabilities: [] }),
      onStateChanged: () => () => undefined
    }
  }
  ;(window as unknown as { restorm: unknown }).restorm = {
    recording: {
      runs: () => Promise.resolve(runs),
      list: () => Promise.resolve(captures),
      get: () => Promise.resolve(null),
      status: () => Promise.resolve({ sessionId: 's1', state: 'idle', runId: null, tabId: null, captureCount: captures.length }),
      onStatusChanged: () => () => undefined,
      onCaptureAdded: (cb: (s: RecordedCallSummary) => void) => { onAdded = cb; return () => undefined },
      onCaptureUpdated: () => () => undefined,
      onCapturesRemoved: () => () => undefined,
      onRunChanged: () => () => undefined,
      onRunRemoved: () => () => undefined,
      clearRun: vi.fn(() => Promise.resolve({ removed: [] })),
      setFilters: vi.fn(() => Promise.resolve({ ok: true })),
      applyFilters: vi.fn(() => Promise.resolve({ removed: [] }))
    }
  }
  return { added: (s) => { onAdded?.(s) } }
}

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

describe('CapturesView', () => {
  beforeEach(() => { resetRecordingStatusStoreForTests() })

  it('shows the empty state until the first call, then the run row and its calls', async () => {
    const b = bridge([run], [])
    render(<CapturesView session={session} />)
    await flush()
    expect(screen.getByTestId('recording-captures-empty')).toBeTruthy()
    act(() => { b.added(call('c1', 'http://localhost:8080/api/pets')) })
    await flush()
    expect(screen.queryByTestId('recording-captures-empty')).toBeNull()
    expect(screen.getByTestId('recording-captures-list')).toBeTruthy()
    expect(screen.getByTestId('recording-run-row-r1')).toBeTruthy()
    expect(screen.getByTestId('recording-capture-row-c1').textContent).toContain('/api/pets')
    expect(screen.getByTestId(`recording-run-clear-${run.id}`)).toBeTruthy()
    void runRowId
  })

  it('renders primed calls under their run and the deduce button disabled without a handler', async () => {
    bridge([run], [call('c1', 'http://localhost:8080/api/pets'), call('c2', 'http://localhost:8080/api/store')])
    render(<CapturesView session={session} />)
    await flush()
    expect(screen.getByTestId('recording-capture-row-c1')).toBeTruthy()
    expect(screen.getByTestId('recording-capture-row-c2')).toBeTruthy()
    const deduce = screen.getByTestId('recording-captures-deduce')
    expect(deduce.classList.contains('disabled') || deduce.hasAttribute('disabled')).toBe(true)
  })
})
