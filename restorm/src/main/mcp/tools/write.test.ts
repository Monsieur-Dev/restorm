import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'

class FakeMcpService {
  private handlers = new Map<string, McpToolHandler>()
  registerTool(name: string, _config: McpToolConfig, handler: McpToolHandler): void {
    this.handlers.set(name, handler)
  }
  registerResource(): void { /* unused */ }
  invoke(name: string, args: Record<string, unknown> = {}): { content: { type: 'text'; text: string }[]; isError?: true } {
    const handler = this.handlers.get(name)
    if (!handler) throw new Error(`tool "${name}" not registered`)
    return handler(args, {}) as { content: { type: 'text'; text: string }[]; isError?: true }
  }
}

interface FakeScenario {
  type: 'scenario'
  id: string
  name: string
  nodes: unknown[]
  edges: unknown[]
}

interface FakeFolder {
  id: string
  name: string
  items: unknown[]
}

const mockState = {
  findById: vi.fn<(id: string) => unknown>(),
  createScenario: vi.fn<(parentId: string, init: { name: string }) => FakeScenario>()
}

const updateScenarioSpy = vi.fn<(id: string, updates: Record<string, unknown>) => unknown>()

const broadcastSpy = vi.fn<() => void>()
const getAllWindowsSpy = vi.fn<() => unknown[]>(() => [])

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => getAllWindowsSpy() }
}))

vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    findById: (id: string) => mockState.findById(id),
    createScenario: (parentId: string, init: { name: string }) => mockState.createScenario(parentId, init),
    updateScenario: (id: string, updates: Record<string, unknown>) => updateScenarioSpy(id, updates)
  }
}))

vi.mock('./import', () => ({
  broadcastTreeReplace: () => { broadcastSpy() }
}))

vi.mock('./scenario', () => ({ broadcastScenario: () => { broadcastSpy() } }))

function parse(result: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

describe('create_scenario MCP tool', () => {
  let mcp: FakeMcpService

  beforeEach(async () => {
    mockState.findById.mockReset()
    mockState.createScenario.mockReset()
    updateScenarioSpy.mockReset()
    broadcastSpy.mockReset()
    getAllWindowsSpy.mockReset()
    getAllWindowsSpy.mockImplementation(() => [])
    mcp = new FakeMcpService()
    // Dynamic import so the vi.mock declarations above land first.
    const { registerWriteTools } = await import('./write')
    registerWriteTools(mcp as unknown as McpService)
  })

  it('rejects an empty parentId', () => {
    const res = mcp.invoke('create_scenario', { parentId: '', name: 'New' })
    expect(res.isError).toBe(true)
    expect(mockState.createScenario).not.toHaveBeenCalled()
  })

  it('rejects an empty name', () => {
    const res = mcp.invoke('create_scenario', { parentId: 'folder-1', name: '' })
    expect(res.isError).toBe(true)
    expect(mockState.createScenario).not.toHaveBeenCalled()
  })

  it('rejects a parentId that points at a request (only folders + scenarios accept children)', () => {
    const fakeRequest = { type: 'http', id: 'req-1', name: 'Some request' }
    mockState.findById.mockImplementation((id) => (id === 'req-1' ? fakeRequest : null))
    const res = mcp.invoke('create_scenario', { parentId: 'req-1', name: 'New' })
    expect(res.isError).toBe(true)
    expect(mockState.createScenario).not.toHaveBeenCalled()
  })

  it('creates the scenario under a folder + broadcasts + triggers save', () => {
    const folder: FakeFolder = { id: 'folder-1', name: 'Folder', items: [] }
    const created: FakeScenario = { type: 'scenario', id: 'scn-new', name: 'New scenario', nodes: [], edges: [] }
    mockState.findById.mockImplementation((id) => (id === 'folder-1' ? folder : null))
    mockState.createScenario.mockImplementation(() => created)

    const res = mcp.invoke('create_scenario', { parentId: 'folder-1', name: 'New scenario' })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({ id: 'scn-new', name: 'New scenario', parentId: 'folder-1' })
    expect(mockState.createScenario).toHaveBeenCalledWith('folder-1', { name: 'New scenario' })
    expect(broadcastSpy).toHaveBeenCalledTimes(1)
    // `triggerSave` walks `BrowserWindow.getAllWindows()` to broadcast the
    // autosave IPC — the call is the wire-level proxy for "save was kicked".
    expect(getAllWindowsSpy).toHaveBeenCalled()
  })

  it('accepts a parent that is itself a scenario (scenarios double as folder-like containers)', () => {
    const parentScenario: FakeScenario = { type: 'scenario', id: 'parent-scn', name: 'Parent', nodes: [], edges: [] }
    const created: FakeScenario = { type: 'scenario', id: 'child-scn', name: 'Child', nodes: [], edges: [] }
    mockState.findById.mockImplementation((id) => (id === 'parent-scn' ? parentScenario : null))
    mockState.createScenario.mockImplementation(() => created)

    const res = mcp.invoke('create_scenario', { parentId: 'parent-scn', name: 'Child' })
    expect(res.isError).toBeUndefined()
    expect(parse(res).parentId).toBe('parent-scn')
    expect(mockState.createScenario).toHaveBeenCalledWith('parent-scn', { name: 'Child' })
  })

  it('rename_item renames a scenario through updateScenario', () => {
    const scenario: FakeScenario = { type: 'scenario', id: 's1', name: 'Old', nodes: [], edges: [] }
    mockState.findById.mockImplementation((id) => (id === 's1' ? scenario : null))
    updateScenarioSpy.mockImplementation((id, updates) => {
      if (id !== 's1') return null
      Object.assign(scenario, updates)
      return scenario
    })
    const res = mcp.invoke('rename_item', { id: 's1', newName: 'New' })
    expect(res.isError).toBeUndefined()
    expect(parse(res)).toEqual({ id: 's1', kind: 'scenario', name: 'New' })
    expect(updateScenarioSpy).toHaveBeenCalledWith('s1', { name: 'New' })
    expect(scenario.name).toBe('New')
    // broadcastScenario (mocked onto broadcastSpy) repaints editor + sidebar.
    expect(broadcastSpy).toHaveBeenCalled()
  })
})
