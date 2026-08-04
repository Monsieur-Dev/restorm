import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  withFirewallBypass: firewallBypassSpy,
  // The undici transport reproduces Layer B's HTTP-level firewall flow
  // explicitly (audit record + classify + prompt await) — stub it to
  // allow-everything so transport tests stay transport tests.
  isFirewallBypassed: () => false,
  firewallService: { emit: vi.fn() },
  permissionService: { classify: vi.fn(() => 'allow'), check: vi.fn(() => Promise.resolve('allow' as const)) }
}))

vi.mock('../../../src/main/services/ContextService', () => {
  const resolveValueMock = vi.fn((v: string) => v)
  return {
    contextService: {
      getResolvedUrl: vi.fn(),
      // The dispatch reads its URL through `resolveUrlForRequest`; with no run
      // contexts that is the request's own cached URL, which is what these
      // tests stub through `getResolvedUrl`.
      resolveUrlForRequest: vi.fn(),
      getRequestContext: vi.fn(),
      resolveValue: resolveValueMock,
      // Body path: the executor resolves a text body through the
      // Content-Type-aware entry point. These fixtures declare no JSON
      // Content-Type, so it behaves exactly like `resolveValue` — and
      // reusing the same mock keeps `resolveValue.mockImplementation`
      // overrides in existing tests effective on the body too.
      resolveBodyValue: vi.fn((v: string) => resolveValueMock(v)),
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
vi.mock('http', async (importOriginal) => {
  // Keep STATUS_CODES real — the undici transport maps statusCode → reason
  // phrase through it — while stubbing the request factory the OTHER
  // services (server mode, WebSocket upgrade) still reach for.
  const actual = await importOriginal<typeof import('http')>()
  return { default: { request: vi.fn(), STATUS_CODES: actual.STATUS_CODES }, request: vi.fn(), STATUS_CODES: actual.STATUS_CODES }
})
vi.mock('https', () => ({ default: { request: vi.fn() }, request: vi.fn() }))
vi.mock('undici', () => ({ request: vi.fn() }))

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
import { request as undiciRequestMock } from 'undici'

const mockedContextService = vi.mocked(contextService)
const resolveGrpcMethodMock = vi.mocked(grpcProtoLoader.resolveGrpcMethod)
interface UndiciCallOpts { headers: Record<string, string>; body?: unknown; signal: AbortSignal }
type UndiciResponseLike = ReturnType<typeof buildUndiciResponse>
const undiciRequestSpy = vi.mocked(undiciRequestMock) as unknown as MockInstance<(url: URL, opts: UndiciCallOpts) => Promise<UndiciResponseLike>>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an undici-shaped response: statusCode + headers + async-iterable body. */
function buildUndiciResponse(
  statusCode: number,
  body: string | Buffer,
  headers: Record<string, string> = {}
): { statusCode: number; headers: Record<string, string>; body: AsyncGenerator<Buffer> } {
  const buf = typeof body === 'string' ? Buffer.from(body) : body
  return {
    statusCode,
    headers,
    body: (async function * (): AsyncGenerator<Buffer> {
      await Promise.resolve()
      if (buf.length > 0) yield buf
    })()
  }
}

function setupResolvedUrl(url: string): void {
  mockedContextService.getResolvedUrl.mockReturnValue({ resolvedUrl: url, resolvedParts: [] })
  mockedContextService.resolveUrlForRequest.mockReturnValue({ resolvedUrl: url, resolvedParts: [] })
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when no resolved URL is found', async () => {
    mockedContextService.getResolvedUrl.mockReturnValue(undefined as never)
    mockedContextService.resolveUrlForRequest.mockReturnValue(undefined as never)

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

    undiciRequestSpy.mockResolvedValue(buildUndiciResponse(200, '{"ok":true}'))

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

    let sentBody: unknown
    undiciRequestSpy.mockImplementation((_url, opts) => {
      expect(opts.headers).toHaveProperty('Authorization', 'Bearer abc')
      expect(opts.headers).not.toHaveProperty('X-Disabled')
      sentBody = opts.body
      return Promise.resolve(buildUndiciResponse(201, ''))
    })

    const result = await httpExecutionService.execute({ requestId: 'r4', method: 'POST' })

    expect(result.success).toBe(true)
    expect(result.statusCode).toBe(201)
    expect(sentBody).toBe('{"hello":"world"}')
  })

  it('resolves a Handlebars header KEY, not just the value — unconditionally, like a query/path param key', async () => {
    setupResolvedUrl('http://example.com/api')
    setupRequestContext({
      keyValueGroups: new Map([['headers', [{ key: '{{headerNameVar}}', value: 'templated-value', enabled: true }]]])
    })
    // Header KEYS have no ValueType to gate on (unlike the value), so —
    // same as the URL and the path/query param keys — the substitution is
    // unconditional, not opt-in via an ExpressionValue.
    mockedContextService.resolveValue.mockImplementation((v: string) => v.replace('{{headerNameVar}}', 'X-Templated-Header'))

    undiciRequestSpy.mockImplementation((_url, opts) => {
      expect(opts.headers).toHaveProperty('X-Templated-Header', 'templated-value')
      expect(opts.headers).not.toHaveProperty('{{headerNameVar}}')
      return Promise.resolve(buildUndiciResponse(200, ''))
    })

    const result = await httpExecutionService.execute({ requestId: 'r-header-key', method: 'GET' })

    expect(result.success).toBe(true)
    expect(undiciRequestSpy).toHaveBeenCalled()
  })

  it('handles network errors gracefully', async () => {
    setupResolvedUrl('http://example.com/api')
    setupRequestContext()

    undiciRequestSpy.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await httpExecutionService.execute({ requestId: 'r5', method: 'GET' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('ECONNREFUSED')
  })

  it('handles timeout by rejecting with timeout error', async () => {
    setupResolvedUrl('http://example.com/slow')
    setupRequestContext()

    undiciRequestSpy.mockRejectedValue(Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' }))

    const result = await httpExecutionService.execute({ requestId: 'r6', method: 'GET', timeout: 100 })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Request timeout')
  })

  it('cancel() aborts an active request and returns true', async () => {
    setupResolvedUrl('http://example.com/api')
    setupRequestContext()

    // A request that only settles when its abort signal fires.
    undiciRequestSpy.mockImplementation((_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { code: 'UND_ERR_ABORTED' }))
        }, { once: true })
      })
    )

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
    undiciRequestSpy.mockResolvedValue(buildUndiciResponse(200, pngBytes, { 'content-type': 'image/png' }))

    const result = await httpExecutionService.execute({ requestId: 'rb', method: 'GET' })

    expect(result.success).toBe(true)
    expect(result.bodyIsBase64).toBe(true)
    expect(result.body).toBe(pngBytes.toString('base64'))
  })

  it('follows a redirect when followRedirects is on (default)', async () => {
    setupResolvedUrl('http://example.com/redirect')
    setupRequestContext()

    let hop = 0
    undiciRequestSpy.mockImplementation((url) => {
      if (hop === 0) {
        hop++
        return Promise.resolve(buildUndiciResponse(302, '', { location: 'http://example.com/final' }))
      }
      expect(url.pathname).toBe('/final')
      return Promise.resolve(buildUndiciResponse(200, 'arrived'))
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
    undiciRequestSpy.mockImplementation(() => {
      const current = hop++
      if (current === 0) return Promise.resolve(buildUndiciResponse(302, '', { location: 'http://example.com/second' }))
      if (current === 1) return Promise.resolve(buildUndiciResponse(302, '', { location: 'http://169.254.169.254/latest/meta-data' }))
      return Promise.resolve(buildUndiciResponse(200, 'meta'))
    })

    const result = await httpExecutionService.execute({ requestId: 'rssrf', method: 'GET', followRedirects: true })

    // Three HTTP hops happened; the bypass wrapped hop 0 AND hop 1 (2x)
    // but NOT hop 2 — the 2nd redirect went through the firewall's explicit
    // classify flow (mocked to allow) instead.
    expect(undiciRequestSpy).toHaveBeenCalledTimes(3)
    expect(firewallBypassSpy).toHaveBeenCalledTimes(2)
    expect(result.statusCode).toBe(200)
  })

  it('errors with an explicit message when redirects exceed the max (loop guard)', async () => {
    setupResolvedUrl('http://example.com/redirect')
    setupRequestContext()

    // Every hop redirects again — an infinite loop. The service must stop
    // after MAX_REDIRECTS (10) and surface a clear too-many-redirects error
    // rather than silently truncating to a confusing 3xx.
    undiciRequestSpy.mockImplementation(() => Promise.resolve(buildUndiciResponse(302, '', { location: 'http://example.com/loop' })))

    const result = await httpExecutionService.execute({ requestId: 'rloop', method: 'GET', followRedirects: true })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Too many redirects')
    // 11 dispatches: the initial request + MAX_REDIRECTS (10) followed hops,
    // then the 11th redirect response trips the guard.
    expect(undiciRequestSpy).toHaveBeenCalledTimes(11)
  })

  it('does NOT follow a redirect when followRedirects is off', async () => {
    setupResolvedUrl('http://example.com/redirect')
    setupRequestContext()

    undiciRequestSpy.mockResolvedValue(buildUndiciResponse(302, '', { location: 'http://example.com/final' }))

    const result = await httpExecutionService.execute({ requestId: 'rn', method: 'GET', followRedirects: false })

    expect(result.statusCode).toBe(302)
    expect(result.headers?.location).toBe('http://example.com/final')
  })

  it('stores a Set-Cookie and re-sends it to the same origin', async () => {
    httpExecutionService.clearCookies()
    setupRequestContext()

    // First request: server sets a cookie.
    setupResolvedUrl('http://cookie.example.com/set')
    undiciRequestSpy.mockResolvedValue(buildUndiciResponse(200, '', { 'set-cookie': 'session=abc; Path=/' }))
    await httpExecutionService.execute({ requestId: 'rc1', method: 'GET' })

    // Second request to the same origin: the stored cookie must be re-sent.
    setupResolvedUrl('http://cookie.example.com/echo')
    let sentCookie: unknown
    undiciRequestSpy.mockImplementation((_url, opts) => {
      sentCookie = opts.headers.Cookie
      return Promise.resolve(buildUndiciResponse(200, 'ok'))
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
    undiciRequestSpy.mockImplementation((_url, opts) => {
      contentType = opts.headers['Content-Type']
      writtenBody = opts.body
      return Promise.resolve(buildUndiciResponse(200, 'ok'))
    })

    const result = await httpExecutionService.execute({ requestId: 'rm', method: 'POST' })

    expect(result.success).toBe(true)
    expect(String(contentType)).toMatch(/^multipart\/form-data; boundary=/)
    const bodyStr = Buffer.isBuffer(writtenBody) ? writtenBody.toString('utf-8') : String(writtenBody)
    expect(bodyStr).toContain('Content-Disposition: form-data; name="name"')
    expect(bodyStr).toContain('doggie')
  })

  describe('file body', () => {
    let dir: string

    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'restorm-http-file-body-')) })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    it('sends the file bytes verbatim, with Content-Type guessed from extension', async () => {
      const filePath = join(dir, 'payload.json')
      writeFileSync(filePath, '{"a":1}')
      setupResolvedUrl('http://example.com/upload')
      setupRequestContext({ fullData: { body: { type: 'file', path: filePath } } })

      let writtenBody: unknown
      let headers: Record<string, string> | undefined
      undiciRequestSpy.mockImplementation((_url, opts) => {
        headers = opts.headers
        writtenBody = opts.body
        return Promise.resolve(buildUndiciResponse(200, 'ok'))
      })

      const result = await httpExecutionService.execute({ requestId: 'rf1', method: 'PUT' })

      expect(result.success).toBe(true)
      expect(Buffer.isBuffer(writtenBody)).toBe(true)
      expect((writtenBody as Buffer).toString('utf-8')).toBe('{"a":1}')
      expect(headers?.['Content-Type']).toBe('application/json')
      expect(headers?.['Content-Length']).toBe(String(Buffer.byteLength('{"a":1}')))
    })

    it('does not override a Content-Type the user already set', async () => {
      const filePath = join(dir, 'payload.bin')
      writeFileSync(filePath, 'raw-bytes')
      setupResolvedUrl('http://example.com/upload')
      setupRequestContext({
        keyValueGroups: new Map([['headers', [{ key: 'Content-Type', value: 'application/octet-stream; charset=x', enabled: true }]]]),
        fullData: { body: { type: 'file', path: filePath } }
      })

      let headers: Record<string, string> | undefined
      undiciRequestSpy.mockImplementation((_url, opts) => {
        headers = opts.headers
        return Promise.resolve(buildUndiciResponse(200, 'ok'))
      })

      const result = await httpExecutionService.execute({ requestId: 'rf2', method: 'PUT' })

      expect(result.success).toBe(true)
      expect(headers?.['Content-Type']).toBe('application/octet-stream; charset=x')
    })

    it('fails with a descriptive error when the file does not exist', async () => {
      const missingPath = join(dir, 'does-not-exist.bin')
      setupResolvedUrl('http://example.com/upload')
      setupRequestContext({ fullData: { body: { type: 'file', path: missingPath } } })

      const result = await httpExecutionService.execute({ requestId: 'rf3', method: 'PUT' })

      expect(result.success).toBe(false)
      expect(result.error).toContain(missingPath)
      expect(undiciRequestSpy).not.toHaveBeenCalled()
    })
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
    mockedContextService.resolveUrlForRequest.mockReturnValue(undefined as never)

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

  it('resolves a Handlebars metadata KEY, not just the value — unconditionally, like a header key', async () => {
    // gRPC metadata is registered under the request's `headers` KeyValue
    // group; the KEY has no ValueType to gate on, so it resolves
    // unconditionally through Handlebars (same as an HTTP header key).
    setupResolvedUrl('grpc://localhost:50051')
    setupRequestContext({
      fullData: { service: 'pkg.Svc', grpcMethod: 'SayHello', callType: 'unary', requestMessage: '{}' },
      keyValueGroups: new Map([['headers', [{ key: '{{metaKeyVar}}', value: 'templated-value', enabled: true }]]])
    })
    mockedContextService.resolveValue.mockImplementation((v: string) => v.replace('{{metaKeyVar}}', 'x-templated-meta'))

    let capturedMetadata: { get: (k: string) => string[] } | undefined
    const fakeClient = {
      SayHello: vi.fn((_req: unknown, metadata: { get: (k: string) => string[] }, _opts: unknown, cb: (err: null, res: object) => void) => {
        capturedMetadata = metadata
        cb(null, {})
        return { cancel: vi.fn() }
      }),
      close: vi.fn()
    }
    resolveGrpcMethodMock.mockReturnValueOnce({ client: fakeClient as never, requestStream: false, responseStream: false })

    const result = await grpcExecutionService.execute({ requestId: 'g-meta-key' })

    expect(result.success).toBe(true)
    expect(capturedMetadata?.get('x-templated-meta')).toEqual(['templated-value'])
    expect(capturedMetadata?.get('{{metaKeyVar}}')).toEqual([])
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
