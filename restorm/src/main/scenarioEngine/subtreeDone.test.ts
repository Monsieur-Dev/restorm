import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { ifExecutor } from './executors/pureExecutors'
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
