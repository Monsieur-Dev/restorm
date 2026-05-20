import { describe, it, expect } from 'vitest'
import {
  scenarioEdgeToFlowEdge,
  flowEdgeToScenarioEdge,
  DEFAULT_SOURCE_PORT,
  DEFAULT_TARGET_PORT
} from '../../src/renderer/src/components/Scenario/scenarioGraphMapping'
import type { ScenarioEdge } from '../../src/shared/types/collections'

describe('scenario graph edge mapping', () => {
  it('round-trips a fully-specified edge (id/ports/selector/color preserved)', () => {
    const edge: ScenarioEdge = {
      id: 'e1',
      from: { nodeId: 'a', portId: 'response' },
      to: { nodeId: 'b', portId: 'in' },
      selector: '$.cooldown.expiration',
      color: '#22c55e'
    }
    const flow = scenarioEdgeToFlowEdge(edge)
    expect(flow).toMatchObject({
      id: 'e1', source: 'a', target: 'b', sourceHandle: 'response', targetHandle: 'in', style: { stroke: '#22c55e' }
    })
    // React Flow only round-trips source/target/handles; selector/color
    // come back from the prior edge.
    const back = flowEdgeToScenarioEdge(flow, edge)
    expect(back).toEqual(edge)
  })

  it('a freshly-drawn connection (no prior, no handles) gets default ports', () => {
    const back = flowEdgeToScenarioEdge({ id: 'e2', source: 'a', target: 'b' })
    expect(back).toEqual({
      id: 'e2',
      from: { nodeId: 'a', portId: DEFAULT_SOURCE_PORT },
      to: { nodeId: 'b', portId: DEFAULT_TARGET_PORT }
    })
    expect(back.selector).toBeUndefined()
    expect(back.color).toBeUndefined()
  })

  it('explicit handles win over the prior edge ports', () => {
    const prior: ScenarioEdge = { id: 'e3', from: { nodeId: 'a', portId: 'then' }, to: { nodeId: 'b', portId: 'in' } }
    const back = flowEdgeToScenarioEdge({ id: 'e3', source: 'a', target: 'b', sourceHandle: 'else', targetHandle: 'x' }, prior)
    expect(back.from.portId).toBe('else')
    expect(back.to.portId).toBe('x')
  })

  it('omits style/handles when the edge has no color/ports', () => {
    const flow = scenarioEdgeToFlowEdge({ id: 'e4', from: { nodeId: 'a', portId: '' }, to: { nodeId: 'b', portId: '' } })
    expect(flow.style).toBeUndefined()
    expect(flow.sourceHandle).toBeUndefined()
    expect(flow.targetHandle).toBeUndefined()
  })
})
