import { describe, it, expect, vi } from 'vitest'
import { Scheduler } from './scheduler'
import type {
  EngineEvent,
  NodeExecutor,
  ScenarioModel
} from './types'

/**
 * Vitest coverage for the scheduler primitives. Each test builds a
 * minimal synthetic `ScenarioModel` + a stubbed executor map so we
 * exercise the scheduler without the rest of the main-process
 * surface (no electron, no IPC, no CollectionStore).
 *
 * The scenario-engine acceptance criteria are addressed across these
 * tests, plus a couple of foundational ones (root-parallel start,
 * pause/step/abort).
 */

// ------------------------------------------------------------------
// Builders
// ------------------------------------------------------------------

interface NodeSpec {
  id: string
  kind: string
  inputs?: string[]
  outputs?: string[]
  config?: Record<string, unknown>
}

interface EdgeSpec { id?: string; from: [string, string]; to: [string, string] }

function buildScenario(nodes: NodeSpec[], edges: EdgeSpec[]): ScenarioModel {
  return {
    id: 's',
    name: 'test',
    tags: [],
    params: [],
    items: [],
    notes: '',
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind as ScenarioModel['nodes'][number]['kind'],
      config: n.config ?? {},
      inputs: (n.inputs ?? []).map((p) => ({ id: p, name: p, role: 'value', dataType: 'any' })) as never,
      outputs: (n.outputs ?? []).map((p) => ({ id: p, name: p, role: 'value', dataType: 'any' })) as never,
      position: { x: 0, y: 0 }
    })),
    edges: edges.map((e, i) => ({
      id: e.id ?? `e${i}`,
      from: { nodeId: e.from[0], portId: e.from[1] },
      to: { nodeId: e.to[0], portId: e.to[1] }
    }))
  } as unknown as ScenarioModel
}

function captureEvents(s: Scheduler): EngineEvent[] {
  const out: EngineEvent[] = []
  s.on((e) => out.push(e))
  return out
}

// ------------------------------------------------------------------
// Foundational
// ------------------------------------------------------------------

describe('Scheduler foundations', () => {
  it('starts every root in parallel — all input-less nodes activate before any downstream', async () => {
    // Two roots, each emits on `value`. A sink waits for both.
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value'] },
        { id: 'b', kind: 'now', outputs: ['value'] },
        { id: 'sink', kind: 'object', inputs: ['x', 'y'], outputs: ['value'] }
      ],
      [
        { from: ['a', 'value'], to: ['sink', 'x'] },
        { from: ['b', 'value'], to: ['sink', 'y'] }
      ]
    )
    const order: string[] = []
    const executors = new Map<string, NodeExecutor>([
      ['a', () => { order.push('a-start'); return { outputs: [{ port: 'value', value: 'A' }] } }],
      ['b', () => { order.push('b-start'); return { outputs: [{ port: 'value', value: 'B' }] } }],
      ['sink', (act) => { order.push(`sink:${JSON.stringify(act.inputs)}`); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(order.slice(0, 2).sort()).toEqual(['a-start', 'b-start'])
    expect(order[2]).toBe('sink:{"x":"A","y":"B"}')
  })

  it('fires a downstream node only when ALL WIRED inputs are present', async () => {
    // Both x and y are wired, but only `a` emits — `b` is wired yet
    // never fires, so sink must wait forever (edge-driven
    // requiredness: a port is required iff it has an incoming edge).
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value'] },
        { id: 'b', kind: 'now', outputs: ['value'] },
        { id: 'sink', kind: 'object', inputs: ['x', 'y'], outputs: ['value'] }
      ],
      [
        { from: ['a', 'value'], to: ['sink', 'x'] },
        { from: ['b', 'value'], to: ['sink', 'y'] }
      ]
    )
    const sinkRan = vi.fn()
    const executors = new Map<string, NodeExecutor>([
      ['a', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      // `b` is a root that fires but emits NOTHING on its `value`
      // port — so the wired `sink.y` edge never carries a token and
      // sink must keep waiting.
      ['b', () => ({ outputs: [] })],
      ['sink', (act) => { sinkRan(act); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(sinkRan).not.toHaveBeenCalled()
  })

  it('an unwired input port is not awaited — a node fires on its wired inputs alone', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value'] },
        { id: 'sink', kind: 'object', inputs: ['x', 'y'], outputs: ['value'] }
      ],
      [{ from: ['a', 'value'], to: ['sink', 'x'] }]
    )
    const sinkRan = vi.fn()
    const executors = new Map<string, NodeExecutor>([
      ['a', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['sink', (act) => { sinkRan(act); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    // `y` was never wired → not awaited → sink fires with just x.
    expect(sinkRan).toHaveBeenCalledTimes(1)
    expect((sinkRan.mock.calls[0]?.[0] as { inputs: Record<string, unknown> }).inputs).toEqual({ x: 1 })
  })

  it('aborts cooperatively: in-flight executors observe AbortSignal and the run lands cancelled', async () => {
    const scenario = buildScenario(
      [{ id: 'slow', kind: 'wait', outputs: ['then'] }],
      []
    )
    const executors = new Map<string, NodeExecutor>([
      ['slow', (_act, ctx) => new Promise<{ outputs: [] }>((resolve, reject) => {
        const timer = setTimeout(() => { resolve({ outputs: [] }) }, 5000)
        ctx.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('cancelled'))
        }, { once: true })
      })]
    ])
    const s = new Scheduler({ scenario, executors })
    const events = captureEvents(s)
    const runPromise = s.run()
    s.abort('user-stop')
    await runPromise
    expect(s.status().state).toBe('cancelled')
    expect(events.some((e) => e.type === 'run-cancelled')).toBe(true)
  })

  it('step gives each box a before-stop then runs it; resume finishes the rest', async () => {
    const scenario = buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value'] },
        { id: 'b', kind: 'now', outputs: ['value'] }
      ],
      []
    )
    let aRan = 0
    let bRan = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', () => { aRan += 1; return { outputs: [] } }],
      ['b', () => { bRan += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    void s.run({ startPaused: true })
    expect(s.status().state).toBe('paused')
    // First step PRE-stops before the first box — nothing has run yet.
    s.step()
    await new Promise((r) => setTimeout(r, 0))
    expect(aRan + bRan).toBe(0)
    // Second step runs exactly that one box.
    s.step()
    await new Promise((r) => setTimeout(r, 0))
    expect(aRan + bRan).toBe(1)
    s.resume()
    await new Promise((r) => setTimeout(r, 0))
    expect(aRan + bRan).toBeGreaterThanOrEqual(2)
  })
})

// ------------------------------------------------------------------
// AC1 — fan-out monsters × character
// ------------------------------------------------------------------

describe('AC1 — fan-out via JOIN-by-lineage', () => {
  it('pairs each monster with the same character (no Cartesian)', async () => {
    // Graph: `monsters` and `character` are roots. `forEach` opens a
    // scope per monster. `pair` joins each monster with the character.
    const scenario = buildScenario(
      [
        { id: 'monsters', kind: 'now', outputs: ['value'] },
        { id: 'character', kind: 'now', outputs: ['value'] },
        { id: 'fe', kind: 'forEach', inputs: ['items'], outputs: ['each', 'done'] },
        { id: 'pair', kind: 'object', inputs: ['monster', 'character'], outputs: ['value'] }
      ],
      [
        { from: ['monsters', 'value'], to: ['fe', 'items'] },
        { from: ['fe', 'each'], to: ['pair', 'monster'] },
        { from: ['character', 'value'], to: ['pair', 'character'] }
      ]
    )
    const pairs: unknown[] = []
    const executors = new Map<string, NodeExecutor>([
      ['monsters', () => ({ outputs: [{ port: 'value', value: ['m1', 'm2', 'm3'] }] })],
      ['character', () => ({ outputs: [{ port: 'value', value: 'hero' }] })],
      ['fe', (act) => ({
        outputs: [],
        scopeAction: { type: 'openForEach', items: Array.isArray(act.inputs['items']) ? act.inputs['items'] as unknown[] : [], parallel: true }
      })],
      ['pair', (act) => { pairs.push(act.inputs); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(pairs).toHaveLength(3)
    expect((pairs as Record<string, unknown>[]).map((p) => p['monster']).sort()).toEqual(['m1', 'm2', 'm3'])
    for (const p of pairs as Record<string, unknown>[]) expect(p['character']).toBe('hero')
  })
})

// ------------------------------------------------------------------
// AC4 — withLatestFrom: no rejoin on outer rebroadcast
// ------------------------------------------------------------------

describe('AC4 — withLatestFrom semantics', () => {
  it('re-firing one input does NOT replay past activations of the other', async () => {
    // Trigger fires multiple times; latch fires once. Each trigger
    // produces one activation, using the same latched value.
    const scenario = buildScenario(
      [
        { id: 'trigger', kind: 'now', outputs: ['value'] },
        { id: 'latch', kind: 'now', outputs: ['value'] },
        { id: 'sink', kind: 'object', inputs: ['t', 'l'], outputs: ['value'] }
      ],
      [
        { from: ['trigger', 'value'], to: ['sink', 't'] },
        { from: ['latch', 'value'], to: ['sink', 'l'] }
      ]
    )
    const sinkRuns: Record<string, unknown>[] = []
    let triggerCount = 0
    const executors = new Map<string, NodeExecutor>([
      ['trigger', () => {
        triggerCount += 1
        return { outputs: [{ port: 'value', value: `t-${triggerCount}` }] }
      }],
      ['latch', () => ({ outputs: [{ port: 'value', value: 'L' }] })],
      ['sink', (act) => { sinkRuns.push(act.inputs); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(sinkRuns).toHaveLength(1)
    expect(sinkRuns[0]).toEqual({ t: 't-1', l: 'L' })
  })
})

// ------------------------------------------------------------------
// AC5 — copy-by-value isolation across scopes
// ------------------------------------------------------------------

describe('AC5 — copy-by-value isolation', () => {
  it('mutating an input in one activation does not leak to the next', async () => {
    // Two-iteration forEach: each "writer" mutates a shared-looking
    // object that came down the wire. The accumulator below should
    // see two independent shapes.
    const scenario = buildScenario(
      [
        { id: 'src', kind: 'now', outputs: ['value'] },
        { id: 'fe', kind: 'forEach', inputs: ['items'], outputs: ['each', 'done'] },
        { id: 'writer', kind: 'object', inputs: ['item'], outputs: ['value'] }
      ],
      [
        { from: ['src', 'value'], to: ['fe', 'items'] },
        { from: ['fe', 'each'], to: ['writer', 'item'] }
      ]
    )
    const seen: unknown[] = []
    const executors = new Map<string, NodeExecutor>([
      ['src', () => ({ outputs: [{ port: 'value', value: [{ tag: 'a', shared: { hits: 0 } }, { tag: 'b', shared: { hits: 0 } }] }] })],
      ['fe', (act) => ({
        outputs: [],
        scopeAction: { type: 'openForEach', items: Array.isArray(act.inputs['items']) ? act.inputs['items'] as unknown[] : [], parallel: true }
      })],
      ['writer', (act) => {
        const item = act.inputs['item'] as { tag: string; shared: { hits: number } }
        item.shared.hits += 1
        seen.push(JSON.parse(JSON.stringify(item)))
        return { outputs: [] }
      }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(seen).toHaveLength(2)
    for (const it of seen as { shared: { hits: number } }[]) {
      expect(it.shared.hits).toBe(1)
    }
  })
})

// ------------------------------------------------------------------
// AC7 — error routing
// ------------------------------------------------------------------

describe('AC7 — error port routing', () => {
  it('a node that throws routes to its `error` port when wired', async () => {
    const scenario = buildScenario(
      [
        { id: 'risky', kind: 'now', outputs: ['value', 'error'] },
        { id: 'rescue', kind: 'object', inputs: ['err'], outputs: ['value'] }
      ],
      [{ from: ['risky', 'error'], to: ['rescue', 'err'] }]
    )
    const rescue = vi.fn()
    const executors = new Map<string, NodeExecutor>([
      ['risky', () => { throw new Error('boom') }],
      ['rescue', (act) => { rescue(act.inputs); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(rescue).toHaveBeenCalledTimes(1)
    expect((rescue.mock.calls[0]?.[0] as { err: { message: string } }).err.message).toBe('boom')
    expect(s.status().state).toBe('completed')
  })

  it('an unrouted error fails the whole run', async () => {
    const scenario = buildScenario(
      [{ id: 'risky', kind: 'now', outputs: ['value'] }],
      []
    )
    const executors = new Map<string, NodeExecutor>([
      ['risky', () => { throw new Error('boom') }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('failed')
  })
})

describe('mid-run input cancellation', () => {
  // An executor that mirrors the real `input` node: it awaits a user
  // prompt and emits the answer on `value`. A cancel rejects that await,
  // so the throw propagates into the scheduler's error routing.
  const askExecutor: NodeExecutor = async (_act, ctx) => {
    const v = await ctx.requestUserInput({ name: 'q', defaultValue: null, hint: 'boolean' })
    return { outputs: [{ port: 'value', value: v }] }
  }
  const firstRequestId = async (events: EngineEvent[]): Promise<string> => {
    await vi.waitFor(() => { expect(events.some((e) => e.type === 'user-input-requested')).toBe(true) })
    const ev = events.find((e) => e.type === 'user-input-requested') as { requestId: string }
    return ev.requestId
  }

  it('cancelling a prompt routes the input node to its `error` port when wired', async () => {
    const scenario = buildScenario(
      [
        { id: 'ask', kind: 'input', outputs: ['value', 'error'] },
        { id: 'rescue', kind: 'object', inputs: ['err'], outputs: ['value'] }
      ],
      [{ from: ['ask', 'error'], to: ['rescue', 'err'] }]
    )
    const rescue = vi.fn()
    const executors = new Map<string, NodeExecutor>([
      ['ask', askExecutor],
      ['rescue', (act) => { rescue(act.inputs); return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    const events = captureEvents(s)
    const runP = s.run()
    s.cancelUserInput(await firstRequestId(events))
    await runP
    expect(rescue).toHaveBeenCalledTimes(1)
    expect(s.status().state).toBe('completed')
  })

  it('cancelling a prompt with no `error` wire fails the run', async () => {
    const scenario = buildScenario([{ id: 'ask', kind: 'input', outputs: ['value'] }], [])
    const executors = new Map<string, NodeExecutor>([['ask', askExecutor]])
    const s = new Scheduler({ scenario, executors })
    const events = captureEvents(s)
    const runP = s.run()
    s.cancelUserInput(await firstRequestId(events))
    await runP
    expect(s.status().state).toBe('failed')
  })
})

// ------------------------------------------------------------------
// AC8 — infinite-loop safety net
// ------------------------------------------------------------------

describe('AC8 — max-activations safety net', () => {
  it('stops a runaway cycle after the configured cap', async () => {
    // `seed` kicks off the cycle once; spinner feeds itself forever.
    const scenario = buildScenario(
      [
        { id: 'seed', kind: 'now', outputs: ['value'] },
        { id: 'spinner', kind: 'now', inputs: ['tick'], outputs: ['value'] }
      ],
      [
        { from: ['seed', 'value'], to: ['spinner', 'tick'] },
        { from: ['spinner', 'value'], to: ['spinner', 'tick'] }
      ]
    )
    let runs = 0
    const executors = new Map<string, NodeExecutor>([
      ['seed', () => ({ outputs: [{ port: 'value', value: 0 }] })],
      ['spinner', () => { runs += 1; return { outputs: [{ port: 'value', value: runs }] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run({ maxActivations: 50 })
    expect(s.status().state).toBe('failed')
    expect(runs).toBeLessThanOrEqual(51)
  })
})

// ------------------------------------------------------------------
// AC2 — while/do-while termination via if + return edge
// ------------------------------------------------------------------

describe('AC2 — loop termination via if + return edge', () => {
  it('counts to 3 then exits through the else branch', async () => {
    // Roots: `seed` emits 0. Then increment → if(counter < 3) → else
    // sink. Then-branch loops back to increment.
    const scenario = buildScenario(
      [
        { id: 'seed', kind: 'now', outputs: ['value'] },
        { id: 'inc', kind: 'arithmetic', inputs: ['a', 'b'], outputs: ['result'], config: { op: 'add' } },
        { id: 'check', kind: 'comparator', inputs: ['left', 'right'], outputs: ['result'], config: { op: 'lt' } },
        { id: 'gate', kind: 'if', inputs: ['condition', 'value'], outputs: ['then', 'else'] },
        { id: 'limit', kind: 'now', outputs: ['value'] },
        { id: 'one', kind: 'now', outputs: ['value'] },
        { id: 'sink', kind: 'object', inputs: ['result'], outputs: ['value'] }
      ],
      [
        { from: ['seed', 'value'], to: ['inc', 'a'] },
        { from: ['one', 'value'], to: ['inc', 'b'] },
        { from: ['inc', 'result'], to: ['check', 'left'] },
        { from: ['limit', 'value'], to: ['check', 'right'] },
        { from: ['check', 'result'], to: ['gate', 'condition'] },
        { from: ['inc', 'result'], to: ['gate', 'value'] },
        // loop back into the increment chain
        { from: ['gate', 'then'], to: ['inc', 'a'] },
        // else exits
        { from: ['gate', 'else'], to: ['sink', 'result'] }
      ]
    )
    let counter = 0
    const executors = new Map<string, NodeExecutor>([
      ['seed', () => ({ outputs: [{ port: 'value', value: 0 }] })],
      ['inc', (act) => {
        const r = (act.inputs['a'] as number) + (act.inputs['b'] as number)
        counter += 1
        return { outputs: [{ port: 'result', value: r }] }
      }],
      ['check', (act) => ({ outputs: [{ port: 'result', value: (act.inputs['left'] as number) < (act.inputs['right'] as number) }] })],
      ['gate', (act) => ({ outputs: [{ port: Boolean(act.inputs['condition']) ? 'then' : 'else', value: act.inputs['value'] }] })],
      ['limit', () => ({ outputs: [{ port: 'value', value: 3 }] })],
      ['one', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['sink', () => ({ outputs: [] })]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run({ maxActivations: 200 })
    // The exact `counter` depends on withLatestFrom firing inc more
    // than once per logical iteration (gate re-fires when EITHER
    // condition or value receives a new token). What we care about
    // is: (a) the loop TERMINATES, (b) without hitting the safety
    // net, (c) inc fires at least 3 times.
    expect(s.status().state).toBe('completed')
    expect(counter).toBeGreaterThanOrEqual(3)
  })
})

// ------------------------------------------------------------------
// AND-join barrier — several "ensuite" edges into one `in`
// ------------------------------------------------------------------

describe('AND-join barrier on `in`', () => {
  it('two forward branches into one `in` wait for both, fire the target once', async () => {
    // `fork` fans out to two branches; both branches' `then` edges
    // converge on `target.in`. This is a synchronisation barrier:
    // target must wait for BOTH branches and run a SINGLE time — not
    // once per arriving branch. (If the user wanted two runs they'd
    // use two target boxes.)
    const scenario = buildScenario(
      [
        { id: 'fork', kind: 'now', outputs: ['value'] },
        { id: 'branchA', kind: 'now', inputs: ['in'], outputs: ['out'] },
        { id: 'branchB', kind: 'now', inputs: ['in'], outputs: ['out'] },
        { id: 'target', kind: 'now', inputs: ['in'], outputs: ['value'] }
      ],
      [
        { from: ['fork', 'value'], to: ['branchA', 'in'] },
        { from: ['fork', 'value'], to: ['branchB', 'in'] },
        { from: ['branchA', 'out'], to: ['target', 'in'] },
        { from: ['branchB', 'out'], to: ['target', 'in'] }
      ]
    )
    let targetRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['fork', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['branchA', (act) => ({ outputs: [{ port: 'out', value: act.inputs['in'] }] })],
      ['branchB', (act) => ({ outputs: [{ port: 'out', value: act.inputs['in'] }] })],
      ['target', () => { targetRuns += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(targetRuns).toBe(1)
  })
})

describe('interactive vs headless input seeding', () => {
  // Mirrors the real `input` executor: a SEEDED activation passes its value
  // through; otherwise it prompts the user.
  const inputExec: NodeExecutor = async (act, ctx) => {
    if (act.seeded === true) return { outputs: [{ port: 'value', value: act.inputs['value'] }] }
    const v = await ctx.requestUserInput({ name: 'name', defaultValue: 'Glaude', hint: 'string' })
    return { outputs: [{ port: 'value', value: { name: v } }] }
  }

  it('interactive run: a no-predecessor input PROMPTS instead of using its default', async () => {
    const scenario = buildScenario([{ id: 'in', kind: 'input', config: { name: 'name' }, outputs: ['value'] }], [])
    const executors = new Map<string, NodeExecutor>([['in', inputExec]])
    const s = new Scheduler({ scenario, executors })
    const events = captureEvents(s)
    const runP = s.run({ interactive: true })
    await vi.waitFor(() => { expect(events.some((e) => e.type === 'user-input-requested')).toBe(true) })
    expect(s.status().state).toBe('running') // live + waiting on the prompt
    const ev = events.find((e) => e.type === 'user-input-requested') as { requestId: string }
    s.resolveUserInput(ev.requestId, 'Bob')
    await runP
    expect(s.status().state).toBe('completed')
  })

  it('headless run: a no-predecessor input uses its configured default (no prompt)', async () => {
    const scenario = buildScenario(
      [{ id: 'in', kind: 'input', config: { name: 'name', valueType: { type: 'string', value: 'Glaude' } }, outputs: ['value'] }],
      []
    )
    const executors = new Map<string, NodeExecutor>([['in', inputExec]])
    const s = new Scheduler({ scenario, executors })
    const events = captureEvents(s)
    await s.run() // non-interactive (default)
    expect(events.some((e) => e.type === 'user-input-requested')).toBe(false)
    expect(s.status().state).toBe('completed')
  })
})

// ------------------------------------------------------------------
// Breakpoints (debug run) — pause BEFORE entering a breakpointed node
// ------------------------------------------------------------------

describe('Breakpoints', () => {
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  // a → b → c chain so breaking on `b` is deterministic (no root-parallel race).
  function chain(): ScenarioModel {
    return buildScenario(
      [
        { id: 'a', kind: 'now', outputs: ['value'] },
        { id: 'b', kind: 'object', inputs: ['x'], outputs: ['value'] },
        { id: 'c', kind: 'object', inputs: ['x'], outputs: ['value'] }
      ],
      [{ from: ['a', 'value'], to: ['b', 'x'] }, { from: ['b', 'value'], to: ['c', 'x'] }]
    )
  }

  it('pauses BEFORE a breakpointed node (not executed), emits breakpoint-hit, then resumes past it', async () => {
    let aRan = 0, bRan = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', () => { aRan += 1; return { outputs: [{ port: 'value', value: 1 }] } }],
      ['b', () => { bRan += 1; return { outputs: [{ port: 'value', value: 2 }] } }],
      ['c', () => ({ outputs: [] })]
    ])
    const s = new Scheduler({ scenario: chain(), executors })
    const events = captureEvents(s)
    void s.run({ debug: true, breakpoints: ['b'] })
    await flush()
    // `a` ran; `b` is paused at its breakpoint and has NOT executed.
    expect(aRan).toBe(1)
    expect(bRan).toBe(0)
    expect(s.status().state).toBe('paused')
    expect(events.find((e) => e.type === 'breakpoint-hit')).toMatchObject({ type: 'breakpoint-hit', nodeId: 'b' })

    s.resume()
    await flush()
    expect(bRan).toBe(1)
    expect(s.status().state).toBe('completed')
  })

  it('step (F6) runs exactly the breakpointed node, then re-pauses before the next', async () => {
    let bRan = 0, cRan = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['b', () => { bRan += 1; return { outputs: [{ port: 'value', value: 2 }] } }],
      ['c', () => { cRan += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario: chain(), executors })
    void s.run({ debug: true, breakpoints: ['b'] })
    await flush()
    expect(bRan).toBe(0) // paused before b

    s.step()
    await flush()
    expect(bRan).toBe(1) // b executed exactly once
    expect(cRan).toBe(0) // re-paused before c
    expect(s.status().state).toBe('paused')

    s.resume()
    await flush()
    expect(cRan).toBe(1)
  })

  it('the plain Play run (no debug) ignores breakpoints entirely', async () => {
    let bRan = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', () => ({ outputs: [{ port: 'value', value: 1 }] })],
      ['b', () => { bRan += 1; return { outputs: [{ port: 'value', value: 2 }] } }],
      ['c', () => ({ outputs: [] })]
    ])
    const s = new Scheduler({ scenario: chain(), executors })
    await s.run({ breakpoints: ['b'] }) // breakpoints present but debug !== true
    expect(bRan).toBe(1)
    expect(s.status().state).toBe('completed')
  })

  it('a stale breakpoint id (node no longer exists) never triggers and never crashes', async () => {
    let aRan = 0
    const scenario = buildScenario([{ id: 'a', kind: 'now', outputs: ['value'] }], [])
    const executors = new Map<string, NodeExecutor>([['a', () => { aRan += 1; return { outputs: [] } }]])
    const s = new Scheduler({ scenario, executors })
    await s.run({ debug: true, breakpoints: ['ghost-deleted-node'] })
    expect(aRan).toBe(1)
    expect(s.status().state).toBe('completed')
  })

  it('setDebug + setBreakpoints honor a breakpoint added mid-run (Play → Debug)', async () => {
    let aRan = 0, bRan = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', () => { aRan += 1; return { outputs: [{ port: 'value', value: 1 }] } }],
      ['b', () => { bRan += 1; return { outputs: [{ port: 'value', value: 2 }] } }],
      ['c', () => ({ outputs: [] })]
    ])
    const s = new Scheduler({ scenario: chain(), executors })
    const events = captureEvents(s)
    // Launch as a NON-debug run (like Play), armed paused so we can arm debug
    // before anything dispatches.
    void s.run({ startPaused: true, debug: false })
    await flush()

    // Mid-run: the user adds a breakpoint on `b` and presses Debug.
    s.setBreakpoints(['b'])
    s.setDebug(true)
    s.resume()
    await flush()

    // `a` ran (no breakpoint), but the run broke BEFORE `b`.
    expect(aRan).toBe(1)
    expect(bRan).toBe(0)
    expect(s.status().state).toBe('paused')
    expect(events.some((e) => e.type === 'breakpoint-hit' && e.nodeId === 'b')).toBe(true)
  })

  it('stepping gives each box TWO stops — one before it runs (step-paused) and one after', async () => {
    let aRan = 0, bRan = 0
    const executors = new Map<string, NodeExecutor>([
      ['a', () => { aRan += 1; return { outputs: [{ port: 'value', value: 1 }] } }],
      ['b', () => { bRan += 1; return { outputs: [{ port: 'value', value: 2 }] } }],
      ['c', () => ({ outputs: [] })]
    ])
    const s = new Scheduler({ scenario: chain(), executors })
    const events = captureEvents(s)
    void s.run({ startPaused: true })
    await flush()

    // Step 1 → PRE-stop before `a`: it has NOT run, and a step-paused fired.
    s.step(); await flush()
    expect(aRan).toBe(0)
    expect(s.status().state).toBe('paused')
    expect(events.find((e) => e.type === 'step-paused')).toMatchObject({ nodeId: 'a' })

    // Step 2 → `a` executes (post-stop), `b` not yet.
    s.step(); await flush()
    expect(aRan).toBe(1)
    expect(bRan).toBe(0)
    expect(s.status().state).toBe('paused')

    // Step 3 → PRE-stop before `b` (still not run).
    s.step(); await flush()
    expect(bRan).toBe(0)
    expect(events.some((e) => e.type === 'step-paused' && e.nodeId === 'b')).toBe(true)

    // Step 4 → `b` executes.
    s.step(); await flush()
    expect(bRan).toBe(1)
  })
})
