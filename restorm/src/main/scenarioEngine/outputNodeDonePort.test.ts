import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import type { ScenarioModel } from './types'

// Regression: an `output` node triggered ONLY by an upstream node's universal
// `done` continuation (no wired data edge into its decl ports — its values are
// pure literals) must still run and surface its `output:<name>` ports. The
// last case guards the completion-tree accounting bug where one port fanning
// out to several ports of the SAME node incremented the emitter's pending
// count per-edge but released it once (Set-deduped), so the emitter's `done`
// never fired and the done-triggered output node never ran.
// We harvest `output:<name>` emissions exactly like engine.startWithStack.

function harvestOutputs(scenario: ScenarioModel): Promise<Record<string, unknown>> {
  const executors = buildExecutorRegistry(scenario)
  const s = new Scheduler({ scenario, executors })
  const bucket: Record<string, unknown> = {}
  s.on((e) => {
    if (e.type !== 'node-completed') return
    const node = scenario.nodes.find((n) => n.id === e.nodeId)
    if (node?.kind !== 'output') return
    for (const o of e.outputs) {
      if (o.port.startsWith('output:')) bucket[o.port.slice('output:'.length)] = o.value
    }
  })
  return s.run().then(() => bucket)
}

const mk = (nodes: unknown[], edges: { from: [string, string]; to: [string, string] }[]): ScenarioModel =>
  ({
    id: 's', name: 't', tags: [], params: [], items: [], notes: '',
    nodes,
    edges: edges.map((e, i) => ({ id: `e${i}`, from: { nodeId: e.from[0], portId: e.from[1] }, to: { nodeId: e.to[0], portId: e.to[1] } }))
  }) as unknown as ScenarioModel

const inputNode = (id: string): Record<string, unknown> => ({
  id, kind: 'input', position: { x: 0, y: 0 },
  config: { params: [{ id: 'p1', name: 'param1', valueType: { type: 'string', value: 'main' } }] },
  inputs: [{ id: 'in', name: '', dataType: 'any' }],
  outputs: [{ id: 'value', name: 'value', dataType: 'any' }]
})

const outputNode = (id: string): Record<string, unknown> => ({
  id, kind: 'output', position: { x: 0, y: 0 },
  config: { outputs: [{ id: 'output-default-decl', name: 'static_output', value: { type: 'boolean', value: true } }] },
  inputs: [{ id: 'in', name: '', dataType: 'any' }, { id: 'value', name: 'value', dataType: 'any' }],
  outputs: []
})

const logNode = (id: string): Record<string, unknown> => ({
  id, kind: 'log', position: { x: 0, y: 0 },
  config: { message: { type: 'string', value: 'x' } },
  inputs: [{ id: 'in', name: '', dataType: 'any' }, { id: 'data', name: 'data', dataType: 'any' }],
  outputs: []
})

describe('output node fed only by a `done` continuation', () => {
  it('MINIMAL: input --(done)--> output(literal) — output is harvested', async () => {
    const scenario = mk(
      [inputNode('inp'), outputNode('out')],
      [{ from: ['inp', 'done'], to: ['out', 'in'] }]
    )
    const bucket = await harvestOutputs(scenario)
    expect(bucket).toEqual({ static_output: true })
  })

  it('REAL TOPOLOGY: input feeds a data branch AND done->output(literal)', async () => {
    // input.value -> log.data (data subtree) ; input.done -> output.in
    const scenario = mk(
      [inputNode('inp'), logNode('lg'), outputNode('out')],
      [
        { from: ['inp', 'value'], to: ['lg', 'data'] },
        { from: ['inp', 'done'], to: ['out', 'in'] }
      ]
    )
    const bucket = await harvestOutputs(scenario)
    expect(bucket).toEqual({ static_output: true })
  })

  it('EXACT Inputs/outputs shape: 3-decl static node + object→log→first/all chain', async () => {
    // Mirrors the real graph: inputA feeds an object (data subtree) whose
    // log.done drives the `first`/`all` outputs; inputA.done drives the
    // literal `static_output`/`env`/`color` node. No env resolver in main →
    // environment '' resolves to null; the variable decl stays `{{param5}}`.
    const inputA = {
      id: 'inA', kind: 'input', position: { x: 0, y: 0 },
      config: { params: [{ id: 'p1', name: 'param1', valueType: { type: 'string', value: 'main' } }] },
      inputs: [{ id: 'in', name: '', dataType: 'any' }],
      outputs: [{ id: 'value', name: 'value', dataType: 'any' }]
    }
    const obj = {
      id: 'obj', kind: 'object', position: { x: 0, y: 0 },
      config: { properties: [{ id: 'k1', name: 'obj_param1', value: { type: 'string', value: '' } }] },
      inputs: [], outputs: [{ id: 'object', name: 'object', dataType: 'json' }]
    }
    const log = logNode('lg')
    const first = {
      id: 'first', kind: 'output', position: { x: 0, y: 0 },
      config: { outputs: [{ id: 'output-default-decl', name: 'first' }] },
      inputs: [{ id: 'in', name: '', dataType: 'any' }, { id: 'value', name: 'value', dataType: 'any' }],
      outputs: []
    }
    const staticOut = {
      id: 'stat', kind: 'output', position: { x: 0, y: 0 },
      config: { outputs: [
        { id: 'output-default-decl', name: 'static_output', value: { type: 'boolean', value: true } },
        { id: 'd-env', name: 'env', value: { type: 'environment', value: '' } },
        { id: 'd-color', name: 'color', value: { type: 'variable', value: 'param5' } }
      ] },
      inputs: [{ id: 'in', name: '', dataType: 'any' }, { id: 'value', name: 'value', dataType: 'any' }],
      outputs: []
    }
    const scenario = mk(
      [inputA, obj, log, first, staticOut],
      [
        { from: ['inA', 'value'], to: ['obj', 'k1'] },
        { from: ['obj', 'object'], to: ['lg', 'data'] },
        { from: ['lg', 'done'], to: ['first', 'output-default-decl'] },
        { from: ['inA', 'done'], to: ['stat', 'in'] }
      ]
    )
    const bucket = await harvestOutputs(scenario)
    expect(bucket).toMatchObject({ static_output: true, env: null, color: '{{param5}}' })
  })

  it('FAN-OUT to two ports of the SAME node still fires the emitter`s done', async () => {
    // inputA.value -> object.k1 AND inputA.value -> object.k2 (same target,
    // two ports). inputA.pending is incremented per-edge (2), but the object
    // activation dedups inputA as a parent — so inputA.done would never fire
    // and the done-triggered static_output never runs.
    const inputA = {
      id: 'inA', kind: 'input', position: { x: 0, y: 0 },
      config: { params: [{ id: 'p1', name: 'param1', valueType: { type: 'string', value: 'main' } }] },
      inputs: [{ id: 'in', name: '', dataType: 'any' }],
      outputs: [{ id: 'value', name: 'value', dataType: 'any' }]
    }
    const obj = {
      id: 'obj', kind: 'object', position: { x: 0, y: 0 },
      config: { properties: [
        { id: 'k1', name: 'a', value: { type: 'string', value: '' } },
        { id: 'k2', name: 'b', value: { type: 'string', value: '' } }
      ] },
      inputs: [], outputs: [{ id: 'object', name: 'object', dataType: 'json' }]
    }
    const scenario = mk(
      [inputA, obj, outputNode('out')],
      [
        { from: ['inA', 'value'], to: ['obj', 'k1'] },
        { from: ['inA', 'value'], to: ['obj', 'k2'] },
        { from: ['inA', 'done'], to: ['out', 'in'] }
      ]
    )
    const bucket = await harvestOutputs(scenario)
    expect(bucket).toEqual({ static_output: true })
  })
})
