import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpService, McpToolConfig, McpToolHandler } from 'electron-core-ui'
import { registerScenarioTools } from './scenario'

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

const mockState = { findById: vi.fn<(id: string) => unknown>() }

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { on: () => { /* noop */ }, removeAllListeners: () => { /* noop */ } }
}))
vi.mock('./import', () => ({ broadcastTreeReplace: () => { /* noop */ } }))
vi.mock('../../services/CollectionStore', () => ({
  collectionStore: { findById: (id: string) => mockState.findById(id) }
}))

interface FakeScenario {
  type: string
  id: string
  name: string
  notes?: string
  tags: string[]
  params: unknown[]
  nodes: { id: string; kind: string; config: Record<string, unknown>; inputs: { id: string }[]; outputs: { id: string }[]; position: { x: number; y: number }; note?: string; color?: string; collapsed?: boolean }[]
  edges: { id: string; from: { nodeId: string; portId: string }; to: { nodeId: string; portId: string } }[]
}

function makeScenario(): FakeScenario {
  return { type: 'scenario', id: 's1', name: 'Test', tags: [], params: [], nodes: [], edges: [] }
}

function parse(result: { content: { type: 'text'; text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}

describe('scenario MCP tools', () => {
  let mcp: FakeMcpService
  let scenario: FakeScenario

  beforeEach(() => {
    scenario = makeScenario()
    mockState.findById.mockReset()
    mockState.findById.mockImplementation((id) => (id === 's1' ? scenario : null))
    mcp = new FakeMcpService()
    registerScenarioTools(mcp as unknown as McpService)
  })

  it('create_scenario_node stamps default ports + appends the node', () => {
    const res = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'if', x: 10, y: 20 }))
    expect(res['kind']).toBe('if')
    expect(res['position']).toEqual({ x: 10, y: 20 })
    expect((res['inputs'] as unknown[]).length).toBe(3) // if → in (trigger) + left + right
    expect(scenario.nodes).toHaveLength(1)
    expect(scenario.nodes[0]?.id).toBe(res['nodeId'])
  })

  it('rejects an unknown scenario id', () => {
    const res = mcp.invoke('create_scenario_node', { scenarioId: 'nope', kind: 'log' })
    expect(res.isError).toBe(true)
  })

  it('connect_scenario_nodes validates ports + adds an edge', () => {
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const b = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const res = parse(mcp.invoke('connect_scenario_nodes', {
      scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'value'
    }))
    expect(res['edgeId']).toBeTruthy()
    expect(scenario.edges).toHaveLength(1)
  })

  it('connect rejects a port that is not on the node', () => {
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const b = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const res = mcp.invoke('connect_scenario_nodes', {
      scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'nope'
    })
    expect(res.isError).toBe(true)
  })

  it('delete_scenario_node removes the node + its edges', () => {
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const b = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'value' })
    const res = parse(mcp.invoke('delete_scenario_node', { scenarioId: 's1', nodeId: a['nodeId'] }))
    expect(res['deletedNodeId']).toBe(a['nodeId'])
    expect((res['deletedEdgeIds'] as unknown[]).length).toBe(1)
    expect(scenario.nodes).toHaveLength(1)
    expect(scenario.edges).toHaveLength(0)
  })

  it('update_scenario_node merges config, deletes null keys, and moves', () => {
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'input', config: { name: 'foo', drop: 'me' } }))
    mcp.invoke('update_scenario_node', { scenarioId: 's1', nodeId: a['nodeId'], config: { name: 'bar', drop: null }, x: 99, y: 5, note: 'hi' })
    const node = scenario.nodes[0]
    expect(node?.config['name']).toBe('bar')
    expect(node ? 'drop' in node.config : true).toBe(false)
    expect(node?.position).toEqual({ x: 99, y: 5 })
    expect(node?.note).toBe('hi')
  })

  it('disconnect_scenario_nodes removes an edge by id', () => {
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const b = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const edge = parse(mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'value' }))
    mcp.invoke('disconnect_scenario_nodes', { scenarioId: 's1', edgeId: edge['edgeId'] })
    expect(scenario.edges).toHaveLength(0)
  })

  it('get_scenario returns the graph', () => {
    mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' })
    const res = parse(mcp.invoke('get_scenario', { scenarioId: 's1' }))
    expect(res['id']).toBe('s1')
    expect((res['nodes'] as unknown[]).length).toBe(1)
  })
})
