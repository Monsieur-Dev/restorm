/**
 * Unit tests for AuthenticationCacheService — cache hit / miss /
 * expired / failure / handlebars-resolution paths.
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

import { authenticationCacheService } from '../../../src/main/services/AuthenticationCacheService'
import { AuthenticationRequest } from '../../../src/shared/models'
import { StringValue } from '../../../src/shared/types/collections'

function makeAuth(overrides: Partial<Parameters<typeof AuthenticationRequest.fromPlain>[0]> = {}): AuthenticationRequest {
  return AuthenticationRequest.fromPlain({
    id: overrides.id ?? 'auth-1',
    name: 'token',
    url: 'https://idp/token',
    method: 'POST',
    producedHeaders: [
      { key: 'Authorization', value: { type: 'expression', value: 'Bearer {{access_token}}' } as unknown as StringValue }
    ],
    authErrorCodes: [401, 403],
    ...overrides
  })
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
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'abc', token_type: 'Bearer', expires_in: 3600 }))
    )
    const headers = await authenticationCacheService.getHeaders(req, executor)
    expect(executor).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: 'Bearer abc' })
  })

  it('returns cached headers without re-running when fresh', async () => {
    const req = makeAuth({ expirationExpression: '{{expires_in}}' })
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'abc', expires_in: 3600 }))
    )
    await authenticationCacheService.getHeaders(req, executor)
    const again = await authenticationCacheService.getHeaders(req, executor)
    expect(executor).toHaveBeenCalledTimes(1) // still just once
    expect(again).toEqual({ Authorization: 'Bearer abc' })
  })

  it('refreshes when the entry has expired', async () => {
    const req = makeAuth({ expirationExpression: '{{expires_in}}' })
    const executor = vi.fn()
      .mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'old', expires_in: 0.001 })))
      .mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'new', expires_in: 60 })))
    await authenticationCacheService.getHeaders(req, executor)
    // TTL of 1 ms → expire immediately.
    await new Promise((r) => setTimeout(r, 5))
    const headers = await authenticationCacheService.getHeaders(req, executor)
    expect(executor).toHaveBeenCalledTimes(2)
    expect(headers).toEqual({ Authorization: 'Bearer new' })
  })

  it('throws on non-2xx auth response', async () => {
    const req = makeAuth()
    const executor = vi.fn().mockResolvedValue(makeResult('{"error":"bad creds"}', 401))
    await expect(authenticationCacheService.getHeaders(req, executor)).rejects.toThrow(/Authentication failed/)
    expect(authenticationCacheService.hasEntry(req.id)).toBe(false)
  })

  it('propagates when executor itself throws', async () => {
    const req = makeAuth()
    const executor = vi.fn().mockRejectedValue(new Error('network down'))
    await expect(authenticationCacheService.getHeaders(req, executor)).rejects.toThrow(/network down/)
    expect(authenticationCacheService.hasEntry(req.id)).toBe(false)
  })

  it('concatenates multiple producedHeaders entries', async () => {
    const req = AuthenticationRequest.fromPlain({
      id: 'auth-multi',
      name: 'token',
      producedHeaders: [
        { key: 'Authorization', value: { type: 'expression', value: '{{token_type}} {{access_token}}' } as unknown as StringValue },
        { key: 'X-Tenant', value: { type: 'expression', value: '{{tenant}}' } as unknown as StringValue }
      ]
    })
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', tenant: 'acme' }))
    )
    const headers = await authenticationCacheService.getHeaders(req, executor)
    expect(headers).toEqual({ Authorization: 'Bearer tok', 'X-Tenant': 'acme' })
  })

  it('invalidate drops the entry so next getHeaders refetches', async () => {
    const req = makeAuth()
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'v1' }))
    )
    await authenticationCacheService.getHeaders(req, executor)
    authenticationCacheService.invalidate(req.id)
    executor.mockResolvedValueOnce(makeResult(JSON.stringify({ access_token: 'v2' })))
    const headers = await authenticationCacheService.getHeaders(req, executor)
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
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ tok: 'abc' }))
    )
    const headers = await authenticationCacheService.getHeaders(req, executor)
    expect(headers).toEqual({ Authorization: 'abc' })
  })

  it('accepts non-JSON response body (handlebars sees { body })', async () => {
    const req = AuthenticationRequest.fromPlain({
      id: 'auth-raw',
      name: 'token',
      producedHeaders: [
        { key: 'Authorization', value: { type: 'expression', value: 'Bearer {{body}}' } as unknown as StringValue }
      ]
    })
    const executor = vi.fn().mockResolvedValue(makeResult('raw-token'))
    const headers = await authenticationCacheService.getHeaders(req, executor)
    expect(headers).toEqual({ Authorization: 'Bearer raw-token' })
  })

  it('coalesces concurrent getHeaders into a single executor call', async () => {
    const req = makeAuth()
    // Hold the executor open until we've queued several concurrent
    // callers — each one must observe cache-miss and would normally
    // fire its own refresh. The coalesce lets the first run stand
    // for all of them.
    let release: (value: ReturnType<typeof makeResult>) => void = () => undefined
    const gate = new Promise<ReturnType<typeof makeResult>>((resolve) => { release = resolve })
    const executor = vi.fn().mockImplementation(() => gate)

    const pending = [0, 1, 2, 3, 4].map(() => authenticationCacheService.getHeaders(req, executor))
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
    // Seed a cache entry so `getHeaders` would normally short-circuit;
    // the retry path calls `invalidate` then `refresh` explicitly and
    // must coalesce just like the cache-miss path.
    await authenticationCacheService.getHeaders(
      makeAuth(),
      vi.fn().mockResolvedValue(makeResult(JSON.stringify({ access_token: 'old', expires_in: 3600 })))
    )
    authenticationCacheService.invalidate(req.id)

    let release: (value: ReturnType<typeof makeResult>) => void = () => undefined
    const gate = new Promise<ReturnType<typeof makeResult>>((resolve) => { release = resolve })
    const executor = vi.fn().mockImplementation(() => gate)

    const pending = [0, 1, 2].map(() => authenticationCacheService.refresh(req, executor))
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
    const failing = vi.fn().mockRejectedValue(new Error('network down'))
    await expect(authenticationCacheService.getHeaders(req, failing)).rejects.toThrow('network down')
    // Slot should be released — not leaked into the next caller.
    const recovering = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'ok', expires_in: 3600 }))
    )
    const headers = await authenticationCacheService.getHeaders(req, recovering)
    expect(recovering).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: 'Bearer ok' })
  })

  it('evicts the cache entry when the auth request is deleted', async () => {
    authenticationCacheService.initialize()
    const req = makeAuth({ id: 'auth-del-1' })
    const executor = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'abc', expires_in: 3600 }))
    )
    await authenticationCacheService.getHeaders(req, executor)
    expect(authenticationCacheService.hasEntry(req.id)).toBe(true)

    // Simulate the collection fire-and-forget `REQUEST_DELETED` for this id.
    const handler = eventHandlers.get('document:request:deleted')
    expect(handler).toBeDefined()
    handler?.({ id: req.id, type: 'request' })
    expect(authenticationCacheService.hasEntry(req.id)).toBe(false)

    // The next call must refetch — proving the in-flight slot was also cleared.
    const executor2 = vi.fn().mockResolvedValue(
      makeResult(JSON.stringify({ access_token: 'zzz', expires_in: 3600 }))
    )
    const headers = await authenticationCacheService.getHeaders(req, executor2)
    expect(executor2).toHaveBeenCalledTimes(1)
    expect(headers).toEqual({ Authorization: 'Bearer zzz' })
  })
})
