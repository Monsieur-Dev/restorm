// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * Regression tests for three scheduler edge cases surfaced in PR review:
 *  - a user-wired manual cycle must stay Stoppable (macrotask yield),
 *  - `forEach` must fire `done` exactly once even when an item scope closes
 *    synchronously (the re-entrant `onClose` double-fire),
 *  - `retry` must not swallow a body exception it isn't configured to retry on.
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

describe('scheduler — PR-review edge cases', () => {
  it('a long manual cycle yields to the macrotask queue so Stop lands mid-run', async () => {
    // `a` feeds its own `in` (a user-wired back-edge / MERGE). Without a periodic
    // macrotask yield the microtask chain runs every iteration before any timer
    // or IPC can fire, so an abort scheduled via setTimeout only lands AFTER the
    // whole cycle. `a` caps itself at 3000 iterations and the run has a
    // max-activations backstop, so the test can never hang regardless.
    const scenario = buildScenario(
      [
        { id: 'seed', kind: 'object', outputs: ['value'] },
        { id: 'a', kind: 'object', inputs: ['in'], outputs: ['out'] }
      ],
      [{ from: ['seed', 'value'], to: ['a', 'in'] }, { from: ['a', 'out'], to: ['a', 'in'] }]
    )
    let count = 0
    const executors = buildExecutorRegistry(scenario)
    executors.set('seed', (() => ({ outputs: [{ port: 'value', value: 0 }] })) as NodeExecutor)
    executors.set('a', (() => {
      count += 1
      return count >= 3000 ? { outputs: [] } : { outputs: [{ port: 'out', value: count }] }
    }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    const runP = s.run({ maxActivations: 10_000 })
    setTimeout(() => { s.abort('test stop') }, 0)
    await runP
    // Yield landed the abort well before the natural 3000-iteration end.
    expect(s.status().state).toBe('cancelled')
    expect(count).toBeLessThan(3000)
  }, 5000)

  it('forEach fires `done` exactly once when each item scope closes synchronously', async () => {
    // `each` is intentionally unwired → each item's child scope is empty and
    // closes synchronously inside `openItem`, exercising the re-entrant
    // `onClose` path where the duplicate `done` fired. `done` → `counter`.
    const scenario = buildScenario(
      [
        { id: 'fe', kind: 'forEach', outputs: ['each', 'done'] },
        { id: 'counter', kind: 'object', inputs: ['in'], outputs: ['value'] }
      ],
      [{ from: ['fe', 'done'], to: ['counter', 'in'] }]
    )
    let doneCount = 0
    const executors = buildExecutorRegistry(scenario)
    executors.set('fe', (() => ({ outputs: [], scopeAction: { type: 'openForEach', items: [1, 2, 3], parallel: false, batchSize: 1 } })) as NodeExecutor)
    executors.set('counter', (() => { doneCount += 1; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run({ maxActivations: 100 })
    expect(s.status().state).toBe('completed')
    expect(doneCount).toBe(1)
  })

  it('retry fails the run on a body exception it is not configured to retry on', async () => {
    // retryOnError:false (only retries on status 503) → a thrown body exception
    // must NOT be swallowed as success; it propagates and fails the run.
    const scenario = buildScenario(
      [
        { id: 'r', kind: 'retry', outputs: ['attempt', 'done', 'exhausted'], config: { maxAttempts: 3, delay: 0, retryOnError: false, retryOnStatus: '503' } },
        { id: 'boom', kind: 'cast', inputs: ['in'], outputs: ['result'] },
        { id: 'ok', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [{ from: ['r', 'attempt'], to: ['boom', 'in'] }, { from: ['r', 'done'], to: ['ok', 'x'] }]
    )
    let reachedOk = false
    const executors = buildExecutorRegistry(scenario)
    executors.set('boom', (() => { throw new Error('kaboom') }) as NodeExecutor)
    executors.set('ok', (() => { reachedOk = true; return { outputs: [] } }) as NodeExecutor)
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('failed')
    expect(reachedOk).toBe(false)
  })
})
