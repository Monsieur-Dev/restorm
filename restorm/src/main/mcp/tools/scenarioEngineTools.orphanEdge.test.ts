import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpService } from 'electron-core-ui'

// Proves the SHARED validator refuses a scenario carrying an edge wired to a
// port its node no longer declares, on the MCP `run_scenario` path — without
// mocking scenarioValidation (the real predicate runs here).

interface FakeHandle { scheduler: { runId: string }; done: Promise<Record<string, unknown>> }
const findByIdMock = vi.fn<(id: string) => unknown>()
const startMock = vi.fn<(...args: unknown[]) => FakeHandle>()

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => undefined, handle: () => undefined, removeAllListeners: () => undefined }
}))
vi.mock('../../services/CollectionStore', () => ({
  collectionStore: { findById: (id: string) => findByIdMock(id) }
}))
vi.mock('../../scenarioEngine/engine', () => ({
  scenarioEngine: {
    start: (...args: unknown[]) => startMock(...args),
    onAnyEvent: () => undefined
  }
}))
vi.mock('../../services', () => ({
  scenarioUsageService: { recordRun: () => undefined }
}))

class FakeMcpService {
  private handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>()
  registerTool(name: string, _cfg: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>): void {
    this.handlers.set(name, handler)
  }
  invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    const h = this.handlers.get(name)
    if (!h) throw new Error(`tool not registered: ${name}`)
    return h(args)
  }
}

function parseReply(reply: unknown): { isError: boolean; text: string } {
  const r = reply as { isError?: boolean; content: { text: string }[] }
  return { isError: r.isError ?? false, text: r.content[0]?.text ?? '' }
}

/** A minimal scenario: `log.done` (a real completion handle) wired into a port
 * `ghostInput` the httpRequest node does not have. Nothing else is invalid, so
 * only the orphan edge can trigger a refusal. */
const orphanScenario = {
  id: 'scn-orphan', type: 'scenario', name: 'Orphan', tags: [], params: [], items: [],
  nodes: [
    { id: 'req', kind: 'httpRequest', config: {}, inputs: [], outputs: [] },
    { id: 'log', kind: 'log', config: {}, inputs: [], outputs: [] }
  ],
  edges: [{ id: 'e1', from: { nodeId: 'log', portId: 'done' }, to: { nodeId: 'req', portId: 'ghostInput' } }]
}

/** Same graph, but `log.done` targets the real `in` trigger — a clean run. */
const cleanScenario = {
  ...orphanScenario, id: 'scn-clean', name: 'Clean',
  edges: [{ id: 'e1', from: { nodeId: 'log', portId: 'done' }, to: { nodeId: 'req', portId: 'in' } }]
}

describe('run_scenario — orphan-edge refusal (real validator)', () => {
  beforeEach(() => { findByIdMock.mockReset(); startMock.mockReset() })

  it('refuses an orphan edge WITHOUT starting the engine, naming the stale port', async () => {
    findByIdMock.mockReturnValue(orphanScenario)
    const { registerScenarioEngineTools } = await import('./scenarioEngineTools')
    const mcp = new FakeMcpService()
    registerScenarioEngineTools(mcp as unknown as McpService)

    const reply = parseReply(await mcp.invoke('run_scenario', { scenarioId: 'scn-orphan' }))
    expect(reply.isError).toBe(true)
    expect(reply.text).toContain('no longer exists on it')
    expect(reply.text).toContain('ghostInput')
    expect(startMock).not.toHaveBeenCalled()
  })

  it('runs a clean scenario (engine started) — the gate is not over-broad', async () => {
    findByIdMock.mockReturnValue(cleanScenario)
    startMock.mockReturnValue({ scheduler: { runId: 'run-1' }, done: Promise.resolve({}) })
    const { registerScenarioEngineTools } = await import('./scenarioEngineTools')
    const mcp = new FakeMcpService()
    registerScenarioEngineTools(mcp as unknown as McpService)

    // Non-blocking: the gate lets the run through and the engine starts; we
    // don't exercise the blocking result-archive path here.
    const reply = parseReply(await mcp.invoke('run_scenario', { scenarioId: 'scn-clean', blocking: false }))
    expect(reply.isError).toBe(false)
    expect(startMock).toHaveBeenCalledTimes(1)
  })
})
