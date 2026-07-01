import { describe, it, expect, vi } from 'vitest'
import { REQUEST_TYPES } from '../../shared/protocolRegistry'

// The execution services pull in sockets / gRPC / fs at import time; stub them
// so this drift guard stays a pure key-set check.
vi.mock('../services/HTTPExecutionService', () => ({ httpExecutionService: { cancel: () => false } }))
vi.mock('../services/GraphQLExecutionService', () => ({ graphqlExecutionService: { cancel: () => false } }))
vi.mock('../services/SOAPExecutionService', () => ({ soapExecutionService: { cancel: () => false } }))
vi.mock('../services/GRPCExecutionService', () => ({ grpcExecutionService: { cancel: () => false } }))
vi.mock('../services/WebSocketExecutionService', () => ({ websocketExecutionService: { disconnect: () => false } }))

describe('main protocol executor registry', () => {
  it('covers exactly the shared registry key set (no drift)', async () => {
    const { PROTOCOL_EXECUTORS } = await import('./executorRegistry')
    expect(Object.keys(PROTOCOL_EXECUTORS).sort()).toEqual([...REQUEST_TYPES].sort())
  })

  it('marks only websocket as a streaming protocol', async () => {
    const { PROTOCOL_EXECUTORS } = await import('./executorRegistry')
    const streaming = REQUEST_TYPES.filter((t) => PROTOCOL_EXECUTORS[t].streaming)
    expect(streaming).toEqual(['websocket'])
  })

  it('exposes a cancel function for every protocol', async () => {
    const { PROTOCOL_EXECUTORS } = await import('./executorRegistry')
    for (const type of REQUEST_TYPES) {
      expect(typeof PROTOCOL_EXECUTORS[type].cancel).toBe('function')
      expect(PROTOCOL_EXECUTORS[type].cancel('no-such-id')).toBe(false)
    }
  })
})
