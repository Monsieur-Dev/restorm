import { describe, it, expect } from 'vitest'
import { RunArchive } from './runArchive'
import type { RunLogEntry } from './types'

function entry(runId: string, message: string, ts = '2026-01-01T00:00:00.000Z'): RunLogEntry {
  return { ts, runId, level: 'debug', source: 'engine', message }
}

describe('RunArchive', () => {
  const limits = { maxRuns: 50, maxEntriesPerRun: 2000, ttlMs: 30 * 60 * 1000 }

  it('archives a run + serves its snapshot after completion', () => {
    const a = new RunArchive(limits)
    a.start({ runId: 'r1', scenarioId: 's1', launcherScenarioId: 's1', startedAtMs: 1000 })
    expect(a.get('r1')?.status).toBe('running')
    a.complete('r1', 'completed', 2000, [entry('r1', 'done')])
    expect(a.get('r1')?.status).toBe('completed')
    expect(a.get('r1')?.log).toHaveLength(1)
    expect(a.get('r1')?.endedAt).toBeDefined()
  })

  it('links sub-runs to their parent and returns the tree parents-first', () => {
    const a = new RunArchive(limits)
    a.start({ runId: 'root', scenarioId: 'parent', launcherScenarioId: 'parent', startedAtMs: 1000 })
    a.start({ runId: 'sub-b', scenarioId: 'child', launcherScenarioId: 'parent', parentRunId: 'root', startedAtMs: 1200 })
    a.start({ runId: 'sub-a', scenarioId: 'child', launcherScenarioId: 'parent', parentRunId: 'root', startedAtMs: 1100 })
    const tree = a.tree('root')
    expect(tree.map((r) => r.runId)).toEqual(['root', 'sub-a', 'sub-b'])
    expect(tree.every((r) => r.launcherScenarioId === 'parent')).toBe(true)
    // Unknown root → empty tree.
    expect(a.tree('nope')).toEqual([])
  })

  it('caps a run log to maxEntriesPerRun with an explicit truncation marker', () => {
    const a = new RunArchive({ ...limits, maxEntriesPerRun: 3 })
    a.start({ runId: 'r1', scenarioId: 's1', launcherScenarioId: 's1', startedAtMs: 1000 })
    const log = Array.from({ length: 10 }, (_, i) => entry('r1', `m${i}`))
    a.complete('r1', 'completed', 2000, log)
    const kept = a.get('r1')?.log ?? []
    expect(kept).toHaveLength(4) // 1 marker + last 3
    expect(kept[0]?.level).toBe('warn')
    expect(kept[0]?.message).toContain('7 earlier log entries dropped')
    expect(kept.slice(1).map((e) => e.message)).toEqual(['m7', 'm8', 'm9'])
  })

  it('purges finished runs past the TTL', () => {
    const a = new RunArchive({ ...limits, ttlMs: 1000 })
    a.start({ runId: 'old', scenarioId: 's', launcherScenarioId: 's', startedAtMs: 0 })
    a.complete('old', 'completed', 100, [])
    // A later start whose "now" is well past the TTL triggers the purge.
    a.start({ runId: 'new', scenarioId: 's', launcherScenarioId: 's', startedAtMs: 5000 })
    expect(a.get('old')).toBeUndefined()
    expect(a.get('new')).toBeDefined()
  })

  it('evicts oldest finished runs past the LRU cap but keeps in-flight runs', () => {
    const a = new RunArchive({ ...limits, maxRuns: 2 })
    a.start({ runId: 'f1', scenarioId: 's', launcherScenarioId: 's', startedAtMs: 1000 })
    a.complete('f1', 'completed', 1100, [])
    a.start({ runId: 'live', scenarioId: 's', launcherScenarioId: 's', startedAtMs: 1200 }) // still running
    a.start({ runId: 'f2', scenarioId: 's', launcherScenarioId: 's', startedAtMs: 1300 })
    a.complete('f2', 'completed', 1400, []) // size now 3 > cap 2 → evict oldest finished (f1)
    expect(a.get('f1')).toBeUndefined()
    expect(a.get('live')).toBeDefined() // in-flight never evicted
    expect(a.get('f2')).toBeDefined()
  })
})
