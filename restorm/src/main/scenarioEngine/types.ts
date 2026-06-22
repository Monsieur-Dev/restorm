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
  /** Completion id of the activation that emitted this token, when the
   * token is part of that activation's DATA subtree (drives the universal
   * `done` port). Left undefined for CONTINUATION tokens — a `done` signal,
   * a loop's `each` / `then` / `done` — which start a fresh sub-tree rather
   * than extending the emitter's. */
  emitter?: number
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
  /** Completion id assigned by the scheduler when the activation is created
   * — the key into the completion tree that drives the universal `done`
   * port (post-order subtree completion). */
  completionId?: number
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
    // A `while` / `doWhile`: the scheduler runs the body (`then`) in a child
    // scope, waits for it to close, re-evaluates the condition, and repeats
    // while true — emitting `else` when false. `while` tests first; `doWhile`
    // runs the body once before the first test.
    | { type: 'conditionalLoop'; mode: 'while' | 'doWhile' }
    // A `retry`: the scheduler runs the body (`attempt`) in a child scope and
    // acts as that scope's ERROR BOUNDARY. When the attempt fails — an unhandled
    // error bubbles to the scope, or (for an httpRequest child) the response
    // status matches `retryOnStatus` / is a non-2xx when `retryOnFailure` —
    // it waits per the backoff policy and re-runs, up to `maxAttempts`. Success
    // fires `done`; giving up fires `exhausted`.
    | {
        type: 'openRetry'
        maxAttempts: number
        backoff: 'fixed' | 'linear' | 'exponential'
        delayMs: number
        factor: number
        maxDelayMs: number
        retryOnError: boolean
        retryOnFailure: boolean
        retryOnStatus: number[]
      }
    // A `timer`: the scheduler fires the `tick` body in a child scope on each
    // interval (a fixed `intervalMs` OR a `cron` expression), waiting for the
    // body to close before scheduling the next tick, bounded by an optional
    // total `durationMs` / `endDateMs` (else it runs until the run is stopped).
    | {
        type: 'openTimer'
        intervalMs: number
        cron?: string
        durationMs?: number
        endDateMs?: number
      }
    // A `socketioConnect` / `websocketConnect`: the scheduler opens a long-lived
    // connection (registered under the node id so the matching send / close nodes
    // can reach it), fires `connected` when the socket opens, re-emits each
    // received frame in a child scope, and fires `done` when the connection
    // closes (a close node, the run being stopped, or the server dropping it).
    // `transport` picks the wire + the routing: `socketio` routes each frame to
    // its `event:<name>` / `others` port (by event name); `websocket` (raw) and
    // `grpc` (streaming RPC) have no events, so every frame goes to the single
    // `message` port (`events` is empty).
    | {
        type: 'openSocketioConnect'
        transport: 'socketio' | 'websocket' | 'grpc' | 'mqtt' | 'graphql-subscribe' | 'http-server' | 'grpc-server' | 'soap-server' | 'graphql-server' | 'odata-server'
        requestId: string
        events: string[]
        connectionName: string
      }
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
  // A debug run paused right BEFORE entering a breakpointed node — the node has
  // NOT executed yet. Resume continues to the next breakpoint; step runs just
  // this node then re-pauses.
  | { type: 'breakpoint-hit'; runId: RuntimeId; nodeId: RuntimeId; scope: ScopeStack; at: string }
  // Stepping paused right BEFORE entering a node (the pre-stop). Distinct from
  // breakpoint-hit (no breakpoint involved, no "reached" tooltip) — drives the
  // pan-zoom + yellow frame onto the about-to-run box.
  | { type: 'step-paused'; runId: RuntimeId; nodeId: RuntimeId; scope: ScopeStack; at: string }
  | { type: 'node-started'; runId: RuntimeId; nodeId: RuntimeId; scope: ScopeStack; at: string }
  | { type: 'node-completed'; runId: RuntimeId; nodeId: RuntimeId; scope: ScopeStack; at: string; outputs: Emission[] }
  | { type: 'node-failed'; runId: RuntimeId; nodeId: RuntimeId; scope: ScopeStack; at: string; error: string }
  | { type: 'data-flow-emitted'; runId: RuntimeId; edgeId: RuntimeId; tokenId: number; at: string }
  | { type: 'user-input-requested'; runId: RuntimeId; nodeId: RuntimeId; requestId: RuntimeId; name: string; defaultValue: unknown; hint: 'string' | 'number' | 'boolean' | 'object'; valueType?: unknown; at: string }
) & {
  /** The TOP-LEVEL ("launcher") scenario whose run produced this event.
   * Sub-scenario events inherit the launcher's id (NOT the sub's), so the
   * renderer animates only the tab that started the run — never a
   * sub-scenario's own tab, where several concurrent instances would
   * otherwise paint conflicting beams. Stamped by the engine container at
   * fanout time. */
  launcherScenarioId?: RuntimeId
}

/** One entry in the run log (engine-internal). Persisted via the run-log archive. */
export interface RunLogEntry {
  ts: string
  /** Process-wide monotonic emission ordinal — the causal tiebreak when two
   * entries (often a sub-run and its parent) share a millisecond `ts`. Stamped
   * by the scheduler at push time; merges sort by this, falling back to `ts`
   * for entries archived before the field existed. */
  seq?: number
  runId: RuntimeId
  level: 'debug' | 'info' | 'warn' | 'error'
  // `run` = a scenario-boundary marker (started / ended), shown in the
  // inspector by default alongside `user` log entries (vs `engine` debug).
  source: 'engine' | 'user' | 'run'
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
/** A single input prompt a run is awaiting — surfaced so a non-UI consumer
 * (the MCP status tool) can see the question and answer it by requestId. */
export interface PendingUserInputInfo {
  requestId: string
  nodeId: string
  /** Param name being asked for. */
  name: string
  /** The prefilled value (a literal default or an upstream-wired value). */
  defaultValue: unknown
  hint: 'string' | 'number' | 'boolean' | 'object'
  /** The param's persisted typed-value shape, when known. */
  valueType?: unknown
}

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
  requestUserInput: (req: { name: string; defaultValue: unknown; hint: 'string' | 'number' | 'boolean' | 'object'; valueType?: unknown }) => Promise<unknown>
  /** Whether this run prompts the user (a UI run). A mid-flow `input` only
   * raises its prompt when true; a non-interactive run (MCP / headless e2e)
   * falls back to the param's configured default so it never blocks. The flag
   * propagates into sub-scenarios. */
  interactive: boolean
  /** The node being executed — handy when the executor needs to read
   * its `config` (request id, comparator op, switch cases, …) without
   * the engine having to pre-extract everything. */
  node: ScenarioNode
  /** Directory of the open `.restorm` file (SettingsService workspace path),
   * for resolving a `readFile`/`writeFile` relative path. Undefined in a
   * headless run with no open workspace → such paths resolve against cwd. */
  workspaceDir?: string
  /** Run-tree-wide input overrides from the headless CLI (`--param name=value`).
   * An `input` node whose param name appears here uses this value instead of
   * prompting / its configured default — at any depth in the run tree. */
  cliParams?: Record<string, unknown>
  /** Bridge to the run's live Socket.IO connections — keyed by the
   * `socketioConnect` node id that opened them. `socketioSend` / `socketioClose`
   * executors use it to drive an already-declared connection. Provided by the
   * scheduler; absent in a run with no socketio nodes. */
  socketio?: {
    /** Emit `payload` on `channel` of the named connection. False if the
     * connection isn't open (yet). */
    send: (connectionNodeId: string, channel: string, payload: string) => boolean
    /** Close the named connection (fires its connect node's `done`). */
    close: (connectionNodeId: string) => boolean
    /** Whether the named connection exists in this run (open or connecting). */
    has: (connectionNodeId: string) => boolean
    /** Whether the named connection is open right now. */
    isOpen: (connectionNodeId: string) => boolean
  }
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
