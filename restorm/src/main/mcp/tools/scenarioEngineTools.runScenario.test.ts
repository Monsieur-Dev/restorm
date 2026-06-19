import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpService } from 'electron-core-ui'

// run_scenario must validate the scenario EXISTS before it records a usage
// entry or starts the engine — a bogus id used to slip past the editor-error
// gate (which returns "no errors" for a non-existent scenario) and inflate the
// recent-activity list / hit the engine for nothing.

interface FakeHandle { scheduler: { runId: string }; done: Promise<Record<string, unknown>> }
const findByIdMock = vi.fn<(id: string) => unknown>()
const startMock = vi.fn<(...args: unknown[]) => FakeHandle>()
const recordRunMock = vi.fn<(...args: unknown[]) => void>()

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
    // Registration installs a one-time event capture; the existence/usage
    // tests don't exercise events, so a no-op subscription is enough.
    onAnyEvent: () => undefined
  }
}))
vi.mock('../../services', () => ({
  scenarioUsageService: { recordRun: (...args: unknown[]): void => { recordRunMock(...args) } }
}))
vi.mock('../../../shared/scenarioValidation', () => ({
  validateScenarioModel: () => new Map()
}))

/** Minimal MCP host that captures registered handlers so a test can invoke
 * a tool by name. */
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

describe('run_scenario — existence gate + usage ordering', () => {
  beforeEach(() => {
    findByIdMock.mockReset()
    startMock.mockReset()
    recordRunMock.mockReset()
  })

  it('errors on a non-existent scenario id WITHOUT recording usage or starting the engine', async () => {
    findByIdMock.mockReturnValue(null)
    const { registerScenarioEngineTools } = await import('./scenarioEngineTools')
    const mcp = new FakeMcpService()
    registerScenarioEngineTools(mcp as unknown as McpService)

    const reply = parseReply(await mcp.invoke('run_scenario', { scenarioId: 'ghost' }))
    expect(reply.isError).toBe(true)
    expect(reply.text).toContain('No scenario found')
    expect(recordRunMock).not.toHaveBeenCalled()
    expect(startMock).not.toHaveBeenCalled()
  })

  it('records usage only AFTER the engine start for a valid scenario', async () => {
    findByIdMock.mockReturnValue({ id: 'scn-1', type: 'scenario', name: 'S', nodes: [], edges: [], params: [], items: [], tags: [] })
    const callOrder: string[] = []
    startMock.mockImplementation(() => {
      callOrder.push('start')
      return { scheduler: { runId: 'run-1' }, done: Promise.resolve({}) }
    })
    recordRunMock.mockImplementation(() => { callOrder.push('recordRun') })

    const { registerScenarioEngineTools } = await import('./scenarioEngineTools')
    const mcp = new FakeMcpService()
    registerScenarioEngineTools(mcp as unknown as McpService)

    const reply = parseReply(await mcp.invoke('run_scenario', { scenarioId: 'scn-1', blocking: false }))
    expect(reply.isError).toBe(false)
    expect(startMock).toHaveBeenCalledTimes(1)
    expect(recordRunMock).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['start', 'recordRun'])
  })
})
