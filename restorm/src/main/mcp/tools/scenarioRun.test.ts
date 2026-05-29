import { describe, it, expect, vi, beforeEach } from 'vitest'

// `runScenarioNode` dispatches on `node.kind`. The renderer persists a
// request box with `kind: 'httpRequest'`; an older format used
// `'request'`. The dispatch must accept BOTH so a scenario file
// pre-rename keeps working, AND so the inspector's inline play button
// (the most common case) stops silently failing.

const executeMock = vi.fn<() => Promise<{ statusCode: number; success: boolean; timings: { durationMs: number } }>>()
const storeExecutionResultMock = vi.fn(() => Promise.resolve())
const findByIdMock = vi.fn<(id: string) => unknown>()

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => undefined, handle: () => undefined, removeAllListeners: () => undefined }
}))

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => findByIdMock(id)
  }
}))
vi.mock('../../services/ResponseHistoryService', () => ({
  responseHistoryService: { storeExecutionResult: storeExecutionResultMock, list: vi.fn(() => Promise.resolve([])), getDetail: vi.fn(() => Promise.resolve(null)) }
}))
vi.mock('../../services/RequestUsageService', () => ({
  requestUsageService: { recordSend: vi.fn() }
}))
vi.mock('../../services/HTTPExecutionService', () => ({
  httpExecutionService: { execute: executeMock, cancel: vi.fn() }
}))
vi.mock('../../services/ContextService', () => {
  const noop = vi.fn()
  const proxy = new Proxy({}, { get: () => noop })
  return {
    flushRequestStateToContext: noop,
    contextService: proxy
  }
})
vi.mock('../../../shared/types/collections', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../shared/types/collections')
  return {
    ...actual,
    isHTTPRequest: () => true,
    isAuthenticationRequest: () => false
  }
})

describe('runScenarioNode kind dispatch', () => {
  beforeEach(() => {
    executeMock.mockReset()
    findByIdMock.mockReset()
    storeExecutionResultMock.mockReset()
    executeMock.mockResolvedValue({ statusCode: 200, success: true, timings: { durationMs: 10 } })
  })

  /** Wire `collectionStore.findById` to return a synthetic scenario when
   * the runner asks for the scenario id, and a synthetic HTTP request
   * when it asks for the bound request id. */
  function seed(node: { id: string; kind: string; config: Record<string, unknown> }): void {
    findByIdMock.mockImplementation((id: string): unknown => {
      if (id === 'scn-1') {
        return { id: 'scn-1', type: 'scenario', nodes: [node], edges: [], params: [], items: [], name: 'S', tags: [] }
      }
      if (id === 'req-1') {
        return { id: 'req-1', type: 'http', method: 'GET' }
      }
      return null
    })
  }

  it('routes `httpRequest` kind to the request executor — the post-rename common case', async () => {
    seed({ id: 'n', kind: 'httpRequest', config: { requestId: 'req-1' } })
    const { runScenarioNode } = await import('./scenarioRun')
    await runScenarioNode('scn-1', 'n')
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('still accepts the legacy `request` kind for pre-rename scenario files', async () => {
    seed({ id: 'n2', kind: 'request', config: { requestId: 'req-1' } })
    const { runScenarioNode } = await import('./scenarioRun')
    await runScenarioNode('scn-1', 'n2')
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an unknown kind with a clear error mentioning the kind', async () => {
    seed({ id: 'n3', kind: 'object', config: {} })
    const { runScenarioNode } = await import('./scenarioRun')
    await expect(runScenarioNode('scn-1', 'n3')).rejects.toThrow(/object/)
    expect(executeMock).not.toHaveBeenCalled()
  })
})
