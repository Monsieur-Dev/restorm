import { describe, it, expect } from 'vitest'
import type { Scenario } from '../../../../../shared/types/collections'
import { namedParams } from './runScenarioPorts'

/** Minimal scenario fixture — only `nodes` (with kind + config.name) matter. */
function scenarioWith(nodes: { kind: string; config: Record<string, unknown> }[]): Scenario {
  return { type: 'scenario', id: 's', name: 'Sub', tags: [], params: [], nodes, edges: [] } as unknown as Scenario
}

describe('namedParams — runScenario port derivation', () => {
  it('returns the names of input / output nodes (a runScenario derives its ports from these)', () => {
    const scenario = scenarioWith([
      { kind: 'input', config: { name: 'token' } },
      { kind: 'input', config: { name: 'characterName' } },
      { kind: 'output', config: { name: 'cooldown' } },
      { kind: 'if', config: {} }
    ])
    expect(namedParams(scenario, 'input')).toEqual(['token', 'characterName'])
    expect(namedParams(scenario, 'output')).toEqual(['cooldown'])
  })

  it('skips unnamed nodes and collapses duplicate names', () => {
    const scenario = scenarioWith([
      { kind: 'input', config: { name: 'a' } },
      { kind: 'input', config: {} },            // unnamed → skipped
      { kind: 'input', config: { name: '  ' } }, // blank → skipped
      { kind: 'input', config: { name: 'a' } }   // duplicate → collapsed
    ])
    expect(namedParams(scenario, 'input')).toEqual(['a'])
  })

  it('returns [] for a missing scenario', () => {
    expect(namedParams(null, 'input')).toEqual([])
  })
})
