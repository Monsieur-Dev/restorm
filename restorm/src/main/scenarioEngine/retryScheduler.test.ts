import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * The `retry` scope: it is the body's ERROR BOUNDARY (an unhandled error marks
 * the attempt failed and re-runs it), supports an HTTP-status failure condition,
 * and gives up via `exhausted` after `maxAttempts`.
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

describe('retry — scheduler error-boundary + backoff', () => {
  it('retries a flaky body (unhandled error) and succeeds on the 3rd attempt', async () => {
    const scenario = buildScenario(
      [
        { id: 'r', kind: 'retry', outputs: ['attempt', 'done', 'exhausted'], config: { maxAttempts: 5, delay: 0 } },
        { id: 'flaky', kind: 'cast', inputs: ['in'], outputs: ['result', 'error'] },
        { id: 'ok', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [{ from: ['r', 'attempt'], to: ['flaky', 'in'] }, { from: ['r', 'done'], to: ['ok', 'x'] }]
    )
    let calls = 0
    let reachedOk = false
    const executors = buildExecutorRegistry(scenario)
    executors.set('flaky', (() => { calls += 1; if (calls < 3) throw new Error('flaky'); return { outputs: [] } }) as NodeExecutor)
    executors.set('ok', (() => { reachedOk = true; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(calls).toBe(3)
    expect(reachedOk).toBe(true)
  })

  it('gives up via `exhausted` when the body always fails', async () => {
    const scenario = buildScenario(
      [
        { id: 'r', kind: 'retry', outputs: ['attempt', 'done', 'exhausted'], config: { maxAttempts: 3, delay: 0 } },
        { id: 'flaky', kind: 'cast', inputs: ['in'], outputs: ['result', 'error'] },
        { id: 'ok', kind: 'object', inputs: ['x'], outputs: ['value'] },
        { id: 'gaveup', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [
        { from: ['r', 'attempt'], to: ['flaky', 'in'] },
        { from: ['r', 'done'], to: ['ok', 'x'] },
        { from: ['r', 'exhausted'], to: ['gaveup', 'x'] }
      ]
    )
    let calls = 0
    let reachedOk = false
    let gaveUp = false
    const executors = buildExecutorRegistry(scenario)
    executors.set('flaky', (() => { calls += 1; throw new Error('always') }) as NodeExecutor)
    executors.set('ok', (() => { reachedOk = true; return { outputs: [] } }) as NodeExecutor)
    executors.set('gaveup', (() => { gaveUp = true; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(calls).toBe(3)
    expect(reachedOk).toBe(false)
    expect(gaveUp).toBe(true)
  })

  it('retries on a matching HTTP status, then succeeds on 200', async () => {
    const scenario = buildScenario(
      [
        { id: 'r', kind: 'retry', outputs: ['attempt', 'done', 'exhausted'], config: { maxAttempts: 5, delay: 0, retryOnStatus: '503' } },
        { id: 'http', kind: 'object', inputs: ['in'], outputs: ['response'] },
        { id: 'ok', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [{ from: ['r', 'attempt'], to: ['http', 'in'] }, { from: ['r', 'done'], to: ['ok', 'x'] }]
    )
    let calls = 0
    let reachedOk = false
    const executors = buildExecutorRegistry(scenario)
    executors.set('http', (() => { calls += 1; const status = calls < 3 ? 503 : 200; return { outputs: [{ port: 'response', value: { response: { status } } }] } }) as NodeExecutor)
    executors.set('ok', (() => { reachedOk = true; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(calls).toBe(3)
    expect(reachedOk).toBe(true)
  })
})
