import { describe, it, expect } from 'vitest'
import type { Scenario, ScenarioNodeKind } from './types/collections'
import { deriveRunScenarioPorts, defaultPortsForKind } from './scenarioNodePorts'
import { acceptsInputEvent } from './scenarioNodeCapabilities'

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

  it('does NOT stamp `in` for the `output` sink', () => {
    expect(hasIn('output')).toBe(false)
    expect(acceptsInputEvent('output')).toBe(false)
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
  it('derives one input port per named input node and one output port per named output node', () => {
    const sub = scenarioWith([
      { kind: 'input', config: { name: 'token', valueType: { type: 'string', value: '' } } },
      { kind: 'input', config: { name: 'count', valueType: { type: 'numeric', value: 0, format: 'decimal' } } },
      { kind: 'output', config: { name: 'cooldown' } },
      { kind: 'if', config: {} }
    ])
    const { inputs, outputs } = deriveRunScenarioPorts(sub)
    expect(inputs.map((p) => [p.id, p.name, p.dataType])).toEqual([
      ['param:token', 'token', 'string'],
      ['param:count', 'count', 'number']
    ])
    expect(outputs.map((p) => [p.id, p.name])).toEqual([['output:cooldown', 'cooldown']])
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

  it('marks a derived input port required when the input node is flagged required', () => {
    const sub = scenarioWith([
      { kind: 'input', config: { name: 'token', required: true } },
      { kind: 'input', config: { name: 'note', required: false } },
      { kind: 'input', config: { name: 'page' } }
    ])
    const { inputs } = deriveRunScenarioPorts(sub)
    expect(inputs.map((p) => [p.name, p.required ?? false])).toEqual([
      ['token', true],
      ['note', false],
      ['page', false]
    ])
  })

  it('exposes a single `done` signal output when the sub-scenario returns no data', () => {
    const sub = scenarioWith([{ kind: 'input', config: { name: 'token' } }])
    const { outputs } = deriveRunScenarioPorts(sub)
    expect(outputs.map((p) => [p.id, p.role, p.flow])).toEqual([['done', 'then', 'signal']])
  })

  it('omits the `done` signal once the sub-scenario declares an output node', () => {
    const sub = scenarioWith([
      { kind: 'input', config: { name: 'token' } },
      { kind: 'output', config: { name: 'cooldown' } }
    ])
    expect(deriveRunScenarioPorts(sub).outputs.map((p) => p.id)).toEqual(['output:cooldown'])
  })

  it('derives one output port per decl of a MULTI-output node (plus legacy single)', () => {
    const sub = scenarioWith([
      { kind: 'output', config: { outputs: [{ id: 'd1', name: 'first' }, { id: 'd2', name: 'second' }] } },
      { kind: 'output', config: { name: 'legacy' } }
    ])
    expect(deriveRunScenarioPorts(sub).outputs.map((p) => p.id)).toEqual(['output:first', 'output:second', 'output:legacy'])
  })

  it('returns empty ports for a missing sub-scenario', () => {
    expect(deriveRunScenarioPorts(null)).toEqual({ inputs: [], outputs: [] })
  })
})
