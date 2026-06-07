import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * End-to-end proof that the `datetime` kind is wired through the REAL executor
 * registry (`pickExecutor` -> `dateTimeExecutor`) and that an unreadable date
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

describe('datetime — registry + scheduler integration', () => {
  it('routes the kind to dateTimeExecutor and emits the shifted ISO date on `result`', async () => {
    const scenario = buildScenario(
      [
        { id: 'd', kind: 'datetime', outputs: ['result', 'error'], config: { op: 'add', amount: 1, unit: 'days', value: { type: 'string', value: '2026-01-01T00:00:00.000Z' } } },
        { id: 'sink', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [{ from: ['d', 'result'], to: ['sink', 'x'] }]
    )
    let received: unknown
    const executors = buildExecutorRegistry(scenario)
    executors.set('sink', ((act) => { received = act.inputs['x']; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(String(received)).toContain('2026-01-02')
  })

  it('routes an unreadable date to the `error` port (run recovers via rescue)', async () => {
    const scenario = buildScenario(
      [
        { id: 'd', kind: 'datetime', outputs: ['result', 'error'], config: { op: 'add', amount: 1, unit: 'days', value: { type: 'string', value: 'not a date' } } },
        { id: 'rescue', kind: 'object', inputs: ['err'], outputs: ['value'] }
      ],
      [{ from: ['d', 'error'], to: ['rescue', 'err'] }]
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
