/**
 * Unit tests for AuthenticationCacheService — cache hit / miss /
 * expired / failure / handlebars-resolution / per-shape isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  }
}))
// Event-bus mock that actually delivers `emit` to subscribers — the
// service's `initialize()` subscribes to REQUEST_DELETED and we want
// to exercise that handler in tests.
const eventHandlers = new Map<string, (payload: unknown) => void>()
vi.mock('electron-core-ui/main', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  eventBusService: {
    subscribe: vi.fn((event: string, handler: (payload: unknown) => void) => {
      eventHandlers.set(event, handler)
      return { unsubscribe: () => eventHandlers.delete(event) }
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      eventHandlers.get(event)?.(payload)
    })
  }
}))

import { authenticationCacheService, type ResolvedAuthShape } from '../../../src/main/services/AuthenticationCacheService'
import { AuthenticationRequest } from '../../../src/shared/models'
import { StringValue } from '../../../src/shared/types/collections'

function makeAuth(overrides: Partial<Parameters<typeof AuthenticationRequest.fromPlain>[0]> = {}): AuthenticationRequest {
  return AuthenticationRequest.fromPlain({
    id: overrides.id ?? 'auth-1',
    name: 'token',
    url: 'https://idp/token',
    method: 'POST',
    producedHeaders: [
      { key: 'Authorization', value: { type: 'expression', value: 'Bearer {{access_token}}' } as unknown as StringValue, enabled: true }
    ],
    authErrorCodes: [401, 403],
    ...overrides
  })
}

function makeShape(overrides: Partial<ResolvedAuthShape> = {}): ResolvedAuthShape {
  return {
    method: 'POST',
    url: 'https://idp/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'client_id=acme',
    ...overrides
  }
}

function makeResult(body: string, statusCode = 200): Awaited<ReturnType<typeof import('../../../src/main/services/HTTPExecutionService').httpExecutionService.execute>> {
  return {
    requestId: 'auth-1',
    success: true,
    statusCode,
    statusText: statusCode === 200 ? 'OK' : 'Err',
    headers: {},
    body,
    timings: { startedAt: new Date().toISOString(), durationMs: 10 }
  }
}

describe('AuthenticationCacheService', () => {
  beforeEach(() => {
    authenticationCacheService.clear()
  })

  it('runs the auth request on cache miss and returns resolved headers', async () => {
    const req = makeAuth()
    const shape = makeShape()
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'abc', token_type: 'Bearer', expires_in: 3600 }))
    )
    const headers = await authenticationCacheService.getHeaders(req, shape, executor)
    expect(executor).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: 'Bearer abc' })
  })

  it('returns cached headers without re-running when fresh', async () => {
    const req = makeAuth({ expirationExpression: '{{expires_in}}' })
    const shape = makeShape()
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'abc', expires_in: 3600 }))
    )
    await authenticationCacheService.getHeaders(req, shape, executor)
    const again = await authenticationCacheService.getHeaders(req, shape, executor)
    expect(executor).toHaveBeenCalledTimes(1) // still just once
    expect(again).toEqual({ Authorization: 'Bearer abc' })
  })

  it('refreshes when the entry has expired', async () => {
    const req = makeAuth({ expirationExpression: '{{expires_in}}' })
    const shape = makeShape()
    const executor = vi.fn()
      .mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'old', expires_in: 0.001 })))
      .mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'new', expires_in: 60 })))
    await authenticationCacheService.getHeaders(req, shape, executor)
    // TTL of 1 ms → expire immediately.
    await new Promise((r) => setTimeout(r, 5))
    const headers = await authenticationCacheService.getHeaders(req, shape, executor)
    expect(executor).toHaveBeenCalledTimes(2)
    expect(headers).toEqual({ Authorization: 'Bearer new' })
  })

  it('throws on non-2xx auth response', async () => {
    const req = makeAuth()
    const shape = makeShape()
    const executor = vi.fn().mockResolvedValue(makeResult('{"error":"bad creds"}', 401))
    await expect(authenticationCacheService.getHeaders(req, shape, executor)).rejects.toThrow(/Authentication failed/)
    expect(authenticationCacheService.hasEntry(req, shape)).toBe(false)
  })

  it('propagates when executor itself throws', async () => {
    const req = makeAuth()
    const shape = makeShape()
    const executor = vi.fn().mockRejectedValue(new Error('network down'))
    await expect(authenticationCacheService.getHeaders(req, shape, executor)).rejects.toThrow(/network down/)
    expect(authenticationCacheService.hasEntry(req, shape)).toBe(false)
  })

  it('concatenates multiple producedHeaders entries', async () => {
    const req = AuthenticationRequest.fromPlain({
      id: 'auth-multi',
      name: 'token',
      producedHeaders: [
        { key: 'Authorization', value: { type: 'expression', value: '{{token_type}} {{access_token}}' } as unknown as StringValue, enabled: true },
        { key: 'X-Tenant', value: { type: 'expression', value: '{{tenant}}' } as unknown as StringValue, enabled: true }
      ]
    })
    const shape = makeShape()
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', tenant: 'acme' }))
    )
    const headers = await authenticationCacheService.getHeaders(req, shape, executor)
    expect(headers).toEqual({ Authorization: 'Bearer tok', 'X-Tenant': 'acme' })
  })

  it('invalidate drops the entry so next getHeaders refetches', async () => {
    const req = makeAuth()
    const shape = makeShape()
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'v1' }))
    )
    await authenticationCacheService.getHeaders(req, shape, executor)
    authenticationCacheService.invalidate(req, shape)
    executor.mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'v2' })))
    const headers = await authenticationCacheService.getHeaders(req, shape, executor)
    expect(executor).toHaveBeenCalledTimes(2)
    expect(headers).toEqual({ Authorization: 'Bearer v2' })
  })

  it('drops disabled producedHeaders', async () => {
    const req = AuthenticationRequest.fromPlain({
      id: 'auth-disabled',
      name: 'token',
      producedHeaders: [
        { key: 'Authorization', value: { type: 'expression', value: '{{tok}}' } as unknown as StringValue, enabled: true },
        { key: 'X-Skip', value: { type: 'expression', value: 'nope' } as unknown as StringValue, enabled: false }
      ]
    })
    const shape = makeShape()
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ tok: 'abc' }))
    )
    const headers = await authenticationCacheService.getHeaders(req, shape, executor)
    expect(headers).toEqual({ Authorization: 'abc' })
  })

  it('accepts non-JSON response body (handlebars sees { body })', async () => {
    const req = AuthenticationRequest.fromPlain({
      id: 'auth-raw',
      name: 'token',
      producedHeaders: [
        { key: 'Authorization', value: { type: 'expression', value: 'Bearer {{body}}' } as unknown as StringValue, enabled: true }
      ]
    })
    const shape = makeShape()
    const executor = vi.fn().mockResolvedValue(makeResult('raw-token'))
    const headers = await authenticationCacheService.getHeaders(req, shape, executor)
    expect(headers).toEqual({ Authorization: 'Bearer raw-token' })
  })

  it('coalesces concurrent getHeaders into a single executor call', async () => {
    const req = makeAuth()
    const shape = makeShape()
    // Hold the executor open until we've queued several concurrent
    // callers — each one must observe cache-miss and would normally
    // fire its own refresh. The coalesce lets the first run stand
    // for all of them.
    let release: (value: ReturnType<typeof makeResult>) => void = () => undefined
    const gate = new Promise<ReturnType<typeof makeResult>>((resolve) => { release = resolve })
    const executor = vi.fn().mockImplementation(() => gate)

    const pending = [0, 1, 2, 3, 4].map(() => authenticationCacheService.getHeaders(req, shape, executor))
    // Small tick so the first caller has registered the inflight promise.
    await new Promise((r) => setTimeout(r, 0))
    release(makeResult(JSON.stringify({ access_token: 'abc', expires_in: 3600 })))

    const results = await Promise.all(pending)
    expect(executor).toHaveBeenCalledTimes(1)
    for (const headers of results) {
      expect(headers).toEqual({ Authorization: 'Bearer abc' })
    }
  })

  it('coalesces concurrent refresh calls hit by the auth-error retry path', async () => {
    const req = makeAuth()
    const shape = makeShape()
    // Seed a cache entry so `getHeaders` would normally short-circuit;
    // the retry path calls `invalidate` then `refresh` explicitly and
    // must coalesce just like the cache-miss path.
    await authenticationCacheService.getHeaders(
      makeAuth(),
      shape,
      vi.fn().mockResolvedValue(makeResult(JSON.stringify({ access_token: 'old', expires_in: 3600 })))
    )
    authenticationCacheService.invalidate(req, shape)

    let release: (value: ReturnType<typeof makeResult>) => void = () => undefined
    const gate = new Promise<ReturnType<typeof makeResult>>((resolve) => { release = resolve })
    const executor = vi.fn().mockImplementation(() => gate)

    const pending = [0, 1, 2].map(() => authenticationCacheService.refresh(req, shape, executor))
    await new Promise((r) => setTimeout(r, 0))
    release(makeResult(JSON.stringify({ access_token: 'new', expires_in: 3600 })))

    const results = await Promise.all(pending)
    expect(executor).toHaveBeenCalledTimes(1)
    for (const headers of results) {
      expect(headers).toEqual({ Authorization: 'Bearer new' })
    }
  })

  it('clears the inflight slot after a failure so later refreshes can run', async () => {
    const req = makeAuth()
    const shape = makeShape()
    const failing = vi.fn().mockRejectedValue(new Error('network down'))
    await expect(authenticationCacheService.getHeaders(req, shape, failing)).rejects.toThrow('network down')
    // Slot should be released — not leaked into the next caller.
    const recovering = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'ok', expires_in: 3600 }))
    )
    const headers = await authenticationCacheService.getHeaders(req, shape, recovering)
    expect(recovering).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: 'Bearer ok' })
  })

  it('evicts every entry minted from a deleted auth request', async () => {
    authenticationCacheService.initialize()
    const req = makeAuth({ id: 'auth-del-1' })
    // Two entries from the same auth route, distinguishable by their
    // resolved bodies (env-A vs env-B). REQUEST_DELETED must drop
    // both of them — not just the most recent shape — so a recreated
    // route doesn't reuse stale headers.
    const shapeA = makeShape({ body: 'client_id=A' })
    const shapeB = makeShape({ body: 'client_id=B' })
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'abc', expires_in: 3600 }))
    )
    await authenticationCacheService.getHeaders(req, shapeA, executor)
    await authenticationCacheService.getHeaders(req, shapeB, executor)
    expect(authenticationCacheService.hasEntry(req, shapeA)).toBe(true)
    expect(authenticationCacheService.hasEntry(req, shapeB)).toBe(true)

    // Simulate the collection fire-and-forget `REQUEST_DELETED` for this id.
    const handler = eventHandlers.get('document:request:deleted')
    expect(handler).toBeDefined()
    handler?.({ id: req.id, type: 'request' })
    expect(authenticationCacheService.hasEntry(req, shapeA)).toBe(false)
    expect(authenticationCacheService.hasEntry(req, shapeB)).toBe(false)

    // The next call must refetch — proving the in-flight slot was also cleared.
    const executor2 = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'zzz', expires_in: 3600 }))
    )
    const headers = await authenticationCacheService.getHeaders(req, shapeA, executor2)
    expect(executor2).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: 'Bearer zzz' })
  })

  it('round-trip A → B → A: third call hits the cache for env A', async () => {
    const req = makeAuth({ expirationExpression: '{{expires_in}}' })
    const shapeA = makeShape({ body: 'client_id=A' })
    const shapeB = makeShape({ body: 'client_id=B' })
    const executor = vi.fn()
      .mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'tokA', expires_in: 3600 })))
      .mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'tokB', expires_in: 3600 })))

    const headersA = await authenticationCacheService.getHeaders(req, shapeA, executor)
    expect(headersA).toEqual({ Authorization: 'Bearer tokA' })
    expect(executor).toHaveBeenCalledTimes(1)

    const headersB = await authenticationCacheService.getHeaders(req, shapeB, executor)
    expect(headersB).toEqual({ Authorization: 'Bearer tokB' })
    expect(executor).toHaveBeenCalledTimes(2)

    // Switching back to A reuses the entry stored on the first call —
    // the executor count stays at 2.
    const headersA2 = await authenticationCacheService.getHeaders(req, shapeA, executor)
    expect(headersA2).toEqual({ Authorization: 'Bearer tokA' })
    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('two routes with same shape but different producedHeaders do not share entries', async () => {
    const reqA = AuthenticationRequest.fromPlain({
      id: 'route-A',
      name: 'route A',
      producedHeaders: [
        { key: 'Authorization', value: { type: 'expression', value: 'Bearer {{access_token}}' } as unknown as StringValue, enabled: true }
      ]
    })
    const reqB = AuthenticationRequest.fromPlain({
      id: 'route-B',
      name: 'route B',
      producedHeaders: [
        { key: 'X-Auth', value: { type: 'expression', value: '{{access_token}}' } as unknown as StringValue, enabled: true }
      ]
    })
    const shape = makeShape()
    const executor = vi.fn()
      .mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'tokA' })))
      .mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'tokB' })))

    const headersA = await authenticationCacheService.getHeaders(reqA, shape, executor)
    expect(headersA).toEqual({ Authorization: 'Bearer tokA' })

    // Same wire shape, but route B emits a different header. Cache must
    // NOT serve route A's entry to route B.
    const headersB = await authenticationCacheService.getHeaders(reqB, shape, executor)
    expect(headersB).toEqual({ 'X-Auth': 'tokB' })
    expect(executor).toHaveBeenCalledTimes(2)
  })
})
