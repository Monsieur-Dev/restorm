import { describe, it, expect } from 'vitest'
import type { Scenario, ScenarioNodeKind } from './types/collections'
import { deriveRunScenarioPorts, defaultPortsForKind, isValidScenarioConnection, dataTypesCompatible } from './scenarioNodePorts'
import { acceptsInputEvent } from './scenarioNodeCapabilities'
import { LIST_MUTATION_DEFAULT_VALUE_ID } from './scenarioListMutationValues'

describe('defaultPortsForKind — header `in` trigger from the capability', () => {
  const hasIn = (kind: ScenarioNodeKind): boolean =>
    defaultPortsForKind(kind).inputs.some((p) => p.id === 'in')

  it('stamps the `in` trigger for a data-driven kind (comparator)', () => {
    expect(hasIn('comparator')).toBe(true)
    // and it comes FIRST, ahead of the kind's own value inputs
    expect(defaultPortsForKind('comparator').inputs[0]?.id).toBe('in')
  })

  it('stamps `in` for object / map / filter / aggregate / boolean too', () => {
    for (const k of ['object', 'map', 'filter', 'aggregate', 'boolean'] as ScenarioNodeKind[]) {
      expect(hasIn(k), `${k} should carry the in trigger`).toBe(true)
    }
  })

  it('stamps `in` for the `output` sink too (it can be sequenced)', () => {
    expect(hasIn('output')).toBe(true)
    expect(acceptsInputEvent('output')).toBe(true)
  })

  it('keeps `in` first on a kind that already had it (if)', () => {
    expect(defaultPortsForKind('if').inputs.map((p) => p.id)).toEqual(['in', 'left', 'right'])
  })
})

/** Minimal sub-scenario fixture — only `nodes` (kind + config) matter. */
function scenarioWith(nodes: { kind: string; config: Record<string, unknown> }[]): Scenario {
  return { type: 'scenario', id: 's', name: 'Sub', tags: [], params: [], nodes, edges: [] } as unknown as Scenario
}

describe('deriveRunScenarioPorts — runScenario ports from the sub-scenario', () => {
  it('derives one input port per named input node and one output port per named output node (>1 source → sorted)', () => {
    const sub = scenarioWith([
      { kind: 'input', config: { name: 'token', valueType: { type: 'string', value: '' } } },
      { kind: 'input', config: { name: 'count', valueType: { type: 'numeric', value: 0, format: 'decimal' } } },
      { kind: 'output', config: { name: 'cooldown' } },
      { kind: 'if', config: {} }
    ])
    const { inputs, outputs } = deriveRunScenarioPorts(sub)
    // Two input nodes → more than one source → ports sorted alphabetically.
    expect(inputs.map((p) => [p.id, p.name, p.dataType])).toEqual([
      ['param:count', 'count', 'number'],
      ['param:token', 'token', 'string']
    ])
    // A single output node → one source → its own order is kept.
    expect(outputs.map((p) => [p.id, p.name])).toEqual([['output:cooldown', 'cooldown']])
  })

  it('keeps declaration order when all ports come from a SINGLE source node', () => {
    const sub = scenarioWith([
      { kind: 'input', config: { params: [
        { id: 'p1', name: 'token' },
        { id: 'p2', name: 'count' },
        { id: 'p3', name: 'abc' }
      ] } }
    ])
    // One input node → no cross-source ambiguity → original order, NOT sorted.
    expect(deriveRunScenarioPorts(sub).inputs.map((p) => p.name)).toEqual(['token', 'count', 'abc'])
  })

  it('skips unnamed/blank nodes and collapses duplicate names', () => {
    const sub = scenarioWith([
      { kind: 'input', config: { name: 'a' } },
      { kind: 'input', config: {} },
      { kind: 'input', config: { name: '  ' } },
      { kind: 'input', config: { name: 'a' } }
    ])
    expect(deriveRunScenarioPorts(sub).inputs.map((p) => p.id)).toEqual(['param:a'])
  })

  it('excludes an input node fed from a predecessor (internally driven, not a caller param)', () => {
    const sub = {
      type: 'scenario', id: 's', name: 'Sub', tags: [], params: [],
      nodes: [
        { id: 'free-1', kind: 'input', config: { name: 'token' } },
        { id: 'free-2', kind: 'input', config: { name: 'count' } },
        { id: 'driven', kind: 'input', config: { name: 'secondInput' } }
      ],
      // `free-2`'s value feeds `driven`'s `in` trigger → `driven` is wired from a
      // predecessor, so its value comes from inside the sub-scenario, not the caller.
      edges: [
        { id: 'e1', from: { nodeId: 'free-2', portId: 'value' }, to: { nodeId: 'driven', portId: 'in' } }
      ]
    } as unknown as Scenario
    // Only the two FREE inputs surface (sorted, >1 source); the predecessor-fed
    // one is dropped. Being an edge SOURCE (`free-2`) does not exclude a node.
    expect(deriveRunScenarioPorts(sub).inputs.map((p) => p.name)).toEqual(['count', 'token'])
  })

  it('derives NO output port when the sub-scenario returns no data (the box`s universal `done` port covers completion)', () => {
    const sub = scenarioWith([{ kind: 'input', config: { name: 'token' } }])
    expect(deriveRunScenarioPorts(sub).outputs).toEqual([])
  })

  it('omits any derived output once the sub-scenario declares an output node', () => {
    const sub = scenarioWith([
      { kind: 'input', config: { name: 'token' } },
      { kind: 'output', config: { name: 'cooldown' } }
    ])
    expect(deriveRunScenarioPorts(sub).outputs.map((p) => p.id)).toEqual(['output:cooldown'])
  })

  it('derives one output port per decl of a MULTI-output node (plus legacy single), sorted across >1 source', () => {
    const sub = scenarioWith([
      { kind: 'output', config: { outputs: [{ id: 'd1', name: 'first' }, { id: 'd2', name: 'second' }] } },
      { kind: 'output', config: { name: 'legacy' } }
    ])
    // Two output nodes → more than one source → sorted alphabetically.
    expect(deriveRunScenarioPorts(sub).outputs.map((p) => p.id)).toEqual(['output:first', 'output:legacy', 'output:second'])
  })

  it('returns empty ports for a missing sub-scenario', () => {
    expect(deriveRunScenarioPorts(null)).toEqual({ inputs: [], outputs: [] })
  })
})

describe('dataTypesCompatible — list vs object vs json', () => {
  it('json and list are mutually compatible (an array IS json); any is a wildcard', () => {
    expect(dataTypesCompatible('json', 'list')).toBe(true)
    expect(dataTypesCompatible('list', 'json')).toBe(true)
    expect(dataTypesCompatible('any', 'list')).toBe(true)
    expect(dataTypesCompatible('list', 'list')).toBe(true)
  })

  it('a plain object is NOT a list, and unrelated scalars stay incompatible', () => {
    expect(dataTypesCompatible('object', 'list')).toBe(false)
    expect(dataTypesCompatible('string', 'number')).toBe(false)
  })
})

describe('isValidScenarioConnection — list-only target', () => {
  const connect = (
    sourceKind: ScenarioNodeKind, sourceHandle: string,
    targetKind: ScenarioNodeKind, targetHandle: string
  ): boolean => isValidScenarioConnection({
    sourceKind, sourceOutputs: defaultPortsForKind(sourceKind).outputs, sourceHandle,
    targetKind, targetInputs: defaultPortsForKind(targetKind).inputs, targetHandle
  })

  it('rejects an object output wired onto the AddToList/RemoveFromList `list` target', () => {
    expect(connect('object', 'object', 'addToList', 'list')).toBe(false)
    expect(connect('object', 'object', 'removeFromList', 'list')).toBe(false)
  })

  it('accepts a list/json source (map.mapped) onto the `list` target', () => {
    expect(connect('map', 'mapped', 'addToList', 'list')).toBe(true)
  })

  it('accepts an `any` source (getVariable.value) onto the `list` target (unknown type, not blocked)', () => {
    expect(connect('getVariable', 'value', 'addToList', 'list')).toBe(true)
  })

  it('accepts an object onto a VALUE row (the default value-row port, type any)', () => {
    expect(connect('object', 'object', 'addToList', LIST_MUTATION_DEFAULT_VALUE_ID)).toBe(true)
  })

  it('rejects a STALE-typed object output (persisted as json) onto a list target — canonical type wins', () => {
    // A node persisted before object's output became `object` still carries
    // dataType `json`; the canonical (fresh-from-defaults) lookup resolves it to
    // `object`, so it's still refused.
    const staleObjectOutputs = [{ id: 'object', name: 'object', dataType: 'json' as const }]
    expect(isValidScenarioConnection({
      sourceKind: 'object', sourceOutputs: staleObjectOutputs, sourceHandle: 'object',
      targetKind: 'addToList', targetInputs: defaultPortsForKind('addToList').inputs, targetHandle: 'list'
    })).toBe(false)
  })

  it('rejects onto a STALE-typed list target (persisted as json) — canonical type wins', () => {
    const staleAddInputs = [{ id: 'in', name: '', dataType: 'any' as const }, { id: 'list', name: 'list', dataType: 'json' as const }]
    expect(isValidScenarioConnection({
      sourceKind: 'object', sourceOutputs: defaultPortsForKind('object').outputs, sourceHandle: 'object',
      targetKind: 'addToList', targetInputs: staleAddInputs, targetHandle: 'list'
    })).toBe(false)
  })
})
