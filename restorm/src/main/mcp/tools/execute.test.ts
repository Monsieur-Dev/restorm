import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

// ---------------------------------------------------------------------------
// Test scaffolding mirrors read.test.ts: fake McpService + mocked
// services. Real time is replaced by `vi.useFakeTimers` so the unary
// flow's 400ms tab-activation tick + 200ms history poll don't actually
// block the test runner.
// ---------------------------------------------------------------------------

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  registerResource(): void { /* unused here */ }
  invoke(name: string, args: Record<string, unknown> = {}): unknown {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {})
  }
  has(name: string): boolean {
    return this.handlers.has(name)
  }
}

const mockState = {
  findById: vi.fn<(id: string) => unknown>(),
  list: vi.fn<(requestId: string) => Promise<{ guid: string }[]>>(),
  getDetail: vi.fn<(guid: string) => Promise<unknown>>(),
  httpCancel: vi.fn<(id: string) => boolean>(),
  graphqlCancel: vi.fn<(id: string) => boolean>(),
  soapCancel: vi.fn<(id: string) => boolean>(),
  grpcCancel: vi.fn<(id: string) => boolean>(),
  wsDisconnect: vi.fn<(id: string) => boolean>(),
  wsGetMessages: vi.fn<(id: string, after?: number) => unknown>(),
  wsIsActive: vi.fn<(id: string) => boolean>(),
  sseDisconnect: vi.fn<(id: string) => boolean>(),
  sseGetMessages: vi.fn<(id: string, after?: number) => unknown>(),
  sseIsActive: vi.fn<(id: string) => boolean>(),
  webSend: vi.fn<(channel: string, payload: unknown) => void>()
}

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => mockState.findById(id),
    // `flushRequestStateToContext` calls this when registering a
    // freshly-resolved request inline (cold open_project case). Tests
    // don't care about env folders → return null and the helper falls
    // back to a null environmentId, which is the same shape the
    // renderer uses when no env has been chosen yet.
    findParentFolder: (_id: string) => null
  }
}))

vi.mock('../../services', () => ({
  responseHistoryService: {
    list: (id: string) => mockState.list(id),
    getDetail: (guid: string) => mockState.getDetail(guid),
    // Mirror the real first-check: a freshly-stored entry is already present in
    // the mocked `list`, so this resolves it immediately; otherwise null (the
    // tests drive `list` to return either a new top guid or the baseline).
    waitForNewEntry: async (id: string, baselineGuid: string | null) => {
      const top = (await mockState.list(id))[0]
      return top !== undefined && top.guid !== baselineGuid ? { guid: top.guid } : null
    }
  }
}))

vi.mock('../../services/HTTPExecutionService', () => ({
  httpExecutionService: { cancel: (id: string) => mockState.httpCancel(id) }
}))
vi.mock('../../services/GraphQLExecutionService', () => ({
  graphqlExecutionService: { cancel: (id: string) => mockState.graphqlCancel(id) }
}))
vi.mock('../../services/SOAPExecutionService', () => ({
  soapExecutionService: { cancel: (id: string) => mockState.soapCancel(id) }
}))
vi.mock('../../services/GRPCExecutionService', () => ({
  grpcExecutionService: { cancel: (id: string) => mockState.grpcCancel(id) }
}))
vi.mock('../../services/WebSocketExecutionService', () => ({
  websocketExecutionService: {
    disconnect: (id: string) => mockState.wsDisconnect(id),
    getMessages: (id: string, after?: number) => mockState.wsGetMessages(id, after),
    isActive: (id: string) => mockState.wsIsActive(id)
  }
}))

vi.mock('../../services/SseExecutionService', () => ({
  sseExecutionService: {
    disconnect: (id: string) => mockState.sseDisconnect(id),
    getMessages: (id: string, after?: number) => mockState.sseGetMessages(id, after),
    isActive: (id: string) => mockState.sseIsActive(id)
  }
}))

vi.mock('electron', () => ({
  // `app.isPackaged` backs electron-core-ui's logger level check; without it
  // ContextService's registerRequest/updateFullRequestData throw on their
  // logger calls and the new proto-flush test below can't observe any state.
  app: { isPackaged: false, getPath: () => '/tmp', getName: () => 'restorm', on: () => undefined },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => { mockState.webSend(channel, payload) } }
    }]
  }
}))

import { registerExecutionTools } from './execute'
import { contextService } from '../../services/ContextService'

interface ReplyText { content: { type: 'text'; text: string }[]; isError?: true }
function parseReply(reply: unknown): { text: string; isError: boolean; payload: unknown } {
  const r = reply as ReplyText
  const text = r.content[0]?.text ?? ''
  let payload: unknown = null
  try { payload = JSON.parse(text) } catch { payload = text }
  return { text, isError: r.isError === true, payload }
}

beforeEach(() => {
  for (const fn of Object.values(mockState)) fn.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// run_request — happy path per protocol + error paths
// ---------------------------------------------------------------------------

describe('execute tools — run_request (unary)', () => {
  for (const protocol of ['http', 'odata', 'soap', 'auth'] as const) {
    it(`returns the freshly-stored history entry shape for ${protocol}`, async () => {
      vi.useFakeTimers()
      mockState.findById.mockReturnValue({ id: 'r1', name: 'r', type: protocol })
      mockState.list
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ guid: 'g-new' }])
      mockState.getDetail.mockResolvedValue({
        requestId: 'r1',
        success: true,
        response: {
          type: protocol,
          statusCode: 200,
          statusText: 'OK',
          responseHeaders: [
            { key: 'content-type', value: 'application/json' }
          ],
          responseBody: '{"hello":"world"}',
          timings: { startedAt: '2026-05-11T00:00:00.000Z', durationMs: 12 },
          requestUrl: 'http://api/foo',
          requestMethod: 'GET',
          requestHeaders: [{ key: 'Authorization', value: 'Bearer x' }],
          requestParams: [{ key: 'q', value: '1' }],
          requestPathParams: [],
          requestBody: { type: 'text', content: '' }
        }
      })

      const mcp = new FakeMcpService()
      registerExecutionTools(mcp as unknown as McpService)
      const promise = mcp.invoke('run_request', { id: 'r1' }) as Promise<unknown>

      // 400ms tab tick + 200ms poll
      await vi.advanceTimersByTimeAsync(700)
      const { payload, isError } = parseReply(await promise)
      expect(isError).toBe(false)
      expect(payload).toMatchObject({
        requestId: 'r1',
        protocol,
        success: true,
        status: 200,
        statusText: 'OK',
        body: { hello: 'world' },
        bodyContentType: 'application/json',
        durationMs: 12,
        requestUrl: 'http://api/foo',
        request: {
          method: 'GET',
          url: 'http://api/foo',
          headers: [{ key: 'Authorization', value: 'Bearer x' }],
          params: [{ key: 'q', value: '1' }]
        }
      })
    })
  }

  it("reports protocol 'unknown' (not 'http') when the history entry has no type", async () => {
    vi.useFakeTimers()
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r', type: 'http' })
    mockState.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ guid: 'g-new' }])
    mockState.getDetail.mockResolvedValue({
      requestId: 'r1',
      success: true,
      // No `type` on the response — a malformed/legacy entry. Must surface
      // 'unknown' rather than silently claiming http.
      response: { statusCode: 200, statusText: 'OK', timings: { durationMs: 1 } }
    })
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request', { id: 'r1' }) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(700)
    const { payload } = parseReply(await promise) as { payload: { protocol: string } }
    expect(payload.protocol).toBe('unknown')
  })

  it('returns parsed { data, errors } for graphql', async () => {
    vi.useFakeTimers()
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r', type: 'graphql' })
    mockState.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ guid: 'g-new' }])
    mockState.getDetail.mockResolvedValue({
      requestId: 'r1',
      success: true,
      response: {
        type: 'graphql',
        statusCode: 200,
        responseHeaders: [{ key: 'content-type', value: 'application/json' }],
        data: { user: { id: 42 } },
        errors: undefined,
        timings: { startedAt: '2026-05-11T00:00:00.000Z', durationMs: 7 },
        requestUrl: 'http://api/graphql'
      }
    })

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request', { id: 'r1' }) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(700)
    const { payload } = parseReply(await promise) as { payload: { body?: { data?: unknown } } }
    expect(payload.body?.data).toEqual({ user: { id: 42 } })
  })

  it('returns the gRPC responseMessage as body', async () => {
    vi.useFakeTimers()
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r', type: 'grpc' })
    mockState.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ guid: 'g-new' }])
    mockState.getDetail.mockResolvedValue({
      requestId: 'r1',
      success: true,
      response: {
        type: 'grpc',
        statusCode: 0,
        responseHeaders: [],
        responseMessage: '{"reply":"pong"}',
        contentType: 'application/json',
        timings: { startedAt: '2026-05-11T00:00:00.000Z', durationMs: 3 },
        requestUrl: 'grpc://api/Foo/Ping',
        requestMethod: 'Ping',
        requestMetadata: []
      }
    })

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request', { id: 'r1' }) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(700)
    const { payload } = parseReply(await promise) as { payload: { body?: unknown } }
    expect(payload.body).toEqual({ reply: 'pong' })
  })

  it('flushes protoDescriptorSet into ContextService for a reflection-imported request', async () => {
    // A reflection-imported request carries ONLY protoDescriptorSet (no
    // protoContent/protoPath). If the flush step drops that field, the
    // dynamic client falls back to the bundled grpcbin proto instead of
    // the real server's schema — the bug this test guards against.
    vi.useFakeTimers()
    mockState.findById.mockReturnValue({
      id: 'r1',
      name: 'r',
      type: 'grpc',
      service: 'real.Service',
      method: 'Ping',
      callType: 'unary',
      requestMessage: '{}',
      protoDescriptorSet: 'BASE64_DESCRIPTOR_SET'
    })
    mockState.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ guid: 'g-new' }])
    mockState.getDetail.mockResolvedValue({
      requestId: 'r1',
      success: true,
      response: {
        type: 'grpc',
        statusCode: 0,
        responseHeaders: [],
        responseMessage: '{}',
        timings: { startedAt: '2026-05-11T00:00:00.000Z', durationMs: 1 },
        requestUrl: 'grpc://api/real.Service/Ping',
        requestMethod: 'Ping',
        requestMetadata: []
      }
    })

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request', { id: 'r1' }) as Promise<unknown>
    // The flush (flushRequestStateToContext) fires right after the 400ms
    // tab-activation delay, ahead of the renderer Send dispatch.
    await vi.advanceTimersByTimeAsync(450)
    expect(contextService.getRequestContext('r1')?.fullData?.protoDescriptorSet).toBe('BASE64_DESCRIPTOR_SET')

    await vi.advanceTimersByTimeAsync(700)
    await promise
  })

  it('opens the tab + clicks Send via the renderer broadcasts', async () => {
    vi.useFakeTimers()
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r', type: 'http' })
    mockState.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ guid: 'g1' }])
    mockState.getDetail.mockResolvedValue({ response: {} })

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request', { id: 'r1' }) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(700)
    await promise

    const channels = mockState.webSend.mock.calls.map((c) => c[0])
    expect(channels).toContain('mcp:open-tab')
    expect(channels).toContain('mcp:run-request')
  })

  it('returns a TIMEOUT error when no new history entry lands', async () => {
    vi.useFakeTimers()
    mockState.findById.mockReturnValue({ id: 'r1', name: 'r', type: 'http' })
    mockState.list.mockResolvedValue([{ guid: 'baseline' }])

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request', { id: 'r1', timeoutMs: 500 }) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(2_000)
    const { payload } = parseReply(await promise) as { payload: { error?: { code: string } } }
    expect(payload.error?.code).toBe('TIMEOUT')
  })

  it('rejects an empty id', async () => {
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(await mcp.invoke('run_request', { id: '' }))
    expect(isError).toBe(true)
    expect(text).toContain('id is required')
  })

  it('rejects an unknown id', async () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(await mcp.invoke('run_request', { id: 'ghost' }))
    expect(isError).toBe(true)
    expect(text).toContain('No request')
  })
})

describe('execute tools — run_request (websocket streaming)', () => {
  it('returns first frames + a continuationToken', async () => {
    vi.useFakeTimers()
    mockState.findById.mockReturnValue({ id: 'ws1', name: 'ws', type: 'websocket' })
    mockState.wsGetMessages.mockReturnValue({
      frames: [
        { direction: 'sent', data: 'hi', timestamp: 't0' },
        { direction: 'received', data: 'hello', timestamp: 't1' }
      ],
      total: 2
    })
    mockState.wsIsActive.mockReturnValue(true)

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request', { id: 'ws1', timeoutMs: 500 }) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(1_000)
    const { payload } = parseReply(await promise) as { payload: { protocol: string; streaming: boolean; frameCount: number; continuationToken: string } }
    expect(payload.protocol).toBe('websocket')
    expect(payload.streaming).toBe(true)
    expect(payload.frameCount).toBe(2)
    expect(payload.continuationToken).toBe('2#ws1')
  })
})

// ---------------------------------------------------------------------------
// cancel_request — routing per protocol
// ---------------------------------------------------------------------------

describe('execute tools — cancel_request', () => {
  const cases: { type: string; mockKey: keyof typeof mockState }[] = [
    { type: 'http', mockKey: 'httpCancel' },
    { type: 'odata', mockKey: 'httpCancel' },
    { type: 'auth', mockKey: 'httpCancel' },
    { type: 'graphql', mockKey: 'graphqlCancel' },
    { type: 'soap', mockKey: 'soapCancel' },
    { type: 'grpc', mockKey: 'grpcCancel' },
    { type: 'websocket', mockKey: 'wsDisconnect' }
  ]
  for (const { type, mockKey } of cases) {
    it(`routes ${type} cancellations to the right service`, () => {
      mockState.findById.mockReturnValue({ id: 'r', name: 'r', type })
      ;(mockState[mockKey] as ReturnType<typeof vi.fn>).mockReturnValue(true)
      const mcp = new FakeMcpService()
      registerExecutionTools(mcp as unknown as McpService)
      const { payload } = parseReply(mcp.invoke('cancel_request', { id: 'r' })) as { payload: { cancelled: boolean; protocol: string } }
      expect(payload.cancelled).toBe(true)
      expect(payload.protocol).toBe(type)
      expect(mockState[mockKey]).toHaveBeenCalledWith('r')
    })
  }

  it('returns cancelled=false when nothing was in flight', () => {
    mockState.findById.mockReturnValue({ id: 'r', name: 'r', type: 'http' })
    mockState.httpCancel.mockReturnValue(false)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(mcp.invoke('cancel_request', { id: 'r' })) as { payload: { cancelled: boolean } }
    expect(payload.cancelled).toBe(false)
  })

  it('errors on unknown id', () => {
    mockState.findById.mockReturnValue(null)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { isError } = parseReply(mcp.invoke('cancel_request', { id: 'ghost' }))
    expect(isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// run_request_batch — order preservation, partial-on-unknown, mixed protocols
// ---------------------------------------------------------------------------

describe('execute tools — run_request_batch', () => {
  it('runs requests sequentially and preserves input order', async () => {
    vi.useFakeTimers()
    const reqs: Record<string, unknown> = {
      'a': { id: 'a', type: 'http' },
      'b': { id: 'b', type: 'http' },
      'c': { id: 'c', type: 'http' }
    }
    mockState.findById.mockImplementation((id: string) => reqs[id] ?? null)
    let callCount = 0
    mockState.list.mockImplementation(() => {
      callCount += 1
      // baseline call returns empty, follow-up returns new entry
      return Promise.resolve(callCount % 2 === 1 ? [] : [{ guid: `g-${callCount}` }])
    })
    mockState.getDetail.mockImplementation((guid: string) => Promise.resolve({ requestId: guid, response: { statusCode: 200 } }))

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request_batch', { ids: ['a', 'b', 'c'] }) as Promise<unknown>
    // 3 requests × (400ms tab + 200ms poll)
    await vi.advanceTimersByTimeAsync(3_000)
    const { payload } = parseReply(await promise) as { payload: { ranCount: number; results: { requestId: string }[] } }
    expect(payload.ranCount).toBe(3)
    expect(payload.results.map((r) => r.requestId)).toEqual(['g-2', 'g-4', 'g-6'])
  })

  it('stops early on unknown id and returns the partial array', async () => {
    vi.useFakeTimers()
    const reqs: Record<string, unknown> = { 'a': { id: 'a', type: 'http' } }
    mockState.findById.mockImplementation((id: string) => reqs[id] ?? null)
    mockState.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ guid: 'g-1' }])
    mockState.getDetail.mockResolvedValue({ response: { statusCode: 200 } })

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const promise = mcp.invoke('run_request_batch', { ids: ['a', 'ghost', 'c'] }) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(1_000)
    const { payload } = parseReply(await promise) as { payload: { ranCount: number; requestedCount: number; error?: { code: string } } }
    expect(payload.ranCount).toBe(1)
    expect(payload.requestedCount).toBe(3)
    expect(payload.error?.code).toBe('UNKNOWN_REQUEST')
  })

  it('rejects an empty array', async () => {
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { isError } = parseReply(await mcp.invoke('run_request_batch', { ids: [] }))
    expect(isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// read_stream — token decode, slicing, done-on-disconnect
// ---------------------------------------------------------------------------

describe('execute tools — read_stream', () => {
  // A continuation token is only ever issued for a request in the project, and
  // the tool reads THAT request's protocol buffer — so the store has to resolve
  // it. Default every id to a websocket request; the SSE cases override.
  beforeEach(() => {
    mockState.findById.mockImplementation((id: string) => ({ id, name: id, type: 'websocket' }))
  })

  it('returns the next slice of frames + advances the cursor', async () => {
    const all = [
      { direction: 'received', data: 'm1', timestamp: 't1' },
      { direction: 'received', data: 'm2', timestamp: 't2' },
      { direction: 'received', data: 'm3', timestamp: 't3' }
    ]
    mockState.wsGetMessages.mockImplementation((_id: string, after?: number) => ({
      frames: all.slice(after ?? 0),
      total: all.length
    }))
    mockState.wsIsActive.mockReturnValue(true)

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('read_stream', { continuationToken: '1#ws1' })) as { payload: { frameCount: number; continuationToken: string; done: boolean } }
    expect(payload.frameCount).toBe(2)
    expect(payload.continuationToken).toBe('3#ws1')
    expect(payload.done).toBe(false)
  })

  it('flips done=true once the connection closed', async () => {
    mockState.wsGetMessages.mockReturnValue({ frames: [], total: 0 })
    mockState.wsIsActive.mockReturnValue(false)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('read_stream', { continuationToken: '5#ws1' })) as { payload: { done: boolean; cursorReset?: boolean } }
    expect(payload.done).toBe(true)
    expect(payload.cursorReset).toBe(true)
  })

  it('returns done=true with empty frames when the buffer is gone', async () => {
    mockState.wsGetMessages.mockReturnValue(null)
    mockState.wsIsActive.mockReturnValue(false)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('read_stream', { continuationToken: '0#ws1' })) as { payload: { frameCount: number; done: boolean } }
    expect(payload.frameCount).toBe(0)
    expect(payload.done).toBe(true)
  })

  it('rejects a malformed token', async () => {
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { isError, text } = parseReply(await mcp.invoke('read_stream', { continuationToken: 'no-cursor-here' }))
    expect(isError).toBe(true)
    expect(text).toContain('Malformed')
  })

  it('recovers a request id that itself contains a "#" (cursor-first encoding)', async () => {
    // The cursor is the leading numeric segment, so the request id after the
    // first '#' is taken verbatim — even when it contains more '#' characters.
    const all = [
      { direction: 'received', data: 'a', timestamp: 't1' },
      { direction: 'received', data: 'b', timestamp: 't2' }
    ]
    let seenId: string | undefined
    mockState.wsGetMessages.mockImplementation((id: string, after?: number) => {
      seenId = id
      return { frames: all.slice(after ?? 0), total: all.length }
    })
    mockState.wsIsActive.mockReturnValue(true)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('read_stream', { continuationToken: '0#ws#weird#id' })) as { payload: { frameCount: number; continuationToken: string } }
    expect(seenId).toBe('ws#weird#id')
    expect(payload.frameCount).toBe(2)
    expect(payload.continuationToken).toBe('2#ws#weird#id')
  })

  it('caps the returned frame count at maxFrames', async () => {
    mockState.wsGetMessages.mockReturnValue({
      frames: [
        { direction: 'received', data: 'a', timestamp: 't' },
        { direction: 'received', data: 'b', timestamp: 't' },
        { direction: 'received', data: 'c', timestamp: 't' }
      ],
      total: 3
    })
    mockState.wsIsActive.mockReturnValue(true)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('read_stream', { continuationToken: '0#ws1', maxFrames: 2 })) as { payload: { frameCount: number; continuationToken: string } }
    expect(payload.frameCount).toBe(2)
    expect(payload.continuationToken).toBe('2#ws1')
  })

  it('signals cursorReset when the cursor overshoots the buffer', async () => {
    // Buffer rebuilt mid-session — total is shorter than the cursor we hand in.
    mockState.wsGetMessages.mockReturnValue({
      frames: [{ direction: 'received', data: 'fresh', timestamp: 't' }],
      total: 1
    })
    mockState.wsIsActive.mockReturnValue(true)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('read_stream', { continuationToken: '42#ws1' })) as { payload: { cursorReset?: boolean; continuationToken: string; frameCount: number } }
    expect(payload.cursorReset).toBe(true)
    expect(payload.continuationToken).toBe('1#ws1')
    expect(payload.frameCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// get_response_history / get_response — passthrough, error paths
// ---------------------------------------------------------------------------

describe('execute tools — get_response_history', () => {
  it('returns the entries + applies the limit cap', async () => {
    mockState.list.mockResolvedValue([
      { guid: 'g1' }, { guid: 'g2' }, { guid: 'g3' }
    ] as unknown as { guid: string }[])
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('get_response_history', { requestId: 'r1', limit: 2 })) as { payload: { count: number; totalAvailable: number; entries: { guid: string }[] } }
    expect(payload.count).toBe(2)
    expect(payload.totalAvailable).toBe(3)
    expect(payload.entries.map((e) => e.guid)).toEqual(['g1', 'g2'])
  })
})

describe('execute tools — get_response', () => {
  it('passes the responseHistoryService.getDetail payload through unchanged', async () => {
    // The tool delegates redaction entirely to ResponseHistoryService —
    // this is a passthrough test, NOT a redaction-pipeline test. Real
    // redaction coverage lives next to ResponseHistoryService itself
    // (see passwordValueSerialization.test.ts + the response-history
    // integration tests).
    mockState.getDetail.mockResolvedValue({
      requestId: 'r1',
      response: { body: '{"token":"***"}' }
    })
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('get_response', { historyEntryId: 'g1' })) as { payload: { response: { body: string } } }
    expect(payload.response.body).toBe('{"token":"***"}')
  })

  it('errors on unknown guid', async () => {
    mockState.getDetail.mockResolvedValue(null)
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { isError } = parseReply(await mcp.invoke('get_response', { historyEntryId: 'ghost' }))
    expect(isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Streaming protocols other than WebSocket — the buffer must be the
// request's OWN, and the reported protocol must be the request's own.
// ---------------------------------------------------------------------------

describe('execute tools — streaming reads the request\'s own protocol buffer', () => {
  const SSE_REQUEST = { id: 'sse1', name: 'Events', type: 'sse' }
  const SSE_FRAMES = [
    { direction: 'received', data: 'ping 1', timestamp: 't1' },
    { direction: 'received', data: 'ping 2', timestamp: 't2' }
  ]

  it('run_request streams an SSE request and reports protocol "sse"', async () => {
    // The WebSocket buffer stays empty throughout: reading it for an SSE
    // request is what produced `{ frameCount: 0, protocol: 'websocket' }` on a
    // connection that was streaming fine.
    mockState.findById.mockReturnValue(SSE_REQUEST)
    mockState.wsGetMessages.mockReturnValue({ frames: [], total: 0 })
    mockState.wsIsActive.mockReturnValue(false)
    mockState.sseGetMessages.mockReturnValue({ frames: SSE_FRAMES, total: SSE_FRAMES.length })
    mockState.sseIsActive.mockReturnValue(true)

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    vi.useFakeTimers()
    const promise = mcp.invoke('run_request', { id: 'sse1' }) as Promise<unknown>
    await vi.runAllTimersAsync()
    const { payload } = parseReply(await promise) as {
      payload: { protocol: string; frameCount: number; success: boolean; continuationToken: string }
    }

    expect(payload.protocol).toBe('sse')
    expect(payload.frameCount).toBe(2)
    expect(payload.success).toBe(true)
    expect(payload.continuationToken).toBe('2#sse1')
  })

  it('read_stream pulls from the SSE buffer, not the WebSocket one', async () => {
    mockState.findById.mockReturnValue(SSE_REQUEST)
    mockState.wsGetMessages.mockReturnValue({ frames: [], total: 0 })
    mockState.wsIsActive.mockReturnValue(false)
    mockState.sseGetMessages.mockImplementation((_id: string, after?: number) => ({
      frames: SSE_FRAMES.slice(after ?? 0),
      total: SSE_FRAMES.length
    }))
    mockState.sseIsActive.mockReturnValue(true)

    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('read_stream', { continuationToken: '1#sse1' })) as {
      payload: { frameCount: number; done: boolean; continuationToken: string }
    }

    expect(payload.frameCount).toBe(1)
    expect(payload.done).toBe(false)
    expect(payload.continuationToken).toBe('2#sse1')
    expect(mockState.wsGetMessages).not.toHaveBeenCalled()
  })

  it('read_stream reports no live buffer for a protocol that has none wired', async () => {
    mockState.findById.mockReturnValue({ id: 'http1', name: 'Get', type: 'http' })
    const mcp = new FakeMcpService()
    registerExecutionTools(mcp as unknown as McpService)
    const { payload } = parseReply(await mcp.invoke('read_stream', { continuationToken: '0#http1' })) as {
      payload: { frameCount: number; done: boolean; note: string }
    }

    expect(payload.frameCount).toBe(0)
    expect(payload.done).toBe(true)
    expect(payload.note).toContain('No live frame buffer')
  })
})
