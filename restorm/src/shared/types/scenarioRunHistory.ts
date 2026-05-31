/**
 * Persisted history of scenario runs. Stored in the SAME on-disk archive
 * as the response history (`<project>.responses.zip`) — the index gains a
 * `scenarios` slice and the run details live under `scenarioRuns/`.
 */

export type ScenarioRunHistoryStatus = 'completed' | 'cancelled' | 'failed'

/** One run-log line, flattened from the engine's run tree (parent run +
 * every sub-run) so a whole run is recoverable from one detail blob. */
export interface ScenarioRunLogEntry {
  ts: string
  runId: string
  level: 'debug' | 'info' | 'warn' | 'error'
  /** `run` = scenario-boundary marker, `user` = Log action, `engine` =
   * executor/scheduler debug. */
  source: 'engine' | 'user' | 'run'
  nodeId?: string
  /** The (sub)scenario this entry was produced by, so the viewer can
   * group a run tree by scenario. */
  scenarioId?: string
  message: string
  data?: unknown
}

/** Deep copy of one scenario as it existed at run time. Loosely typed
 * (the persisted Scenario shape) — kept opaque here to avoid coupling
 * the history archive to the engine's evolving node/edge model. The
 * read-only "scenario at run time" view is a later feature. */
export interface ScenarioRunSnapshot {
  id: string
  name: string
  nodes: unknown[]
  edges: unknown[]
  config?: unknown
}

/** Index entry (lightweight, drives the run list). */
export interface ScenarioRunHistoryEntry {
  guid: string
  /** Run start, ISO-8601. */
  timestamp: string
  pinned: boolean
  status: ScenarioRunHistoryStatus
  scenarioName: string
}

/** Full persisted detail for one run (logs + scenario snapshots). */
export interface ScenarioRunHistoryDetail {
  guid: string
  scenarioId: string
  scenarioName: string
  timestamp: string
  endedAt?: string
  pinned: boolean
  status: ScenarioRunHistoryStatus
  /** The main scenario + every scenario it references (transitively),
   * deep-copied as they were at run time. Not surfaced yet. */
  scenarios: ScenarioRunSnapshot[]
  /** Complete run-tree log (user + engine), across parent + sub-runs. */
  log: ScenarioRunLogEntry[]
}
