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

describe('waitMs — persisted wait-node duration', () => {
  function node(config: Record<string, unknown>): { id: string; kind: string; config: Record<string, unknown> } {
    return { id: 'w', kind: 'wait', config }
  }

  it('reads durationMs from the node config', async () => {
    const { waitMs } = await import('./scenarioRun')
    expect(waitMs(node({ durationMs: 2500 }) as never)).toBe(2500)
  })

  it('falls back to `duration` when durationMs is absent', async () => {
    const { waitMs } = await import('./scenarioRun')
    expect(waitMs(node({ duration: 400 }) as never)).toBe(400)
  })

  it('defaults to 1000ms (engine parity), not the old 5000ms demo value', async () => {
    const { waitMs } = await import('./scenarioRun')
    expect(waitMs(node({}) as never)).toBe(1000)
    expect(waitMs(node({ durationMs: 0 }) as never)).toBe(1000)
    expect(waitMs(node({ durationMs: -5 }) as never)).toBe(1000)
  })
})

// A JSON-path picker asking for the result of a node that was deleted / rewired
// must get `null`, NOT an exception: the throw surfaces as an Electron
// `console.error` from the `scenario:node-result` handler and gets captured as
// crash-report noise, even though the renderer already treats null as "no
// result". Guards against a regression back to the throwing `locateNode` path.
describe('getScenarioNodeResult — a stale reference resolves to null, never throws', () => {
  beforeEach(() => {
    findByIdMock.mockReset()
  })

  it('returns null when the scenario no longer holds the node', async () => {
    findByIdMock.mockImplementation((id: string) =>
      id === 's1' ? { id: 's1', type: 'scenario', nodes: [{ id: 'other', kind: 'code', config: {} }] } : null
    )
    const { getScenarioNodeResult } = await import('./scenarioRun')
    await expect(getScenarioNodeResult('s1', 'deleted-node')).resolves.toBeNull()
  })

  it('returns null when the scenario itself is gone', async () => {
    findByIdMock.mockReturnValue(null)
    const { getScenarioNodeResult } = await import('./scenarioRun')
    await expect(getScenarioNodeResult('missing', 'n1')).resolves.toBeNull()
  })
})
