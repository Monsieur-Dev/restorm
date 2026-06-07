import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * End-to-end proof that the `jwt` kind is wired through the REAL executor
 * registry (`pickExecutor` -> `jwtExecutor`) and that a malformed token routes
 * to the implicit `error` port.
 */

interface NodeSpec { id: string; kind: string; inputs?: string[]; outputs?: string[]; config?: Record<string, unknown> }
interface EdgeSpec { id?: string; from: [string, string]; to: [string, string] }

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

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

describe('jwt — registry + scheduler integration', () => {
  it('routes the kind to jwtExecutor and emits the decoded payload on `result`', async () => {
    const scenario = buildScenario(
      [
        { id: 'j', kind: 'jwt', outputs: ['result', 'error'], config: { value: { type: 'string', value: SAMPLE } } },
        { id: 'sink', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [{ from: ['j', 'result'], to: ['sink', 'x'] }]
    )
    let received: { payload?: { name?: string } } | undefined
    const executors = buildExecutorRegistry(scenario)
    executors.set('sink', ((act) => { received = act.inputs['x'] as typeof received; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(received?.payload?.name).toBe('John Doe')
  })

  it('routes a malformed token to the `error` port (run recovers via rescue)', async () => {
    const scenario = buildScenario(
      [
        { id: 'j', kind: 'jwt', outputs: ['result', 'error'], config: { value: { type: 'string', value: 'notajwt' } } },
        { id: 'rescue', kind: 'object', inputs: ['err'], outputs: ['value'] }
      ],
      [{ from: ['j', 'error'], to: ['rescue', 'err'] }]
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
