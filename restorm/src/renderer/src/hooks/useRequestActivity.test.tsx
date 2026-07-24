// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup, act } from '@testing-library/react'

// The real 'electron-core-ui/renderer' barrel drags Monaco into jsdom; the
// activity stores only need a synchronous local pub/sub.
vi.mock('electron-core-ui/renderer', () => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  return {
    eventBus: {
      subscribe: (event: string, cb: (payload: unknown) => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set())
        const set = handlers.get(event)
        set?.add(cb)
        return () => { set?.delete(cb) }
      },
      emitLocalSync: (event: string, payload: unknown) => {
        for (const cb of handlers.get(event) ?? []) cb(payload)
      }
    }
  }
})

interface ProgressEvent { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }
type ProgressCb = (event: ProgressEvent) => void

// Stand in for the preload bridge the HTTP listening store subscribes to.
// Installed before the first render so the store's lazy subscription finds it.
const progressCallbacks = new Set<ProgressCb>()
;(window as unknown as { restorm: { http: { onProgress: (cb: ProgressCb) => () => void } } }).restorm = {
  http: {
    onProgress: (cb: ProgressCb) => {
      progressCallbacks.add(cb)
      return () => { progressCallbacks.delete(cb) }
    }
  }
}

function emitProgress(event: ProgressEvent): void {
  act(() => {
    for (const cb of progressCallbacks) cb(event)
  })
}

import { useIsRequestActive } from './useRequestActivity'

afterEach(() => { cleanup() })

/** Renders the beam's activity truth so assertions can read it off the DOM. */
const Probe: React.FC<{ requestId: string }> = ({ requestId }) => {
  const active = useIsRequestActive(requestId)
  return <span data-testid="beam">{active ? 'beaming' : 'idle'}</span>
}

describe('useIsRequestActive — HTTP progress stream', () => {
  it('stops the beam when the request ends in error', () => {
    // The regressed case: a send that finishes with a transport-level
    // failure (empty / invalid URL, "Status Code 0 Error") must clear the
    // activity truth exactly like a success does.
    const id = 'beam-error'
    const { getByTestId } = render(<Probe requestId={id} />)
    expect(getByTestId('beam').textContent).toBe('idle')

    emitProgress({ requestId: id, status: 'started' })
    expect(getByTestId('beam').textContent).toBe('beaming')

    emitProgress({ requestId: id, status: 'error' })
    expect(getByTestId('beam').textContent).toBe('idle')
  })

  it('stops the beam when the request completes', () => {
    const id = 'beam-completed'
    const { getByTestId } = render(<Probe requestId={id} />)

    emitProgress({ requestId: id, status: 'started' })
    expect(getByTestId('beam').textContent).toBe('beaming')

    emitProgress({ requestId: id, status: 'completed' })
    expect(getByTestId('beam').textContent).toBe('idle')
  })

  it('keeps the beam running for a request that has not ended yet', () => {
    const id = 'beam-running'
    const other = 'beam-other'
    const { getByTestId } = render(<Probe requestId={id} />)

    emitProgress({ requestId: id, status: 'started' })
    emitProgress({ requestId: other, status: 'started' })
    emitProgress({ requestId: other, status: 'error' })

    expect(getByTestId('beam').textContent).toBe('beaming')
  })
})
