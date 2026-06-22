import { describe, it, expect, vi, beforeEach } from 'vitest'
import type http from 'http'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Mocks – vi.mock factories are hoisted; they must not reference outer vars.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) }
}))

// The user-initiated hop AND the first redirect wrap their http.request in
// the firewall bypass (a Send the user already clicked + one legitimate
// redirect never re-prompt); the 2nd+ redirect does NOT bypass (the firewall
// must vet a server-controlled Location to block SSRF). The mock is a tracked
// spy that still runs the wrapped fn straight through, so a test can assert
// HOW MANY hops were bypassed.
const { firewallBypassSpy } = vi.hoisted(() => ({
  firewallBypassSpy: vi.fn(<T>(fn: () => T): T => fn())
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  // GRPCExecutionService now imports ResponseHistoryService, which pulls in
  // CollectionStore's `createPubSub(...)` at module load — provide it here.
  createPubSub: () => ({ publish: vi.fn(), subscribe: vi.fn(), asyncIterator: vi.fn() }),
  withFirewallBypass: firewallBypassSpy
}))

vi.mock('../../../src/main/services/ContextService', () => {
  const resolveValueMock = vi.fn((v: string) => v)
  return {
    contextService: {
      getResolvedUrl: vi.fn(),
      getRequestContext: vi.fn(),
      resolveValue: resolveValueMock,
      // Type-aware header path: HTTPExecutionService now calls
      // `resolveKeyValueForRequest(kv)` instead of
      // `resolveValue(kv.value)` so it can gate substitution on
      // `ExpressionValue` vs `StringValue`. The default mock unwraps
      // the value via `toString()` (covers both class instances and
      // raw-string test fixtures) and reuses `resolveValueMock` so
      // existing tests that override `resolveValue.mockImplementation`
      // keep working without having to also configure this one.
      resolveKeyValueForRequest: vi.fn((kv: { value: unknown }) => {
        const raw = typeof kv.value === 'string' ? kv.value : String(kv.value)
        return resolveValueMock(raw)
      }),
      transformAllValues: vi.fn(),
      // Secrets foundation: execution services hydrate environment-folder
      // secrets before resolving values. The mock has no environment, so
      // there are no env secrets to collect and the context refresh is a no-op.
      collectEnvironmentSecrets: vi.fn(() => []),
      refreshEnvironmentContext: vi.fn(() => undefined)
    }
  }
})

// For http/https we return an object whose `request` is a vi.fn().
// We grab the reference *after* the mock is set up via `await import(…)`.
vi.mock('http', () => ({ default: { request: vi.fn() }, request: vi.fn() }))
vi.mock('https', () => ({ default: { request: vi.fn() }, request: vi.fn() }))

// grpcProtoLoader: default to a factory that throws (the existing behaviour for
// the "service not in proto" path); individual tests override
// resolveGrpcMethodMock to return a controlled { client, requestStream,
// responseStream } shape.
vi.mock('../../../src/main/services/grpc/grpcProtoLoader', () => ({
  resolveGrpcMethod: vi.fn((_src: unknown, _addr: unknown, service: string) => {
    throw new Error(`Service '${service}' not found in proto descriptor`)
  }),
  grpcStatusName: vi.fn((code: number) => `STATUS_${code}`)
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { httpExecutionService } from '../../../src/main/services/HTTPExecutionService'
import { grpcExecutionService } from '../../../src/main/services/GRPCExecutionService'
import { contextService } from '../../../src/main/services/ContextService'
import * as grpcProtoLoader from '../../../src/main/services/grpc/grpcProtoLoader'
import httpMod from 'http'

const mockedContextService = vi.mocked(contextService)
const resolveGrpcMethodMock = vi.mocked(grpcProtoLoader.resolveGrpcMethod)
const httpRequestSpy = vi.mocked(httpMod.request) as unknown as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh fake ClientRequest (EventEmitter with write/end/destroy). */
function createFakeRequest(): EventEmitter & {
  write: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
} {
  const req = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  req.write = vi.fn()
  req.end = vi.fn()
  req.destroy = vi.fn()
  return req
}

/** Build a fake Node.js IncomingMessage-like readable for http tests. */
function buildFakeResponse(
  statusCode: number,
  statusMessage: string,
  body: string,
  headers: Record<string, string> = {}
): EventEmitter {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number
    statusMessage: string
    headers: Record<string, string>
  }
  res.statusCode = statusCode
  res.statusMessage = statusMessage
  res.headers = headers

  // Emit data + end asynchronously so the service has time to attach listeners
  queueMicrotask(() => {
    res.emit('data', Buffer.from(body))
    res.emit('end')
  })

  return res
}

function setupResolvedUrl(url: string): void {
  mockedContextService.getResolvedUrl.mockReturnValue({ resolvedUrl: url, resolvedParts: [] })
}

function setupRequestContext(overrides: Record<string, unknown> = {}): void {
  mockedContextService.getRequestContext.mockReturnValue({
    fullData: {},
    keyValueGroups: new Map(),
    ...overrides
  } as never)
}

// ---------------------------------------------------------------------------
// Tests – HTTPExecutionService
// ---------------------------------------------------------------------------

describe('HTTPExecutionService', () => {
  let fakeRequest: ReturnType<typeof createFakeRequest>

  beforeEach(() => {
    vi.clearAllMocks()
    fakeRequest = createFakeRequest()
  })

  it('returns error when no resolved URL is found', async () => {
    mockedContextService.getResolvedUrl.mockReturnValue(undefined as never)

    const result = await httpExecutionService.execute({ requestId: 'r1', method: 'GET' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('No resolved URL')
    expect(result.requestId).toBe('r1')
  })

  it('returns error for an invalid URL', async () => {
    setupResolvedUrl('not-a-valid-url')
    setupRequestContext()

    const result = await httpExecutionService.execute({ requestId: 'r2', method: 'GET' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid URL')
  })

  it('executes a successful GET request', async () => {
    setupResolvedUrl('http://example.com/api')
    setupRequestContext()

    httpRequestSpy.mockImplementation((_opts: unknown, cb: (res: EventEmitter) => void) => {
      queueMicrotask(() => { cb(buildFakeResponse(200, 'OK', '{"ok":true}')) })
      return fakeRequest
    })

    const result = await httpExecutionService.execute({ requestId: 'r3', method: 'GET' })

    expect(result.success).toBe(true)
    expect(result.statusCode).toBe(200)
    expect(result.body).toBe('{"ok":true}')
    expect(result.requestUrl).toBe('http://example.com/api')
    expect(result.timings.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('sends request body and resolves headers from context', async () => {
    setupResolvedUrl('http://example.com/api')

    const headersGroup = [
      { key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
      { key: 'X-Disabled', value: 'skip', enabled: false }
    ]
    setupRequestContext({
      keyValueGroups: new Map([['headers', headersGroup]]),
      fullData: { body: { type: 'text', content: '{"hello":"world"}' } }
    })
    mockedContextService.resolveValue.mockImplementation((v: string) => v.replace('{{token}}', 'abc'))

    httpRequestSpy.mockImplementation((opts: http.RequestOptions, cb: (res: EventEmitter) => void) => {
      expect(opts.headers).toHaveProperty('Authorization', 'Bearer abc')
      expect(opts.headers).not.toHaveProperty('X-Disabled')
      queueMicrotask(() => { cb(buildFakeResponse(201, 'Created', '')) })
      return fakeRequest
    })

    const result = await httpExecutionService.execute({ requestId: 'r4', method: 'POST' })

    expect(result.success).toBe(true)
    expect(result.statusCode).toBe(201)
    expect(fakeRequest.write).toHaveBeenCalledWith('{"hello":"world"}')
  })

  it('handles network errors gracefully', async () => {
    setupResolvedUrl('http://example.com/api')
    setupRequestContext()

    httpRequestSpy.mockImplementation((_opts: unknown, _cb: unknown) => {
      queueMicrotask(() => {
        fakeRequest.emit('error', new Error('ECONNREFUSED'))
      })
      return fakeRequest
    })

    const result = await httpExecutionService.execute({ requestId: 'r5', method: 'GET' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('handles timeout by rejecting with timeout error', async () => {
    setupResolvedUrl('http://example.com/slow')
    setupRequestContext()

    httpRequestSpy.mockImplementation((_opts: unknown, _cb: unknown) => {
      queueMicrotask(() => {
        fakeRequest.emit('timeout')
      })
      return fakeRequest
    })

    const result = await httpExecutionService.execute({ requestId: 'r6', method: 'GET', timeout: 100 })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Request timeout')
    expect(fakeRequest.destroy).toHaveBeenCalled()
  })

  it('cancel() aborts an active request and returns true', async () => {
    setupResolvedUrl('http://example.com/api')
    setupRequestContext()

    // Create a request that never resolves on its own
    httpRequestSpy.mockImplementation((_opts: unknown, _cb: unknown) => fakeRequest)

    const promise = httpExecutionService.execute({ requestId: 'r7', method: 'GET' })

    // The request should now be active
    expect(httpExecutionService.isActive('r7')).toBe(true)

    const cancelled = httpExecutionService.cancel('r7')
    expect(cancelled).toBe(true)

    const result = await promise

    expect(result.success).toBe(false)
    expect(result.error).toBe('Request cancelled')
    expect(httpExecutionService.isActive('r7')).toBe(false)
  })

  it('cancel() returns false for unknown request', () => {
    expect(httpExecutionService.cancel('nonexistent')).toBe(false)
  })

  it('isActive() returns false when no request is running', () => {
    expect(httpExecutionService.isActive('unknown')).toBe(false)
  })

  it('preserves a binary response body as base64', async () => {
    setupResolvedUrl('http://example.com/binary')
    setupRequestContext()

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe])
    httpRequestSpy.mockImplementation((_opts: unknown, cb: (res: EventEmitter) => void) => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; statusMessage: string; headers: Record<string, string> }
      res.statusCode = 200
      res.statusMessage = 'OK'
      res.headers = { 'content-type': 'image/png' }
      // Hand the response to the service first, THEN emit so its
      // data/end listeners are attached before the events fire.
      queueMicrotask(() => {
        cb(res)
        queueMicrotask(() => { res.emit('data', pngBytes); res.emit('end') })
      })
      return fakeRequest
    })

    const result = await httpExecutionService.execute({ requestId: 'rb', method: 'GET' })

    expect(result.success).toBe(true)
    expect(result.bodyIsBase64).toBe(true)
    expect(result.body).toBe(pngBytes.toString('base64'))
  })

  it('follows a redirect when followRedirects is on (default)', async () => {
    setupResolvedUrl('http://example.com/redirect')
    setupRequestContext()

    let hop = 0
    httpRequestSpy.mockImplementation((opts: http.RequestOptions, cb: (res: EventEmitter) => void) => {
      const req = createFakeRequest()
      if (hop === 0) {
        hop++
        queueMicrotask(() => { cb(buildFakeResponse(302, 'Found', '', { location: 'http://example.com/final' })) })
      } else {
        expect(opts.path).toBe('/final')
        queueMicrotask(() => { cb(buildFakeResponse(200, 'OK', 'arrived')) })
      }
      return req
    })

    const result = await httpExecutionService.execute({ requestId: 'rr', method: 'GET', followRedirects: true })

    expect(result.statusCode).toBe(200)
    expect(result.body).toBe('arrived')
  })

  it('bypasses the firewall on hop 0 + the first redirect, but VETS the 2nd+ redirect (SSRF guard)', async () => {
    setupResolvedUrl('http://example.com/redirect')
    setupRequestContext()

    // Three hops: the user request (hop 0), the first redirect (hop 1),
    // then a SECOND redirect to a host the firewall would normally vet —
    // e.g. cloud metadata. Policy B: hops 0 and 1 are firewall-bypassed
    // (a single redirect is friction-free); the 2nd redirect (hop 2) is
    // NOT bypassed, so the firewall vets the SSRF target.
    let hop = 0
    httpRequestSpy.mockImplementation((_opts: http.RequestOptions, cb: (res: EventEmitter) => void) => {
      const req = createFakeRequest()
      const current = hop++
      if (current === 0) {
        queueMicrotask(() => { cb(buildFakeResponse(302, 'Found', '', { location: 'http://example.com/second' })) })
      } else if (current === 1) {
        queueMicrotask(() => { cb(buildFakeResponse(302, 'Found', '', { location: 'http://169.254.169.254/latest/meta-data' })) })
      } else {
        queueMicrotask(() => { cb(buildFakeResponse(200, 'OK', 'meta')) })
      }
      return req
    })

    const result = await httpExecutionService.execute({ requestId: 'rssrf', method: 'GET', followRedirects: true })

    // Three HTTP hops happened; the bypass wrapped hop 0 AND hop 1 (2x)
    // but NOT hop 2 — the 2nd redirect went through the firewall normally.
    expect(httpRequestSpy).toHaveBeenCalledTimes(3)
    expect(firewallBypassSpy).toHaveBeenCalledTimes(2)
    expect(result.statusCode).toBe(200)
  })

  it('errors with an explicit message when redirects exceed the max (loop guard)', async () => {
    setupResolvedUrl('http://example.com/redirect')
    setupRequestContext()

    // Every hop redirects again — an infinite loop. The service must stop
    // after MAX_REDIRECTS (10) and surface a clear too-many-redirects error
    // rather than silently truncating to a confusing 3xx.
    httpRequestSpy.mockImplementation((_opts: http.RequestOptions, cb: (res: EventEmitter) => void) => {
      queueMicrotask(() => { cb(buildFakeResponse(302, 'Found', '', { location: 'http://example.com/loop' })) })
      return createFakeRequest()
    })

    const result = await httpExecutionService.execute({ requestId: 'rloop', method: 'GET', followRedirects: true })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Too many redirects')
    // 11 dispatches: the initial request + MAX_REDIRECTS (10) followed hops,
    // then the 11th redirect response trips the guard.
    expect(httpRequestSpy).toHaveBeenCalledTimes(11)
  })

  it('does NOT follow a redirect when followRedirects is off', async () => {
    setupResolvedUrl('http://example.com/redirect')
    setupRequestContext()

    httpRequestSpy.mockImplementation((_opts: unknown, cb: (res: EventEmitter) => void) => {
      queueMicrotask(() => { cb(buildFakeResponse(302, 'Found', '', { location: 'http://example.com/final' })) })
      return createFakeRequest()
    })

    const result = await httpExecutionService.execute({ requestId: 'rn', method: 'GET', followRedirects: false })

    expect(result.statusCode).toBe(302)
    expect(result.headers?.location).toBe('http://example.com/final')
  })

  it('stores a Set-Cookie and re-sends it to the same origin', async () => {
    httpExecutionService.clearCookies()
    setupRequestContext()

    // First request: server sets a cookie.
    setupResolvedUrl('http://cookie.example.com/set')
    httpRequestSpy.mockImplementation((_opts: unknown, cb: (res: EventEmitter) => void) => {
      queueMicrotask(() => { cb(buildFakeResponse(200, 'OK', '', { 'set-cookie': 'session=abc; Path=/' })) })
      return createFakeRequest()
    })
    await httpExecutionService.execute({ requestId: 'rc1', method: 'GET' })

    // Second request to the same origin: the stored cookie must be re-sent.
    setupResolvedUrl('http://cookie.example.com/echo')
    let sentCookie: unknown
    httpRequestSpy.mockImplementation((opts: http.RequestOptions, cb: (res: EventEmitter) => void) => {
      sentCookie = opts.headers?.Cookie
      queueMicrotask(() => { cb(buildFakeResponse(200, 'OK', 'ok')) })
      return createFakeRequest()
    })
    await httpExecutionService.execute({ requestId: 'rc2', method: 'GET' })

    expect(sentCookie).toBe('session=abc')
    httpExecutionService.clearCookies()
  })

  it('builds a multipart/form-data body for a form-data request', async () => {
    setupResolvedUrl('http://example.com/upload')
    setupRequestContext({
      fullData: { body: { type: 'form-data', fields: [{ key: 'name', value: 'doggie', enabled: true }] } }
    })

    let writtenBody: unknown
    let contentType: unknown
    httpRequestSpy.mockImplementation((opts: http.RequestOptions, cb: (res: EventEmitter) => void) => {
      contentType = opts.headers?.['Content-Type']
      const req = createFakeRequest()
      req.write = vi.fn((chunk: unknown) => { writtenBody = chunk })
      queueMicrotask(() => { cb(buildFakeResponse(200, 'OK', 'ok')) })
      return req
    })

    const result = await httpExecutionService.execute({ requestId: 'rm', method: 'POST' })

    expect(result.success).toBe(true)
    expect(String(contentType)).toMatch(/^multipart\/form-data; boundary=/)
    const bodyStr = Buffer.isBuffer(writtenBody) ? writtenBody.toString('utf-8') : String(writtenBody)
    expect(bodyStr).toContain('Content-Disposition: form-data; name="name"')
    expect(bodyStr).toContain('doggie')
  })
})

// ---------------------------------------------------------------------------
// Tests – GRPCExecutionService
// ---------------------------------------------------------------------------

describe('GRPCExecutionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when no resolved URL is found', async () => {
    mockedContextService.getResolvedUrl.mockReturnValue(undefined as never)

    const result = await grpcExecutionService.execute({ requestId: 'g1' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('No resolved URL')
  })

  it('fails with a descriptive error when the bound service is not in the proto descriptor', async () => {
    // No inline proto / protoPath → the bundled grpcbin descriptor is used, which
    // does not define `mypackage.MyService`, so dynamic client resolution fails.
    // (Real unary/stream execution against a real service is covered by the
    // grpc-execution e2e + the grpcProtoLoader unit test.)
    setupResolvedUrl('grpc://localhost:50051')
    setupRequestContext({
      fullData: { service: 'mypackage.MyService', grpcMethod: 'SayHello', callType: 'unary', requestMessage: '{"name":"world"}' }
    })

    const result = await grpcExecutionService.execute({ requestId: 'g2' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('mypackage.MyService')
    expect(result.requestUrl).toBe('localhost:50051')
    expect(result.requestMethod).toBe('mypackage.MyService/SayHello')
    expect(result.timings.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('executeUnary: fails with a clear error when the proto declares a streaming method', async () => {
    // Arrange: context resolves to a unary callType, but the proto's streaming
    // flags say it is a server-stream method. The reconciliation in executeUnary
    // must surface this as a descriptive failure instead of crashing in grpc-js.
    setupResolvedUrl('grpc://localhost:50051')
    setupRequestContext({
      fullData: { service: 'pkg.Svc', grpcMethod: 'Subscribe', callType: 'unary', requestMessage: '{}' }
    })
    const fakeClient = { Subscribe: vi.fn(), close: vi.fn() }
    resolveGrpcMethodMock.mockReturnValueOnce({
      client: fakeClient as never,
      requestStream: false,
      responseStream: true   // proto says server-stream, not unary
    })

    const result = await grpcExecutionService.execute({ requestId: 'g3' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('server-stream')
    expect(result.error).toContain('unary')
    // The mismatch is caught before any grpc-js call is made.
    expect(fakeClient.Subscribe).not.toHaveBeenCalled()
  })

  it('connectStreaming: uses the proto-reconciled callType, not the stale request callType', async () => {
    // Arrange: saved callType is 'bidirectional-stream' but the proto only has
    // requestStream=false/responseStream=true → reconcileCallType corrects to
    // 'server-stream'. The connectStreaming path must use that corrected value.
    setupResolvedUrl('grpc://localhost:50051')
    setupRequestContext({
      fullData: { service: 'pkg.Svc', grpcMethod: 'Watch', callType: 'bidirectional-stream', requestMessage: '{}' }
    })

    const serverStream = new EventEmitter() as EventEmitter & { cancel: ReturnType<typeof vi.fn> }
    serverStream.cancel = vi.fn()
    const fakeClient = { Watch: vi.fn().mockReturnValue(serverStream), close: vi.fn() }
    resolveGrpcMethodMock.mockReturnValueOnce({
      client: fakeClient as never,
      requestStream: false,   // proto: no client writes
      responseStream: true    // proto: server pushes frames → 'server-stream'
    })

    let connected = false
    let closed = false
    const handle = grpcExecutionService.connectStreaming({
      requestId: 'g4',
      onConnect: () => { connected = true },
      onMessage: vi.fn(),
      onClose: () => { closed = true }
    })

    // Allow the async IIFE inside connectStreaming to run.
    await new Promise((r) => setTimeout(r, 0))

    expect(connected).toBe(true)
    // The client's Watch method was called without a callback argument (server-stream
    // call signature: client[method](req, metadata, options) — not with a final cb).
    expect(fakeClient.Watch).toHaveBeenCalled()

    // `send` should be a no-op for server-stream (returns false).
    expect(handle.send('', '{}')).toBe(false)

    // Closing via handle cancels the server-stream.
    handle.close()
    // Emit 'end' to let the call settle.
    serverStream.emit('end')
    await new Promise((r) => setTimeout(r, 0))
    expect(closed).toBe(true)
  })

  it('isActive() returns false when no request is running', () => {
    expect(grpcExecutionService.isActive('gx')).toBe(false)
  })

  it('cancel() returns false for unknown request', () => {
    expect(grpcExecutionService.cancel('nonexistent')).toBe(false)
  })
})
