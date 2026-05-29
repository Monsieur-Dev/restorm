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
}

export class ScenarioEngine {
  private readonly activeRuns = new Map<RuntimeId, Scheduler>()
  /** Listeners interested in every event across every run — used by
   * the IPC bridge to forward to the renderer. */
  private readonly fanoutListeners: ((e: EngineEvent) => void)[] = []

  /** Top-level run entry point. */
  start(scenarioId: RuntimeId, options: RunOptions = {}): RunHandle {
    return this.startWithStack(scenarioId, options, { stack: new Set() })
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

  /** Read the in-memory log for a run. Returns `[]` for unknown ids. */
  readLog(runId: RuntimeId): readonly RunLogEntry[] {
    const scheduler = this.activeRuns.get(runId)
    return scheduler ? scheduler.readLog() : []
  }

  pause(runId: RuntimeId): void { this.activeRuns.get(runId)?.pause() }
  resume(runId: RuntimeId): void { this.activeRuns.get(runId)?.resume() }
  step(runId: RuntimeId): void { this.activeRuns.get(runId)?.step() }
  abort(runId: RuntimeId, reason?: string): void { this.activeRuns.get(runId)?.abort(reason) }

  private startWithStack(scenarioId: RuntimeId, options: RunOptions, callCtx: RunCallContext): RunHandle {
    const scenario = this.loadScenario(scenarioId)
    if (callCtx.stack.has(scenarioId)) {
      throw new Error(`recursion detected: scenario ${scenarioId} is already running on the call stack`)
    }
    const executors = buildExecutorRegistry(scenario)
    const scheduler = new Scheduler({
      scenario,
      executors,
      runSubScenario: async (subId, params) => {
        const subStack = new Set(callCtx.stack)
        subStack.add(scenarioId)
        const handle = this.startWithStack(subId, { params }, { stack: subStack })
        return handle.done
      }
    })
    this.activeRuns.set(scheduler.runId, scheduler)
    // Forward this scheduler's events to the global fanout.
    scheduler.on((e) => {
      for (const l of this.fanoutListeners) {
        try { l(e) } catch { /* swallow */ }
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
