import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FullRequestData } from '../../services/ContextServiceTypes'

// flushRequestStateToContext bridges a sidebar request's model into the
// ContextService so the scenario engine (sseConnect) can read it. This guards
// the cross-process trap: an SSE request's `lastEventId` reconnect seed must
// reach `fullData` (the interactive tab pushes it explicitly on mount/change,
// but a scenario-driven sseConnect only ever goes through this helper — and
// used to drop it, so a scenario-bound reconnect always started cold).

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
import { SseRequest } from '../../../shared/models/requests/SseRequest'

beforeEach(() => { updateFullRequestData.mockReset() })

describe('flushRequestStateToContext — SSE', () => {
  it('carries lastEventId into fullData so a scenario-driven sseConnect can seed its reconnect', () => {
    const sse = new SseRequest({
      id: 'sse-1',
      name: 'Frames',
      url: 'http://localhost:8097/events',
      lastEventId: '42'
    })

    flushRequestStateToContext(sse as unknown as Parameters<typeof flushRequestStateToContext>[0])

    expect(updateFullRequestData).toHaveBeenCalledTimes(1)
    const data: FullRequestData = updateFullRequestData.mock.calls[0][1]
    expect(data.requestType).toBe('sse')
    expect(data.lastEventId).toBe('42')
  })

  it('omits lastEventId for a request that has never carried one', () => {
    const sse = new SseRequest({ id: 'sse-2', name: 'Frames', url: 'http://localhost:8097/events' })
    flushRequestStateToContext(sse as unknown as Parameters<typeof flushRequestStateToContext>[0])
    const data: FullRequestData = updateFullRequestData.mock.calls[0][1]
    expect(data.lastEventId).toBeUndefined()
  })

  it('carries headers through the common headers path', () => {
    const sse = new SseRequest({
      id: 'sse-3',
      name: 'Frames',
      url: 'http://localhost:8097/events',
      headers: [{ key: 'X-Echo', value: { type: 'string', value: 'hi' }, enabled: true } as never]
    })
    flushRequestStateToContext(sse as unknown as Parameters<typeof flushRequestStateToContext>[0])
    const data: FullRequestData = updateFullRequestData.mock.calls[0][1]
    expect(data.headers).toHaveLength(1)
  })
})
