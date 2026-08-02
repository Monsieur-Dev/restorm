import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

// A header KEY is Handlebars-resolved on the way to the wire. An unknown
// variable resolves to the EMPTY STRING (Handlebars renders a missing binding
// as ''), and `headers['']` is an invalid HTTP token — Node throws
// ERR_INVALID_HTTP_TOKEN and the whole send dies on what is really just a
// typo'd variable name. This pins that such a row is dropped instead.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createPubSub: () => ({ publish: vi.fn(), subscribe: vi.fn(), asyncIterator: vi.fn() }),
  withFirewallBypass: <T>(fn: () => T): T => fn(),
  isFirewallBypassed: () => false,
  firewallService: { emit: vi.fn() },
  permissionService: { classify: () => 'allow', check: () => Promise.resolve('allow' as const) }
}))

const { getResolvedUrlMock, getRequestContextMock } = vi.hoisted(() => ({
  getResolvedUrlMock: vi.fn(),
  getRequestContextMock: vi.fn()
}))

// Resolution runs through the REAL shared resolver, so "an unknown variable
// yields ''" is the genuine engine behaviour rather than a stubbed premise.
vi.mock('./ContextService', async () => {
  const { resolveWithContextPriority } = await import('../../shared/utils/handlebars/resolveWithContextPriority')
  const context: Record<string, string> = { hdrName: 'X-Trace' }
  return {
    contextService: {
      getResolvedUrl: getResolvedUrlMock,
      getRequestContext: getRequestContextMock,
      resolveValue: (v: string) => (v.includes('{{') ? tryResolve(v) : v),
      resolveBodyValue: (v: string) => v,
      resolveKeyValueForRequest: (kv: { value: unknown }) => String(kv.value),
      collectEnvironmentSecrets: () => [],
      refreshEnvironmentContext: () => undefined
    }
  }

  function tryResolve(v: string): string {
    try {
      return resolveWithContextPriority(v, context)
    } catch {
      return v
    }
  }
})

vi.mock('undici', () => ({ request: vi.fn() }))

import { httpExecutionService } from './HTTPExecutionService'
import { request as undiciRequestMock } from 'undici'

const undiciRequestSpy = vi.mocked(undiciRequestMock)

function undiciOk(): { statusCode: number; headers: Record<string, string>; body: Readable } {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: Readable.from([Buffer.from('{}')])
  }
}

/** The headers handed to the transport on the last dispatch. */
function dispatchedHeaders(): Record<string, string> {
  const call = undiciRequestSpy.mock.calls[0]
  const options = call?.[1] as { headers?: Record<string, string> } | undefined
  return options?.headers ?? {}
}

function contextWithHeaders(headers: { key: string; value: string; enabled?: boolean }[]): unknown {
  return {
    keyValueGroups: new Map([['headers', headers]]),
    fullData: {}
  }
}

describe('HTTP dispatch — header key resolution', () => {
  beforeEach(() => {
    getResolvedUrlMock.mockReset()
    getRequestContextMock.mockReset()
    undiciRequestSpy.mockReset()
    getResolvedUrlMock.mockReturnValue({ resolvedUrl: 'http://localhost:1/thing' })
    undiciRequestSpy.mockResolvedValue(undiciOk() as unknown as Awaited<ReturnType<typeof undiciRequestMock>>)
  })

  it('sends a header whose KEY is a resolvable variable under the resolved name', async () => {
    getRequestContextMock.mockReturnValue(
      contextWithHeaders([{ key: '{{hdrName}}', value: 'abc', enabled: true }])
    )

    const result = await httpExecutionService.execute({ requestId: 'header-key-ok', method: 'GET' })

    expect(result.success).toBe(true)
    expect(dispatchedHeaders()).toHaveProperty('X-Trace', 'abc')
    // The unresolved template must not survive as a literal header name.
    expect(dispatchedHeaders()).not.toHaveProperty('{{hdrName}}')
  })

  it('skips a header whose KEY resolves to the empty string instead of crashing the send', async () => {
    getRequestContextMock.mockReturnValue(
      contextWithHeaders([
        { key: '{{noSuchVar}}', value: 'orphan', enabled: true },
        { key: 'X-Kept', value: 'kept', enabled: true }
      ])
    )

    const result = await httpExecutionService.execute({ requestId: 'header-key-empty', method: 'GET' })

    // The send goes through, and only the well-named header reaches the wire —
    // an empty key would be an invalid HTTP token.
    expect(result.success).toBe(true)
    const sent = dispatchedHeaders()
    expect(Object.keys(sent)).not.toContain('')
    expect(sent).toHaveProperty('X-Kept', 'kept')
    expect(Object.values(sent)).not.toContain('orphan')
  })
})
