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
  collectionStore: {
    findById: (id: string) => mockState.findById(id),
    // Every scenario mutation bumps the model version at the mutation site (the
    // stale-mirror stale-write guard); the tools call it, so the mock needs it.
    bumpModelVersion: () => 0,
    // Mirror the real `updateScenario`: find, type-guard, shallow-assign.
    updateScenario: (id: string, updates: Record<string, unknown>) => {
      const s = mockState.findById(id)
      if (!s || (s as { type?: string }).type !== 'scenario') return null
      Object.assign(s, updates)
      return s
    }
  }
}))

interface FakeScenario {
  type: string
  id: string
  name: string
  notes?: string
  tags: string[]
  params: unknown[]
  nodes: { id: string; kind: string; config: Record<string, unknown>; inputs: { id: string }[]; outputs: { id: string }[]; position: { x: number; y: number }; note?: string; color?: string; collapsed?: boolean }[]
  edges: { id: string; from: { nodeId: string; portId: string }; to: { nodeId: string; portId: string }; selector?: string }[]
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

  it('arrange_scenario spreads a stacked graph left→right', async () => {
    // Three boxes, all defaulted to 0,0 (the shape an agent builds without
    // computing positions), wired into a chain.
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const b = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const c = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'data' })
    mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: b['nodeId'], fromPortId: 'done', toNodeId: c['nodeId'], toPortId: 'in' })
    expect(scenario.nodes.every((n) => n.position.x === 0 && n.position.y === 0)).toBe(true)

    const res = parse(await Promise.resolve(mcp.invoke('arrange_scenario', { scenarioId: 's1' })))
    expect(res['moved']).toBeGreaterThan(0)
    // The chained boxes step rightwards (layered RIGHT direction).
    const byId = new Map(scenario.nodes.map((n) => [n.id, n.position]))
    const ax = byId.get(a['nodeId'] as string)?.x ?? 0
    const bx = byId.get(b['nodeId'] as string)?.x ?? 0
    const cx = byId.get(c['nodeId'] as string)?.x ?? 0
    expect(bx).toBeGreaterThan(ax)
    expect(cx).toBeGreaterThan(bx)
  })

  it('arrange_scenario orders the downstream boxes by their source-port order', async () => {
    // An HTTP mock server: `connected` and `served` are rendered in that order,
    // then the implicit `done` at the bottom of the box. The three boxes they
    // feed are created in the REVERSE order on purpose — that creation order is
    // what a port-blind layout falls back to, and it's what used to cross the
    // links.
    const server = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'httpListen' }))
    const onDone = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const onServed = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const onConnected = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: server['nodeId'], fromPortId: 'done', toNodeId: onDone['nodeId'], toPortId: 'in' })
    mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: server['nodeId'], fromPortId: 'served', toNodeId: onServed['nodeId'], toPortId: 'data' })
    mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: server['nodeId'], fromPortId: 'connected', toNodeId: onConnected['nodeId'], toPortId: 'in' })

    const res = parse(await Promise.resolve(mcp.invoke('arrange_scenario', { scenarioId: 's1' })))
    expect(res['moved']).toBeGreaterThan(0)

    const byId = new Map(scenario.nodes.map((n) => [n.id, n.position]))
    const y = (node: Record<string, unknown>): number => byId.get(node['nodeId'] as string)?.y ?? Number.NaN
    // Top output's box on top, bottom output's box at the bottom.
    expect(y(onConnected)).toBeLessThan(y(onServed))
    expect(y(onServed)).toBeLessThan(y(onDone))
  })

  it('create_scenario_node with arrange=true repositions the whole graph', async () => {
    mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' })
    const res = parse(await Promise.resolve(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log', arrange: true, config: {} })))
    expect(res['arranged']).toBe(true)
    // Two boxes can't both stay at the same origin after a layout pass.
    const coords = new Set(scenario.nodes.map((n) => `${n.position.x},${n.position.y}`))
    expect(coords.size).toBe(2)
  })

  it('update_scenario patches name / notes / tags, leaving the graph untouched', () => {
    scenario.nodes.push({ id: 'n', kind: 'log', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } })
    const res = parse(mcp.invoke('update_scenario', { scenarioId: 's1', name: 'Renamed', notes: 'hi', tags: ['a', 'b'] }))
    expect(res).toEqual({ id: 's1', name: 'Renamed', notes: 'hi', tags: ['a', 'b'] })
    expect(scenario.name).toBe('Renamed')
    expect(scenario.notes).toBe('hi')
    expect(scenario.tags).toEqual(['a', 'b'])
    expect(scenario.nodes).toHaveLength(1) // graph not touched
  })

  it('update_scenario ignores an empty name but still applies notes', () => {
    const res = parse(mcp.invoke('update_scenario', { scenarioId: 's1', name: '', notes: 'kept' }))
    expect(scenario.name).toBe('Test') // unchanged
    expect(res['notes']).toBe('kept')
  })

  it('update_scenario rejects an unknown scenario id', () => {
    expect(mcp.invoke('update_scenario', { scenarioId: 'nope', name: 'x' }).isError).toBe(true)
  })

  it('connect_scenario_nodes validates ports + adds an edge', () => {
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const b = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const res = parse(mcp.invoke('connect_scenario_nodes', {
      scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'data'
    }))
    expect(res['edgeId']).toBeTruthy()
    expect(scenario.edges).toHaveLength(1)
  })

  it('connect rejects a second incoming link on a non-header input', () => {
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const a2 = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const b = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const first = mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'data' })
    expect(first.isError).toBeUndefined()
    const second = mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: a2['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'data' })
    expect(second.isError).toBe(true)
    expect(scenario.edges).toHaveLength(1)
  })

  it('connects to a runScenario input port derived from its sub-scenario', () => {
    // A sub-scenario with one named input → runScenario exposes `param:token`.
    const sub = {
      type: 'scenario', id: 'sub1', name: 'Sub', tags: [], params: [],
      nodes: [{ id: 'i1', kind: 'input', config: { name: 'token' }, inputs: [], outputs: [], position: { x: 0, y: 0 } }],
      edges: []
    }
    mockState.findById.mockImplementation((id) => (id === 's1' ? scenario : id === 'sub1' ? sub : null))
    const now = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const rs = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'runScenario', config: { scenarioId: 'sub1' } }))
    const res = mcp.invoke('connect_scenario_nodes', {
      scenarioId: 's1', fromNodeId: now['nodeId'], fromPortId: 'value', toNodeId: rs['nodeId'], toPortId: 'param:token'
    })
    expect(res.isError).toBeUndefined()
    expect(scenario.edges).toHaveLength(1)
  })

  it('connects a runScenario `done` signal (sub-scenario returns no data) into a launch input', () => {
    // A sub-scenario with only an input node → its runScenario exposes a `done`
    // completion trigger, which can sequence the next node's launch input.
    const sub = {
      type: 'scenario', id: 'sub1', name: 'Sub', tags: [], params: [],
      nodes: [{ id: 'i1', kind: 'input', config: { name: 'token' }, inputs: [], outputs: [], position: { x: 0, y: 0 } }],
      edges: []
    }
    mockState.findById.mockImplementation((id) => (id === 's1' ? scenario : id === 'sub1' ? sub : null))
    const rs = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'runScenario', config: { scenarioId: 'sub1' } }))
    const target = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'if' }))
    const res = mcp.invoke('connect_scenario_nodes', {
      scenarioId: 's1', fromNodeId: rs['nodeId'], fromPortId: 'done', toNodeId: target['nodeId'], toPortId: 'in'
    })
    expect(res.isError).toBeUndefined()
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
    mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'data' })
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
    const edge = parse(mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'data' }))
    mcp.invoke('disconnect_scenario_nodes', { scenarioId: 's1', edgeId: edge['edgeId'] })
    expect(scenario.edges).toHaveLength(0)
  })

  it('get_scenario returns the graph', () => {
    mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' })
    const res = parse(mcp.invoke('get_scenario', { scenarioId: 's1' }))
    expect(res['id']).toBe('s1')
    expect((res['nodes'] as unknown[]).length).toBe(1)
  })

  it('set_edge_selector sets then clears an existing edge selector', () => {
    const a = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'now' }))
    const b = parse(mcp.invoke('create_scenario_node', { scenarioId: 's1', kind: 'log' }))
    const edge = parse(mcp.invoke('connect_scenario_nodes', { scenarioId: 's1', fromNodeId: a['nodeId'], fromPortId: 'value', toNodeId: b['nodeId'], toPortId: 'data' }))
    const set = parse(mcp.invoke('set_edge_selector', { scenarioId: 's1', edgeId: edge['edgeId'], selector: 'data.cooldown.total_seconds' }))
    expect(set['selector']).toBe('data.cooldown.total_seconds')
    expect(scenario.edges[0]?.selector).toBe('data.cooldown.total_seconds')
    // Empty string clears it.
    const cleared = parse(mcp.invoke('set_edge_selector', { scenarioId: 's1', edgeId: edge['edgeId'], selector: '' }))
    expect(cleared['selector']).toBeUndefined()
    expect(scenario.edges[0]?.selector).toBeUndefined()
  })

  it('set_edge_selector rejects an unknown edge id', () => {
    expect(mcp.invoke('set_edge_selector', { scenarioId: 's1', edgeId: 'nope', selector: 'x' }).isError).toBe(true)
  })

  it('define_param adds an input node carrying the param name, default + required', () => {
    const res = parse(mcp.invoke('define_param', {
      scenarioId: 's1',
      name: 'character',
      valueType: { type: 'string', value: 'Glaude' },
      required: true
    }))
    expect(res['kind']).toBe('input')
    expect(res['name']).toBe('character')
    expect(scenario.nodes).toHaveLength(1)
    const node = scenario.nodes[0]
    expect(node?.kind).toBe('input')
    expect(node?.config['name']).toBe('character')
    expect(node?.config['required']).toBe(true)
    expect(node?.config['valueType']).toEqual({ type: 'string', value: 'Glaude' })
  })

  it('define_param rejects an empty name', () => {
    expect(mcp.invoke('define_param', { scenarioId: 's1', name: '' }).isError).toBe(true)
  })
})
