import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FullRequestData } from '../../services/ContextServiceTypes'

// flushRequestStateToContext bridges a sidebar request's model into the
// ContextService so the scenario engine (stompConnect) and MCP run_request can
// read it even when the request's tab isn't open. `StompExecutionService`'s
// `resolveExecution` reads `stompVersion` / `connectHeaders` / `subscriptions`
// / `sendDestination` / `sendBody` / `sendHeaders` off `fullData` — without a
// dedicated branch here they'd silently resolve to defaults (no
// subscriptions, empty send pane) on every headless run.

const updateFullRequestData = vi.fn<(id: string, data: FullRequestData) => void>()

vi.mock('../../services/ContextService', () => ({
  contextService: {
    getRequestContext: (_id: string) => ({}), // already registered → skip inline register
    updateFullRequestData: (id: string, data: FullRequestData) => { updateFullRequestData(id, data) }
  }
}))

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: { findParentFolder: (_id: string) => null }
}))

import { flushRequestStateToContext } from './execute'
import { StompRequest } from '../../../shared/models/requests/StompRequest'

beforeEach(() => { updateFullRequestData.mockReset() })

describe('flushRequestStateToContext — STOMP', () => {
  it('carries the STOMP-specific fields into fullData', () => {
    const stomp = new StompRequest({
      id: 'stomp-1',
      name: 'Artemis topic',
      url: 'ws://localhost:61614',
      stompVersion: '1.1',
      connectHeaders: [{ key: 'login', value: 'guest' }],
      subscriptions: [{ id: 'sub-0', destination: '/topic/test', ackMode: 'client' }],
      sendDestination: '/topic/test',
      sendBody: '{"hello":"world"}',
      sendHeaders: [{ key: 'priority', value: '5' }]
    })

    flushRequestStateToContext(stomp as unknown as Parameters<typeof flushRequestStateToContext>[0])

    expect(updateFullRequestData).toHaveBeenCalledTimes(1)
    const data: FullRequestData = updateFullRequestData.mock.calls[0][1]
    expect(data.requestType).toBe('stomp')
    expect(data.stompVersion).toBe('1.1')
    expect(data.connectHeaders?.map((h) => h.key)).toEqual(['login'])
    expect(data.subscriptions).toEqual([{ id: 'sub-0', destination: '/topic/test', ackMode: 'client' }])
    expect(data.sendDestination).toBe('/topic/test')
    expect(data.sendBody).toBe('{"hello":"world"}')
    expect(data.sendHeaders?.map((h) => h.key)).toEqual(['priority'])
  })
})
