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

import { soapExecutionService } from './SOAPExecutionService'
import { contextService } from './ContextService'

interface MockEndpointHandle {
  port: number
  /** Header names/values of the last request the endpoint served. */
  lastHeaders: http.IncomingHttpHeaders | undefined
  close: () => Promise<void>
}

const SOAP_RESPONSE = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><Ok/></soap:Body>
</soap:Envelope>`

/** A minimal SOAP endpoint that records the request headers and always answers
 * 200 with a well-formed envelope. */
function startMockEndpoint(): Promise<MockEndpointHandle> {
  return new Promise((resolve) => {
    const handle: MockEndpointHandle = {
      port: 0,
      lastHeaders: undefined,
      close: () => new Promise((res) => { server.close(() => { res() }) })
    }
    const server = http.createServer((req, res) => {
      handle.lastHeaders = req.headers
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/xml' })
        res.end(SOAP_RESPONSE)
      })
    })
    server.listen(0, '127.0.0.1', () => {
      handle.port = (server.address() as AddressInfo).port
      resolve(handle)
    })
  })
}

/** Register a SOAP request against the REAL ContextService the same way the
 * request tab does, so the executor resolves everything production does. */
function registerSoapRequest(requestId: string, input: {
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
    requestType: 'soap',
    url: input.url,
    headers: input.headers,
    soapBody: '<Ping/>'
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

describe('SOAPExecutionService header resolution', () => {
  let endpoint: MockEndpointHandle

  beforeEach(async () => {
    endpoint = await startMockEndpoint()
  })
  afterEach(async () => {
    await endpoint.close()
  })

  it('resolves a Handlebars header KEY, not just the value', async () => {
    // A header NAME has no ValueType to gate on, so — like the URL and the
    // path/query param keys — the substitution is unconditional. Left
    // unresolved, `{{…}}` is not a valid HTTP token and Node's client rejects
    // the request outright before it ever reaches the endpoint.
    const requestId = 'soap-header-key-resolution'
    registerSoapRequest(requestId, {
      url: `http://127.0.0.1:${endpoint.port}/service`,
      headers: [{ key: '{{soapHeaderName}}', value: 'header-value', enabled: true }],
      envId: seedEnvironment('env-soap-header-key', { soapHeaderName: 'x-tenant' })
    })

    const result = await soapExecutionService.execute({ requestId, timeout: 2000 })

    expect(result.success).toBe(true)
    expect(endpoint.lastHeaders?.['x-tenant']).toBe('header-value')
    expect(endpoint.lastHeaders).not.toHaveProperty('{{soapheadername}}')

    contextService.unregisterRequest(requestId)
  })

  it('leaves a header key without Handlebars untouched', async () => {
    const requestId = 'soap-header-key-plain'
    registerSoapRequest(requestId, {
      url: `http://127.0.0.1:${endpoint.port}/service`,
      headers: [{ key: 'X-Plain', value: 'plain-value', enabled: true }]
    })

    const result = await soapExecutionService.execute({ requestId, timeout: 2000 })

    expect(result.success).toBe(true)
    expect(endpoint.lastHeaders?.['x-plain']).toBe('plain-value')

    contextService.unregisterRequest(requestId)
  })
})
