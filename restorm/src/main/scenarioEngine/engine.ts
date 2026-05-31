/**
 * Top-level entry point: load a scenario, build the executor
 * registry, build the scheduler, and expose a `run()` that the IPC
 * bridge + MCP tool both call.
 *
 * Also owns the sub-scenario recursion guard: a scenario calling
 * itself (directly or transitively) raises an error before the
 * inner `runScenario` node fires.
 */

import { logger } from 'electron-core-ui/main'
import { collectionStore } from '../services/CollectionStore'
import { isScenario } from '../../shared/types/collections'
import type { Scenario } from '../../shared/types/scenario'
import { Scheduler, type RunOptions } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import { RunArchive, type ArchivedRun } from './runArchive'
import { collectReferencedScenarios } from './collectReferencedScenarios'
import { scenarioRunHistoryService } from '../services/ScenarioRunHistoryService'
import type { ScenarioRunHistoryStatus, ScenarioRunLogEntry, ScenarioRunSnapshot } from '../../shared/types/scenarioRunHistory'
import type { EngineEvent, RunLogEntry, RunStatus, RuntimeId } from './types'

export interface RunHandle {
  scheduler: Scheduler
  /** Resolves with the engine's collected output values from the
   * scenario's `output` nodes. */
  done: Promise<Record<string, unknown>>
}

export interface RunCallContext {
  /** Scenario ids already on the call stack (used to detect
   * recursion). Top-level calls pass an empty set. */
  stack: ReadonlySet<RuntimeId>
  /** The top-level scenario that started this run. Inherited unchanged
   * by every sub-scenario so all events trace back to the launcher. */
  launcherScenarioId: RuntimeId
  /** The run that launched this one (a `runScenario` node). Absent for
   * a top-level run. Links sub-runs to their parent in the archive. */
  parentRunId?: RuntimeId
  /** Deep-copied snapshots of every statically-referenced scenario, taken at
   * the top-level run's launch and shared by the whole run tree (keyed by
   * scenario id). Every (sub-)run executes against — and the archive keeps —
   * these copies, so editing a scenario mid-run never affects the run. */
  snapshots?: Map<RuntimeId, ScenarioRunSnapshot>
}

export class ScenarioEngine {
  private readonly activeRuns = new Map<RuntimeId, Scheduler>()
  /** Listeners interested in every event across every run — used by
   * the IPC bridge to forward to the renderer. */
  private readonly fanoutListeners: ((e: EngineEvent) => void)[] = []
  /** Retains run logs (incl. sub-runs) during AND after execution so
   * any client can harvest them by `runId`. Bounded — see defaults. */
  private readonly archive = new RunArchive({ maxRuns: 50, maxEntriesPerRun: 2000, ttlMs: 30 * 60 * 1000 })
  /** Deep-copied scenario snapshots captured at each TOP-LEVEL run's start,
   * keyed by its run id. Persisted into the history at run end so the archive
   * keeps the versions that actually ran — never a sub-scenario edited
   * mid-run. Cleared once the run is persisted. */
  private readonly runSnapshots = new Map<RuntimeId, ScenarioRunSnapshot[]>()

  /** Top-level run entry point. */
  start(scenarioId: RuntimeId, options: RunOptions = {}): RunHandle {
    // Snapshot every referenced scenario NOW (deep copies) so the whole run
    // tree — and the persisted history — uses exactly these versions, immune
    // to edits made while the run is in flight.
    const snapshots = new Map<RuntimeId, ScenarioRunSnapshot>(
      collectReferencedScenarios(scenarioId).map((s) => [s.id, s])
    )
    return this.startWithStack(scenarioId, options, { stack: new Set(), launcherScenarioId: scenarioId, snapshots })
  }

  /** Fanout subscription — every event from every active scheduler
   * lands here. The IPC bridge uses this to forward to the renderer
   * without needing to know which run is currently being driven. */
  onAnyEvent(listener: (e: EngineEvent) => void): () => void {
    this.fanoutListeners.push(listener)
    return () => {
      const i = this.fanoutListeners.indexOf(listener)
      if (i >= 0) this.fanoutListeners.splice(i, 1)
    }
  }

  /** Snapshot of every active run's status. */
  activeStatuses(): RunStatus[] {
    return [...this.activeRuns.values()].map((s) => s.status())
  }

  /** Read the in-memory log for a run. Serves the LIVE scheduler log
   * while the run is active, then the archived snapshot once it ends.
   * Returns `[]` for unknown ids. */
  readLog(runId: RuntimeId): readonly RunLogEntry[] {
    const scheduler = this.activeRuns.get(runId)
    if (scheduler) return scheduler.readLog()
    return this.archive.get(runId)?.log ?? []
  }

  /** A run + every sub-run it launched (transitively), each with its
   * metadata + current log (live or archived). The entry point for a
   * client to harvest a whole run tree from a single top-level runId. */
  runTree(runId: RuntimeId): (ArchivedRun & { log: readonly RunLogEntry[] })[] {
    return this.archive.tree(runId).map((r) => ({ ...r, log: this.readLog(r.runId) }))
  }

  /** Metadata for every retained run (most recent first) — lets a
   * client discover the runId of a run it didn't start (e.g. one
   * launched from the UI Play button). Live status reflects the
   * scheduler when still active. */
  listRuns(): (ArchivedRun & { live: boolean })[] {
    return this.archive.list().map((r) => {
      const scheduler = this.activeRuns.get(r.runId)
      return { ...r, ...(scheduler ? { status: scheduler.status().state } : {}), live: scheduler !== undefined }
    })
  }

  pause(runId: RuntimeId): void { this.activeRuns.get(runId)?.pause() }
  resume(runId: RuntimeId): void { this.activeRuns.get(runId)?.resume() }
  step(runId: RuntimeId): void { this.activeRuns.get(runId)?.step() }
  setDebug(runId: RuntimeId, enabled: boolean): void { this.activeRuns.get(runId)?.setDebug(enabled) }
  setBreakpoints(runId: RuntimeId, ids: readonly RuntimeId[]): void { this.activeRuns.get(runId)?.setBreakpoints(ids) }
  abort(runId: RuntimeId, reason?: string): void { this.activeRuns.get(runId)?.abort(reason) }
  resolveUserInput(runId: RuntimeId, requestId: string, value: unknown): void { this.activeRuns.get(runId)?.resolveUserInput(requestId, value) }

  cancelUserInput(runId: RuntimeId, requestId: string): void { this.activeRuns.get(runId)?.cancelUserInput(requestId) }

  private startWithStack(scenarioId: RuntimeId, options: RunOptions, callCtx: RunCallContext, parentSignal?: AbortSignal): RunHandle {
    const scenario = this.loadScenario(scenarioId, callCtx.snapshots)
    if (callCtx.stack.has(scenarioId)) {
      throw new Error(`recursion detected: scenario ${scenarioId} is already running on the call stack`)
    }
    const executors = buildExecutorRegistry(scenario)
    const scheduler = new Scheduler({
      scenario,
      executors,
      ...(parentSignal ? { parentSignal } : {}),
      runSubScenario: async (subId, params, subParentSignal) => {
        const subStack = new Set(callCtx.stack)
        subStack.add(scenarioId)
        // Forward the calling node's abort signal so a Stop cascades all
        // the way down the sub-scenario tree, and link the sub-run to
        // this run in the archive via `parentRunId`.
        const handle = this.startWithStack(subId, { params }, { stack: subStack, launcherScenarioId: callCtx.launcherScenarioId, parentRunId: scheduler.runId, ...(callCtx.snapshots ? { snapshots: callCtx.snapshots } : {}) }, subParentSignal)
        return handle.done
      }
    })
    this.activeRuns.set(scheduler.runId, scheduler)
    // For a top-level run, retain the launch snapshots so the archived history
    // (written at run end) reflects exactly what ran — not a sub-scenario the
    // user may edit while the run is still going.
    if (callCtx.parentRunId === undefined && callCtx.snapshots) {
      this.runSnapshots.set(scheduler.runId, [...callCtx.snapshots.values()])
    }
    this.archive.start({
      runId: scheduler.runId,
      scenarioId,
      launcherScenarioId: callCtx.launcherScenarioId,
      ...(callCtx.parentRunId !== undefined ? { parentRunId: callCtx.parentRunId } : {}),
      startedAtMs: Date.now()
    })
    // Forward this scheduler's events to the global fanout, stamping the
    // launcher (top-level) scenario id so the renderer only animates the
    // tab that started the run — sub-scenario events carry the launcher's
    // id, never the sub's.
    const { launcherScenarioId } = callCtx
    scheduler.on((e) => {
      const stamped: EngineEvent = { ...e, launcherScenarioId }
      for (const l of this.fanoutListeners) {
        try { l(stamped) } catch { /* swallow */ }
      }
    })
    const outputBucket: Record<string, unknown> = {}
    scheduler.on((e) => {
      if (e.type !== 'node-completed') return
      const node = scenario.nodes.find((n) => n.id === e.nodeId)
      if (node?.kind !== 'output') return
      const cfg = node.config as { name?: string }
      const name = cfg.name ?? node.id
      const out = e.outputs.find((o) => o.port === 'value')
      if (out) outputBucket[name] = out.value
    })
    const done = scheduler.run(options).then(() => outputBucket).finally(() => {
      // Snapshot the final log into the archive BEFORE dropping the live
      // scheduler, so the run's logs survive for later harvesting.
      this.archive.complete(scheduler.runId, scheduler.status().state, Date.now(), scheduler.readLog())
      this.activeRuns.delete(scheduler.runId)
      // Persist the whole run tree to disk history — only for a top-level
      // run (sub-runs are folded into the parent's persisted log). Sub-runs
      // have already archived their logs by now (the parent awaited them).
      if (callCtx.parentRunId === undefined) {
        this.persistRunHistory(scheduler.runId, scenarioId)
        this.runSnapshots.delete(scheduler.runId)
      }
    })
    return { scheduler, done }
  }

  /** Snapshot a finished top-level run (its whole sub-run tree's logs +
   * deep copies of every referenced scenario) into the on-disk history.
   * Fire-and-forget: the run result never waits on the archive write. */
  private persistRunHistory(topRunId: RuntimeId, scenarioId: RuntimeId): void {
    try {
      const tree = this.runTree(topRunId)
      const top = tree.find((r) => r.runId === topRunId)
      if (!top) return

      const log: ScenarioRunLogEntry[] = []
      for (const run of tree) {
        for (const e of run.log) {
          log.push({
            ts: e.ts,
            runId: e.runId,
            level: e.level,
            source: e.source,
            ...(e.nodeId !== undefined ? { nodeId: e.nodeId } : {}),
            scenarioId: run.scenarioId,
            message: e.message,
            ...(e.data !== undefined ? { data: e.data } : {})
          })
        }
      }
      log.sort((a, b) => a.ts.localeCompare(b.ts))

      // Use the snapshot captured at run START (not a live re-fetch), so a
      // sub-scenario edited mid-run is archived as it actually ran. Fall back
      // to a live collect only if the snapshot is somehow missing.
      const scenarios = this.runSnapshots.get(topRunId) ?? collectReferencedScenarios(scenarioId)
      const foundName = scenarios.find((s) => s.id === scenarioId)?.name
      const scenarioName = foundName !== undefined && foundName.trim() !== '' ? foundName : 'scénario'
      const status: ScenarioRunHistoryStatus =
        top.status === 'cancelled' || top.status === 'failed' ? top.status : 'completed'

      void scenarioRunHistoryService.storeRun({
        scenarioId,
        scenarioName,
        startedAt: top.startedAt,
        endedAt: top.endedAt ?? top.startedAt,
        status,
        scenarios,
        log
      })
    } catch (error) {
      logger.error('[ScenarioEngine] Failed to persist run history', { topRunId, error: String(error) })
    }
  }

  private loadScenario(id: RuntimeId, snapshots?: Map<RuntimeId, ScenarioRunSnapshot>): Scenario {
    // Prefer the launch-time snapshot (a deep copy taken when the run started)
    // so the run is ISOLATED from edits made while it's in flight. Statically-
    // referenced scenarios are all pre-snapshotted; a dynamically-chosen sub
    // (a `param:`-resolved `runScenario`) isn't, so fall back to a fresh copy.
    const snap = snapshots?.get(id)
    if (snap) return snap as unknown as Scenario
    const item = collectionStore.findById(id)
    if (!item || !isScenario(item)) {
      throw new Error(`no scenario with id ${id}`)
    }
    return JSON.parse(JSON.stringify(item)) as Scenario
  }
}

/** Singleton — the main-process side wires its IPC handlers + MCP
 * tools to this instance. */
export const scenarioEngine = new ScenarioEngine()
