import { describe, it, expect } from 'vitest'
import { captureToHttpResponse, captureToGraphqlResponse, captureToGrpcResponse, captureToWebSocketResponse } from '../../src/shared/recording/captureToResponse'
import type { RecordedCallDetail } from '../../src/shared/types/recordingCapture'

function detail(overrides: Partial<RecordedCallDetail> = {}): RecordedCallDetail {
  return {
    id: 'c1', sessionId: 's1', runId: 'r1', protocol: 'http', timestamp: 1_700_000_000_000, method: 'POST',
    url: 'http://localhost:8080/api/pets?limit=2', resourceType: 'fetch', status: 201, statusText: 'Created', durationMs: 42,
    mimeType: 'application/json', responseSize: 512,
    request: {
      headers: [{ key: 'Content-Type', value: 'application/json' }, { key: 'cookie', value: 'sid=1; theme=dark' }],
      query: [{ key: 'limit', value: '2' }],
      body: { encoding: 'utf8', data: '{"name":"Rex"}', mimeType: 'application/json', size: 14 }
    },
    response: {
      headers: [{ key: 'content-type', value: 'application/json' }, { key: 'set-cookie', value: 'a=1; Path=/\nb=2; HttpOnly' }],
      body: { encoding: 'utf8', data: '{"id":7}', mimeType: 'application/json', size: 8 }
    },
    ...overrides
  }
}

describe('captureToResponse — a captured call as the protocol response the request tabs render', () => {
  it('maps an HTTP call: method, headers, params, body, status, cookies, timings', () => {
    const r = captureToHttpResponse(detail())
    expect(r.type).toBe('http')
    expect(r.requestMethod).toBe('POST')
    expect(r.requestHeaders.map((h) => h.key)).toEqual(['Content-Type', 'cookie'])
    expect(r.requestParams[0]?.key).toBe('limit')
    expect(r.requestBody).toEqual({ type: 'text', content: '{"name":"Rex"}' })
    expect(r.statusCode).toBe(201)
    expect(r.responseBody).toBe('{"id":7}')
    expect(r.contentType).toBe('application/json')
    expect(r.contentLength).toBe(512)
    expect(r.timings).toEqual({ startedAt: new Date(1_700_000_000_000).toISOString(), durationMs: 42 })
    expect(r.sentCookies).toEqual([{ name: 'sid', value: '1' }, { name: 'theme', value: 'dark' }])
    expect(r.receivedCookies).toEqual([{ name: 'a', value: '1' }, { name: 'b', value: '2' }])
  })

  it('an unknown verb falls back to GET; a failed call keeps its error and no body', () => {
    const r = captureToHttpResponse(detail({ method: 'BREW', status: undefined, statusText: undefined, response: null, error: 'net::ERR_CONNECTION_REFUSED' }))
    expect(r.requestMethod).toBe('GET')
    expect(r.statusCode).toBe(0)
    expect(r.statusText).toBe('net::ERR_CONNECTION_REFUSED')
    expect(r.error).toBe('net::ERR_CONNECTION_REFUSED')
    expect(r.responseBody).toBe('')
    expect(r.receivedCookies).toBeUndefined()
  })

  it('keeps a binary body base64 and flags it', () => {
    const r = captureToHttpResponse(detail({ response: { headers: [], body: { encoding: 'base64', data: 'AAEC', mimeType: 'image/png', size: 3 } } }))
    expect(r.responseBody).toBe('AAEC')
    expect(r.bodyIsBase64).toBe(true)
  })

  it('maps a GraphQL call: query + variables from the body, data + errors from the response', () => {
    const body = JSON.stringify({ query: 'query Pets { pets { id } }', variables: { first: 2 } })
    const r = captureToGraphqlResponse(detail({ protocol: 'graphql', request: { headers: [], query: [], body: { encoding: 'utf8', data: body, mimeType: 'application/json', size: body.length } }, response: { headers: [], body: { encoding: 'utf8', data: '{"data":{"pets":[]},"errors":[{"message":"boom"}]}', mimeType: 'application/json', size: 1 } } }))
    expect(r.type).toBe('graphql')
    expect(r.requestQuery).toBe('query Pets { pets { id } }')
    expect(r.requestVariables).toBe(JSON.stringify({ first: 2 }, null, 2))
    expect(r.data).toEqual({ pets: [] })
    expect(r.errors).toEqual([{ message: 'boom' }])
  })

  it('maps a gRPC-web call: service/method, grpc-status trailer, messages', () => {
    const r = captureToGrpcResponse(detail({ protocol: 'grpc-web', grpc: { service: 'pets.PetService', method: 'GetPet' }, response: { headers: [{ key: 'grpc-status', value: '5' }, { key: 'grpc-message', value: 'not found' }], body: { encoding: 'base64', data: 'AAAA', mimeType: 'application/grpc-web+proto', size: 3 } } }))
    expect(r.type).toBe('grpc')
    expect(r.requestMethod).toBe('pets.PetService/GetPet')
    expect(r.statusCode).toBe(5)
    expect(r.statusMessage).toBe('not found')
    expect(r.responseMessage).toBe('AAAA')
    // Without a grpc-status trailer, a 2xx transport reads as OK (0).
    expect(captureToGrpcResponse(detail({ protocol: 'grpc-web', status: 200, response: { headers: [], body: null } })).statusCode).toBe(0)
  })

  it('maps a WebSocket connection: frames become the chat messages', () => {
    const r = captureToWebSocketResponse(detail({
      protocol: 'websocket', method: 'WS', url: 'ws://localhost:8080/socket', status: 101,
      websocket: { messageType: 'hello', messageTypes: ['hello'], frameCount: 2, closed: false },
      websocketFrames: [{ direction: 'sent', timestamp: 1, opcode: 1, payload: '{"type":"hello"}' }, { direction: 'received', timestamp: 2, opcode: 1, payload: 'ok' }]
    }))
    expect(r.type).toBe('websocket')
    expect(r.connected).toBe(true)
    expect(r.messages.map((m) => `${m.direction}:${m.data}`)).toEqual(['sent:{"type":"hello"}', 'received:ok'])
  })
})
