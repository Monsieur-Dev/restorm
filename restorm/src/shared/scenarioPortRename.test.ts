import { describe, it, expect } from 'vitest'
import { diffScenarioPortRenames, remapCallerScenarioEdges, isEmptyRenameMap } from './scenarioPortRename'
import type { ScenarioNode, ScenarioEdge } from './types/scenario'

const outputNode = (id: string, decls: { id: string; name: string }[]): ScenarioNode =>
  ({ id, kind: 'output', config: { outputs: decls }, inputs: [], outputs: [], position: { x: 0, y: 0 } }) as unknown as ScenarioNode

const inputNode = (id: string, params: { id: string; name: string }[]): ScenarioNode =>
  ({ id, kind: 'input', config: { params }, inputs: [], outputs: [], position: { x: 0, y: 0 } }) as unknown as ScenarioNode

const runScenarioNode = (id: string, subId: string): ScenarioNode =>
  ({ id, kind: 'runScenario', config: { scenarioId: subId }, inputs: [], outputs: [], position: { x: 0, y: 0 } }) as unknown as ScenarioNode

const edge = (from: [string, string], to: [string, string]): ScenarioEdge =>
  ({ id: `${from[0]}:${from[1]}->${to[0]}:${to[1]}`, from: { nodeId: from[0], portId: from[1] }, to: { nodeId: to[0], portId: to[1] } })

describe('diffScenarioPortRenames', () => {
  it('detects an output rename (same id, new name)', () => {
    const before = [outputNode('o1', [{ id: 'd1', name: 'static_output' }])]
    const after = [outputNode('o1', [{ id: 'd1', name: 'static_output2' }])]
    const r = diffScenarioPortRenames(before, after)
    expect([...r.outputs]).toEqual([['static_output', 'static_output2']])
    expect(r.params.size).toBe(0)
  })

  it('detects an input param rename', () => {
    const before = [inputNode('i1', [{ id: 'p1', name: 'token' }])]
    const after = [inputNode('i1', [{ id: 'p1', name: 'auth' }])]
    expect([...diffScenarioPortRenames(before, after).params]).toEqual([['token', 'auth']])
  })

  it('detects a rename even when several output nodes share the default decl id', () => {
    // Every output node seeds its first decl with id `output-default-decl`, so a
    // bare-id lookup would collide across nodes and mask the rename.
    const before = [
      outputNode('o1', [{ id: 'output-default-decl', name: 'static_output' }]),
      outputNode('o2', [{ id: 'output-default-decl', name: 'first' }]),
      outputNode('o3', [{ id: 'output-default-decl', name: 'all' }])
    ]
    const after = [
      outputNode('o1', [{ id: 'output-default-decl', name: 'renamed' }]),
      outputNode('o2', [{ id: 'output-default-decl', name: 'first' }]),
      outputNode('o3', [{ id: 'output-default-decl', name: 'all' }])
    ]
    expect([...diffScenarioPortRenames(before, after).outputs]).toEqual([['static_output', 'renamed']])
  })

  it('skips an ambiguous rename when another decl still carries the old name', () => {
    // o1 renames first→primary, but o2 still has a decl named "first". A caller's
    // `output:first` edge could belong to either, so we must NOT remap it.
    const before = [
      outputNode('o1', [{ id: 'd1', name: 'first' }]),
      outputNode('o2', [{ id: 'd2', name: 'first' }])
    ]
    const after = [
      outputNode('o1', [{ id: 'd1', name: 'primary' }]),
      outputNode('o2', [{ id: 'd2', name: 'first' }])
    ]
    expect(isEmptyRenameMap(diffScenarioPortRenames(before, after))).toBe(true)
  })

  it('ignores blank names and additions/removals (id changed = not a rename)', () => {
    const before = [outputNode('o1', [{ id: 'd1', name: 'a' }])]
    const after = [outputNode('o1', [{ id: 'd1', name: '' }, { id: 'd2', name: 'b' }])]
    const r = diffScenarioPortRenames(before, after)
    expect(isEmptyRenameMap(r)).toBe(true)
  })
})

describe('remapCallerScenarioEdges', () => {
  const renames = { outputs: new Map([['static_output', 'static_output2']]), params: new Map([['token', 'auth']]) }

  it('follows an output edge from a runScenario bound to the renamed sub', () => {
    const caller = {
      nodes: [runScenarioNode('rs', 'sub-1'), outputNode('log', [])],
      edges: [edge(['rs', 'output:static_output'], ['log', 'in'])]
    }
    const next = remapCallerScenarioEdges(caller, 'sub-1', renames)
    expect(next[0]?.from.portId).toBe('output:static_output2')
    expect(next[0]?.to.portId).toBe('in') // untouched
  })

  it('follows a param edge into a bound runScenario', () => {
    const caller = {
      nodes: [runScenarioNode('rs', 'sub-1'), inputNode('src', [])],
      edges: [edge(['src', 'value'], ['rs', 'param:token'])]
    }
    const next = remapCallerScenarioEdges(caller, 'sub-1', renames)
    expect(next[0]?.to.portId).toBe('param:auth')
  })

  it('leaves edges of a runScenario bound to a DIFFERENT sub untouched (same ref)', () => {
    const caller = {
      nodes: [runScenarioNode('rs', 'other-sub')],
      edges: [edge(['rs', 'output:static_output'], ['log', 'in'])]
    }
    expect(remapCallerScenarioEdges(caller, 'sub-1', renames)).toBe(caller.edges)
  })

  it('returns the same array when no rename applies', () => {
    const caller = { nodes: [runScenarioNode('rs', 'sub-1')], edges: [edge(['rs', 'output:other'], ['log', 'in'])] }
    expect(remapCallerScenarioEdges(caller, 'sub-1', renames)).toBe(caller.edges)
  })
})
