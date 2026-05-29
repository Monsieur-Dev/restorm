/**
 * Core types for the scenario dataflow engine.
 *
 * The engine activates nodes by routing **tokens** along edges. Each
 * token carries a value, the (node, port) it came from, and a **scope
 * stack** identifying which loop / branch iteration produced it. A
 * node fires when its required inputs are all present at the deepest
 * common ancestor scope (JOIN-by-lineage, not Cartesian).
 *
 * Pause / Stop / Step are first-class: the scheduler is a tickable
 * dispatcher driven by a queue, not a "run until done" function.
 */

import type {
  ScenarioNode,
  ScenarioNodeKind,
  ScenarioEdge,
  Scenario
} from '../../shared/types/scenario'

export type RuntimeId = string

/**
 * One frame on the scope stack. Top-level activations carry an empty
 * stack `[]`; entering a `forEach` pushes `{ scopeNodeId, index }`
 * onto the stack. JOIN matching reads the stack to find the deepest
 * common ancestor of all participating tokens.
 */
export interface ScopeFrame {
  /** The node that opened this scope (a `forEach` so far). */
  scopeNodeId: RuntimeId
  /** Iteration index inside that scope (0-based). */
  index: number
}

export type ScopeStack = readonly ScopeFrame[]

/** A value travelling from `(fromNodeId, fromPort)` to `(toNodeId,
 * toPort)`. The scope stack at emission time is carried verbatim — a
 * downstream `forEach` extends it; everything else preserves it. */
export interface Token {
  value: unknown
  fromNodeId: RuntimeId
  fromPort: RuntimeId
  toNodeId: RuntimeId
  toPort: RuntimeId
  scope: ScopeStack
  /** Monotonically-increasing token id (for trace + dedupe). Assigned
   * by the engine when the token leaves an executor. */
  tokenId: number
}

/**
 * A node ready to fire — its required inputs are all collected at a
 * single scope. The executor reads `inputs` (port → value) and
 * returns one or more emissions on output ports.
 */
export interface Activation {
  nodeId: RuntimeId
  kind: ScenarioNodeKind
  scope: ScopeStack
  /** Values keyed by input port id, deep-cloned so executors can't
   * mutate sibling scopes' state. */
  inputs: Record<RuntimeId, unknown>
  /** Set by the scheduler when this activation came from the root-
   * seed pass (not from a token match). The `input` executor uses
   * this to skip the mid-run prompt — the up-front form already
   * collected the value. */
  seeded?: boolean
}

/** One output emission from an executor: the port + the value to put
 * on it. The scheduler turns each `Emission` into N tokens (one per
 * outgoing edge from that port). */
export interface Emission {
  port: RuntimeId
  value: unknown
}

/** Result of executing one Activation. `outputs` lists the ports the
 * executor produced; `scopeAction` lets specific kinds (notably
 * `forEach`) interact with the scope tree atomically. */
export interface ExecResult {
  outputs: Emission[]
  /** When set, the scheduler manipulates the scope tree as part of
   * the activation: a `forEach` opens N child scopes (one per item)
   * and emits the `each` port inside each; `aggregate` collects on
   * a scope-closed signal. */
  scopeAction?:
    | { type: 'openForEach'; items: unknown[]; parallel: boolean; batchSize: number }
    | { type: 'closeScope' }
}

/**
 * Events surfaced to the renderer (and to anyone subscribing to the
 * engine) — drives node animations + edge beams + the run log.
 */
export type EngineEvent = (
  | { type: 'run-started'; runId: RuntimeId; scenarioId: RuntimeId; at: string }
  | { type: 'run-completed'; runId: RuntimeId; at: string }
  | { type: 'run-cancelled'; runId: RuntimeId; at: string; reason?: string }
  | { type: 'run-failed'; runId: RuntimeId; at: string; error: string }
  | { type: 'run-paused'; runId: RuntimeId; at: string }
  | { type: 'run-resumed'; runId: RuntimeId; at: string }
  | { type: 'node-started'; runId: RuntimeId; nodeId: RuntimeId; scope: ScopeStack; at: string }
  | { type: 'node-completed'; runId: RuntimeId; nodeId: RuntimeId; scope: ScopeStack; at: string; outputs: Emission[] }
  | { type: 'node-failed'; runId: RuntimeId; nodeId: RuntimeId; scope: ScopeStack; at: string; error: string }
  | { type: 'data-flow-emitted'; runId: RuntimeId; edgeId: RuntimeId; tokenId: number; at: string }
  | { type: 'user-input-requested'; runId: RuntimeId; nodeId: RuntimeId; requestId: RuntimeId; name: string; defaultValue: unknown; hint: 'string' | 'number' | 'boolean' | 'object'; at: string }
) & {
  /** The TOP-LEVEL ("launcher") scenario whose run produced this event.
   * Sub-scenario events inherit the launcher's id (NOT the sub's), so the
   * renderer animates only the tab that started the run — never a
   * sub-scenario's own tab, where several concurrent instances would
   * otherwise paint conflicting beams. Stamped by the engine container at
   * fanout time. */
  launcherScenarioId?: RuntimeId
}

/** One entry in the run log (engine-internal). Persistence is OYO-286. */
export interface RunLogEntry {
  ts: string
  runId: RuntimeId
  level: 'debug' | 'info' | 'warn' | 'error'
  source: 'engine' | 'user'
  nodeId?: RuntimeId
  scope?: ScopeStack
  message: string
  data?: unknown
}

/**
 * A node's execution function. Returns a value-producing Emission[]
 * synchronously or via Promise. Cancellable via the AbortSignal.
 */
export type NodeExecutor = (
  activation: Activation,
  ctx: ExecContext
) => Promise<ExecResult> | ExecResult

/** Per-activation context — what an executor needs beyond its inputs:
 * the abort signal for cooperative cancellation, a logger so it can
 * push user-facing entries, and a thin handle to the engine for
 * sub-scenario calls + variable scope. */
export interface ExecContext {
  signal: AbortSignal
  log: (entry: Omit<RunLogEntry, 'ts' | 'runId' | 'source'> & { source?: 'engine' | 'user' }) => void
  /** Read / write the run's variable store. Keyed by name; `setVariable`
   * writes here, `getVariable` reads. Scope-less (a scenario's variables
   * live for the whole run regardless of which forEach iteration the
   * write happened in). */
  variables: Map<string, unknown>
  /** Run a sub-scenario by id, with the given param map. Recursion is
   * detected by the engine. */
  runSubScenario: (scenarioId: RuntimeId, params: Record<string, unknown>, parentSignal?: AbortSignal) => Promise<Record<string, unknown>>
  /** Pause the activation and surface a single-field prompt to the
   * renderer. The promise resolves with the user-confirmed value
   * (which may be the default or an edited one). Used by the `input`
   * executor when an upstream node has already supplied a value the
   * user can still override. */
  requestUserInput: (req: { name: string; defaultValue: unknown; hint: 'string' | 'number' | 'boolean' | 'object' }) => Promise<unknown>
  /** The node being executed — handy when the executor needs to read
   * its `config` (request id, comparator op, switch cases, …) without
   * the engine having to pre-extract everything. */
  node: ScenarioNode
}

/**
 * Snapshot the scheduler exposes to the renderer (and to test
 * fixtures) so an observer can see exactly which nodes are pending,
 * which are running, and where the user is in step-through.
 */
export interface RunStatus {
  runId: RuntimeId
  state: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
  /** Activations queued, not yet running. */
  pendingCount: number
  /** Activations currently `await`-ing inside an executor. */
  inFlightCount: number
}

/** A scenario as the engine sees it — the persisted shape, but the
 * type alias keeps the engine code from importing the full collections
 * union just to reach `Scenario`. */
export type ScenarioModel = Scenario
export type EdgeModel = ScenarioEdge
