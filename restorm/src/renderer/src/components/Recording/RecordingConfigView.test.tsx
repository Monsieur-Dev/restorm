import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'

// jsdom implements no editing commands, and the ECUI barrel probes for them
// at import time.
vi.hoisted(() => {
  Object.defineProperty(globalThis.document, 'queryCommandSupported', { value: () => false, configurable: true })
})

import { RecordingConfigView } from './RecordingConfigView'
import type { RecordingSession } from '../../../../shared/types/collections'

function session(overrides: Partial<RecordingSession> = {}): RecordingSession {
  return { type: 'recording', id: 'rec-1', name: 'Petstore', url: '', protocols: ['http', 'websocket', 'graphql', 'grpc-web'], whitelist: [], blacklist: [], ...overrides }
}

describe('RecordingConfigView', () => {
  const setFilters = vi.fn()
  beforeEach(() => {
    setFilters.mockClear()
    ;(window as unknown as { restorm: unknown }).restorm = { recording: { setFilters, status: () => Promise.resolve({ sessionId: 'rec-1', state: 'idle', runId: null, tabId: null, captureCount: 0 }) } }
  })

  it('disables the record button until the url is recordable', () => {
    const { rerender } = render(<RecordingConfigView session={session()} onStartRecording={vi.fn()} onStopRecording={vi.fn()} />)
    // The ECUI Button flags its disabled state with a `disabled` class (and
    // attribute on a native button) — the e2e checks the same class.
    const isDisabled = (): boolean => {
      const el = screen.getByTestId('recording-config-record')
      return el.classList.contains('disabled') || el.hasAttribute('disabled')
    }
    expect(isDisabled()).toBe(true)
    rerender(<RecordingConfigView session={session({ url: 'http://localhost:8080/' })} onStartRecording={vi.fn()} onStopRecording={vi.fn()} />)
    expect(isDisabled()).toBe(false)
  })

  it('the record button starts the session', () => {
    const onStart = vi.fn()
    render(<RecordingConfigView session={session({ url: 'file:///tmp/page.html' })} onStartRecording={onStart} onStopRecording={vi.fn()} />)
    fireEvent.click(screen.getByTestId('recording-config-record'))
    expect(onStart).toHaveBeenCalledWith('rec-1')
  })

  it('toggles protocols by reassigning the list, and never drops the last one', () => {
    const s = session({ url: 'http://x/' })
    const { rerender } = render(<RecordingConfigView session={s} onStartRecording={vi.fn()} onStopRecording={vi.fn()} />)
    fireEvent.click(screen.getByTestId('recording-protocol-graphql'))
    expect(s.protocols).toEqual(['http', 'websocket', 'grpc-web'])
    const only = session({ url: 'http://x/', protocols: ['http'] })
    rerender(<RecordingConfigView session={only} onStartRecording={vi.fn()} onStopRecording={vi.fn()} />)
    fireEvent.click(screen.getByTestId('recording-protocol-http'))
    expect(only.protocols).toEqual(['http'])
    // Idle session: nothing is pushed to the engine.
    expect(setFilters).not.toHaveBeenCalled()
  })

  it('adds and removes white / black list rows through reassignment', () => {
    const s = session({ blacklist: ['\\.png$'] })
    render(<RecordingConfigView session={s} onStartRecording={vi.fn()} onStopRecording={vi.fn()} />)
    fireEvent.click(screen.getByTestId('recording-config-whitelist-add'))
    expect(s.whitelist).toEqual([''])
    fireEvent.click(screen.getByTestId('recording-config-blacklist-remove-0'))
    expect(s.blacklist).toEqual([])
  })
})
