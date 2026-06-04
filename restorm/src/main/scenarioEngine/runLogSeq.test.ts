import { describe, it, expect } from 'vitest'
import { Scheduler } from './scheduler'
import type { NodeExecutor, ScenarioModel } from './types'

// The run-log merges a whole run tree (parent + sub-runs) into one ordered
// list. `ts` is millisecond-resolution, so a sub-run entry and its parent's
// post-call entry routinely share a `ts` and a pure-`ts` sort then violates
// happens-before. Every log entry gets a process-wide monotonic `seq` at
// emission, so the merge can restore causal order. These tests pin that
// contract: every entry is stamped, seq increases in push order, and a
// scheduler that runs LATER (a parent emitting after awaiting its sub) gets
// strictly higher seq than one that ran earlier (the sub).

function oneLogScenario(nodeId: string): ScenarioModel {
  return {
    id: 's', name: 't', tags: [], params: [], items: [], notes: '',
    nodes: [{ id: nodeId, kind: 'now', config: {}, inputs: [], outputs: [{ id: 'value', name: 'value', role: 'value', dataType: 'any' }], position: { x: 0, y: 0 } }],
    edges: []
  } as unknown as ScenarioModel
}

const loggingExecutor = (message: string): NodeExecutor => (_act, ctx) => {
  ctx.log({ level: 'info', message })
  return { outputs: [{ port: 'value', value: 1 }] }
}

describe('run-log seq ordering', () => {
  it('stamps every entry with a strictly increasing seq', async () => {
    const s = new Scheduler({
      scenario: oneLogScenario('n'),
      executors: new Map<string, NodeExecutor>([['n', loggingExecutor('hello')]])
    })
    await s.run()
    const log = s.readLog()
    expect(log.length).toBeGreaterThan(0)
    const seqs = log.map((e) => e.seq).filter((s): s is number => typeof s === 'number')
    expect(seqs.length).toBe(log.length) // every entry stamped
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
  })

  it('orders a later scheduler`s entries after an earlier one`s (cross-run causal merge)', async () => {
    // Mirrors a parent emitting AFTER awaiting its sub-run: the sub runs first,
    // the parent second, so even on an identical `ts` the parent`s entries must
    // sort last. The global seq guarantees it.
    const sub = new Scheduler({
      scenario: oneLogScenario('inner'),
      executors: new Map<string, NodeExecutor>([['inner', loggingExecutor('inner')]])
    })
    await sub.run()
    const parent = new Scheduler({
      scenario: oneLogScenario('outer'),
      executors: new Map<string, NodeExecutor>([['outer', loggingExecutor('outer')]])
    })
    await parent.run()

    const innerSeq = sub.readLog().find((e) => e.source === 'user' && e.message === 'inner')?.seq ?? -1
    const outerSeq = parent.readLog().find((e) => e.source === 'user' && e.message === 'outer')?.seq ?? -1
    expect(innerSeq).toBeGreaterThan(0)
    expect(outerSeq).toBeGreaterThan(innerSeq)

    // Merge the two run logs (as the inspector / persisted history does) and
    // sort by seq — `inner` must land before `outer` regardless of ts ties.
    const merged = [...parent.readLog(), ...sub.readLog()] // deliberately parent-first to defeat a naive stable sort
      .filter((e) => e.source === 'user')
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    expect(merged.map((e) => e.message)).toEqual(['inner', 'outer'])
  })
})
