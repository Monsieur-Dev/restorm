// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup, act } from '@testing-library/react'

// The real 'electron-core-ui/renderer' barrel drags Monaco into jsdom; the
// store only needs a synchronous local pub/sub, so provide one in-place.
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

import { eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents } from './DocumentEvents'
import {
  useIsRequestExecuting,
  useEmitRequestExecution,
  isRequestExecuting
} from './requestExecutingStore'

afterEach(() => { cleanup() })

/** Renders nothing; publishes `active` into the store via the emit hook. */
const Emitter: React.FC<{ requestId: string; active: boolean }> = ({ requestId, active }) => {
  useEmitRequestExecution(requestId, active)
  return null
}

/** Renders the store's view of the request so assertions can read the DOM. */
const Probe: React.FC<{ requestId: string }> = ({ requestId }) => {
  const executing = useIsRequestExecuting(requestId)
  return <span data-testid="probe">{executing ? 'active' : 'idle'}</span>
}

describe('useEmitRequestExecution', () => {
  it('publishes start on active=true and end on active=false', () => {
    const id = 'req-activity-hook-1'
    const { rerender, getByTestId } = render(
      <>
        <Emitter requestId={id} active={false} />
        <Probe requestId={id} />
      </>
    )
    expect(getByTestId('probe').textContent).toBe('idle')

    rerender(
      <>
        <Emitter requestId={id} active={true} />
        <Probe requestId={id} />
      </>
    )
    expect(getByTestId('probe').textContent).toBe('active')

    rerender(
      <>
        <Emitter requestId={id} active={false} />
        <Probe requestId={id} />
      </>
    )
    expect(getByTestId('probe').textContent).toBe('idle')
  })

  it('emits end on unmount so a closed tab never leaves a stuck beam', () => {
    const id = 'req-activity-hook-2'
    const { unmount } = render(<Emitter requestId={id} active={true} />)
    expect(isRequestExecuting(id)).toBe(true)
    unmount()
    expect(isRequestExecuting(id)).toBe(false)
  })

  it('coexists with the base-view event pair for a different request', () => {
    const id = 'req-activity-hook-3'
    render(<Emitter requestId={id} active={true} />)
    act(() => {
      eventBus.emitLocalSync(DocumentEvents.REQUEST_EXECUTION_STARTED, { requestId: 'other' })
      eventBus.emitLocalSync(DocumentEvents.REQUEST_EXECUTION_ENDED, { requestId: 'other' })
    })
    expect(isRequestExecuting(id)).toBe(true)
    expect(isRequestExecuting('other')).toBe(false)
  })
})
