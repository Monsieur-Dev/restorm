import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// Same pattern as `StompExecutionService.test.ts`: mock the two Electron-facing
// surfaces the service touches (BrowserWindow broadcasts + the logger) so a real
// ContextService and a real local HTTP server can drive the service end-to-end
// without Electron. The point of this suite is what actually reaches the wire,
// so nothing on the resolution path is stubbed.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('electron-core-ui/main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('electron-core-ui/main')>()
  return {
    ...actual,
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
  }
})

import { sseExecutionService } from './SseExecutionService'
import { contextService } from './ContextService'

interface MockStreamHandle {
  port: number
  /** Header names/values of the last request the endpoint served. */
  lastHeaders: http.IncomingHttpHeaders | undefined
  close: () => Promise<void>
}

/** A stream endpoint that records the request headers and answers 204, which
 * the SSE spec defines as "stop reconnecting" — that keeps the run single-shot
 * instead of looping through the reconnect budget. */
function startMockStream(): Promise<MockStreamHandle> {
  return new Promise((resolve) => {
    const handle: MockStreamHandle = {
      port: 0,
      lastHeaders: undefined,
      close: () => new Promise((res) => { server.close(() => { res() }) })
    }
    const server = http.createServer((req, res) => {
      handle.lastHeaders = req.headers
      req.resume()
      res.writeHead(204)
      res.end()
    })
    server.listen(0, '127.0.0.1', () => {
      handle.port = (server.address() as AddressInfo).port
      resolve(handle)
    })
  })
}

/** Register an SSE request against the REAL ContextService the same way the
 * request tab does, so the executor resolves everything production does. */
function registerSseRequest(requestId: string, input: {
  url: string
  headers: { key: string; value: unknown; enabled?: boolean }[]
  envId?: string
}): void {
  contextService.registerRequest(requestId, input.envId ?? null, {
    id: requestId,
    headers: input.headers
  } as Parameters<typeof contextService.registerRequest>[2])
  contextService.updateFullRequestData(requestId, {
    id: requestId,
    requestType: 'sse',
    url: input.url,
    headers: input.headers
  } as Parameters<typeof contextService.updateFullRequestData>[1])
}

/**
 * Seed an environment holding `variables` and return its id, so a request can be
 * registered against it.
 *
 * The variables reach resolution through the request's own environment — the
 * only channel there is. A scenario run's values never enter a request's stored
 * context; they travel as a disposable `ResolutionContexts` handed to the
 * dispatch, and this protocol's executor does not compose one.
 */
function seedEnvironment(envId: string, variables: Record<string, string>): string {
  const svc = contextService as unknown as { handleEnvironmentCreated: (payload: unknown) => void }
  svc.handleEnvironmentCreated({
    id: envId,
    type: 'environment',
    document: {
      id: envId,
      name: 'E',
      variables: Object.entries(variables).map(([key, value]) => ({ key, value: { type: 'string', value } }))
    }
  })
  return envId
}

describe('SseExecutionService header resolution', () => {
  let stream: MockStreamHandle

  beforeEach(async () => {
    stream = await startMockStream()
  })
  afterEach(async () => {
    await stream.close()
  })

  it('resolves a Handlebars header KEY, not just the value', async () => {
    // A header NAME has no ValueType to gate on, so — like the URL and the
    // path/query param keys — the substitution is unconditional. Left
    // unresolved, `{{…}}` is not a valid HTTP token and Node's client rejects
    // the request outright before it ever reaches the endpoint.
    const requestId = 'sse-header-key-resolution'
    registerSseRequest(requestId, {
      url: `http://127.0.0.1:${stream.port}/events`,
      headers: [{ key: '{{sseHeaderName}}', value: 'header-value', enabled: true }],
      envId: seedEnvironment('env-sse-header-key', { sseHeaderName: 'x-tenant' })
    })

    await sseExecutionService.execute({ requestId, timeout: 2000 })

    expect(stream.lastHeaders?.['x-tenant']).toBe('header-value')
    expect(stream.lastHeaders).not.toHaveProperty('{{sseheadername}}')

    contextService.unregisterRequest(requestId)
  })

  it('leaves a header key without Handlebars untouched', async () => {
    const requestId = 'sse-header-key-plain'
    registerSseRequest(requestId, {
      url: `http://127.0.0.1:${stream.port}/events`,
      headers: [{ key: 'X-Plain', value: 'plain-value', enabled: true }]
    })

    await sseExecutionService.execute({ requestId, timeout: 2000 })

    expect(stream.lastHeaders?.['x-plain']).toBe('plain-value')

    contextService.unregisterRequest(requestId)
  })
})
