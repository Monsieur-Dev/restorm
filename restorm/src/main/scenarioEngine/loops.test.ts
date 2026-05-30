import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import { forExecutor } from './executors/timeAndFlowExecutors'
import { ifExecutor, comparatorExecutor, whileExecutor, doWhileExecutor } from './executors/pureExecutors'
import { buildExecutorRegistry } from './executors/registry'
import type { Activation, ExecContext, ExecResult, NodeExecutor, ScenarioModel } from './types'

/**
 * Coverage for the loop kinds:
 *  - `for` builds an inclusive numeric range and fans it out over the same
 *    scope machinery as `forEach` (each / done, bounded concurrency);
 *  - `while` / `doWhile` ARE the `if` mechanism — a wired loop-back edge
 *    terminates the loop and routes to the exit branch.
 */

// ------------------------------------------------------------------
// Builders (mirrors scheduler.test.ts)
// ------------------------------------------------------------------

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

/** Call `forExecutor` with a synthetic config + inputs; return the range. */
function forRange(config: Record<string, unknown>, inputs: Record<string, unknown> = {}): { items: number[]; batchSize: number; parallel: boolean } {
  const act = { nodeId: 'f', kind: 'for', scope: [], inputs } as unknown as Activation
  const ctx = { node: { id: 'f', kind: 'for', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
  const res = forExecutor(act, ctx) as ExecResult & { scopeAction: { items: number[]; batchSize: number; parallel: boolean } }
  return { items: res.scopeAction.items, batchSize: res.scopeAction.batchSize, parallel: res.scopeAction.parallel }
}

// ------------------------------------------------------------------
// `for` — range building
// ------------------------------------------------------------------

describe('for executor — numeric range', () => {
  it('builds an ascending range with the default `<` operator (exclusive bound)', () => {
    expect(forRange({ from: 1, to: 5, step: 1 }).items).toEqual([1, 2, 3, 4])
  })
  it('includes the bound with the `≤` operator', () => {
    expect(forRange({ from: 1, to: 5, step: 1, operator: '≤' }).items).toEqual([1, 2, 3, 4, 5])
  })
  it('honours the step', () => {
    expect(forRange({ from: 0, to: 10, step: 2 }).items).toEqual([0, 2, 4, 6, 8])
  })
  it('counts down with `>` and a negative step', () => {
    expect(forRange({ from: 5, to: 1, step: -1, operator: '>' }).items).toEqual([5, 4, 3, 2])
  })
  it('resolves typed-value config bounds (the real node persists `{type:numeric,value}`)', () => {
    // Regression: the node box saves bounds as typed values, not raw numbers —
    // reading them raw collapsed every `for` to a single iteration [from].
    expect(forRange({ from: { type: 'numeric', value: 0 }, to: { type: 'numeric', value: 3 }, step: { type: 'numeric', value: 1 } }).items).toEqual([0, 1, 2])
  })
  it('treats step 0 as 1', () => {
    expect(forRange({ from: 1, to: 3, step: 0 }).items).toEqual([1, 2])
  })
  it('lets wired inputs override config', () => {
    expect(forRange({ from: 0, to: 0, step: 1 }, { from: 2, to: 5 }).items).toEqual([2, 3, 4])
  })
  it('bounds a runaway range', () => {
    expect(forRange({ from: 1, to: 1e9, step: 1 }).items).toHaveLength(100_000)
  })
  it('sizes the parallel batch from config', () => {
    const r = forRange({ from: 1, to: 9, step: 1, parallelism: { enabled: true, count: 3 } })
    expect(r.batchSize).toBe(3)
    expect(r.parallel).toBe(true)
  })
  it('is sequential (batch 1) when parallelism is off', () => {
    expect(forRange({ from: 1, to: 9, step: 1 }).batchSize).toBe(1)
  })
})

// ------------------------------------------------------------------
// `for` — end-to-end fan-out through the scheduler
// ------------------------------------------------------------------

describe('for — fans the range out over `each`, then `done`', () => {
  it('emits each number once and fires done after the last', async () => {
    const scenario = buildScenario(
      [
        { id: 'f', kind: 'for', outputs: ['each', 'done'], config: { from: 1, to: 4, step: 1, operator: '≤' } },
        { id: 'body', kind: 'now', inputs: ['v'], outputs: [] },
        { id: 'end', kind: 'now', inputs: ['d'], outputs: [] }
      ],
      [
        { from: ['f', 'each'], to: ['body', 'v'] },
        { from: ['f', 'done'], to: ['end', 'd'] }
      ]
    )
    const seen: number[] = []
    let doneRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['f', forExecutor],
      ['body', (act) => { seen.push(act.inputs['v'] as number); return { outputs: [] } }],
      ['end', () => { doneRuns += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(doneRuns).toBe(1)
  })
})

// ------------------------------------------------------------------
// `while` / `doWhile` — engine-managed scope loop (auto-loop, no
// manual loop-back: the scheduler re-runs the body + re-evaluates)
// ------------------------------------------------------------------

describe('while / doWhile — engine-managed scope loop', () => {
  it('while runs the body while the (variable) condition holds, then exits', async () => {
    // `init` seeds run-var n=3, triggers the while; each body pass decrements
    // n; the condition `n > 0` is RE-EVALUATED each iteration from the live var.
    const scenario = buildScenario(
      [
        { id: 'init', kind: 'now', outputs: ['out'] },
        { id: 'w', kind: 'while', inputs: ['in'], outputs: ['then', 'else'], config: { operator: '>', left: { type: 'variable', value: 'n' }, right: { type: 'numeric', value: 0 } } },
        { id: 'body', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'exit', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['init', 'out'], to: ['w', 'in'] },
        { from: ['w', 'then'], to: ['body', 'in'] },
        { from: ['w', 'else'], to: ['exit', 'in'] }
      ]
    )
    let bodyRuns = 0
    let exitRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['init', (_act, ctx) => { ctx.variables.set('n', 3); return { outputs: [{ port: 'out', value: 1 }] } }],
      ['w', whileExecutor],
      ['body', (_act, ctx) => { bodyRuns += 1; const n = ctx.variables.get('n'); ctx.variables.set('n', (typeof n === 'number' ? n : 0) - 1); return { outputs: [] } }],
      ['exit', () => { exitRuns += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(bodyRuns).toBe(3) // n: 3>0, 2>0, 1>0 → body; 0>0 → exit
    expect(exitRuns).toBe(1)
  })

  it('doWhile runs the body at least once even when the condition is false from the start', async () => {
    const scenario = buildScenario(
      [
        { id: 'init', kind: 'now', outputs: ['out'] },
        { id: 'dw', kind: 'doWhile', inputs: ['in'], outputs: ['then', 'else'], config: { operator: '>', left: { type: 'variable', value: 'n' }, right: { type: 'numeric', value: 0 } } },
        { id: 'body', kind: 'now', inputs: ['in'], outputs: [] },
        { id: 'exit', kind: 'now', inputs: ['in'], outputs: [] }
      ],
      [
        { from: ['init', 'out'], to: ['dw', 'in'] },
        { from: ['dw', 'then'], to: ['body', 'in'] },
        { from: ['dw', 'else'], to: ['exit', 'in'] }
      ]
    )
    let bodyRuns = 0
    let exitRuns = 0
    const executors = new Map<string, NodeExecutor>([
      ['init', (_act, ctx) => { ctx.variables.set('n', 0); return { outputs: [{ port: 'out', value: 1 }] } }],
      ['dw', doWhileExecutor],
      ['body', () => { bodyRuns += 1; return { outputs: [] } }],
      ['exit', () => { exitRuns += 1; return { outputs: [] } }]
    ])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    expect(s.status().state).toBe('completed')
    expect(bodyRuns).toBe(1) // body-first: runs once, then 0>0 false → exit
    expect(exitRuns).toBe(1)
  })
})

// ------------------------------------------------------------------
// condition resolution — inline operands + operator-toggle symbols
// (the `if` mechanism that while/doWhile reuse)
// ------------------------------------------------------------------

function callCond(executor: typeof ifExecutor, config: Record<string, unknown>, inputs: Record<string, unknown> = {}): { outputs: { port: string; value: unknown }[] } {
  const act = { nodeId: 'n', kind: 'if', scope: [], inputs } as unknown as Activation
  const ctx = { node: { id: 'n', kind: 'if', config, inputs: [], outputs: [], position: { x: 0, y: 0 } } } as unknown as ExecContext
  return executor(act, ctx) as { outputs: { port: string; value: unknown }[] }
}

describe('condition uses inline operands + operator-toggle symbols', () => {
  it('if compares inline numeric operands with a symbol operator', () => {
    expect(callCond(ifExecutor, { operator: '>', left: { type: 'numeric', value: 5 }, right: { type: 'numeric', value: 3 } }).outputs[0]?.port).toBe('then')
    expect(callCond(ifExecutor, { operator: '>', left: { type: 'numeric', value: 1 }, right: { type: 'numeric', value: 3 } }).outputs[0]?.port).toBe('else')
  })

  it('if with inline booleans and "=" routes to then when equal (the user-reported loop case)', () => {
    expect(callCond(ifExecutor, { operator: '=', left: { type: 'boolean', value: true }, right: { type: 'boolean', value: true } }).outputs[0]?.port).toBe('then')
    expect(callCond(ifExecutor, { operator: '=', left: { type: 'boolean', value: true }, right: { type: 'boolean', value: false } }).outputs[0]?.port).toBe('else')
  })

  it('a bare if (no operands) still gates on the `in` trigger truthiness', () => {
    expect(callCond(ifExecutor, {}, { in: true }).outputs[0]?.port).toBe('then')
    expect(callCond(ifExecutor, {}, { in: false }).outputs[0]?.port).toBe('else')
  })

  it('wired operands win over inline config', () => {
    // config would say 99 < 3 (false), but wired 1 < 3 (true) wins.
    expect(callCond(ifExecutor, { operator: '<', left: { type: 'numeric', value: 99 }, right: { type: 'numeric', value: 3 } }, { left: 1, right: 3 }).outputs[0]?.port).toBe('then')
  })

  it('comparator emits the boolean from inline operands + symbol operator', () => {
    expect(callCond(comparatorExecutor, { operator: '≥', a: { type: 'numeric', value: 3 }, b: { type: 'numeric', value: 3 } }).outputs[0]?.value).toBe(true)
    expect(callCond(comparatorExecutor, { operator: '<', a: { type: 'numeric', value: 3 }, b: { type: 'numeric', value: 3 } }).outputs[0]?.value).toBe(false)
  })
})

// ------------------------------------------------------------------
// run-boundary logs (▶ start / ■ end, source `run`)
// ------------------------------------------------------------------

describe('scenario run boundaries in the log', () => {
  it('logs a ▶ start and ■ end (source `run`) even for a no-op run', async () => {
    const scenario = buildScenario([{ id: 'n', kind: 'now', outputs: [] }], [])
    const executors = new Map<string, NodeExecutor>([['n', () => ({ outputs: [] })]])
    const s = new Scheduler({ scenario, executors })
    await s.run()
    const boundaries = s.readLog().filter((e) => e.source === 'run')
    expect(boundaries).toHaveLength(2)
    expect(boundaries[0]?.message.startsWith('▶')).toBe(true)
    expect(boundaries[1]?.message.startsWith('■')).toBe(true)
  })
})

// ------------------------------------------------------------------
// registry — for/while/doWhile resolve to executors
// ------------------------------------------------------------------

describe('registry wires the loop kinds', () => {
  it('binds for → forExecutor, while → whileExecutor, doWhile → doWhileExecutor', () => {
    const scenario = buildScenario(
      [
        { id: 'f', kind: 'for', outputs: ['each', 'done'] },
        { id: 'w', kind: 'while', inputs: ['in', 'left', 'right'], outputs: ['then', 'else'] },
        { id: 'dw', kind: 'doWhile', inputs: ['in', 'left', 'right'], outputs: ['then', 'else'] }
      ],
      []
    )
    const reg = buildExecutorRegistry(scenario)
    expect(reg.get('f')).toBe(forExecutor)
    expect(reg.get('w')).toBe(whileExecutor)
    expect(reg.get('dw')).toBe(doWhileExecutor)
  })
})
