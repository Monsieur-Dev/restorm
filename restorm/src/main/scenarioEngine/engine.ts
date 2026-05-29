/**
 * Top-level entry point: load a scenario, build the executor
 * registry, build the scheduler, and expose a `run()` that the IPC
 * bridge + MCP tool both call.
 *
 * Also owns the sub-scenario recursion guard: a scenario calling
 * itself (directly or transitively) raises an error before the
 * inner `runScenario` node fires.
 */

import { collectionStore } from '../services/CollectionStore'
import { isScenario } from '../../shared/types/collections'
import type { Scenario } from '../../shared/types/scenario'
import { Scheduler, type RunOptions } from './scheduler'
import { buildExecutorRegistry } from './executors/registry'
import { RunArchive, type ArchivedRun } from './runArchive'
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
}

export class ScenarioEngine {
  private readonly activeRuns = new Map<RuntimeId, Scheduler>()
  /** Listeners interested in every event across every run — used by
   * the IPC bridge to forward to the renderer. */
  private readonly fanoutListeners: ((e: EngineEvent) => void)[] = []
  /** Retains run logs (incl. sub-runs) during AND after execution so
   * any client can harvest them by `runId`. Bounded — see defaults. */
  private readonly archive = new RunArchive({ maxRuns: 50, maxEntriesPerRun: 2000, ttlMs: 30 * 60 * 1000 })

  /** Top-level run entry point. */
  start(scenarioId: RuntimeId, options: RunOptions = {}): RunHandle {
    return this.startWithStack(scenarioId, options, { stack: new Set(), launcherScenarioId: scenarioId })
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
  abort(runId: RuntimeId, reason?: string): void { this.activeRuns.get(runId)?.abort(reason) }
  resolveUserInput(runId: RuntimeId, requestId: string, value: unknown): void { this.activeRuns.get(runId)?.resolveUserInput(requestId, value) }

  private startWithStack(scenarioId: RuntimeId, options: RunOptions, callCtx: RunCallContext, parentSignal?: AbortSignal): RunHandle {
    const scenario = this.loadScenario(scenarioId)
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
        const handle = this.startWithStack(subId, { params }, { stack: subStack, launcherScenarioId: callCtx.launcherScenarioId, parentRunId: scheduler.runId }, subParentSignal)
        return handle.done
      }
    })
    this.activeRuns.set(scheduler.runId, scheduler)
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
    })
    return { scheduler, done }
  }

  private loadScenario(id: RuntimeId): Scenario {
    const item = collectionStore.findById(id)
    if (!item || !isScenario(item)) {
      throw new Error(`no scenario with id ${id}`)
    }
    return item as unknown as Scenario
  }
}

/** Singleton — the main-process side wires its IPC handlers + MCP
 * tools to this instance. */
export const scenarioEngine = new ScenarioEngine()
