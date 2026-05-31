/**
 * Bounded in-memory archive of scenario run logs, keyed by `runId` and
 * retained AFTER the run ends — so a client (the agent, the renderer,
 * any MCP consumer) can harvest a run's logs both DURING and AFTER
 * execution, including the logs of every sub-scenario it launched.
 *
 * The live `Scheduler` owns the authoritative log while a run is in
 * flight; this archive holds the metadata + the final log snapshot, and
 * links sub-runs to their parent (`parentRunId`) so a whole run tree is
 * recoverable from a single top-level `runId`.
 *
 * Memory is bounded three ways (the engine wires the defaults):
 *  - **TTL**: a finished run is dropped once it's older than `ttlMs`.
 *  - **LRU**: at most `maxRuns` runs are kept (oldest finished evicted first).
 *  - **per-run cap**: a run's snapshot keeps at most `maxEntriesPerRun`
 *    entries (the most recent), with an explicit truncation marker so a
 *    dropped prefix is never silent.
 */

import type { RunLogEntry, RunStatus, RuntimeId } from './types'

export type RunState = RunStatus['state']

export interface ArchivedRun {
  runId: RuntimeId
  scenarioId: RuntimeId
  /** Top-level scenario that started the run tree this run belongs to. */
  launcherScenarioId: RuntimeId
  /** The run that launched this one (a `runScenario` node), if any. */
  parentRunId?: RuntimeId
  startedAt: string
  startedAtMs: number
  endedAt?: string
  endedAtMs?: number
  status: RunState
  /** Final log snapshot, populated on completion. While the run is live
   * the engine serves the scheduler's authoritative log instead. */
  log: RunLogEntry[]
}

export interface RunArchiveLimits {
  maxRuns: number
  maxEntriesPerRun: number
  ttlMs: number
}

export class RunArchive {
  private readonly runs = new Map<RuntimeId, ArchivedRun>()

  constructor(private readonly limits: RunArchiveLimits) {}

  /** Register a run as it starts (status `running`, empty log). */
  start(meta: {
    runId: RuntimeId
    scenarioId: RuntimeId
    launcherScenarioId: RuntimeId
    parentRunId?: RuntimeId
    startedAtMs: number
  }): void {
    this.runs.set(meta.runId, {
      runId: meta.runId,
      scenarioId: meta.scenarioId,
      launcherScenarioId: meta.launcherScenarioId,
      ...(meta.parentRunId !== undefined ? { parentRunId: meta.parentRunId } : {}),
      startedAt: new Date(meta.startedAtMs).toISOString(),
      startedAtMs: meta.startedAtMs,
      status: 'running',
      log: []
    })
    this.purge(meta.startedAtMs)
  }

  /** Snapshot the final log + status when a run ends. */
  complete(runId: RuntimeId, status: RunState, endedAtMs: number, log: readonly RunLogEntry[]): void {
    const entry = this.runs.get(runId)
    if (!entry) return
    entry.status = status
    entry.endedAtMs = endedAtMs
    entry.endedAt = new Date(endedAtMs).toISOString()
    entry.log = this.cap(log)
    this.purge(endedAtMs)
  }

  get(runId: RuntimeId): ArchivedRun | undefined {
    return this.runs.get(runId)
  }

  /** All retained runs, most-recently-started first. */
  list(): ArchivedRun[] {
    return [...this.runs.values()].sort((a, b) => b.startedAtMs - a.startedAtMs)
  }

  /** The run + every descendant (sub-runs, transitively), parents first. */
  tree(rootRunId: RuntimeId): ArchivedRun[] {
    const root = this.runs.get(rootRunId)
    if (!root) return []
    const out: ArchivedRun[] = [root]
    const childrenOf = (parent: RuntimeId): ArchivedRun[] =>
      [...this.runs.values()].filter((r) => r.parentRunId === parent).sort((a, b) => a.startedAtMs - b.startedAtMs)
    const walk = (parent: RuntimeId): void => {
      for (const child of childrenOf(parent)) {
        out.push(child)
        walk(child.runId)
      }
    }
    walk(rootRunId)
    return out
  }

  private cap(log: readonly RunLogEntry[]): RunLogEntry[] {
    const max = this.limits.maxEntriesPerRun
    if (log.length <= max) return [...log]
    const dropped = log.length - max
    const kept = log.slice(log.length - max)
    const marker: RunLogEntry = {
      ts: kept[0]?.ts ?? new Date().toISOString(),
      runId: kept[0]?.runId ?? '',
      level: 'warn',
      source: 'engine',
      message: `… ${dropped} earlier log entries dropped (per-run cap ${max})`
    }
    return [marker, ...kept]
  }

  /** Drop runs past the TTL, then enforce the LRU cap (oldest FINISHED
   * runs go first; an in-flight run is never evicted). */
  private purge(nowMs: number): void {
    for (const [id, run] of this.runs) {
      if (run.endedAtMs !== undefined && nowMs - run.endedAtMs > this.limits.ttlMs) this.runs.delete(id)
    }
    if (this.runs.size <= this.limits.maxRuns) return
    const finished = [...this.runs.values()]
      .filter((r) => r.endedAtMs !== undefined)
      .sort((a, b) => (a.endedAtMs ?? 0) - (b.endedAtMs ?? 0))
    let overflow = this.runs.size - this.limits.maxRuns
    for (const run of finished) {
      if (overflow <= 0) break
      this.runs.delete(run.runId)
      overflow -= 1
    }
  }
}
