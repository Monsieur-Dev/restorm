import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import type { NodeExecutor, ScenarioModel } from './types'
import { forEachExecutor, aggregateExecutor } from './executors/timeAndFlowExecutors'
import { setVariableExecutor } from './executors/pureExecutors'

/**
 * AC: "ForEach ∥ et séquentiel testés ; Aggregate collecte à la fermeture de
 * scope, ré-ordonné sur l'index, politique d'erreur configurable (défaut :
 * partiel + liste d'erreurs)."
 *
 * A streaming aggregate is wired downstream of a `forEach`: each iteration's
 * body contributes one value on `items` (inside the iteration scope) and the
 * loop's `done` triggers the aggregate, which reduces the contributions —
 * reordered by iteration index, regardless of completion order — and applies
 * its error policy to iterations that produced nothing.
 */

interface NodeSpec { id: string; kind: string; inputs?: string[]; outputs?: string[]; config?: Record<string, unknown> }
interface EdgeSpec { from: [string, string]; to: [string, string] }

function buildScenario(nodes: NodeSpec[], edges: EdgeSpec[]): ScenarioModel {
  return {
    id: 's', name: 'agg', tags: [], params: [], items: [], notes: '',
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      config: n.config ?? {},
      inputs: (n.inputs ?? []).map((p) => ({ id: p, name: p, role: 'value', dataType: 'any' })),
      outputs: (n.outputs ?? []).map((p) => ({ id: p, name: p, role: 'value', dataType: 'any' })),
      position: { x: 0, y: 0 }
    })),
    edges: edges.map((e, i) => ({ id: `e${i}`, from: { nodeId: e.from[0], portId: e.from[1] }, to: { nodeId: e.to[0], portId: e.to[1] } }))
  } as unknown as ScenarioModel
}

/** A forEach → body → aggregate → sink graph. `body` is supplied by the test
 * so it can contribute (or skip) per item; `sink` captures the reduced result. */
function aggGraph(aggConfig: Record<string, unknown>): ScenarioModel {
  return buildScenario(
    [
      { id: 'src', kind: 'now', outputs: ['value'] },
      { id: 'fe', kind: 'forEach', inputs: ['items'], outputs: ['each', 'done'], config: { parallelism: { enabled: true, count: 8 } } },
      { id: 'body', kind: 'transform', inputs: ['item'], outputs: ['value'] },
      { id: 'agg', kind: 'aggregate', inputs: ['items', 'in'], outputs: ['result'], config: aggConfig },
      { id: 'sink', kind: 'object', inputs: ['result'], outputs: ['value'] }
    ],
    [
      { from: ['src', 'value'], to: ['fe', 'items'] },
      { from: ['fe', 'each'], to: ['body', 'item'] },
      { from: ['body', 'value'], to: ['agg', 'items'] },
      { from: ['fe', 'done'], to: ['agg', 'in'] },
      { from: ['agg', 'result'], to: ['sink', 'result'] }
    ]
  )
}

describe('AC3 — Aggregate scope-close collection', () => {
  it('collects each iteration on close and reduces in index order (sequential)', async () => {
    const scenario = buildScenario(
      [
        { id: 'src', kind: 'now', outputs: ['value'] },
        { id: 'fe', kind: 'forEach', inputs: ['items'], outputs: ['each', 'done'], config: {} }, // batch 1 → sequential
        { id: 'body', kind: 'transform', inputs: ['item'], outputs: ['value'] },
        { id: 'agg', kind: 'aggregate', inputs: ['items', 'in'], outputs: ['result'], config: { op: 'join', separator: '-' } },
        { id: 'sink', kind: 'object', inputs: ['result'], outputs: ['value'] }
      ],
      [
        { from: ['src', 'value'], to: ['fe', 'items'] },
        { from: ['fe', 'each'], to: ['body', 'item'] },
        { from: ['body', 'value'], to: ['agg', 'items'] },
        { from: ['fe', 'done'], to: ['agg', 'in'] },
        { from: ['agg', 'result'], to: ['sink', 'result'] }
      ]
    )
    let result: unknown
    const executors = new Map<string, NodeExecutor>([
      ['src', () => ({ outputs: [{ port: 'value', value: ['a', 'b', 'c'] }] })],
      ['fe', forEachExecutor],
      ['body', (act) => ({ outputs: [{ port: 'value', value: act.inputs['item'] }] })],
      ['agg', aggregateExecutor],
      ['sink', (act) => { result = act.inputs['result']; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(result).toBe('a-b-c')
  })

  it('reorders by iteration index even when iterations complete out of order (parallel)', async () => {
    // Items carry a settle delay so completion order (b,d,c,a) differs from
    // index order (a,b,c,d). The reduced join must follow INDEX order.
    const scenario = aggGraph({ op: 'join', separator: ',' })
    let result: unknown
    const executors = new Map<string, NodeExecutor>([
      ['src', () => ({ outputs: [{ port: 'value', value: [
        { v: 'a', d: 40 }, { v: 'b', d: 0 }, { v: 'c', d: 25 }, { v: 'd', d: 8 }
      ] }] })],
      ['fe', forEachExecutor],
      ['body', async (act) => {
        const item = act.inputs['item'] as { v: string; d: number }
        await new Promise((r) => setTimeout(r, item.d))
        return { outputs: [{ port: 'value', value: item.v }] }
      }],
      ['agg', aggregateExecutor],
      ['sink', (act) => { result = act.inputs['result']; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(result).toBe('a,b,c,d')
  })

  it('errors the run when an iteration produces nothing (strict — no silent partial)', async () => {
    const scenario = aggGraph({ op: 'join', separator: ',' })
    let result: unknown
    const executors = new Map<string, NodeExecutor>([
      ['src', () => ({ outputs: [{ port: 'value', value: ['a', 'b', 'c', 'd'] }] })],
      ['fe', forEachExecutor],
      // Iterations 1 ('b') and 3 ('d') contribute NOTHING → missing → the
      // aggregate throws (its `error` port is unwired here, so the whole run
      // fails). No silently-wrong partial sum.
      ['body', (act) => {
        const item = act.inputs['item'] as string
        return item === 'b' || item === 'd' ? { outputs: [] } : { outputs: [{ port: 'value', value: item }] }
      }],
      ['agg', aggregateExecutor],
      ['sink', (act) => { result = act.inputs['result']; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('failed')
    expect(result).toBeUndefined()
  })

  it('routes the missing-item error to the aggregate\'s `error` port when wired', async () => {
    // Same missing-item case, but the aggregate's `error` port is wired to a
    // rescue node → the run RECOVERS instead of failing.
    const scenario = buildScenario(
      [
        { id: 'src', kind: 'now', outputs: ['value'] },
        { id: 'fe', kind: 'forEach', inputs: ['items'], outputs: ['each', 'done'], config: { parallelism: { enabled: true, count: 8 } } },
        { id: 'body', kind: 'transform', inputs: ['item'], outputs: ['value'] },
        { id: 'agg', kind: 'aggregate', inputs: ['items', 'in'], outputs: ['result', 'error'], config: { op: 'count' } },
        { id: 'rescue', kind: 'object', inputs: ['err'], outputs: ['value'] }
      ],
      [
        { from: ['src', 'value'], to: ['fe', 'items'] },
        { from: ['fe', 'each'], to: ['body', 'item'] },
        { from: ['body', 'value'], to: ['agg', 'items'] },
        { from: ['fe', 'done'], to: ['agg', 'in'] },
        { from: ['agg', 'error'], to: ['rescue', 'err'] }
      ]
    )
    let rescued = false
    const executors = new Map<string, NodeExecutor>([
      ['src', () => ({ outputs: [{ port: 'value', value: ['a', 'b', 'c'] }] })],
      ['fe', forEachExecutor],
      ['body', (act) => (act.inputs['item'] === 'b' ? { outputs: [] } : { outputs: [{ port: 'value', value: act.inputs['item'] }] })],
      ['agg', aggregateExecutor],
      ['rescue', () => { rescued = true; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(rescued).toBe(true)
  })

  it('aggregates per outer iteration when wired to a nested inner loop\'s `done`', async () => {
    // outer forEach [[1,2],[3,4]] → inner forEach over each sub-array → body →
    // agg.items ; inner.done → agg.in. The aggregate fires ONCE per outer
    // iteration (in the outer scope), collecting that iteration's inner items.
    const scenario = buildScenario(
      [
        { id: 'src', kind: 'now', outputs: ['value'] },
        { id: 'outer', kind: 'forEach', inputs: ['items'], outputs: ['each', 'done'], config: { parallelism: { enabled: true, count: 4 } } },
        { id: 'inner', kind: 'forEach', inputs: ['items'], outputs: ['each', 'done'], config: { parallelism: { enabled: true, count: 4 } } },
        { id: 'body', kind: 'transform', inputs: ['item'], outputs: ['value'] },
        { id: 'agg', kind: 'aggregate', inputs: ['items', 'in'], outputs: ['result'], config: { op: 'sum' } },
        { id: 'sink', kind: 'object', inputs: ['result'], outputs: ['value'] }
      ],
      [
        { from: ['src', 'value'], to: ['outer', 'items'] },
        { from: ['outer', 'each'], to: ['inner', 'items'] },
        { from: ['inner', 'each'], to: ['body', 'item'] },
        { from: ['body', 'value'], to: ['agg', 'items'] },
        { from: ['inner', 'done'], to: ['agg', 'in'] },
        { from: ['agg', 'result'], to: ['sink', 'result'] }
      ]
    )
    const results: unknown[] = []
    const executors = new Map<string, NodeExecutor>([
      ['src', () => ({ outputs: [{ port: 'value', value: [[1, 2], [3, 4]] }] })],
      ['outer', forEachExecutor],
      ['inner', forEachExecutor],
      ['body', (act) => ({ outputs: [{ port: 'value', value: act.inputs['item'] }] })],
      ['agg', aggregateExecutor],
      ['sink', (act) => { results.push(act.inputs['result']); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    // One aggregate per outer iteration: sum(1,2)=3 and sum(3,4)=7.
    expect([...results].sort()).toEqual([3, 7])
  })

  it('errors (does not silently mis-reduce) a ready-made array wired into a scope-close aggregate', async () => {
    // Contract violation: the aggregate is a scope-close collector (it has a
    // `done` trigger) yet `items` is fed a ROOT-scope array. The array is not
    // mistaken for the trigger; the loop's `done` fires once with an empty
    // collection vs total 2 → strict fail (not a silently wrong reduce).
    const scenario = buildScenario(
      [
        { id: 'arr', kind: 'now', outputs: ['value'] },
        { id: 'fe', kind: 'forEach', inputs: ['items'], outputs: ['each', 'done'], config: {} },
        { id: 'noop', kind: 'now', inputs: ['tick'], outputs: ['value'] },
        { id: 'agg', kind: 'aggregate', inputs: ['items', 'in'], outputs: ['result'], config: { op: 'count' } },
        { id: 'sink', kind: 'object', inputs: ['result'], outputs: ['value'] }
      ],
      [
        { from: ['arr', 'value'], to: ['agg', 'items'] },
        { from: ['fe', 'each'], to: ['noop', 'tick'] },
        { from: ['fe', 'done'], to: ['agg', 'in'] },
        { from: ['agg', 'result'], to: ['sink', 'result'] }
      ]
    )
    let result: unknown
    let fired = 0
    const executors = new Map<string, NodeExecutor>([
      ['arr', () => ({ outputs: [{ port: 'value', value: [10, 20, 30] }] })],
      // The forEach iterates a 2-item placeholder so `done` carries total 2;
      // `each` feeds a real no-op body so iteration scopes open/close normally.
      ['fe', () => ({ outputs: [], scopeAction: { type: 'openForEach', items: ['p', 'q'], parallel: false, batchSize: 1 } })],
      ['noop', () => ({ outputs: [] })],
      ['agg', (act, ctx) => { fired += 1; return aggregateExecutor(act, ctx) }],
      ['sink', (act) => { result = act.inputs['result']; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    // Fires exactly once (the root array does NOT spawn a second activation),
    // then throws on the empty-vs-total mismatch → the run fails.
    expect(fired).toBe(1)
    expect(s.status().state).toBe('failed')
    expect(result).toBeUndefined()
  })
})

describe('plain aggregate (non-streaming) over a variable list', () => {
  it('counts a variable holding an array, triggered by a plain (non-loop) `done`', async () => {
    // A variable holds a real list; an aggregate(items = that variable) is
    // triggered by the setVariable's UNIVERSAL `done` port. That `done` must
    // keep the aggregate a plain array-reduce — it used to be mis-flagged as a
    // loop collector (any `done` source), collect nothing → empty result. And
    // the `items` variable reference must resolve to the live array.
    const scenario = buildScenario(
      [
        { id: 'src', kind: 'now', outputs: ['value'] },
        { id: 'sv', kind: 'setVariable', inputs: ['in', 'value'], outputs: [], config: { name: 'PetColors' } },
        { id: 'agg', kind: 'aggregate', inputs: ['items', 'in'], outputs: ['result'], config: { op: 'count', items: { type: 'variable', value: 'PetColors' } } },
        { id: 'sink', kind: 'object', inputs: ['result'], outputs: [] }
      ],
      [
        { from: ['src', 'value'], to: ['sv', 'value'] },
        { from: ['sv', 'done'], to: ['agg', 'in'] },
        { from: ['agg', 'result'], to: ['sink', 'result'] }
      ]
    )
    let result: unknown
    const executors = new Map<string, NodeExecutor>([
      ['src', () => ({ outputs: [{ port: 'value', value: ['Vert', 'Bleu', 'Rouge'] }] })],
      ['sv', setVariableExecutor],
      ['agg', aggregateExecutor],
      ['sink', (act) => { result = act.inputs['result']; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(result).toBe(3)
  })

  it('counts a customListMulti stashed in a variable — a multi-select is a real list', async () => {
    // setVariable PetColors = customListMulti[Vert, Bleu] (stored as the ARRAY,
    // since a multi-select resolves to a list); aggregate(count) over the
    // variable → 2. This is the end-to-end of "a list of colors is a real list".
    const scenario = buildScenario(
      [
        { id: 'sv', kind: 'setVariable', inputs: ['in', 'value'], outputs: [], config: { name: 'PetColors', value: { type: 'customListMulti', listId: 'L', labels: ['Vert', 'Bleu'] } } },
        { id: 'agg', kind: 'aggregate', inputs: ['items', 'in'], outputs: ['result'], config: { op: 'count', items: { type: 'variable', value: 'PetColors' } } },
        { id: 'sink', kind: 'object', inputs: ['result'], outputs: [] }
      ],
      [
        { from: ['sv', 'done'], to: ['agg', 'in'] },
        { from: ['agg', 'result'], to: ['sink', 'result'] }
      ]
    )
    let result: unknown
    const executors = new Map<string, NodeExecutor>([
      ['sv', setVariableExecutor],
      ['agg', aggregateExecutor],
      ['sink', (act) => { result = act.inputs['result']; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(result).toBe(2)
  })
})
