import { describe, it, expect } from 'vitest'
import { captureToHistoryDetail, captureOutcome } from '../../../src/main/services/recording/captureHistory'
import type { RecordedCallDetail } from '../../../src/shared/types/recordingCapture'

function detail(overrides: Partial<RecordedCallDetail> = {}): RecordedCallDetail {
  return {
    id: 'c1', sessionId: 's1', runId: 'r1', protocol: 'http', timestamp: 1_700_000_000_000, method: 'GET',
    url: 'http://localhost:8080/api/pets', resourceType: 'fetch', status: 200, statusText: 'OK', durationMs: 12, mimeType: 'application/json',
    request: { headers: [{ key: 'cookie', value: 'sid=1' }], query: [], body: null },
    response: { headers: [{ key: 'set-cookie', value: 'a=1; Path=/' }], body: { encoding: 'utf8', data: '[]', mimeType: 'application/json', size: 2 } },
    ...overrides
  }
}

describe('captureToHistoryDetail — a captured call as a response-history record', () => {
  it('writes the normal history format for an HTTP call, with the reference call pinned', () => {
    const d = captureToHistoryDetail('req-1', detail(), true)
    expect(d.requestId).toBe('req-1')
    expect(d.type).toBe('http')
    expect(d.outcome).toBe('ok')
    expect(d.pinned).toBe(true)
    expect(d.timestamp).toBe(new Date(1_700_000_000_000).toISOString())
    expect(d.guid).toMatch(/[0-9a-f-]{36}/)
    if (d.response.type !== 'http') throw new Error('http expected')
    expect(d.response.requestMethod).toBe('GET')
    expect(d.response.responseBody).toBe('[]')
    expect(d.response.sentCookies).toEqual([{ key: 'sid', value: '1' }])
    expect(d.response.receivedCookies).toEqual([{ key: 'a', value: '1' }])
    expect(d.response.timings.durationMs).toBe(12)
  })

  it('derives the outcome from the status, the error or the gRPC trailer', () => {
    expect(captureOutcome(detail({ status: 404 }))).toBe('failure')
    expect(captureOutcome(detail({ status: 302 }))).toBe('warning')
    expect(captureOutcome(detail({ status: undefined, response: null, error: 'net::ERR_CONNECTION_REFUSED' }))).toBe('failure')
    expect(captureOutcome(detail({ protocol: 'grpc-web', response: { headers: [{ key: 'grpc-status', value: '0' }], body: null } }))).toBe('ok')
    expect(captureOutcome(detail({ protocol: 'grpc-web', response: { headers: [{ key: 'grpc-status', value: '13' }], body: null } }))).toBe('failure')
    expect(captureOutcome(detail({ protocol: 'websocket', status: 101 }))).toBe('ok')
  })

  it('maps gRPC-web to the grpc history type with its meta, and WebSocket frames to messages', () => {
    const grpc = captureToHistoryDetail('req-2', detail({ protocol: 'grpc-web', grpc: { service: 'pets.PetService', method: 'GetPet' }, response: { headers: [{ key: 'grpc-status', value: '0' }], body: { encoding: 'base64', data: 'AAAA', mimeType: 'application/grpc-web+proto', size: 3 } } }), false)
    expect(grpc.type).toBe('grpc')
    expect(grpc.requestMeta).toEqual({ service: 'pets.PetService', method: 'GetPet', callType: 'unary' })
    if (grpc.response.type !== 'grpc') throw new Error('grpc expected')
    expect(grpc.response.statusCode).toBe(0)
    expect(grpc.response.requestMethod).toBe('pets.PetService/GetPet')
    const ws = captureToHistoryDetail('req-3', detail({ protocol: 'websocket', method: 'WS', url: 'ws://localhost:8080/socket', status: 101, websocket: { messageType: null, messageTypes: [], frameCount: 1, closed: true }, websocketFrames: [{ direction: 'received', timestamp: 5, opcode: 1, payload: 'hi' }] }), false)
    expect(ws.type).toBe('websocket')
    if (ws.response.type !== 'websocket') throw new Error('websocket expected')
    expect(ws.response.connected).toBe(false)
    expect(ws.response.messages).toEqual([{ direction: 'received', data: 'hi', timestamp: new Date(5).toISOString() }])
  })
})
