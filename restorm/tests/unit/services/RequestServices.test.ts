import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (must be before imports) ──────────────────────────────────────────

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) }
}))

vi.mock('axios', () => {
  const fn = vi.fn()
  fn.post = vi.fn()
  return { default: fn }
})

// ── Imports ─────────────────────────────────────────────────────────────────

import axios from 'axios'
import { StringValue } from '../../../src/shared/types/collections'
import type { KeyValue } from '../../../src/shared/types/collections'

import {
  resolveRequestURL,
  executeHTTPRequest,
  type HTTPRequestInput
} from '../../../src/main/services/request/HTTPRequestService'

import { executeGraphQLRequest } from '../../../src/main/services/request/GraphQLRequestService'

import { executeGrpcRequest } from '../../../src/main/services/request/GrpcRequestService'

import { executeSoapRequest } from '../../../src/main/services/request/SoapRequestService'

import {
  connectWebSocket,
  sendWebSocketMessage,
  disconnectWebSocket,
  getActiveConnections
} from '../../../src/main/services/request/WebSocketRequestService'

// ── Helpers ─────────────────────────────────────────────────────────────────

function kv(key: string, value: string): KeyValue {
  return { key, value: new StringValue(value) }
}

// ── HTTPRequestService ──────────────────────────────────────────────────────

describe('HTTPRequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resolveRequestURL', () => {
    it('returns the URL as-is when there are no query params or path params', () => {
      const result = resolveRequestURL({
        urlTemplate: 'https://api.example.com/users',
        pathParams: [],
        queryParams: [],
        environmentContext: {}
      })
      expect(result.url).toBe('https://api.example.com/users')
      expect(result.baseUrl).toBe('https://api.example.com/users')
      expect(result.queryString).toBe('')
    })

    it('appends URL-encoded query parameters', () => {
      const result = resolveRequestURL({
        urlTemplate: 'https://api.example.com/search',
        pathParams: [],
        queryParams: [kv('q', 'hello world'), kv('page', '2')],
        environmentContext: {}
      })
      expect(result.url).toBe('https://api.example.com/search?q=hello%20world&page=2')
      expect(result.queryString).toBe('q=hello%20world&page=2')
    })

    it('skips query params with empty keys', () => {
      const result = resolveRequestURL({
        urlTemplate: 'https://api.example.com',
        pathParams: [],
        queryParams: [kv('', 'ignored'), kv('valid', 'yes')],
        environmentContext: {}
      })
      expect(result.url).toBe('https://api.example.com?valid=yes')
    })
  })

  describe('executeHTTPRequest', () => {
    function baseInput(overrides?: Partial<HTTPRequestInput>): HTTPRequestInput {
      return {
        request: { id: 'req-1', name: 'Test', type: 'http', method: 'GET', url: '', headers: [], params: [], documentation: '', tags: [] },
        method: 'GET',
        url: 'https://api.example.com/data',
        headers: [kv('Authorization', 'Bearer tok')],
        params: [],
        pathParams: [],
        bodyMode: 'text',
        bodyContent: '',
        variableContext: {},
        ...overrides
      }
    }

    it('assembles headers from KeyValue array and sends them to axios', async () => {
      const mockedAxios = vi.mocked(axios)
      mockedAxios.mockResolvedValue({ status: 200, statusText: 'OK', data: '{}', headers: {} })

      await executeHTTPRequest(baseInput())

      const config = mockedAxios.mock.calls[0][0]
      expect(config.headers).toMatchObject({ Authorization: 'Bearer tok' })
    })

    it('sends text body content', async () => {
      const mockedAxios = vi.mocked(axios)
      mockedAxios.mockResolvedValue({ status: 200, statusText: 'OK', data: '', headers: {} })

      await executeHTTPRequest(baseInput({ method: 'POST', bodyMode: 'text', bodyContent: '{"a":1}' }))

      const config = mockedAxios.mock.calls[0][0]
      expect(config.data).toBe('{"a":1}')
    })

    it('builds x-www-form-urlencoded body from form fields', async () => {
      const mockedAxios = vi.mocked(axios)
      mockedAxios.mockResolvedValue({ status: 200, statusText: 'OK', data: '', headers: {} })

      await executeHTTPRequest(baseInput({
        method: 'POST',
        bodyMode: 'x-www-form-urlencoded',
        formFields: [kv('user', 'alice'), kv('pass', 's3cret')]
      }))

      const config = mockedAxios.mock.calls[0][0]
      expect(config.data).toBe('user=alice&pass=s3cret')
      expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    })

    it('returns status 0 and error message on network failure', async () => {
      const mockedAxios = vi.mocked(axios)
      mockedAxios.mockRejectedValue(new Error('ECONNREFUSED'))

      const resp = await executeHTTPRequest(baseInput())

      expect(resp.statusCode).toBe(0)
      expect(resp.statusText).toBe('Network Error')
      expect(resp.error).toBe('ECONNREFUSED')
    })

    it('defaults bodyContent to empty string when undefined', async () => {
      const mockedAxios = vi.mocked(axios)
      mockedAxios.mockResolvedValue({ status: 200, statusText: 'OK', data: '', headers: {} })

      await executeHTTPRequest(baseInput({ bodyMode: 'text', bodyContent: undefined }))

      const config = mockedAxios.mock.calls[0][0]
      expect(config.data).toBe('')
    })
  })
})

// ── GraphQLRequestService ───────────────────────────────────────────────────

describe('GraphQLRequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends query and variables as JSON payload', async () => {
    const mockedPost = vi.mocked(axios.post)
    mockedPost.mockResolvedValue({
      status: 200,
      data: { data: { user: { name: 'Alice' } } },
      headers: { 'content-type': 'application/json' }
    })

    const resp = await executeGraphQLRequest({
      request: { id: 'gql-1', name: 'GetUser', type: 'graphql', url: '', operationType: 'query', query: '', headers: [], documentation: '', tags: [] },
      url: 'https://api.example.com/graphql',
      query: '{ user { name } }',
      variables: '{"id":"42"}',
      headers: [],
      variableContext: {}
    })

    expect(mockedPost).toHaveBeenCalledWith(
      'https://api.example.com/graphql',
      { query: '{ user { name } }', variables: { id: '42' } },
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) })
    )
    expect(resp.statusCode).toBe(200)
    expect(resp.data).toEqual({ user: { name: 'Alice' } })
  })

  it('sets Content-Type to application/json by default', async () => {
    const mockedPost = vi.mocked(axios.post)
    mockedPost.mockResolvedValue({ status: 200, data: { data: null }, headers: {} })

    await executeGraphQLRequest({
      request: { id: 'gql-2', name: 'Q', type: 'graphql', url: '', operationType: 'query', query: '', headers: [], documentation: '', tags: [] },
      url: 'https://api.example.com/graphql',
      query: '{ ping }',
      headers: [],
      variableContext: {}
    })

    const callHeaders = mockedPost.mock.calls[0][2]?.headers as Record<string, string>
    expect(callHeaders['Content-Type']).toBe('application/json')
  })

  it('omits variables key when variables string is empty', async () => {
    const mockedPost = vi.mocked(axios.post)
    mockedPost.mockResolvedValue({ status: 200, data: { data: null }, headers: {} })

    await executeGraphQLRequest({
      request: { id: 'gql-3', name: 'Q', type: 'graphql', url: '', operationType: 'query', query: '', headers: [], documentation: '', tags: [] },
      url: 'https://api.example.com/graphql',
      query: '{ ping }',
      variables: undefined,
      headers: [],
      variableContext: {}
    })

    const payload = mockedPost.mock.calls[0][1] as { variables?: unknown }
    expect(payload.variables).toBeUndefined()
  })

  it('returns error message on network failure', async () => {
    const mockedPost = vi.mocked(axios.post)
    mockedPost.mockRejectedValue(new Error('timeout'))

    const resp = await executeGraphQLRequest({
      request: { id: 'gql-4', name: 'Q', type: 'graphql', url: '', operationType: 'query', query: '', headers: [], documentation: '', tags: [] },
      url: 'https://api.example.com/graphql',
      query: '{ ping }',
      headers: [],
      variableContext: {}
    })

    expect(resp.statusCode).toBe(0)
    expect(resp.error).toContain('timeout')
  })

  it('handles invalid variables JSON gracefully', async () => {
    const mockedPost = vi.mocked(axios.post)
    mockedPost.mockResolvedValue({ status: 200, data: { data: null }, headers: {} })

    await executeGraphQLRequest({
      request: { id: 'gql-5', name: 'Q', type: 'graphql', url: '', operationType: 'query', query: '', headers: [], documentation: '', tags: [] },
      url: 'https://api.example.com/graphql',
      query: '{ ping }',
      variables: '{{not valid json}}',
      headers: [],
      variableContext: {}
    })

    const payload = mockedPost.mock.calls[0][1] as { variables?: unknown }
    expect(payload.variables).toBeUndefined()
  })
})

// ── GrpcRequestService ─────────────────────────────────────────────────────

describe('GrpcRequestService', () => {
  it('returns UNIMPLEMENTED status code 12', async () => {
    const resp = await executeGrpcRequest({
      request: { id: 'grpc-1', name: 'Call', type: 'grpc', url: '', service: '', method: '', callType: 'unary', requestMessage: '{}', metadata: [], documentation: '', tags: [] },
      url: 'localhost:50051',
      service: 'greeter.Greeter',
      method: 'SayHello',
      requestMessage: '{"name":"world"}',
      metadata: [],
      variableContext: {}
    })

    expect(resp.statusCode).toBe(12)
    expect(resp.error).toContain('gRPC not fully implemented')
  })

  it('includes the full method path (service/method) in the response', async () => {
    const resp = await executeGrpcRequest({
      request: { id: 'grpc-2', name: 'Call', type: 'grpc', url: '', service: '', method: '', callType: 'unary', requestMessage: '{}', metadata: [], documentation: '', tags: [] },
      url: 'localhost:50051',
      service: 'my.pkg.Svc',
      method: 'DoStuff',
      requestMessage: '{}',
      metadata: [],
      variableContext: {}
    })

    expect(resp.requestMethod).toBe('my.pkg.Svc/DoStuff')
  })

  it('handles invalid JSON in requestMessage without throwing', async () => {
    const resp = await executeGrpcRequest({
      request: { id: 'grpc-3', name: 'Call', type: 'grpc', url: '', service: '', method: '', callType: 'unary', requestMessage: '{}', metadata: [], documentation: '', tags: [] },
      url: 'localhost:50051',
      service: 'Svc',
      method: 'M',
      requestMessage: '{{bad json',
      metadata: [],
      variableContext: {}
    })

    expect(resp.statusCode).toBe(12)
    expect(resp.requestMessage).toBe('{{bad json')
  })

  it('resolves metadata key-value pairs', async () => {
    const resp = await executeGrpcRequest({
      request: { id: 'grpc-4', name: 'Call', type: 'grpc', url: '', service: '', method: '', callType: 'unary', requestMessage: '{}', metadata: [], documentation: '', tags: [] },
      url: 'localhost:50051',
      service: 'Svc',
      method: 'M',
      requestMessage: '{}',
      metadata: [kv('authorization', 'Bearer tok')],
      variableContext: {}
    })

    expect(resp.requestMetadata).toHaveLength(1)
    expect(resp.requestMetadata[0].key).toBe('authorization')
    expect(resp.requestMetadata[0].value.toString()).toBe('Bearer tok')
  })
})

// ── SoapRequestService ─────────────────────────────────────────────────────

describe('SoapRequestService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the SOAP body and sets Content-Type to text/xml', async () => {
    const mockedPost = vi.mocked(axios.post)
    mockedPost.mockResolvedValue({ status: 200, data: '<Envelope/>', headers: {} })

    const soapBody = '<soapenv:Envelope><soapenv:Body><GetUser/></soapenv:Body></soapenv:Envelope>'

    await executeSoapRequest({
      request: { id: 'soap-1', name: 'GetUser', type: 'soap', url: '', soapAction: '', service: '', operation: '', body: '', headers: [], documentation: '', tags: [] },
      url: 'https://api.example.com/soap',
      soapAction: 'GetUser',
      body: soapBody,
      headers: [],
      variableContext: {}
    })

    expect(mockedPost).toHaveBeenCalledWith(
      'https://api.example.com/soap',
      soapBody,
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: 'GetUser'
        })
      })
    )
  })

  it('handles empty body', async () => {
    const mockedPost = vi.mocked(axios.post)
    mockedPost.mockResolvedValue({ status: 200, data: '', headers: {} })

    const resp = await executeSoapRequest({
      request: { id: 'soap-2', name: 'Empty', type: 'soap', url: '', soapAction: '', service: '', operation: '', body: '', headers: [], documentation: '', tags: [] },
      url: 'https://api.example.com/soap',
      soapAction: '',
      body: '',
      headers: [],
      variableContext: {}
    })

    expect(resp.requestBody).toBe('')
    expect(resp.statusCode).toBe(200)
  })

  it('returns status 0 and error on network failure', async () => {
    const mockedPost = vi.mocked(axios.post)
    mockedPost.mockRejectedValue(new Error('ECONNREFUSED'))

    const resp = await executeSoapRequest({
      request: { id: 'soap-3', name: 'Fail', type: 'soap', url: '', soapAction: '', service: '', operation: '', body: '', headers: [], documentation: '', tags: [] },
      url: 'https://api.example.com/soap',
      soapAction: '',
      body: '<Envelope/>',
      headers: [],
      variableContext: {}
    })

    expect(resp.statusCode).toBe(0)
    expect(resp.error).toBe('ECONNREFUSED')
  })
})

// ── WebSocketRequestService ─────────────────────────────────────────────────

describe('WebSocketRequestService', () => {
  const mockSend = vi.fn()
  const mockClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Replace the global WebSocket with a minimal mock that records event handlers
    vi.stubGlobal(
      'WebSocket',
      vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.send = mockSend
        this.close = mockClose
        this.onopen = null
        this.onmessage = null
        this.onclose = null
        this.onerror = null
        return this
      })
    )
  })

  function wsInput(): Parameters<typeof connectWebSocket>[0] {
    return {
      request: { id: 'ws-1', name: 'WS', type: 'websocket', url: '', protocol: 'websocket', message: '', headers: [], documentation: '', tags: [] },
      url: 'ws://localhost:8080',
      protocol: 'websocket',
      message: 'hello',
      headers: [],
      variableContext: {}
    }
  }

  /** Get the underlying mock socket from the connection */
  function getSocket(conn: ReturnType<typeof connectWebSocket>): Record<string, unknown> {
    return conn.socket as unknown as Record<string, unknown>
  }

  it('creates a connection and tracks it in active connections', () => {
    const conn = connectWebSocket(wsInput())
    expect(conn.id).toBeTruthy()
    expect(conn.url).toBe('ws://localhost:8080')
    expect(getActiveConnections().some((c) => c.id === conn.id)).toBe(true)
  })

  it('sets connected to true when the socket opens', () => {
    const conn = connectWebSocket(wsInput())
    expect(conn.connected).toBe(false)

    const socket = getSocket(conn)
    ;(socket.onopen as () => void)()
    expect(conn.connected).toBe(true)
  })

  it('receives messages and records them in the connection history', () => {
    const onMsg = vi.fn()
    const conn = connectWebSocket(wsInput(), onMsg)
    const socket = getSocket(conn)
    ;(socket.onopen as () => void)()
    ;(socket.onmessage as (e: { data: string }) => void)({ data: '{"status":"ok"}' })

    expect(conn.messages).toHaveLength(1)
    expect(conn.messages[0].direction).toBe('received')
    expect(conn.messages[0].data).toBe('{"status":"ok"}')
    expect(onMsg).toHaveBeenCalledTimes(1)
  })

  it('sends a message through an active connection', () => {
    const conn = connectWebSocket(wsInput())
    const socket = getSocket(conn)
    ;(socket.onopen as () => void)()

    const msg = sendWebSocketMessage(conn.id, 'ping')
    expect(msg).not.toBeNull()
    expect(msg?.direction).toBe('sent')
    expect(mockSend).toHaveBeenCalledWith('ping')
  })

  it('returns null when sending on a disconnected connection', () => {
    const conn = connectWebSocket(wsInput())
    // Socket never opened, so connected is false
    const msg = sendWebSocketMessage(conn.id, 'ping')
    expect(msg).toBeNull()
  })

  it('disconnects and removes the connection from the active list', () => {
    const conn = connectWebSocket(wsInput())
    disconnectWebSocket(conn.id)

    expect(conn.connected).toBe(false)
    expect(mockClose).toHaveBeenCalled()
    expect(getActiveConnections().some((c) => c.id === conn.id)).toBe(false)
  })
})
