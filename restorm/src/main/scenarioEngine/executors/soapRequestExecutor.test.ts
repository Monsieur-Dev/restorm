import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Activation, ExecContext } from '../types'
import type { ScenarioNode } from '../../../shared/types/scenario'

/**
 * Unary SOAP node: bind a saved SOAP request, run it through the existing
 * `soapExecutionService`, persist to history, and emit the parsed response on
 * the `response` port. The pipeline (CollectionStore + SOAPExecutionService +
 * history + context flush) is mocked so the test stays a pure unit; what we
 * assert is the response-envelope mapping, the fault passthrough, the
 * history-persist + context-flush contract, and cooperative cancellation.
 */

const findById = vi.fn<(id: string) => unknown>()
const execute = vi.fn<(i: unknown) => Promise<unknown>>()
const cancel = vi.fn<(id: string) => boolean>()
const storeExecutionResult = vi.fn<(...a: unknown[]) => Promise<void>>()
const flushRequestStateToContext = vi.fn<(r: unknown) => void>()

vi.mock('../../services/CollectionStore', () => ({ collectionStore: { findById: (id: string) => findById(id) } }))
vi.mock('../../services/SOAPExecutionService', () => ({
  soapExecutionService: { execute: (i: unknown) => execute(i), cancel: (id: string) => cancel(id) }
}))
vi.mock('../../services/ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult: (...a: unknown[]) => storeExecutionResult(...a) }
}))
vi.mock('../../mcp/tools/execute', () => ({ flushRequestStateToContext: (r: unknown) => { flushRequestStateToContext(r) } }))

// Import AFTER the mocks are registered.
const { soapRequestExecutor } = await import('./soapRequestExecutor')

function makeRequest(): Record<string, unknown> {
  return { id: 'soap-1', type: 'soap', url: 'http://localhost:8076/calculator' }
}

function cannedResult(): Record<string, unknown> {
  return {
    requestId: 'soap-1',
    success: true,
    statusCode: 200,
    responseBody: '<Envelope><Body><AddResponse><result>7</result></AddResponse></Body></Envelope>',
    headers: { 'content-type': 'text/xml' },
    requestUrl: 'http://localhost:8076/calculator',
    timings: { startedAt: '2026-01-01T00:00:00.000Z', durationMs: 9 }
  }
}

function makeCtx(node: ScenarioNode, signal?: AbortSignal): ExecContext {
  return {
    signal: signal ?? new AbortController().signal,
    log: () => undefined,
    variables: new Map(),
    runSubScenario: () => Promise.reject(new Error('not wired')),
    requestUserInput: () => Promise.reject(new Error('not wired')),
    node
  }
}

function makeActivation(inputs: Record<string, unknown> = {}): Activation {
  return { nodeId: 'n1', kind: 'soapRequest' as Activation['kind'], scope: [], inputs }
}

function node(): ScenarioNode {
  return { id: 'n1', kind: 'soapRequest', config: { requestId: 'soap-1' }, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
}

beforeEach(() => {
  findById.mockReset().mockReturnValue(makeRequest())
  execute.mockReset().mockResolvedValue(cannedResult())
  cancel.mockReset().mockReturnValue(true)
  storeExecutionResult.mockReset().mockResolvedValue(undefined)
  flushRequestStateToContext.mockReset()
})

describe('soapRequestExecutor', () => {
  it('flushes the bound request, executes via the SOAP service, and persists to history as soap', async () => {
    await soapRequestExecutor(makeActivation(), makeCtx(node()))
    expect(flushRequestStateToContext).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith({ requestId: 'soap-1' })
    expect(storeExecutionResult).toHaveBeenCalledWith('soap-1', 'soap', expect.objectContaining({ success: true }))
  })

  it('emits the `response` port with the request + response envelope', async () => {
    const result = await soapRequestExecutor(makeActivation(), makeCtx(node()))
    const out = result.outputs.find((o) => o.port === 'response')?.value as {
      request: { url: string; method: string }
      response: { status: number; success: boolean; body: string; headers: Record<string, unknown> }
    }
    expect(out.request.url).toBe('http://localhost:8076/calculator')
    expect(out.request.method).toBe('POST')
    expect(out.response.status).toBe(200)
    expect(out.response.success).toBe(true)
    expect(out.response.body).toContain('<result>7</result>')
    expect(out.response.headers).toEqual({ 'content-type': 'text/xml' })
  })

  it('surfaces a SOAP fault on the response object and reports success=false', async () => {
    execute.mockResolvedValue({
      ...cannedResult(),
      success: false,
      statusCode: 500,
      fault: { code: 'soap:Server', message: 'boom' },
      responseBody: '<Envelope><Body><Fault/></Body></Envelope>'
    })
    const result = await soapRequestExecutor(makeActivation(), makeCtx(node()))
    const out = result.outputs.find((o) => o.port === 'response')?.value as {
      response: { status: number; success: boolean; fault?: { code: string; message: string } }
    }
    expect(out.response.success).toBe(false)
    expect(out.response.status).toBe(500)
    expect(out.response.fault).toEqual({ code: 'soap:Server', message: 'boom' })
  })

  it('honours the abort signal by cancelling the live SOAP dispatch', async () => {
    const ctrl = new AbortController()
    let release: () => void = () => undefined
    execute.mockImplementation(() => new Promise((resolve) => { release = (): void => { resolve(cannedResult()) } }))
    const p = soapRequestExecutor(makeActivation(), makeCtx(node(), ctrl.signal))
    ctrl.abort()
    expect(cancel).toHaveBeenCalledWith('soap-1')
    release()
    await p
  })

  it('throws when the bound request is not a SOAP request', async () => {
    findById.mockReturnValue({ id: 'soap-1', type: 'http' })
    await expect(soapRequestExecutor(makeActivation(), makeCtx(node()))).rejects.toThrow(/not SOAP/)
  })

  it('throws when no request is bound', async () => {
    const n = { id: 'n1', kind: 'soapRequest', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } } as unknown as ScenarioNode
    await expect(soapRequestExecutor(makeActivation(), makeCtx(n))).rejects.toThrow(/no bound requestId/)
  })
})
