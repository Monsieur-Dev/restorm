import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, get as httpGet, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'
import { Server as IOServer } from 'socket.io'

// ---------------------------------------------------------------------------
// Mocks – vi.mock factories are hoisted; they must not reference outer vars.
// Same shape as ExecutionServices.test.ts so the shared execute() prologue
// (URL resolution, header build, secret hydration) is driven from fixtures.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('../../../src/main/services/ContextService', () => {
  const resolveValueMock = vi.fn((v: string) => v)
  return {
    contextService: {
      getResolvedUrl: vi.fn(),
      getRequestContext: vi.fn(),
      resolveValue: resolveValueMock,
      resolveKeyValueForRequest: vi.fn((kv: { value: unknown }) =>
        typeof kv.value === 'string' ? kv.value : String(kv.value)
      ),
      collectEnvironmentSecrets: vi.fn(() => []),
      refreshEnvironmentContext: vi.fn(() => undefined)
    }
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { websocketExecutionService } from '../../../src/main/services/WebSocketExecutionService'
import { contextService } from '../../../src/main/services/ContextService'

const mockedContextService = vi.mocked(contextService)

// ---------------------------------------------------------------------------
// In-process Socket.IO server (no Docker dependency for the unit suite).
// ---------------------------------------------------------------------------

let httpServer: HttpServer
let io: IOServer
let baseUrl: string

beforeAll(async () => {
  // HTTP /emit route mirrors the docker mock: pushes a server→client event.
  httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/emit') {
      const event = url.searchParams.get('event') ?? 'message'
      const raw = url.searchParams.get('data')
      io.emit(event, raw != null ? JSON.parse(raw) : { triggeredAt: 1 })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  io = new IOServer(httpServer, { cors: { origin: '*' } })

  io.on('connection', (socket) => {
    // Echo: re-emits AND acknowledges (mirrors the docker mock).
    socket.on('echo', (data, ack) => {
      socket.emit('echo', data)
      if (typeof ack === 'function') ack(data)
    })
    // Ack-only: responds solely through the acknowledgement callback.
    socket.on('echo:ack', (data, ack) => {
      if (typeof ack === 'function') ack({ echoed: data })
    })
  })

  // Auth-protected namespace mirrors the docker mock's /chat.
  io.of('/chat').use((socket, next) => {
    if (socket.handshake.auth.token === 'secret-token') { next(); return; }
    next(new Error('unauthorized'))
  })

  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  const port = (httpServer.address() as AddressInfo).port
  baseUrl = `http://localhost:${port}`
})

afterAll(async () => {
  await io.close()
  await new Promise<void>((resolve) => httpServer.close(() => { resolve(); }))
})

function setupRequest(url: string, fullData: Record<string, unknown>): void {
  mockedContextService.getResolvedUrl.mockReturnValue({ resolvedUrl: url, resolvedParts: [] } as never)
  mockedContextService.getRequestContext.mockReturnValue({
    fullData,
    keyValueGroups: new Map()
  } as never)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Poll until `cond()` is true or the deadline passes. */
async function waitFor(cond: () => boolean, deadlineMs = 2500): Promise<void> {
  const end = Date.now() + deadlineMs
  while (Date.now() < end) {
    if (cond()) return
    await sleep(25)
  }
}

/** Number of frames currently buffered for an active connection. */
function frameCount(requestId: string): number {
  return websocketExecutionService.getMessages(requestId)?.frames.length ?? 0
}

/** GET the mock's /emit route to push a server→client event. */
function triggerEmit(baseUrl: string, event: string, data: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    httpGet(`${baseUrl}/emit?event=${event}&data=${encodeURIComponent(data)}`, (res) => {
      res.resume()
      res.on('end', () => { resolve(); })
    }).on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocketExecutionService — Socket.IO', () => {
  beforeEach(() => {
    mockedContextService.getResolvedUrl.mockReset()
    mockedContextService.getRequestContext.mockReset()
    mockedContextService.resolveValue.mockImplementation((v: string) => v)
  })

  it('connects (listen), then send() emits and captures echo + ack', async () => {
    setupRequest(baseUrl, { protocol: 'socketio', event: 'echo', message: '{"hi":"there"}' })

    // Connect = listen only; emitting is an explicit send().
    const run = websocketExecutionService.execute({ requestId: 'sio-echo' })
    await waitFor(() => websocketExecutionService.isActive('sio-echo'))
    expect(websocketExecutionService.send('sio-echo', '{"hi":"there"}', 'echo')).toBe(true)
    await waitFor(() => frameCount('sio-echo') >= 3) // sent + echo + ack
    websocketExecutionService.disconnect('sio-echo')
    const result = await run

    expect(result.connected).toBe(true)
    const sent = result.messages.filter((m) => m.direction === 'sent')
    const received = result.messages.filter((m) => m.direction === 'received')
    expect(sent.length).toBe(1)
    expect(received.length).toBeGreaterThanOrEqual(2)
    expect(received.some((m) => m.data.includes('there'))).toBe(true)
    expect(received.some((m) => m.event === 'echo (ack)')).toBe(true)
  })

  it('treats fullData.method as the transport when protocol is absent (renderer convention)', async () => {
    // The renderer mirrors the websocket protocol onto fullData.method.
    setupRequest(baseUrl, { method: 'socketio' })

    const run = websocketExecutionService.execute({ requestId: 'sio-method-fallback' })
    await waitFor(() => websocketExecutionService.isActive('sio-method-fallback'))
    websocketExecutionService.send('sio-method-fallback', '{"hi":"method"}', 'echo')
    await waitFor(() => frameCount('sio-method-fallback') >= 2)
    websocketExecutionService.disconnect('sio-method-fallback')
    const result = await run

    expect(result.connected).toBe(true)
    expect(result.messages.some((m) => m.direction === 'received' && m.data.includes('method'))).toBe(true)
  })

  it('send() captures an acknowledgement-only reply', async () => {
    setupRequest(baseUrl, { protocol: 'socketio' })

    const run = websocketExecutionService.execute({ requestId: 'sio-ack' })
    await waitFor(() => websocketExecutionService.isActive('sio-ack'))
    websocketExecutionService.send('sio-ack', '{"n":1}', 'echo:ack')
    await waitFor(() => frameCount('sio-ack') >= 2) // sent + ack
    websocketExecutionService.disconnect('sio-ack')
    const result = await run

    const ack = result.messages.find((m) => m.event === 'echo:ack (ack)')
    expect(ack).toBeDefined()
    expect(ack?.data).toContain('echoed')
  })

  it('stays connected and receives a server-pushed event triggered over HTTP', async () => {
    // No event to emit → the connection just listens.
    setupRequest(baseUrl, { protocol: 'socketio' })

    const run = websocketExecutionService.execute({ requestId: 'sio-listen' })
    await waitFor(() => websocketExecutionService.isActive('sio-listen'))
    await triggerEmit(baseUrl, 'tick', '{"n":7}')
    await waitFor(() => frameCount('sio-listen') >= 1)
    websocketExecutionService.disconnect('sio-listen')
    const result = await run

    expect(result.connected).toBe(true)
    const tick = result.messages.find((m) => m.event === 'tick')
    expect(tick).toBeDefined()
    expect(tick?.data).toContain('7')
  })

  it('disconnect() ends the listening run and resolves it (no idle timeout)', async () => {
    setupRequest(baseUrl, { protocol: 'socketio' })

    const run = websocketExecutionService.execute({ requestId: 'sio-disc' })
    await waitFor(() => websocketExecutionService.isActive('sio-disc'))
    expect(websocketExecutionService.isActive('sio-disc')).toBe(true)

    expect(websocketExecutionService.disconnect('sio-disc')).toBe(true)
    const result = await run
    expect(result.connected).toBe(true)
    expect(websocketExecutionService.isActive('sio-disc')).toBe(false)
  })

  it('returns a clean error when the server is unreachable', async () => {
    // Port 1 is privileged / not listening → connect_error.
    setupRequest('http://localhost:1', { protocol: 'socketio', event: 'echo', message: '{}' })

    const result = await websocketExecutionService.execute({ requestId: 'sio-unreachable', timeout: 1500 })

    expect(result.success).toBe(false)
    expect(result.connected).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns an error when no resolved URL is found', async () => {
    mockedContextService.getResolvedUrl.mockReturnValue(undefined as never)

    const result = await websocketExecutionService.execute({ requestId: 'sio-no-url' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('No resolved URL')
  })

  it('isActive() returns false for an unknown request', () => {
    expect(websocketExecutionService.isActive('nope')).toBe(false)
  })
})
