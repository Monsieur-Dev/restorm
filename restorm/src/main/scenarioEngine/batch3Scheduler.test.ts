import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * End-to-end proof that the `listOp` / `csv` / `math` kinds are wired through the
 * REAL executor registry (`pickExecutor`), resolve their typed config operands,
 * and route a bad operand to the implicit `error` port.
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

const num = (value: number): Record<string, unknown> => ({ type: 'numeric', value, format: 'decimal' })
const list = (...values: number[]): Record<string, unknown> => ({ type: 'list', items: values.map(num) })

async function emit(kind: string, config: Record<string, unknown>): Promise<unknown> {
  const scenario = buildScenario(
    [
      { id: 'n', kind, inputs: ['value', 'a'], outputs: ['result', 'error'], config },
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

async function routesToError(kind: string, config: Record<string, unknown>): Promise<boolean> {
  const scenario = buildScenario(
    [
      { id: 'n', kind, inputs: ['value', 'a'], outputs: ['result', 'error'], config },
      { id: 'rescue', kind: 'object', inputs: ['err'], outputs: ['value'] }
    ],
    [{ from: ['n', 'error'], to: ['rescue', 'err'] }]
  )
  let rescued = false
  const executors = buildExecutorRegistry(scenario)
  executors.set('rescue', (() => { rescued = true; return { outputs: [] } }) as NodeExecutor)
  const s = new Scheduler({ scenario, executors })
  await s.run()
  expect(s.status().state).toBe('completed')
  return rescued
}

describe('listOp / csv / math — registry + scheduler integration', () => {
  it('listOp sorts the resolved list', async () => {
    expect(await emit('listOp', { op: 'sort', value: list(3, 1, 2) })).toEqual([1, 2, 3])
  })

  it('listOp chunks', async () => {
    expect(await emit('listOp', { op: 'chunk', size: 2, value: list(1, 2, 3) })).toEqual([[1, 2], [3]])
  })

  it('csv parses a string into row-objects', async () => {
    expect(await emit('csv', { op: 'parse', value: { type: 'string', value: 'id,name\n1,Rex' } })).toEqual([{ id: '1', name: 'Rex' }])
  })

  it('math takes the square root', async () => {
    expect(await emit('math', { op: 'sqrt', a: num(9) })).toBe(3)
  })

  it('math clamps with config bounds', async () => {
    expect(await emit('math', { op: 'clamp', a: num(7), min: num(0), max: num(5) })).toBe(5)
  })

  it('a non-list listOp operand routes to the `error` port', async () => {
    expect(await routesToError('listOp', { op: 'reverse', value: { type: 'string', value: 'nope' } })).toBe(true)
  })

  it('a negative sqrt routes to the `error` port', async () => {
    expect(await routesToError('math', { op: 'sqrt', a: num(-1) })).toBe(true)
  })
})
