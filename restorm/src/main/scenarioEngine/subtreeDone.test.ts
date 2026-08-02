import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { assertExecutor, ifExecutor } from './executors/pureExecutors'
import { forExecutor } from './executors/timeAndFlowExecutors'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * The universal `Done` port: every action box emits an implicit `done`
 * signal once its ENTIRE downstream data-subtree has drained (post-order
 * completion). It carries no value — it is a pure sequencing signal, the
 * generalisation of the loop `done` to every kind.
 *
 * `done` is a CONTINUATION, not a child: a token routed off a box's `done`
 * port is NOT part of that box's subtree, so a `.done → .in` chain runs
 * each box strictly after the previous one's work finished.
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

describe('universal Done port — subtree completion', () => {
  it('fires `done` on a plain box once its (empty) data-subtree has drained', async () => {
    // a has no wired data output, so its subtree is empty → `done` fires
    // immediately, triggering b.
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value', 'done'] },
        { id: 'b', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [{ from: ['a', 'done'], to: ['b', 'in'] }]
    )
    let bRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['b', () => { bRuns += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(bRuns).toBe(1)
  })

  it('defers `done` until a wired (async) data-subtree has fully drained', async () => {
    // a → (data) → slow b ;  a → (done) → c.  `c` must run strictly AFTER b
    // finishes — proving `done` waits for the subtree, not just a's return.
    const order: string[] = []
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value', 'done'] },
        { id: 'b', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'c', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['a', 'value'], to: ['b', 'in'] },
        { from: ['a', 'done'], to: ['c', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['a', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['b', async () => { await new Promise((r) => setTimeout(r, 15)); order.push('b'); return { outputs: [] } }],
      ['c', () => { order.push('c'); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(order).toEqual(['b', 'c'])
  })

  it('waits for EVERY branch of a fan-out before `done`', async () => {
    // a fans out to two slow boxes; `done` fires only once both have drained.
    const order: string[] = []
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value', 'done'] },
        { id: 'b1', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'b2', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'c', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['a', 'value'], to: ['b1', 'in'] },
        { from: ['a', 'value'], to: ['b2', 'in'] },
        { from: ['a', 'done'], to: ['c', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['a', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['b1', async () => { await new Promise((r) => setTimeout(r, 20)); order.push('b1'); return { outputs: [] } }],
      ['b2', async () => { await new Promise((r) => setTimeout(r, 5)); order.push('b2'); return { outputs: [] } }],
      ['c', () => { order.push('c'); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(order).toEqual(['b2', 'b1', 'c']) // c last, after both branches
  })

  it('fires `done` only after the chosen `if` branch subtree completes', async () => {
    // if routes to `then` → slow body; if.done must wait for that body.
    const order: string[] = []
    const scenario = buildScenario(
      [
        { id: 'seed', kind: 'now', outputs: ['out'] },
        { id: 'gate', kind: 'if', inputs: ['in'], outputs: ['then', 'else'], config: {} },
        { id: 'body', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'after', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['seed', 'out'], to: ['gate', 'in'] },
        { from: ['gate', 'then'], to: ['body', 'in'] },
        { from: ['gate', 'done'], to: ['after', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['seed', () => ({ outputs: [{ port: 'out', value: true }] })],
      ['gate', ifExecutor],
      ['body', async () => { await new Promise((r) => setTimeout(r, 15)); order.push('body'); return { outputs: [] } }],
      ['after', () => { order.push('after'); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(order).toEqual(['body', 'after'])
  })

  it('AND-joins two `done` ports into one `in`: target fires once both predecessors complete', async () => {
    // p1.done AND p2.done → target.in. Two forward `done` edges into `in` form
    // an AND-join barrier — the target must fire exactly once, after BOTH
    // predecessors have finished. (Mirrors a real scenario: a setVariable's
    // `done` and an `if`'s `done` both gating a downstream box.)
    let targetRuns = 0
    const scenario = buildScenario(
      [
        { id: 'p1', kind: 'now', outputs: ['value', 'done'] },
        { id: 'p2', kind: 'now', outputs: ['value', 'done'] },
        { id: 'target', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['p1', 'done'], to: ['target', 'in'] },
        { from: ['p2', 'done'], to: ['target', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['p1', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['p2', () => ({ outputs: [{ port: 'value', value: 2 }] })],
      ['target', () => { targetRuns += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(targetRuns).toBe(1)
  })

  it('a loop`s upstream `done` waits for the whole loop (done is the loop`s exit)', async () => {
    // a → (data) → for(0..2) → body×3 ;  a → (done) → after.  `after` runs
    // only once the loop has fully iterated.
    const order: string[] = []
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value', 'done'] },
        { id: 'loop', kind: 'for', inputs: ['from'], outputs: ['each', 'done'], config: { from: 0, to: 3, step: 1 } },
        { id: 'body', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'after', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['a', 'value'], to: ['loop', 'from'] },
        { from: ['loop', 'each'], to: ['body', 'in'] },
        { from: ['a', 'done'], to: ['after', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['a', () => ({ outputs: [{ port: 'value', value: 0 }] })],
      ['loop', forExecutor],
      ['body', async () => { await new Promise((r) => setTimeout(r, 5)); order.push('body'); return { outputs: [] } }],
      ['after', () => { order.push('after'); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(order).toEqual(['body', 'body', 'body', 'after'])
  })
})

/**
 * A consumer wired to BOTH a box's data output and that same box's `done`
 * signal — "fetch, then assert on the response", the most common shape in the
 * product.
 *
 * `done` waits for the emitter's data subtree to drain, but such a consumer is
 * NOT in that subtree: it runs on the `done` CONTINUATION. Treating its token
 * as a subtree obligation instead makes `done` wait for a consumer that is
 * itself waiting for `done` — a circular wait that strands every node below it
 * while the run still reports success.
 */
describe('a value wire and a `done` wire into the same consumer', () => {
  it('runs the consumer once, with the routed value AND the trigger', async () => {
    const scenario = buildScenario(
      [
        { id: 'request', kind: 'now', outputs: ['response', 'done'] },
        { id: 'check', kind: 'now', inputs: ['in', 'a'], outputs: [] }
      ],
      [
        { from: ['request', 'response'], to: ['check', 'a'] },
        { from: ['request', 'done'], to: ['check', 'in'] }
      ]
    )
    const seen: unknown[] = []
    const executors = new Map<string, NodeExecutor>([
      ['request', () => ({ outputs: [{ port: 'response', value: { response: { status: 200 } } }] })],
      ['check', (act) => { seen.push(act.inputs['a']); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    // The value must actually arrive — a consumer that fires on the trigger
    // alone, with an empty operand, would assert against nothing.
    expect(seen).toEqual([{ response: { status: 200 } }])
  })

  it('runs the consumer in the normal flow, not deferred to the end of the run', async () => {
    // The distinction that matters: this wiring must work by ACCOUNTING, not by
    // the end-of-run settlement. Here an independent slow chain runs alongside.
    // Accounted for, `check` fires as soon as the request returns — before the
    // slow chain finishes. Left to the settlement it could only fire once the
    // whole run went quiet, i.e. dead last, turning an ordinary graph's
    // ordering into a function of when everything else happened to finish.
    const order: string[] = []
    const scenario = buildScenario(
      [
        { id: 'request', kind: 'now', outputs: ['response', 'done'] },
        { id: 'check', kind: 'now', inputs: ['in', 'a'], outputs: [] },
        { id: 'slowOne', kind: 'now', outputs: ['out'] },
        { id: 'slowTwo', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['request', 'response'], to: ['check', 'a'] },
        { from: ['request', 'done'], to: ['check', 'in'] },
        { from: ['slowOne', 'out'], to: ['slowTwo', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['request', () => ({ outputs: [{ port: 'response', value: 1 }] })],
      ['check', () => { order.push('check'); return { outputs: [] } }],
      ['slowOne', async () => { await new Promise((r) => setTimeout(r, 20)); order.push('slowOne'); return { outputs: [{ port: 'out', value: 1 }] } }],
      ['slowTwo', async () => { await new Promise((r) => setTimeout(r, 20)); order.push('slowTwo'); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(order).toEqual(['check', 'slowOne', 'slowTwo'])
  })

  it('keeps running the rest of the chain below that consumer', async () => {
    // request → check → transform → sink, with the value + done pair at the
    // top. Everything downstream must execute, not just the first consumer.
    const order: string[] = []
    const scenario = buildScenario(
      [
        { id: 'request', kind: 'now', outputs: ['response', 'done'] },
        { id: 'check', kind: 'now', inputs: ['in', 'a'], outputs: ['then'] },
        { id: 'shape', kind: 'now', inputs: ['in'], outputs: ['out'] },
        { id: 'sink', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['request', 'response'], to: ['check', 'a'] },
        { from: ['request', 'done'], to: ['check', 'in'] },
        { from: ['check', 'then'], to: ['shape', 'in'] },
        { from: ['shape', 'out'], to: ['sink', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['request', () => ({ outputs: [{ port: 'response', value: 1 }] })],
      ['check', () => { order.push('check'); return { outputs: [{ port: 'then', value: true }] } }],
      ['shape', () => { order.push('shape'); return { outputs: [{ port: 'out', value: 2 }] } }],
      ['sink', () => { order.push('sink'); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(order).toEqual(['check', 'shape', 'sink'])
  })

  it('resolves the same cycle when the `done` reaches the consumer indirectly', async () => {
    // The block is transitive: producer.value → sink.a, but sink's trigger
    // comes from a gate that is itself triggered by producer.done. Nothing
    // below the producer can run unless the whole chain is accounted for.
    const order: string[] = []
    const scenario = buildScenario(
      [
        { id: 'producer', kind: 'now', outputs: ['value', 'done'] },
        { id: 'gate', kind: 'now', inputs: ['in'], outputs: ['out'] },
        { id: 'sink', kind: 'now', inputs: ['in', 'a'], outputs: [] }
      ],
      [
        { from: ['producer', 'value'], to: ['sink', 'a'] },
        { from: ['producer', 'done'], to: ['gate', 'in'] },
        { from: ['gate', 'out'], to: ['sink', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['producer', () => ({ outputs: [{ port: 'value', value: 7 }] })],
      ['gate', () => { order.push('gate'); return { outputs: [{ port: 'out', value: true }] } }],
      ['sink', (act) => { order.push(`sink:${String(act.inputs['a'])}`); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(order).toEqual(['gate', 'sink:7'])
    expect(s.readLog().filter((e) => e.level === 'warn')).toEqual([])
  })

  it('still defers `done` for a consumer that is genuinely in the subtree', async () => {
    // The exemption is narrow: `slow` is fed data only, so it stays part of the
    // producer's subtree and `done` must still wait for it. Without this the
    // fix would have bought the fetch→assert case by breaking `done` ordering
    // everywhere else.
    const order: string[] = []
    const scenario = buildScenario(
      [
        { id: 'producer', kind: 'now', outputs: ['value', 'done'] },
        { id: 'slow', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'consumer', kind: 'now', inputs: ['in', 'a'], outputs: [] }
      ],
      [
        { from: ['producer', 'value'], to: ['slow', 'in'] },
        { from: ['producer', 'value'], to: ['consumer', 'a'] },
        { from: ['producer', 'done'], to: ['consumer', 'in'] }
      ]
    )
    const executors = new Map<string, NodeExecutor>([
      ['producer', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['slow', async () => { await new Promise((r) => setTimeout(r, 15)); order.push('slow'); return { outputs: [] } }],
      ['consumer', () => { order.push('consumer'); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(order).toEqual(['slow', 'consumer'])
  })
})

/**
 * An obligation that can never be discharged — the consumer's trigger depends
 * on a branch that was not taken, so the token sits buffered forever. At
 * quiescence (empty queue, nothing in flight, no deferred re-entry) no token
 * can move again, so the emitter's subtree IS finished and its `done` must
 * fire; otherwise every continuation below it is silently skipped while the run
 * reports success.
 */
describe('a subtree that can no longer drain', () => {
  function strandedScenario(): ScenarioModel {
    return buildScenario(
      [
        { id: 'root', kind: 'now', outputs: ['done'] },
        { id: 'source', kind: 'now', inputs: ['in'], outputs: ['value', 'done'] },
        { id: 'gate', kind: 'now', inputs: ['in'], outputs: ['then', 'else'] },
        { id: 'skipped', kind: 'now', inputs: ['in', 'a'], outputs: [] },
        { id: 'after', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['root', 'done'], to: ['source', 'in'] },
        { from: ['root', 'done'], to: ['gate', 'in'] },
        { from: ['source', 'value'], to: ['skipped', 'a'] },
        { from: ['gate', 'then'], to: ['skipped', 'in'] },
        { from: ['source', 'done'], to: ['after', 'in'] }
      ]
    )
  }

  function strandedExecutors(ran: Record<string, number>): Map<string, NodeExecutor> {
    const count = (id: string): void => { ran[id] = (ran[id] ?? 0) + 1 }
    return new Map<string, NodeExecutor>([
      ['root', () => { count('root'); return { outputs: [] } }],
      ['source', () => { count('source'); return { outputs: [{ port: 'value', value: 7 }] } }],
      // Takes the `else` branch, so `skipped` never receives its trigger.
      ['gate', () => { count('gate'); return { outputs: [{ port: 'else', value: false }] } }],
      ['skipped', () => { count('skipped'); return { outputs: [] } }],
      ['after', () => { count('after'); return { outputs: [] } }]
    ])
  }

  it('still fires the `done` continuation of the box whose token was stranded', async () => {
    const ran: Record<string, number> = {}
    const s = new Scheduler({ scenario: strandedScenario(), executors: strandedExecutors(ran) })
    await s.run()
    expect(s.status().state).toBe('completed')
    // The untaken branch legitimately skips `skipped` — but `after` hangs off
    // `source.done` and has to run.
    expect(ran['skipped']).toBeUndefined()
    expect(ran['after']).toBe(1)
  })

  it('records in the run log which boxes never ran', async () => {
    const ran: Record<string, number> = {}
    const s = new Scheduler({ scenario: strandedScenario(), executors: strandedExecutors(ran) })
    await s.run()
    const warning = s.readLog().find((e) => e.level === 'warn' && e.message.includes('never ran'))
    // Green, but not silent: the box that sat waiting is named, AND the port it
    // was waiting on — that port is the wire the user has to go look at.
    expect(warning?.message).toContain('skipped')
    expect(warning?.message).toContain('waiting on "in"')
  })

  it('names a loop body that could never fire, instead of finishing green and mute', async () => {
    // The loop iterates, but its body also needs a value from a box that emits
    // nothing — so the body never runs. The run has nothing to fail over, and
    // exactly for that reason the journal has to say so.
    const scenario = buildScenario(
      [
        { id: 'loop', kind: 'for', inputs: [], outputs: ['each', 'done'], config: { from: 0, to: 2, step: 1 } },
        { id: 'silent', kind: 'now', inputs: [], outputs: ['out'] },
        { id: 'body', kind: 'now', inputs: ['in', 'a'], outputs: [] }
      ],
      [
        { from: ['loop', 'each'], to: ['body', 'in'] },
        { from: ['silent', 'out'], to: ['body', 'a'] }
      ]
    )
    let bodyRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['loop', forExecutor],
      ['silent', () => ({ outputs: [] })],
      ['body', () => { bodyRuns += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(bodyRuns).toBe(0)
    const warning = s.readLog().find((e) => e.level === 'warn' && e.message.includes('never ran'))
    expect(warning?.message).toContain('body')
  })

  it('picks the same box to settle on every run, whatever the timing', async () => {
    // Two independent stranded subtrees settle in graph order, not in whichever
    // order their async executors happened to land.
    const seen = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const scenario = buildScenario(
        [
          { id: 'root', kind: 'now', outputs: ['done'] },
          { id: 'alpha', kind: 'now', inputs: ['in'], outputs: ['value', 'done'] },
          { id: 'beta', kind: 'now', inputs: ['in'], outputs: ['value', 'done'] },
          { id: 'gate', kind: 'now', inputs: ['in'], outputs: ['then', 'else'] },
          { id: 'deadA', kind: 'now', inputs: ['in', 'a'], outputs: [] },
          { id: 'deadB', kind: 'now', inputs: ['in', 'a'], outputs: [] },
          { id: 'afterA', kind: 'now', inputs: ['in'], outputs: [] },
          { id: 'afterB', kind: 'now', inputs: ['in'], outputs: [] }
        ],
        [
          { from: ['root', 'done'], to: ['alpha', 'in'] },
          { from: ['root', 'done'], to: ['beta', 'in'] },
          { from: ['root', 'done'], to: ['gate', 'in'] },
          { from: ['alpha', 'value'], to: ['deadA', 'a'] },
          { from: ['beta', 'value'], to: ['deadB', 'a'] },
          { from: ['gate', 'then'], to: ['deadA', 'in'] },
          { from: ['gate', 'then'], to: ['deadB', 'in'] },
          { from: ['alpha', 'done'], to: ['afterA', 'in'] },
          { from: ['beta', 'done'], to: ['afterB', 'in'] }
        ]
      )
      const order: string[] = []
      // Randomised delays: the two subtrees settle in a timing-independent order.
      const jitter = async (): Promise<void> => { await new Promise((r) => setTimeout(r, Math.random() * 8)) }
      const executors = new Map<string, NodeExecutor>([
        ['root', () => ({ outputs: [] })],
        ['alpha', async () => { await jitter(); return { outputs: [{ port: 'value', value: 1 }] } }],
        ['beta', async () => { await jitter(); return { outputs: [{ port: 'value', value: 2 }] } }],
        ['gate', () => ({ outputs: [{ port: 'else', value: false }] })],
        ['deadA', () => ({ outputs: [] })],
        ['deadB', () => ({ outputs: [] })],
        ['afterA', () => { order.push('afterA'); return { outputs: [] } }],
        ['afterB', () => { order.push('afterB'); return { outputs: [] } }]
      ])
      const s = new Scheduler({ scenario, executors })
      await s.run()
      expect(s.status().state).toBe('completed')
      seen.add(order.join(','))
    }
    expect(seen.size).toBe(1)
    expect([...seen][0]).toBe('afterA,afterB')
  })
})

/**
 * The end-to-end shape a real API smoke test has: call an endpoint, assert on
 * the response, reshape it, branch on the result, log. The response feeds the
 * assert's operand AND the transform's value, while both take their trigger
 * from the upstream box's `done` — so the graph carries the value/`done` pair
 * twice over, on top of a conditional branch.
 */
describe('an end-to-end fetch, assert, transform, branch, log scenario', () => {
  function smokeTest(): ScenarioModel {
    const nodes = [
      { id: 'input', kind: 'now', outputs: ['value', 'done'] },
      { id: 'http', kind: 'now', inputs: ['in'], outputs: ['response', 'done'] },
      { id: 'check', kind: 'assert', inputs: ['in', 'a'], outputs: ['then', 'else'], config: { operator: 'eq', b: 200 } },
      { id: 'shape', kind: 'now', inputs: ['in', 'value'], outputs: ['out', 'done'] },
      { id: 'gate', kind: 'if', inputs: ['in', 'left'], outputs: ['then', 'else'], config: { operator: 'gte', right: 0 } },
      { id: 'report', kind: 'now', inputs: ['in'], outputs: [] }
    ]
    const scenario = buildScenario(nodes, [
      { from: ['input', 'done'], to: ['http', 'in'] },
      { from: ['http', 'response'], to: ['check', 'a'] },
      { from: ['http', 'done'], to: ['check', 'in'] },
      { from: ['check', 'then'], to: ['shape', 'in'] },
      { from: ['http', 'response'], to: ['shape', 'value'] },
      { from: ['shape', 'out'], to: ['gate', 'left'] },
      { from: ['shape', 'done'], to: ['gate', 'in'] },
      { from: ['gate', 'then'], to: ['report', 'in'] }
    ])
    // The operand selector has to dig into the response envelope, exactly as the
    // real edge does — a bare `status` would resolve to undefined.
    const withSelector = scenario as unknown as { edges: { id: string; selector?: string }[] }
    const byId = new Map(withSelector.edges.map((e) => [e.id, e]))
    const operand = byId.get('e1')
    if (operand) operand.selector = 'response.status'
    const value = byId.get('e4')
    if (value) value.selector = '.'
    return scenario
  }

  function smokeExecutors(status: number, ran: string[]): Map<string, NodeExecutor> {
    return new Map<string, NodeExecutor>([
      ['input', () => { ran.push('input'); return { outputs: [{ port: 'value', value: { petId: 1 } }] } }],
      ['http', () => { ran.push('http'); return { outputs: [{ port: 'response', value: { request: {}, response: { status, body: '{}' } } }] } }],
      ['check', (act, ctx) => { ran.push('check'); return assertExecutor(act, ctx) }],
      ['shape', () => { ran.push('shape'); return { outputs: [{ port: 'out', value: 42 }] } }],
      ['gate', (act, ctx) => { ran.push('gate'); return ifExecutor(act, ctx) }],
      ['report', () => { ran.push('report'); return { outputs: [] } }]
    ])
  }

  it('executes every box when the assertion passes', async () => {
    const ran: string[] = []
    const s = new Scheduler({ scenario: smokeTest(), executors: smokeExecutors(200, ran) })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(ran).toEqual(['input', 'http', 'check', 'shape', 'gate', 'report'])
    expect(s.readLog().filter((e) => e.level === 'warn')).toEqual([])
  })

  it('stops at the failed assertion without turning it into an engine error', async () => {
    // A failing assertion is an ORDINARY outcome: the boxes on the `then` side
    // are skipped, the run still completes, and the journal says which box sat
    // waiting. Reporting an engine stall here would drown a real assertion
    // failure in a false alarm.
    const ran: string[] = []
    const s = new Scheduler({ scenario: smokeTest(), executors: smokeExecutors(500, ran) })
    await s.run()
    expect(s.status().state).toBe('completed')
    // WHICH boxes were skipped is the whole point, not how many: exactly the
    // three on the `then` side, and nothing else. A fix that merely lets all
    // six run on a 200 is compatible with several wrong implementations; only
    // an engine that tells "the branch wasn't taken" apart from "it never got
    // the chance to run" skips precisely these three and still completes.
    expect(ran).toEqual(['input', 'http', 'check'])
    const skipped = ['shape', 'gate', 'report'].filter((id) => !ran.includes(id))
    expect(skipped).toEqual(['shape', 'gate', 'report'])
    const warning = s.readLog().find((e) => e.level === 'warn' && e.message.includes('never ran'))
    expect(warning?.message).toContain('shape')
  })
})
