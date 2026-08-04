import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type IncomingMessage, type Server as HttpServer } from 'http'
import type { AddressInfo } from 'net'

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories are hoisted; they must not reference outer vars.
// Same shape as ExecutionServices.test.ts so the shared execute() prologue
// (URL resolution, header build) is driven from fixtures.
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
      resolveUrlForRequest: vi.fn(),
      getRequestContext: vi.fn(),
      resolveValue: resolveValueMock,
      // Type-aware header VALUE path (see `HTTPExecutionService`): only an
      // `ExpressionValue` row is handlebars-substituted; a `StringValue`
      // row ships verbatim.
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
import { graphqlExecutionService } from '../../../src/main/services/GraphQLExecutionService'
import { contextService } from '../../../src/main/services/ContextService'

const mockedContextService = vi.mocked(contextService)

// ---------------------------------------------------------------------------
// A real, in-process HTTP server standing in for the GraphQL endpoint (no
// Docker dependency for the unit suite) — captures the headers it actually
// received so the test asserts on what really hit the wire, not a mock's
// recorded call arguments.
// ---------------------------------------------------------------------------

let server: HttpServer
let baseUrl: string
let lastRequestHeaders: IncomingMessage['headers'] | undefined

beforeAll(async () => {
  server = createServer((req, res) => {
    lastRequestHeaders = req.headers
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: { ok: true } }))
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as AddressInfo).port
  baseUrl = `http://localhost:${port}/graphql`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => { resolve() }))
})

function setupRequest(fullData: Record<string, unknown> = {}, keyValueGroups = new Map()): void {
  mockedContextService.getResolvedUrl.mockReturnValue({ resolvedUrl: baseUrl, resolvedParts: [] } as never)
  mockedContextService.resolveUrlForRequest.mockReturnValue({ resolvedUrl: baseUrl, resolvedParts: [] } as never)
  mockedContextService.getRequestContext.mockReturnValue({ fullData, keyValueGroups } as never)
}

describe('GraphQLExecutionService', () => {
  beforeEach(() => {
    mockedContextService.getResolvedUrl.mockReset()
    mockedContextService.resolveUrlForRequest.mockReset()
    mockedContextService.getRequestContext.mockReset()
    mockedContextService.resolveValue.mockImplementation((v: string) => v)
    lastRequestHeaders = undefined
  })

  it('returns error when no resolved URL is found', async () => {
    mockedContextService.resolveUrlForRequest.mockReturnValue(undefined as never)

    const result = await graphqlExecutionService.execute({ requestId: 'gql-no-url' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('No resolved URL')
  })

  it('executes a query and receives the response', async () => {
    setupRequest({ query: 'query { hello }', variables: '{}' })

    const result = await graphqlExecutionService.execute({ requestId: 'gql-basic' })

    expect(result.success).toBe(true)
    expect(result.statusCode).toBe(200)
    expect(result.data).toEqual({ ok: true })
  })

  it('resolves a Handlebars header KEY, not just the value — unconditionally, like a query/path param key', async () => {
    setupRequest(
      { query: 'query { hello }', variables: '{}' },
      new Map([['headers', [{ key: '{{headerNameVar}}', value: 'templated-value', enabled: true }]]])
    )
    // The header KEY has no ValueType to gate on, so — same as the URL and a
    // query/path param key — it resolves unconditionally through Handlebars.
    mockedContextService.resolveValue.mockImplementation((v: string) => v.replace('{{headerNameVar}}', 'x-templated-header'))

    const result = await graphqlExecutionService.execute({ requestId: 'gql-header-key' })

    expect(result.success).toBe(true)
    expect(lastRequestHeaders?.['x-templated-header']).toBe('templated-value')
    // Node lower-cases incoming header names, but the raw `{`/`}` would still
    // show up verbatim if the key had shipped unresolved — it must not.
    expect(Object.keys(lastRequestHeaders ?? {}).some((k) => k.includes('{{'))).toBe(false)
  })
})
