import { describe, it, expect } from 'vitest'
import { scenarioNodeHandleIds, findOrphanScenarioEdges, type OrphanCheckNode, type ScenarioEdgeEndpoints } from './scenarioValidation'

const node = (id: string, kind: OrphanCheckNode['kind'], config?: Record<string, unknown>): OrphanCheckNode => ({ id, kind, config })
const edge = (from: [string, string], to: [string, string]): ScenarioEdgeEndpoints => ({ id: `${from.join(':')}->${to.join(':')}`, from: { nodeId: from[0], portId: from[1] }, to: { nodeId: to[0], portId: to[1] } })

describe('scenarioNodeHandleIds — the CURRENT handle set of a node', () => {
  it('includes the capability-derived done/error outputs, absent from the static port map', () => {
    const { outputs } = scenarioNodeHandleIds('httpRequest', {})
    expect(outputs.has('response')).toBe(true) // static
    expect(outputs.has('done')).toBe(true) // hasDonePort
    expect(outputs.has('error')).toBe(true) // hasErrorPort
  })

  it('omits done/error where the kind opts out of them (output sink)', () => {
    const { outputs } = scenarioNodeHandleIds('output', {})
    expect(outputs.has('done')).toBe(false)
    expect(outputs.has('error')).toBe(false)
  })

  it('carries the universal implicit in/done inputs on every kind', () => {
    for (const kind of ['httpRequest', 'output', 'setVariable', 'switch'] as const) {
      const { inputs } = scenarioNodeHandleIds(kind, {})
      expect(inputs.has('in')).toBe(true)
      expect(inputs.has('done')).toBe(true)
    }
  })

  it('derives object property (prop-) inputs from config', () => {
    const { inputs } = scenarioNodeHandleIds('object', { properties: [{ id: 'prop-a' }, { id: 'prop-b' }] })
    expect(inputs.has('prop-a')).toBe(true)
    expect(inputs.has('prop-b')).toBe(true)
    expect(inputs.has('prop-gone')).toBe(false)
  })

  it('derives switch case outputs from config — including the seeded switch-default-case id', () => {
    const { outputs } = scenarioNodeHandleIds('switch', { cases: [{ id: 'case-x' }, { id: 'switch-default-case' }] })
    expect(outputs.has('default')).toBe(true) // static
    expect(outputs.has('case-x')).toBe(true)
    expect(outputs.has('switch-default-case')).toBe(true)
  })

  it('derives socketio event: outputs from config.events', () => {
    const { outputs } = scenarioNodeHandleIds('socketioConnect', { events: ['message', 'tick'] })
    expect(outputs.has('event:message')).toBe(true)
    expect(outputs.has('event:tick')).toBe(true)
  })

  it('derives list-mutation value-row inputs from config.values', () => {
    const { inputs } = scenarioNodeHandleIds('addToList', { values: [{ id: 'val-1' }, { id: 'val-2' }] })
    expect(inputs.has('list')).toBe(true) // static
    expect(inputs.has('val-1')).toBe(true)
    expect(inputs.has('val-2')).toBe(true)
  })

  it('derives output-decl value inputs from config.outputs', () => {
    const { inputs } = scenarioNodeHandleIds('output', { outputs: [{ id: 'out-1', name: 'a' }, { id: 'out-2', name: 'b' }] })
    expect(inputs.has('out-1')).toBe(true)
    expect(inputs.has('out-2')).toBe(true)
  })
})

describe('findOrphanScenarioEdges', () => {
  it('flags a target input wired to a removed object property', () => {
    const scenario = {
      nodes: [node('src', 'httpRequest'), node('obj', 'object', { properties: [{ id: 'prop-live' }] })],
      edges: [edge(['src', 'response'], ['obj', 'prop-gone'])]
    }
    const orphans = findOrphanScenarioEdges(scenario)
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ nodeId: 'obj', side: 'target', portId: 'prop-gone', kind: 'object' })
  })

  it('flags a source output wired from a removed switch case', () => {
    const scenario = {
      nodes: [node('sw', 'switch', { cases: [{ id: 'case-live' }] }), node('log', 'log')],
      edges: [edge(['sw', 'case-gone'], ['log', 'in'])]
    }
    const orphans = findOrphanScenarioEdges(scenario)
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ nodeId: 'sw', side: 'source', portId: 'case-gone' })
  })

  it('does NOT flag edges on the capability-derived done / error handles', () => {
    const scenario = {
      nodes: [node('a', 'httpRequest'), node('b', 'setVariable')],
      edges: [edge(['a', 'done'], ['b', 'in']), edge(['a', 'error'], ['b', 'value'])]
    }
    expect(findOrphanScenarioEdges(scenario)).toEqual([])
  })

  it('accepts a runScenario param: / output: handle wholesale (sub-scenario not resolved here)', () => {
    const scenario = {
      nodes: [node('rs', 'runScenario', { scenarioId: 'sub' }), node('log', 'log')],
      edges: [edge(['log', 'done'], ['rs', 'param:anything']), edge(['rs', 'output:whatever'], ['log', 'in'])]
    }
    expect(findOrphanScenarioEdges(scenario)).toEqual([])
  })

  it('ignores an edge whose node no longer exists (a dangling node ref is a separate concern)', () => {
    const scenario = {
      nodes: [node('a', 'httpRequest')],
      edges: [edge(['ghost', 'x'], ['a', 'in']), edge(['a', 'response'], ['ghost', 'y'])]
    }
    expect(findOrphanScenarioEdges(scenario)).toEqual([])
  })

  it('flags a persisted edge to a STATIC port id the kind no longer declares — the port-rename case', () => {
    // Simulates a rename in the kind registry: the saved edge still points at
    // the OLD static port id, which is not in the node's CURRENT handle set.
    // Detection derives handles from the live registry, never the persisted
    // stamp, so already-saved projects are caught, not only freshly-drawn edges.
    const scenario = {
      nodes: [node('req', 'httpRequest'), node('log', 'log')],
      edges: [
        edge(['req', 'response'], ['log', 'in']), // current static ports — clean
        edge(['req', 'legacyResponse'], ['log', 'message']), // renamed source → orphan
        edge(['log', 'done'], ['req', 'legacyEnv']) // renamed target input → orphan
      ]
    }
    const orphans = findOrphanScenarioEdges(scenario)
    expect(orphans.map((o) => o.portId).sort()).toEqual(['legacyEnv', 'legacyResponse'])
  })

  it('returns nothing for a fully valid graph', () => {
    const scenario = {
      nodes: [node('req', 'httpRequest'), node('obj', 'object', { properties: [{ id: 'prop-a' }] }), node('out', 'output', { outputs: [{ id: 'out-1', name: 'r' }] })],
      edges: [edge(['req', 'response'], ['obj', 'prop-a']), edge(['obj', 'object'], ['out', 'out-1'])]
    }
    expect(findOrphanScenarioEdges(scenario)).toEqual([])
  })
})
