import { describe, it, expect, vi, beforeEach } from 'vitest'
import type http from 'http'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Mocks – vi.mock factories are hoisted; they must not reference outer vars.
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

vi.mock('../../../src/main/services/ContextService', () => ({
  contextService: {
    getResolvedUrl: vi.fn(),
    getRequestContext: vi.fn(),
    resolveValue: vi.fn((v: string) => v),
    transformAllValues: vi.fn()
  }
}))

// For http/https we return an object whose `request` is a vi.fn().
// We grab the reference *after* the mock is set up via `await import(…)`.
vi.mock('http', () => ({ default: { request: vi.fn() }, request: vi.fn() }))
vi.mock('https', () => ({ default: { request: vi.fn() }, request: vi.fn() }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { httpExecutionService } from '../../../src/main/services/HTTPExecutionService'
import { grpcExecutionService } from '../../../src/main/services/GRPCExecutionService'
import { contextService } from '../../../src/main/services/ContextService'
import httpMod from 'http'

const mockedContextService = vi.mocked(contextService)
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
})

// ---------------------------------------------------------------------------
// Tests – GRPCExecutionService
// ---------------------------------------------------------------------------

describe('GRPCExecutionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when no resolved URL is found', () => {
    mockedContextService.getResolvedUrl.mockReturnValue(undefined as never)

    const result = grpcExecutionService.execute({ requestId: 'g1' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('No resolved URL')
  })

  it('returns UNIMPLEMENTED placeholder (status 12)', () => {
    setupResolvedUrl('grpc://localhost:50051')
    setupRequestContext({
      fullData: { service: 'mypackage.MyService', grpcMethod: 'SayHello', requestMessage: '{"name":"world"}' }
    })

    const result = grpcExecutionService.execute({ requestId: 'g2' })

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(12)
    expect(result.statusMessage).toContain('gRPC')
    expect(result.requestUrl).toBe('grpc://localhost:50051')
    expect(result.requestMethod).toBe('mypackage.MyService/SayHello')
    expect(result.error).toContain('not fully implemented')
    expect(result.timings.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('isActive() returns false when no request is running', () => {
    expect(grpcExecutionService.isActive('gx')).toBe(false)
  })

  it('cancel() returns false for unknown request', () => {
    expect(grpcExecutionService.cancel('nonexistent')).toBe(false)
  })
})
