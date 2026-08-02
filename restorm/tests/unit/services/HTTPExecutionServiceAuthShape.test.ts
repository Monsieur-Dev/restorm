/**
 * The auth sub-request's own outgoing headers — the shape
 * `HTTPExecutionService` resolves before handing it to the auth cache for
 * dispatch. A header NAME has no ValueType to gate on, so (like the auth URL
 * and the url-encoded body field keys) it resolves through Handlebars
 * unconditionally; left verbatim, `{{…}}` is not a valid HTTP token and the
 * transport rejects the call.
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createPubSub: () => ({ publish: vi.fn(), subscribe: vi.fn(), asyncIterator: vi.fn() }),
  withFirewallBypass: <T>(fn: () => T): T => fn(),
  isFirewallBypassed: () => false,
  firewallService: { emit: vi.fn() },
  permissionService: { classify: vi.fn(() => 'allow'), check: vi.fn(() => Promise.resolve('allow' as const)) }
}))

vi.mock('../../../src/main/services/ContextService', () => {
  const resolveValueMock = vi.fn((v: string) => v)
  return {
    contextService: {
      getResolvedUrl: vi.fn(),
      getRequestContext: vi.fn(),
      resolveValue: resolveValueMock,
      resolveBodyValue: vi.fn((v: string) => resolveValueMock(v)),
      resolveKeyValueForRequest: vi.fn((kv: { value: unknown }) => {
        const raw = typeof kv.value === 'string' ? kv.value : String(kv.value)
        return resolveValueMock(raw)
      }),
      transformAllValues: vi.fn(),
      collectEnvironmentSecrets: vi.fn(() => []),
      refreshEnvironmentContext: vi.fn(() => undefined)
    }
  }
})

// Pass-through cache: run the executor with the shape the service resolved, so
// the auth call really reaches the (mocked) transport and its headers can be
// asserted. Injecting nothing back keeps the downstream request unaffected.
vi.mock('../../../src/main/services/AuthenticationCacheService', () => ({
  authenticationCacheService: {
    getHeaders: vi.fn(async (
      _request: unknown,
      shape: { headers: Record<string, string> },
      executor: (s: unknown) => Promise<unknown>
    ) => {
      await executor(shape)
      return {}
    }),
    invalidate: vi.fn(),
    refresh: vi.fn()
  }
}))

// The auth dispatch records into the login route's own history off the hot
// path; that write is irrelevant here and would otherwise hit the store.
vi.mock('../../../src/main/services/ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult: vi.fn(() => Promise.resolve()) }
}))

vi.mock('http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('http')>()
  return { default: { request: vi.fn(), STATUS_CODES: actual.STATUS_CODES }, request: vi.fn(), STATUS_CODES: actual.STATUS_CODES }
})
vi.mock('https', () => ({ default: { request: vi.fn() }, request: vi.fn() }))
vi.mock('undici', () => ({ request: vi.fn() }))

import { httpExecutionService } from '../../../src/main/services/HTTPExecutionService'
import { contextService } from '../../../src/main/services/ContextService'
import { request as undiciRequestMock } from 'undici'
import type { AuthenticationRequest } from '../../../src/shared/models/requests/AuthenticationRequest'

const mockedContextService = vi.mocked(contextService)
interface UndiciCallOpts { headers: Record<string, string>; body?: unknown; signal: AbortSignal }
interface UndiciResponseLike { statusCode: number; headers: Record<string, string>; body: AsyncGenerator<Buffer> }
const undiciRequestSpy = vi.mocked(undiciRequestMock) as unknown as MockInstance<(url: URL, opts: UndiciCallOpts) => Promise<UndiciResponseLike>>

const AUTH_ID = 'auth-route-1'
const AUTH_URL = 'http://idp.example.com/token'
const PARENT_ID = 'parent-request-1'
const PARENT_URL = 'http://example.com/api'

function buildUndiciResponse(statusCode: number, body: string): UndiciResponseLike {
  const buf = Buffer.from(body)
  return {
    statusCode,
    headers: {},
    body: (async function * (): AsyncGenerator<Buffer> {
      await Promise.resolve()
      if (buf.length > 0) yield buf
    })()
  }
}

function makeAuthRequest(headers: { key: string; value: unknown; enabled?: boolean }[]): AuthenticationRequest {
  return {
    id: AUTH_ID,
    type: 'auth',
    method: 'POST',
    url: AUTH_URL,
    headers,
    params: [],
    producedHeaders: [],
    authErrorCodes: [401, 403]
  } as unknown as AuthenticationRequest
}

/** Headers of the undici call that went to the auth endpoint (the downstream
 * request goes to a different host). */
function authCallHeaders(): Record<string, string> | undefined {
  const call = undiciRequestSpy.mock.calls.find(([url]) => url.hostname === 'idp.example.com')
  return call?.[1].headers
}

describe('HTTPExecutionService auth shape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedContextService.getResolvedUrl.mockImplementation(((id: string) => (
      id === AUTH_ID
        ? { resolvedUrl: AUTH_URL, resolvedParts: [] }
        : { resolvedUrl: PARENT_URL, resolvedParts: [] }
    )) as never)
    mockedContextService.resolveValue.mockImplementation((v: string) => v.replace('{{authHeaderName}}', 'x-tenant'))
    undiciRequestSpy.mockImplementation(() => Promise.resolve(buildUndiciResponse(200, '{"access_token":"tok"}')))
  })

  it('resolves a Handlebars header KEY on the auth request registered with the context service', async () => {
    mockedContextService.getRequestContext.mockImplementation(((id: string) => ({
      environmentId: null,
      availableEnvironmentIds: [],
      fullData: {},
      keyValueGroups: id === AUTH_ID
        ? new Map([['headers', [{ key: '{{authHeaderName}}', value: 'auth-value', enabled: true }]]])
        : new Map()
    })) as never)

    const result = await httpExecutionService.execute({
      requestId: PARENT_ID,
      method: 'GET',
      authRequest: makeAuthRequest([])
    })

    expect(result.success).toBe(true)
    expect(authCallHeaders()).toHaveProperty('x-tenant', 'auth-value')
    expect(authCallHeaders()).not.toHaveProperty('{{authHeaderName}}')
  })

  it('resolves a Handlebars header KEY on the fallback path, against the calling request context', async () => {
    // The auth route was never registered (the import-wizard / never-mounted
    // tab path): headers come straight off the `AuthenticationRequest` and
    // resolve against the parent request's environment.
    mockedContextService.getRequestContext.mockImplementation(((id: string) => (
      id === AUTH_ID
        ? undefined
        : { environmentId: null, availableEnvironmentIds: [], fullData: {}, keyValueGroups: new Map() }
    )) as never)
    mockedContextService.getResolvedUrl.mockImplementation(((id: string) => (
      id === AUTH_ID ? undefined : { resolvedUrl: PARENT_URL, resolvedParts: [] }
    )) as never)

    const result = await httpExecutionService.execute({
      requestId: PARENT_ID,
      method: 'GET',
      authRequest: makeAuthRequest([{ key: '{{authHeaderName}}', value: 'auth-value', enabled: true }])
    })

    expect(result.success).toBe(true)
    expect(authCallHeaders()).toHaveProperty('x-tenant', 'auth-value')
    expect(authCallHeaders()).not.toHaveProperty('{{authHeaderName}}')
  })
})
