import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * End-to-end proof that the `objectOp` / `url` / `random` / `throw` kinds are
 * wired through the REAL executor registry (`pickExecutor`), and that a `throw`
 * routes to the implicit `error` port.
 */

interface NodeSpec { id: string; kind: string; inputs?: string[]; outputs?: string[]; config?: Record<string, unknown> }
interface EdgeSpec { id?: string; from: [string, string]; to: [string, string] }

function buildScenario(nodes: NodeSpec[], edges: EdgeSpec[]): ScenarioModel {
  return {
    id: 's', name: 'test', tags: [], params: [], items: [], notes: '',
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind as ScenarioModel['nodes'][number]['kind'],
      config: n.config ?? {},
      inputs: (n.inputs ?? []).map((p) => ({ id: p, name: p, role: 'value', dataType: 'any' })) as never,
      outputs: (n.outputs ?? []).map((p) => ({ id: p, name: p, role: 'value', dataType: 'any' })) as never,
      position: { x: 0, y: 0 }
    })),
    edges: edges.map((e, i) => ({ id: e.id ?? `e${i}`, from: { nodeId: e.from[0], portId: e.from[1] }, to: { nodeId: e.to[0], portId: e.to[1] } }))
  } as unknown as ScenarioModel
}

async function emit(kind: string, config: Record<string, unknown>): Promise<unknown> {
  const scenario = buildScenario(
    [
      { id: 'n', kind, outputs: ['result', 'error'], config },
      { id: 'sink', kind: 'object', inputs: ['x'], outputs: ['value'] }
    ],
    [{ from: ['n', 'result'], to: ['sink', 'x'] }]
  )
  let received: unknown
  const executors = buildExecutorRegistry(scenario)
  executors.set('sink', ((act) => { received = act.inputs['x']; return { outputs: [] } }) as NodeExecutor)
  const s = new Scheduler({ scenario, executors })
  await s.run()
  expect(s.status().state).toBe('completed')
  return received
}

describe('objectOp / url / random / throw — registry + scheduler integration', () => {
  it('objectOp emits the reshaped object (fed by an object node)', async () => {
    const scenario = buildScenario(
      [
        { id: 'src', kind: 'object', outputs: ['object'], config: { properties: [
          { id: 'p1', name: 'id', value: { type: 'numeric', value: 1, format: 'decimal' } },
          { id: 'p2', name: 'extra', value: { type: 'numeric', value: 9, format: 'decimal' } }
        ] } },
        { id: 'n', kind: 'objectOp', inputs: ['value'], outputs: ['result', 'error'], config: { op: 'pick', keys: 'id' } },
        { id: 'sink', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [{ from: ['src', 'object'], to: ['n', 'value'] }, { from: ['n', 'result'], to: ['sink', 'x'] }]
    )
    let received: unknown
    const executors = buildExecutorRegistry(scenario)
    executors.set('sink', ((act) => { received = act.inputs['x']; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(received).toEqual({ id: 1 })
  })

  it('url emits the encoded value', async () => {
    expect(await emit('url', { op: 'encode', value: { type: 'string', value: 'a b' } })).toBe('a%20b')
  })

  it('random emits a deterministic seeded value', async () => {
    const v = await emit('random', { op: 'int', min: 1, max: 6, seed: 99 })
    expect(v).toBeGreaterThanOrEqual(1)
    expect(v).toBeLessThanOrEqual(6)
  })

  it('throw routes to the `error` port (run recovers via rescue)', async () => {
    const scenario = buildScenario(
      [
        { id: 't', kind: 'throw', outputs: [], config: { message: { type: 'string', value: 'boom' } } },
        { id: 'rescue', kind: 'object', inputs: ['err'], outputs: ['value'] }
      ],
      [{ from: ['t', 'error'], to: ['rescue', 'err'] }]
    )
    let rescued = false
    const executors = buildExecutorRegistry(scenario)
    executors.set('rescue', (() => { rescued = true; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(rescued).toBe(true)
  })
})
