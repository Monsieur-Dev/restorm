import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * End-to-end proof that the `regex` kind is wired through the REAL executor
 * registry (`pickExecutor` -> `regexExecutor`) and that an invalid pattern routes
 * to the implicit `error` port.
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

describe('regex — registry + scheduler integration', () => {
  it('routes the kind to regexExecutor and emits the extracted value on `result`', async () => {
    const scenario = buildScenario(
      [
        { id: 'r', kind: 'regex', outputs: ['result', 'error'], config: { op: 'extract', pattern: 'id=(\\d+)', value: { type: 'string', value: 'id=99' } } },
        { id: 'sink', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [{ from: ['r', 'result'], to: ['sink', 'x'] }]
    )
    let received: unknown
    const executors = buildExecutorRegistry(scenario)
    executors.set('sink', ((act) => { received = act.inputs['x']; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(received).toBe('99')
  })

  it('routes an invalid pattern to the `error` port (run recovers via rescue)', async () => {
    const scenario = buildScenario(
      [
        { id: 'r', kind: 'regex', outputs: ['result', 'error'], config: { op: 'extract', pattern: '(unclosed', value: { type: 'string', value: 'x' } } },
        { id: 'rescue', kind: 'object', inputs: ['err'], outputs: ['value'] }
      ],
      [{ from: ['r', 'error'], to: ['rescue', 'err'] }]
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
