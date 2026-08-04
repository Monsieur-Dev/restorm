import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

// The dispatch path composes the body from the request context, so this pins
// what actually reaches the transport: a JSON body must go out resolved AND
// syntactically valid, and a non-JSON one must keep the raw substitution.
// Both the request panel and the scenario engine reach the wire through this
// same `execute`, so the assertion covers both.
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

// The context stand-in resolves through the REAL shared resolvers, so the test
// exercises the genuine composition (executor → content-type gate → resolver)
// rather than a hand-written stub of the substitution.
vi.mock('./ContextService', async () => {
  const { resolveJsonBodyTemplate, isJsonContentType } = await import(
    '../../shared/utils/handlebars/resolveJsonBodyTemplate'
  )
  const { resolveWithContextPriority } = await import('../../shared/utils/handlebars/resolveWithContextPriority')
  const context: Record<string, string> = { petId: '42', petName: 'Rex "the\\dog"\nline2' }
  return {
    contextService: {
      getResolvedUrl: getResolvedUrlMock,
      resolveUrlForRequest: getResolvedUrlMock,
      getRequestContext: getRequestContextMock,
      resolveValue: (v: string) => (v.includes('{{') ? tryResolve(v) : v),
      resolveBodyValue: (v: string, _id: string, contentType?: string) => {
        if (!isJsonContentType(contentType)) return v.includes('{{') ? tryResolve(v) : v
        try {
          return resolveJsonBodyTemplate(v, context)
        } catch {
          return v
        }
      },
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

/** The body handed to the transport on the last dispatch. */
function dispatchedBody(): string {
  const call = undiciRequestSpy.mock.calls[0]
  const options = call?.[1] as { body?: string } | undefined
  return options?.body ?? ''
}

function contextWith(contentTypeHeader: string | null, content: string): unknown {
  const headers = contentTypeHeader === null
    ? []
    : [{ key: 'Content-Type', value: contentTypeHeader, enabled: true }]
  return {
    keyValueGroups: new Map([['headers', headers]]),
    fullData: { body: { type: 'text', content } }
  }
}

describe('HTTP dispatch — request body resolution', () => {
  beforeEach(() => {
    getResolvedUrlMock.mockReset()
    getRequestContextMock.mockReset()
    undiciRequestSpy.mockReset()
    getResolvedUrlMock.mockReturnValue({ resolvedUrl: 'http://localhost:1/thing' })
    undiciRequestSpy.mockResolvedValue(undiciOk() as unknown as Awaited<ReturnType<typeof undiciRequestMock>>)
  })

  it('sends a JSON body resolved, escaped and syntactically valid', async () => {
    getRequestContextMock.mockReturnValue(
      contextWith('application/json', '{"name":"{{petName}}","id":{{petId}}}')
    )

    const result = await httpExecutionService.execute({ requestId: 'json-body', method: 'POST' })

    expect(result.success).toBe(true)
    const sent = dispatchedBody()
    expect(JSON.parse(sent)).toEqual({ name: 'Rex "the\\dog"\nline2', id: 42 })
  })

  it('picks the Content-Type up whatever its casing', async () => {
    getRequestContextMock.mockReturnValue(contextWith('APPLICATION/JSON', '{"id":{{petId}}}'))

    await httpExecutionService.execute({ requestId: 'json-body-casing', method: 'POST' })

    expect(dispatchedBody()).toBe('{"id":42}')
  })

  it('keeps the raw substitution when the Content-Type is not JSON', async () => {
    getRequestContextMock.mockReturnValue(contextWith('application/xml', '<pet><name>{{petName}}</name></pet>'))

    await httpExecutionService.execute({ requestId: 'xml-body', method: 'POST' })

    expect(dispatchedBody()).toBe('<pet><name>Rex "the\\dog"\nline2</name></pet>')
  })

  it('leaves a JSON-looking body alone when no Content-Type declares it', async () => {
    getRequestContextMock.mockReturnValue(contextWith(null, '{"id":{{petId}}}'))

    await httpExecutionService.execute({ requestId: 'no-content-type', method: 'POST' })

    // Unchanged behaviour: the whole-template compile fails on the tight brace
    // and the body ships verbatim.
    expect(dispatchedBody()).toBe('{"id":{{petId}}}')
  })
})
