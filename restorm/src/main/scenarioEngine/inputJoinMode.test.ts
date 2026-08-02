import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import type { NodeExecutor, ScenarioModel } from './types'

/**
 * The `in` fan-in join mode.
 *
 * Two forward edges into a node's `in` port are an AND-join barrier by default:
 * the node waits for BOTH branches and fires ONCE. A node that opts into
 * `runOnEachEvent` turns the same fan-in into an OR gate: it fires on EACH
 * arriving token (any one branch triggers it; every later event re-triggers),
 * which is what an "alert on any failure" error-catcher wants.
 */

interface NodeSpec { id: string; kind: string; inputs?: string[]; outputs?: string[]; config?: Record<string, unknown> }
interface EdgeSpec { from: [string, string]; to: [string, string] }

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
    edges: edges.map((e, i) => ({ id: `e${i}`, from: { nodeId: e.from[0], portId: e.from[1] }, to: { nodeId: e.to[0], portId: e.to[1] } }))
  } as unknown as ScenarioModel
}

// a and b are roots that each emit one token into sink.in (a forward fan-in).
function fanInScenario(sinkConfig: Record<string, unknown>): ScenarioModel {
  return buildScenario(
    [
      { id: 'a', kind: 'now', outputs: ['out'] },
      { id: 'b', kind: 'now', outputs: ['out'] },
      { id: 'sink', kind: 'now', inputs: ['in'], outputs: [], config: sinkConfig }
    ],
    [
      { from: ['a', 'out'], to: ['sink', 'in'] },
      { from: ['b', 'out'], to: ['sink', 'in'] }
    ]
  )
}

async function countSinkRuns(scenario: ScenarioModel): Promise<number> {
  let runs = 0
  const executors = new Map<string, NodeExecutor>([
    ['a', () => ({ outputs: [{ port: 'out', value: 1 }] })],
    ['b', () => ({ outputs: [{ port: 'out', value: 2 }] })],
    ['sink', () => { runs += 1; return { outputs: [] } }]
  ])
  const s = new Scheduler({ scenario, executors })
  await s.run()
  expect(s.status().state).toBe('completed')
  return runs
}

describe('`in` fan-in join mode', () => {
  it('AND (default): a forward fan-in fires the node ONCE for both branches', async () => {
    expect(await countSinkRuns(fanInScenario({}))).toBe(1)
  })

  it('OR (runOnEachEvent): the same fan-in fires the node on EACH branch', async () => {
    expect(await countSinkRuns(fanInScenario({ runOnEachEvent: true }))).toBe(2)
  })
})

// One producer feeds a log node on TWO ports at once: its `response` value into
// the log's `data` port, and its universal `done` signal into the log's `in`
// port. This is the everyday "fetch, then act on the response" wiring.
//
// `done` fires once the producer's data subtree has drained, but a consumer
// gated on that very `done` is NOT part of the subtree — it runs on the `done`
// CONTINUATION. So the producer's `done` does not wait for the log, the log
// gets its trigger, and it fires ONCE holding both the routed value and the
// trigger. (Counting such a token as a subtree obligation instead makes `done`
// wait for a consumer that is itself waiting for `done` — a circular wait that
// silently strands every node downstream.)
//
// `runOnEachEvent` keeps its own, different meaning: each incoming wire is an
// independent OR trigger, so the log fires once per arriving token rather than
// joining them into a single activation.
function completionCycleScenario(logConfig: Record<string, unknown>): ScenarioModel {
  return buildScenario(
    [
      { id: 'producer', kind: 'now', outputs: ['response'] },
      { id: 'log', kind: 'now', inputs: ['in', 'data'], outputs: [], config: logConfig }
    ],
    [
      { from: ['producer', 'response'], to: ['log', 'data'] },
      { from: ['producer', 'done'], to: ['log', 'in'] }
    ]
  )
}

async function countLogRuns(scenario: ScenarioModel): Promise<number> {
  let runs = 0
  const executors = new Map<string, NodeExecutor>([
    ['producer', () => ({ outputs: [{ port: 'response', value: { ok: true } }] })],
    ['log', () => { runs += 1; return { outputs: [] } }]
  ])
  const s = new Scheduler({ scenario, executors })
  await s.run()
  expect(s.status().state).toBe('completed')
  return runs
}

describe('a value wire and a `done` wire into the same consumer (response → data + done → in)', () => {
  it('default AND-join fires the consumer ONCE, joining the value with the trigger', async () => {
    expect(await countLogRuns(completionCycleScenario({}))).toBe(1)
  })

  it('runOnEachEvent fires the log on each event instead of joining them', async () => {
    // `response → data` fires it once; the log then completes, the producer
    // subtree drains, `done → in` arrives and fires it a second time.
    expect(await countLogRuns(completionCycleScenario({ runOnEachEvent: true }))).toBe(2)
  })
})
