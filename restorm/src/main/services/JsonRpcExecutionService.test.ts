import { describe, it, expect, vi, beforeEach } from 'vitest'

// JsonRpcExecutionService is a thin request-shaping layer over
// HTTPExecutionService — mock both of its dependencies directly rather than
// the transport (http/https) level ExecutionServices.test.ts exercises.
// vi.mock factories are hoisted above imports, so the mocks they close over
// must be created via vi.hoisted rather than as plain top-level `const`s.
const { executeMock, cancelMock, isActiveMock, getRequestContextMock, resolveValueMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  cancelMock: vi.fn(),
  isActiveMock: vi.fn(),
  getRequestContextMock: vi.fn(),
  resolveValueMock: vi.fn((v: string) => v)
}))

vi.mock('./HTTPExecutionService', () => ({
  httpExecutionService: {
    execute: executeMock,
    cancel: cancelMock,
    isActive: isActiveMock
  }
}))

vi.mock('./ContextService', () => ({
  contextService: {
    getRequestContext: getRequestContextMock,
    resolveValue: (v: string) => resolveValueMock(v)
  }
}))

import { jsonRpcExecutionService } from './JsonRpcExecutionService'
import type { HTTPExecutionInput, HTTPExecutionResult } from './HTTPExecutionService'

const timings = { startedAt: '2026-01-01T00:00:00.000Z', durationMs: 5 }

/** The `rawBody` of the nth (default: most recent) call into the mocked
 * `httpExecutionService.execute` — typed so callers don't touch `.mock.calls`
 * as `any`. */
function lastSentBody(callIndex = -1): string {
  const calls = executeMock.mock.calls as [HTTPExecutionInput][]
  const call = callIndex >= 0 ? calls[callIndex] : calls[calls.length - 1]
  return call?.[0].rawBody ?? ''
}

function httpSuccess(body: string, overrides: Partial<HTTPExecutionResult> = {}): HTTPExecutionResult {
  return { requestId: 'r1', success: true, statusCode: 200, body, timings, requestUrl: 'http://mock/rpc', ...overrides }
}

describe('JsonRpcExecutionService', () => {
  beforeEach(() => {
    executeMock.mockReset()
    getRequestContextMock.mockReset()
    resolveValueMock.mockReset()
    resolveValueMock.mockImplementation((v: string) => v)
  })

  describe('execute — single call', () => {
    it('composes the envelope with positional params and unwraps a result', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: { jsonRpcMethod: 'echo', jsonRpcParams: '[1, 2]', jsonRpcId: 'abc' }
      })
      executeMock.mockResolvedValue(httpSuccess(JSON.stringify({ jsonrpc: '2.0', id: 'abc', result: 3 })))

      const result = await jsonRpcExecutionService.execute({ requestId: 'r1' })

      expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
        requestId: 'r1',
        method: 'POST',
        rawBodyContentType: 'application/json'
      }))
      const sentBody: string = lastSentBody()
      expect(JSON.parse(sentBody)).toEqual({ jsonrpc: '2.0', method: 'echo', params: [1, 2], id: 'abc' })
      expect(result.success).toBe(true)
      expect(result.result).toBe(3)
      expect(result.error).toBeUndefined()
    })

    it('composes named (object) params the same way as positional (array) params', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: { jsonRpcMethod: 'namedEcho', jsonRpcParams: '{"name": "restorm"}', jsonRpcId: 'n1' }
      })
      executeMock.mockResolvedValue(httpSuccess(JSON.stringify({ jsonrpc: '2.0', id: 'n1', result: 'restorm' })))

      const result = await jsonRpcExecutionService.execute({ requestId: 'r1' })

      const sentEnvelope = JSON.parse(lastSentBody()) as { params?: unknown }
      expect(sentEnvelope.params).toEqual({ name: 'restorm' })
      expect(result.result).toBe('restorm')
    })

    it('surfaces a JSON-RPC error response distinctly from a transport error', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: { jsonRpcMethod: 'failMethod', jsonRpcParams: '', jsonRpcId: 'e1' }
      })
      executeMock.mockResolvedValue(httpSuccess(JSON.stringify({
        jsonrpc: '2.0', id: 'e1', error: { code: -32601, message: 'Method not found' }
      })))

      const result = await jsonRpcExecutionService.execute({ requestId: 'r1' })

      expect(result.success).toBe(true) // the HTTP call itself succeeded
      expect(result.result).toBeUndefined()
      expect(result.error).toEqual({ code: -32601, message: 'Method not found' })
      expect(result.transportError).toBeUndefined()
    })

    it('auto-generates an id when none is provided', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: { jsonRpcMethod: 'echo', jsonRpcParams: '', jsonRpcId: '' }
      })
      executeMock.mockResolvedValue(httpSuccess(JSON.stringify({ jsonrpc: '2.0', id: 'whatever', result: null })))

      await jsonRpcExecutionService.execute({ requestId: 'r1' })

      const sentEnvelope = JSON.parse(lastSentBody()) as { id?: unknown }
      expect(typeof sentEnvelope.id).toBe('string')
      expect((sentEnvelope.id as string).length).toBeGreaterThan(0)
    })

    it('omits `id` and reports notificationSent in notification mode', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: { jsonRpcMethod: 'echo', jsonRpcParams: '', jsonRpcId: 'ignored', jsonRpcNotificationMode: true }
      })
      executeMock.mockResolvedValue(httpSuccess(''))

      const result = await jsonRpcExecutionService.execute({ requestId: 'r1' })

      const sentEnvelope = JSON.parse(lastSentBody()) as { id?: unknown }
      expect(sentEnvelope.id).toBeUndefined()
      expect(result.notificationSent).toBe(true)
      expect(result.result).toBeUndefined()
      expect(result.error).toBeUndefined()
    })

    it('reports a transportError for malformed params JSON without dispatching', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: { jsonRpcMethod: 'echo', jsonRpcParams: '{not json', jsonRpcId: 'x' }
      })

      const result = await jsonRpcExecutionService.execute({ requestId: 'r1' })

      expect(executeMock).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.transportError).toMatch(/Invalid params JSON/)
    })

    it('reports a transportError when the request is not registered', async () => {
      getRequestContextMock.mockReturnValue(undefined)

      const result = await jsonRpcExecutionService.execute({ requestId: 'unregistered' })

      expect(executeMock).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.transportError).toMatch(/No resolved request data/)
    })

    it('propagates a transport-level failure from HTTPExecutionService', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: { jsonRpcMethod: 'echo', jsonRpcParams: '', jsonRpcId: 'x' }
      })
      executeMock.mockResolvedValue({ requestId: 'r1', success: false, error: 'ECONNREFUSED', timings })

      const result = await jsonRpcExecutionService.execute({ requestId: 'r1' })

      expect(result.success).toBe(false)
      expect(result.transportError).toBe('ECONNREFUSED')
    })
  })

  describe('executeBatch', () => {
    it('composes an array envelope and matches each response entry back by id', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: {
          jsonRpcChildren: [
            { childId: 'c1', method: 'echo', params: '[1]', rpcId: 'id-1' },
            { childId: 'c2', method: 'namedEcho', params: '{"x":1}', rpcId: 'id-2' }
          ]
        }
      })
      executeMock.mockResolvedValue(httpSuccess(JSON.stringify([
        { jsonrpc: '2.0', id: 'id-2', result: { x: 1 } },
        { jsonrpc: '2.0', id: 'id-1', result: 1 }
      ])))

      const result = await jsonRpcExecutionService.executeBatch({ requestId: 'r1' })

      const sentEnvelopes = JSON.parse(lastSentBody()) as unknown[]
      expect(sentEnvelopes).toHaveLength(2)
      expect(result.success).toBe(true)
      expect(result.children).toHaveLength(2)
      expect(result.children.find((c) => c.childId === 'c1')?.result).toBe(1)
      expect(result.children.find((c) => c.childId === 'c2')?.result).toEqual({ x: 1 })
    })

    it('surfaces a per-child error without failing the whole batch', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: {
          jsonRpcChildren: [
            { childId: 'c1', method: 'echo', params: '', rpcId: 'ok' },
            { childId: 'c2', method: 'failMethod', params: '', rpcId: 'bad' }
          ]
        }
      })
      executeMock.mockResolvedValue(httpSuccess(JSON.stringify([
        { jsonrpc: '2.0', id: 'ok', result: 'fine' },
        { jsonrpc: '2.0', id: 'bad', error: { code: -32000, message: 'boom' } }
      ])))

      const result = await jsonRpcExecutionService.executeBatch({ requestId: 'r1' })

      expect(result.children.find((c) => c.childId === 'c1')?.result).toBe('fine')
      expect(result.children.find((c) => c.childId === 'c2')?.error).toEqual({ code: -32000, message: 'boom' })
    })

    it('marks a child unmatched when the server drops its response entry', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: {
          jsonRpcChildren: [
            { childId: 'c1', method: 'echo', params: '', rpcId: 'id-1' },
            { childId: 'c2', method: 'echo', params: '', rpcId: 'id-2' }
          ]
        }
      })
      executeMock.mockResolvedValue(httpSuccess(JSON.stringify([
        { jsonrpc: '2.0', id: 'id-1', result: 'ok' }
      ])))

      const result = await jsonRpcExecutionService.executeBatch({ requestId: 'r1' })

      expect(result.children.find((c) => c.childId === 'c2')?.unmatched).toBe(true)
    })

    it('reports a transportError when the batch has no children', async () => {
      getRequestContextMock.mockReturnValue({ fullData: { jsonRpcChildren: [] } })

      const result = await jsonRpcExecutionService.executeBatch({ requestId: 'r1' })

      expect(executeMock).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.transportError).toMatch(/no child calls/)
    })

    it('reports a transportError when every child fails to compose', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: {
          jsonRpcChildren: [{ childId: 'c1', method: 'echo', params: '{bad', rpcId: 'x' }]
        }
      })

      const result = await jsonRpcExecutionService.executeBatch({ requestId: 'r1' })

      expect(executeMock).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.transportError).toMatch(/Invalid params JSON/)
    })

    it('propagates a transport-level failure from HTTPExecutionService', async () => {
      getRequestContextMock.mockReturnValue({
        fullData: { jsonRpcChildren: [{ childId: 'c1', method: 'echo', params: '', rpcId: 'x' }] }
      })
      executeMock.mockResolvedValue({ requestId: 'r1', success: false, error: 'ECONNREFUSED', timings })

      const result = await jsonRpcExecutionService.executeBatch({ requestId: 'r1' })

      expect(result.success).toBe(false)
      expect(result.transportError).toBe('ECONNREFUSED')
      expect(result.children).toEqual([])
    })
  })

  describe('cancel / isActive', () => {
    it('delegates to httpExecutionService', () => {
      cancelMock.mockReturnValue(true)
      isActiveMock.mockReturnValue(true)

      expect(jsonRpcExecutionService.cancel('r1')).toBe(true)
      expect(cancelMock).toHaveBeenCalledWith('r1')
      expect(jsonRpcExecutionService.isActive('r1')).toBe(true)
      expect(isActiveMock).toHaveBeenCalledWith('r1')
    })
  })
})
