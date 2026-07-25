import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

// The renderer's activity beam (sidebar row + workbench tab) treats a request
// as running from its `started` progress event until a terminal one
// (`completed` / `cancelled` / `error`). An execution path that returns
// without emitting a terminal leaves the beam spinning forever, so these
// tests pin the invariant at the source: EXACTLY ONE terminal per execute(),
// on every exit path — including the error paths that return early.
//
// vi.mock factories are hoisted above the imports, so the collector they
// close over has to come from vi.hoisted.
const { progressEvents } = vi.hoisted(() => ({
  progressEvents: [] as { channel: string; requestId: string; status: string }[]
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: {
          send: (channel: string, payload: { requestId: string; status: string }) => {
            progressEvents.push({ channel, requestId: payload.requestId, status: payload.status })
          }
        }
      }
    ]
  }
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  // ResponseHistoryService pulls CollectionStore's `createPubSub(...)` in at
  // module load, and the undici transport reproduces the firewall flow.
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

vi.mock('./ContextService', () => ({
  contextService: {
    getResolvedUrl: getResolvedUrlMock,
    getRequestContext: getRequestContextMock,
    resolveValue: (v: string) => v,
    resolveKeyValueForRequest: (kv: { value: unknown }) => String(kv.value),
    collectEnvironmentSecrets: () => [],
    refreshEnvironmentContext: () => undefined
  }
}))

vi.mock('undici', () => ({ request: vi.fn() }))

import { httpExecutionService } from './HTTPExecutionService'
import { graphqlExecutionService } from './GraphQLExecutionService'
import { soapExecutionService } from './SOAPExecutionService'
import { request as undiciRequestMock } from 'undici'

const undiciRequestSpy = vi.mocked(undiciRequestMock)

/** The progress stream a single request produced, in order. */
function statusesFor(requestId: string): string[] {
  return progressEvents.filter((e) => e.requestId === requestId).map((e) => e.status)
}

/** An undici-shaped 200 response whose body is a real destroyable stream. */
function undiciOk(): { statusCode: number; headers: Record<string, string>; body: Readable } {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: Readable.from([Buffer.from('{}')])
  }
}

describe('request progress lifecycle', () => {
  beforeEach(() => {
    progressEvents.length = 0
    getResolvedUrlMock.mockReset()
    getRequestContextMock.mockReset()
    getRequestContextMock.mockReturnValue(undefined)
    undiciRequestSpy.mockReset()
  })

  describe('HTTP', () => {
    it('emits a terminal event when the URL cannot be parsed', async () => {
      // The `0 Error` case: an empty / malformed URL fails `new URL()` and
      // the execution returns before any transport work happens.
      getResolvedUrlMock.mockReturnValue({ resolvedUrl: '' })

      const result = await httpExecutionService.execute({ requestId: 'http-bad-url', method: 'DELETE' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid URL')
      expect(statusesFor('http-bad-url')).toEqual(['started', 'error'])
    })

    it('emits a terminal event when the request has no resolved URL', async () => {
      getResolvedUrlMock.mockReturnValue(undefined)

      const result = await httpExecutionService.execute({ requestId: 'http-no-url', method: 'GET' })

      expect(result.success).toBe(false)
      expect(statusesFor('http-no-url')).toEqual(['started', 'error'])
    })

    it('emits a terminal event when an upload file is missing', async () => {
      getResolvedUrlMock.mockReturnValue({ resolvedUrl: 'http://localhost:1/upload' })
      getRequestContextMock.mockReturnValue({
        fullData: { body: { type: 'file', path: '/definitely/not/here.bin' } }
      })

      const result = await httpExecutionService.execute({ requestId: 'http-missing-file', method: 'POST' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('File not found')
      expect(statusesFor('http-missing-file')).toEqual(['started', 'error'])
      expect(undiciRequestSpy).not.toHaveBeenCalled()
    })

    it('emits a terminal event when the body type is not recognised', async () => {
      getResolvedUrlMock.mockReturnValue({ resolvedUrl: 'http://localhost:1/thing' })
      getRequestContextMock.mockReturnValue({ fullData: { body: { type: 'not-a-body-type' } } })

      const result = await httpExecutionService.execute({ requestId: 'http-bad-body', method: 'POST' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown body type')
      expect(statusesFor('http-bad-body')).toEqual(['started', 'error'])
    })

    it('emits a single terminal event when the transport throws', async () => {
      getResolvedUrlMock.mockReturnValue({ resolvedUrl: 'http://localhost:1/thing' })
      undiciRequestSpy.mockRejectedValue(new Error('connect ECONNREFUSED'))

      const result = await httpExecutionService.execute({ requestId: 'http-throw', method: 'GET' })

      expect(result.success).toBe(false)
      expect(statusesFor('http-throw')).toEqual(['started', 'error'])
    })

    it('emits exactly one completed event on the success path', async () => {
      getResolvedUrlMock.mockReturnValue({ resolvedUrl: 'http://localhost:1/thing' })
      undiciRequestSpy.mockResolvedValue(undiciOk() as unknown as Awaited<ReturnType<typeof undiciRequestMock>>)

      const result = await httpExecutionService.execute({ requestId: 'http-ok', method: 'GET' })

      expect(result.success).toBe(true)
      expect(statusesFor('http-ok')).toEqual(['started', 'completed'])
    })
  })

  describe('GraphQL', () => {
    it('emits a terminal event when the URL cannot be parsed', async () => {
      getResolvedUrlMock.mockReturnValue({ resolvedUrl: 'not a url' })

      const result = await graphqlExecutionService.execute({ requestId: 'gql-bad-url' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid URL')
      expect(statusesFor('gql-bad-url')).toEqual(['started', 'error'])
    })
  })

  describe('SOAP', () => {
    it('emits a terminal event when the URL cannot be parsed', async () => {
      getResolvedUrlMock.mockReturnValue({ resolvedUrl: 'not a url' })

      const result = await soapExecutionService.execute({ requestId: 'soap-bad-url' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid URL')
      expect(statusesFor('soap-bad-url')).toEqual(['started', 'error'])
    })
  })
})
