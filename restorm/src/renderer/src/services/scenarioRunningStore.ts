/**
 * Global, ephemeral registry of which scenarios currently have an in-flight
 * run — drives the "running" border-beam on a scenario's badge wherever it
 * appears (sidebar tree, workbench tab strip, favorites/open-items lists).
 *
 * Unlike `useScenarioEngine` (one instance per open editor), this is a single
 * app-wide subscription to the engine event stream. It tracks only the
 * scenarios the user EXPLICITLY launched — a top-level run (whose own
 * `scenarioId` equals its `launcherScenarioId`). Transitive sub-scenarios
 * spun up by `runScenario` are NOT lit, so launching one scenario beams just
 * its own badge, not the whole call chain. Runs are counted PER scenario id,
 * keyed by runId, so the same scenario launched concurrently N times is
 * ref-counted and only goes dark when the LAST of those runs ends.
 *
 * State is purely in-memory: it reflects live activity and is never persisted.
 */

import { useSyncExternalStore } from 'react'

interface EngineEvent {
  type: string
  runId?: string
  scenarioId?: string
  /** Top-level scenario that launched the run; sub-runs inherit the parent's.
   * A top-level run has `scenarioId === launcherScenarioId`. */
  launcherScenarioId?: string
}

interface Bridge {
  onScenarioEngineEvent?: (cb: (event: EngineEvent) => void) => () => void
}

function bridge(): Bridge | undefined {
  return (window as { restorm?: { runtime?: Bridge } }).restorm?.runtime
}

// scenarioId → number of in-flight runs for it.
const refCount = new Map<string, number>()
// runId → the scenario it runs (so an end event can find what to decrement).
const runToScenario = new Map<string, string>()
const listeners = new Set<() => void>()

const RUN_END_TYPES = new Set(['run-completed', 'run-cancelled', 'run-failed'])

let engineSubscribed = false

function notify(): void {
  for (const cb of listeners) cb()
}

function incr(scenarioId: string): void {
  const next = (refCount.get(scenarioId) ?? 0) + 1
  refCount.set(scenarioId, next)
  if (next === 1) notify()
}

function decr(scenarioId: string): void {
  const curr = refCount.get(scenarioId)
  if (curr === undefined) return
  if (curr <= 1) {
    refCount.delete(scenarioId)
    notify()
  } else {
    refCount.set(scenarioId, curr - 1)
  }
}

function handleEngineEvent(event: EngineEvent): void {
  if (event.type === 'run-started') {
    // Only light the TOP-LEVEL launched scenario, not its transitive
    // sub-scenarios — a top-level run is the one whose own scenario IS the
    // launcher. (Sub-runs inherit the parent's `launcherScenarioId`, so they
    // differ and are skipped: launching one scenario beams just its badge.)
    if (
      event.runId &&
      event.scenarioId &&
      event.scenarioId === event.launcherScenarioId &&
      !runToScenario.has(event.runId)
    ) {
      runToScenario.set(event.runId, event.scenarioId)
      incr(event.scenarioId)
    }
    return
  }
  if (event.runId && RUN_END_TYPES.has(event.type)) {
    const scenarioId = runToScenario.get(event.runId)
    if (scenarioId !== undefined) {
      runToScenario.delete(event.runId)
      decr(scenarioId)
    }
  }
}

/** Wire the single app-wide engine-event subscription. Idempotent + retried on
 * each `subscribe` until the preload bridge is available (components mount
 * after preload, so this lands on the first real subscriber). */
function ensureEngineSubscription(): void {
  if (engineSubscribed) return
  const unsub = bridge()?.onScenarioEngineEvent?.(handleEngineEvent)
  if (unsub) engineSubscribed = true
}

function subscribe(cb: () => void): () => void {
  ensureEngineSubscription()
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function isScenarioRunning(scenarioId: string): boolean {
  return refCount.has(scenarioId)
}

/** React hook: `true` while the scenario has at least one in-flight run. */
export function useIsScenarioRunning(scenarioId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => refCount.has(scenarioId),
    () => false
  )
}
