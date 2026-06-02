/**
 * The tick-driven dataflow scheduler.
 *
 * Responsibilities:
 *  - seed the queue with root activations (nodes with no required
 *    inputs) when a run starts;
 *  - route emitted tokens through the InputBuffer to discover new
 *    Activations + enqueue them;
 *  - dispatch one Activation per tick, observing pause / stop / step;
 *  - emit `EngineEvent`s the renderer subscribes to;
 *  - capture an internal run log + a separate user-facing log fed by
 *    the `log` action node;
 *  - cooperative cancellation through an AbortController.
 *
 * The scheduler is INTENTIONALLY UI-free + IPC-free: the IPC bridge
 * subscribes to its events. That makes the engine unit-testable
 * standalone.
 */

import { EventEmitter } from 'events'
import type {
  Activation,
  EngineEvent,
  Emission,
  ExecContext,
  ExecResult,
  NodeExecutor,
  PendingUserInputInfo,
  RunLogEntry,
  RunStatus,
  RuntimeId,
  ScopeFrame,
  ScopeStack,
  ScenarioModel,
  Token
} from './types'
import { ScopeRegistry, scopeKey } from './scopeRegistry'
import { InputBuffer, type PortSpec } from './inputBuffer'
import { resolveSelectorPath, concreteValue } from '../../shared/utils/scenarioStaticPreview'
import { readInputParams } from '../../shared/scenarioInputParams'
import { evaluateCondition, resolveOperand } from './conditionEval'

/**
 * No activation cap by default — a scenario can loop intentionally for as
 * long as the user wants (days), stopped only by an explicit Stop. A finite
 * cap is still settable per-run via `RunOptions.maxActivations` (the unit
 * tests use it to assert the runaway-cycle guard still works on demand).
 */
const DEFAULT_MAX_ACTIVATIONS = Number.POSITIVE_INFINITY

/** Conditional-loop iterations to run synchronously before yielding once to
 * the macrotask queue (so a Stop / IPC can interleave instead of being
 * starved by the microtask chain — see `runConditionalLoop`). Small enough
 * that a runaway loop stays snappy to Stop; large enough that an ordinary
 * finite loop pays no measurable yield overhead. */
const LOOP_YIELD_EVERY = 256

export interface RunOptions {
  /** Params for the scenario's `input` nodes (keyed by param name). */
  params?: Record<string, unknown>
  /** Override the run-wide max activations safety net. */
  maxActivations?: number
  /** Begin paused — first `resume()` ticks the first activation. */
  startPaused?: boolean
  /** Interactive (UI) run: no-predecessor `input` nodes prompt the user (and
   * beam) instead of falling back to their configured default. Headless runs
   * (MCP, sub-scenarios) leave this false so they never block on a prompt. */
  interactive?: boolean
  /** Debug run: pause right BEFORE entering any node whose id is in
   * `breakpoints` (the node hasn't executed yet). The normal Play run leaves
   * this false and ignores breakpoints entirely. */
  debug?: boolean
  /** Node ids to break on — only honored when `debug` is true. An id that
   * matches no node simply never triggers (stale breakpoints can't crash). */
  breakpoints?: readonly RuntimeId[]
}

export interface SchedulerInit {
  scenario: ScenarioModel
  /** Executor registry — keyed by node id (every node binds to its
   * kind-specific executor, but some node-level wrapping happens at
   * load time so the keying is per-node rather than per-kind). */
  executors: Map<RuntimeId, NodeExecutor>
  /** Sub-scenario dispatcher — called from a `runScenario` executor.
   * Wired by the engine container so the scheduler stays unaware of
   * the collection store. */
  runSubScenario?: (scenarioId: RuntimeId, params: Record<string, unknown>, parentSignal?: AbortSignal) => Promise<Record<string, unknown>>
  /** Optional input-port spec override. By default each node's
   * required inputs come from the persisted `inputs` array. */
  portSpecOverrides?: Map<RuntimeId, PortSpec[]>
  /** When set, this run aborts as soon as the parent run aborts — so a
   * Stop on a parent scenario cascades into its sub-scenarios. */
  parentSignal?: AbortSignal
  /** True when this scheduler runs a SUB-scenario (invoked by a parent's
   * `runScenario`). A sub never raises the start-time "run parameters" prompt
   * for its entry inputs — the caller supplies those — but its mid-flow inputs
   * still prompt (when interactive). */
  isSubScenario?: boolean
}

type State = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'

/** Cloning of input values happens at the buffer boundary, so the
 * scheduler hands the executor a Map that's safe to mutate. */
type InternalActivation = Activation

export class Scheduler {
  readonly runId: RuntimeId
  private readonly scenario: ScenarioModel
  private readonly executors: Map<RuntimeId, NodeExecutor>
  private readonly buffer = new InputBuffer()
  private readonly scopes = new ScopeRegistry()
  private readonly emitter = new EventEmitter()
  private readonly log: RunLogEntry[] = []
  private readonly variables = new Map<string, unknown>()
  private readonly abortCtl = new AbortController()
  private readonly outgoingByPort = new Map<string, { edgeId: string; toNodeId: string; toPort: string; selector?: string }[]>()
  private readonly runSubScenario?: SchedulerInit['runSubScenario']

  private queue: InternalActivation[] = []
  private state: State = 'idle'
  /** Debug run + the set of breakpointed node ids (empty = no breakpoints).
   * Set in `run()` from `RunOptions`. */
  private debug = false
  /** UI run: mid-flow `input` nodes prompt the user (propagated into subs).
   * Set in `run()` from `RunOptions`. */
  private interactive = false
  /** True for a sub-scenario run (see {@link SchedulerInit.isSubScenario}). */
  private readonly isSubScenario: boolean
  private breakpoints: ReadonlySet<RuntimeId> = new Set()
  /** Activations already released past their breakpoint (so resume/step runs
   * them instead of re-breaking). Per-activation — each forEach iteration is a
   * distinct activation object, so every iteration breaks on its own. */
  private readonly breakpointCleared = new WeakSet<InternalActivation>()
  /** Activations already given their step PRE-stop (paused once BEFORE running).
   * Stepping gives each box two stops — one before it executes (this), one
   * after (the existing post-dispatch pause). */
  private readonly stepPreStopped = new WeakSet<InternalActivation>()
  private inFlight = 0
  private tokenSeq = 0
  private activations = 0
  private maxActivations = DEFAULT_MAX_ACTIVATIONS
  private completionWaiters: (() => void)[] = []
  private readonly pendingInputRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; info: PendingUserInputInfo }>()
  private userInputSeq = 0
  /** Node ids that have ≥1 incoming edge (so they're NOT roots). */
  private readonly nodesWithIncoming = new Set<string>()
  /** Per node, the set of input port ids that carry an incoming edge. */
  private readonly incomingPortsByNode = new Map<string, Set<string>>()
  /** Per node → port → set of source keys (`${fromNodeId}:${fromPort}`)
   * feeding that port. A port fed by >1 source is an AND-join barrier. */
  private readonly incomingSourcesByNodePort = new Map<string, Map<string, Set<string>>>()
  /** Aggregate nodes wired to a `forEach`/`for` `done` port — they collect
   * one contribution per iteration on `items` (inside the loop scope) and
   * fire ONCE when the loop closes (the `done` trigger), reordered by index.
   * Aggregates NOT fed by a `done` port keep the plain array-reduce path. */
  private readonly streamingAggregates = new Set<string>()
  /** Buffered per-iteration contributions for a streaming aggregate, keyed
   * by `${aggregateNodeId}@${parentScopeKey}` → (iteration index → value). */
  private readonly aggregateCollect = new Map<string, Map<number, unknown>>()

  // --- Completion tree (universal `done` port) --------------------------
  // Every action box emits an implicit `done` signal once its ENTIRE data
  // subtree has drained (post-order completion). We track that with a tree
  // PARALLEL to the dataflow — leaving the scope / buffer / join machinery
  // untouched (those drive data lineage, which `done` must not perturb).
  /** Monotonic completion-id source — one per created activation. */
  private completionSeq = 0
  /** completionId → the activations whose DATA subtree this one belongs to
   * (the emitters of the tokens it consumed). Draining decrements them. */
  private readonly parentsOf = new Map<number, number[]>()
  /** completionId → count of not-yet-drained DATA descendants. Hits 0 (and
   * the executor has returned) ⇒ the box's subtree is fully drained. */
  private readonly pending = new Map<number, number>()
  /** Completion ids whose executor has returned (so a later pending→0 can
   * fire `done`). */
  private readonly returned = new Set<number>()
  /** completionId → its activation (to fire `done` + read scope on drain). */
  private readonly actById = new Map<number, InternalActivation>()
  /** Tokens already counted toward a parent obligation — a latched token
   * re-read on a later firing must NOT re-attribute its emitter. WeakSet so
   * a long / infinite loop doesn't leak (entries vanish with the token). */
  private readonly consumedTokens = new WeakSet<Token>()
  /** Loop iterations deferred to the macrotask queue (the anti-freeze yield):
   * counted as live work so the run isn't reported "done" while a re-entry is
   * still pending on a timer. */
  private pendingReentry = 0

  constructor(init: SchedulerInit) {
    this.runId = randomId()
    this.scenario = init.scenario
    this.executors = init.executors
    this.isSubScenario = init.isSubScenario === true
    if (init.runSubScenario) this.runSubScenario = init.runSubScenario
    // Cascade a parent abort into this (sub-)run: cancelling the parent
    // scenario must stop everything it launched.
    if (init.parentSignal) {
      if (init.parentSignal.aborted) this.abortCtl.abort('parent cancelled')
      else init.parentSignal.addEventListener('abort', () => { this.abort('parent cancelled') }, { once: true })
    }
    // `indexEdges` populates `incomingPortsByNode`, which `registerPorts`
    // reads to compute edge-driven requiredness — so it must run first.
    this.indexEdges()
    this.registerPorts(init.portSpecOverrides)
  }

  /** Subscribe to engine events. */
  on(listener: (e: EngineEvent) => void): () => void {
    this.emitter.on('event', listener)
    return () => { this.emitter.off('event', listener) }
  }

  /** Get the in-memory run log (engine + user entries, chronological). */
  readLog(): readonly RunLogEntry[] {
    return this.log
  }

  /** Current status snapshot. */
  status(): RunStatus {
    return {
      runId: this.runId,
      state: this.state,
      pendingCount: this.queue.length,
      inFlightCount: this.inFlight
    }
  }

  /**
   * Start the run: seed root activations, drive the dispatch loop.
   * Resolves when the run reaches a terminal state (completed,
   * cancelled, failed). The promise NEVER rejects — observe via
   * events / status.
   */
  run(opts: RunOptions = {}): Promise<void> {
    if (this.state !== 'idle') return this.completionPromise()
    if (opts.maxActivations !== undefined) this.maxActivations = opts.maxActivations
    this.debug = opts.debug === true
    this.interactive = opts.interactive === true
    if (opts.breakpoints && opts.breakpoints.length > 0) this.breakpoints = new Set(opts.breakpoints)
    this.state = opts.startPaused === true ? 'paused' : 'running'
    this.emit({ type: 'run-started', runId: this.runId, scenarioId: this.scenario.id, at: now() })
    // Launched in step mode: surface the paused state so observers (the editor
    // toolbar) know the run is armed at the start, ready to step.
    if (opts.startPaused === true) this.emit({ type: 'run-paused', runId: this.runId, at: now() })
    this.logRunBoundary('start')
    // The start-time "run parameters" prompt for predecessor-less inputs is
    // raised ONLY for a top-level interactive run. A sub-scenario's entry inputs
    // are supplied by the calling `runScenario` (or fall back to their default),
    // so it never re-asks for them.
    this.seedRoots(opts.params ?? {}, this.interactive && !this.isSubScenario)
    this.tick()
    return this.completionPromise()
  }

  /** Pause the dispatch loop. Already-running executors finish on their
   * own; no new activations leave the queue until `resume()`. */
  pause(): void {
    if (this.state !== 'running') return
    this.state = 'paused'
    this.emit({ type: 'run-paused', runId: this.runId, at: now() })
  }

  /** Resume from a paused state. No-op when not paused. */
  resume(): void {
    if (this.state !== 'paused') return
    this.state = 'running'
    this.emit({ type: 'run-resumed', runId: this.runId, at: now() })
    this.tick()
  }

  /** Turn breakpoint-honoring on/off mid-run — lets the Debug button convert a
   * plain Play run (launched with `debug:false`) into one that stops at
   * breakpoints. Honored from the next node dispatch. */
  setDebug(enabled: boolean): void { this.debug = enabled }

  /** Replace the live breakpoint set mid-run — the user toggled a breakpoint
   * while the run is in flight; the change takes effect at the next dispatch
   * (already-passed nodes are not revisited). */
  setBreakpoints(ids: readonly RuntimeId[]): void { this.breakpoints = new Set(ids) }

  /** Dequeue exactly one activation while keeping the scheduler in a
   * paused state — the user's "step" gesture. No-op when not paused
   * or queue empty. */
  step(): void {
    if (this.state !== 'paused') return
    if (this.queue.length === 0 && this.inFlight === 0) {
      this.terminateIfDone()
      return
    }
    // Temporarily flip to running, dispatch one, then re-pause via
    // an explicit guard in `dispatchOne`.
    this.stepLatch = true
    this.tick()
  }

  /** Cooperative cancellation. Aborts in-flight executors and drains
   * the queue; the run completes in `cancelled` state. */
  abort(reason?: string): void {
    if (this.state === 'completed' || this.state === 'cancelled' || this.state === 'failed') return
    const wasState = this.state
    this.state = 'cancelled'
    // Record the stop moment in the run log (the user explicitly wants
    // "when I hit Stop" traceable; also marks where an abort cascaded
    // into a sub-run via `reason: 'parent cancelled'`).
    this.log.push({ ts: now(), runId: this.runId, level: 'info', source: 'engine', message: `run aborted${reason !== undefined ? ` (${reason})` : ''}` })
    this.logRunBoundary('end', reason === 'parent cancelled' ? 'parent cancelled' : 'cancelled')
    this.abortCtl.abort(reason ?? 'cancelled')
    this.queue = []
    // If we were idle, just emit; if running, the in-flight chain
    // will land via `finally` and call `terminateIfDone`.
    this.emit({ type: 'run-cancelled', runId: this.runId, at: now(), ...(reason !== undefined ? { reason } : {}) })
    if (wasState === 'idle' || this.inFlight === 0) this.terminateIfDone()
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private stepLatch = false

  private emit(e: EngineEvent): void {
    try { this.emitter.emit('event', e) } catch { /* swallow */ }
  }

  /** Routine called from `run()`, `resume()`, `step()`, and after
   * each completion — drains the queue while we're in a runnable
   * state, respecting the step latch. */
  private tick(): void {
    while (
      (this.state === 'running' || (this.state === 'paused' && this.stepLatch)) &&
      this.queue.length > 0
    ) {
      const next = this.queue.shift()
      if (!next) break
      // Breakpoint: in a debug run, pause right BEFORE entering a breakpointed
      // node — re-queue it un-executed and surface `breakpoint-hit`. The first
      // resume/step clears this activation so the next pass runs it (keyed
      // per-activation, so each forEach iteration breaks on its own). A hit
      // supersedes any pending step latch.
      if (this.debug && this.breakpoints.has(next.nodeId) && !this.breakpointCleared.has(next)) {
        this.breakpointCleared.add(next)
        // A breakpoint hit IS the "before" stop, so don't ALSO step-pre-stop it:
        // the next step should run the node, not pause before it again.
        this.stepPreStopped.add(next)
        this.queue.unshift(next)
        this.stepLatch = false
        this.state = 'paused'
        this.log.push({ ts: now(), runId: this.runId, level: 'info', source: 'engine', nodeId: next.nodeId, scope: next.scope, message: `breakpoint hit ${next.kind}` })
        this.emit({ type: 'breakpoint-hit', runId: this.runId, nodeId: next.nodeId, scope: next.scope, at: now() })
        return
      }
      // Step PRE-stop: while stepping, pause BEFORE entering a node (once per
      // activation) so each box gets two stops — one before it runs (here) and
      // one after it completes (the post-dispatch pause below).
      if (this.stepLatch && !this.stepPreStopped.has(next)) {
        this.stepPreStopped.add(next)
        this.queue.unshift(next)
        this.stepLatch = false
        this.state = 'paused'
        this.emit({ type: 'step-paused', runId: this.runId, nodeId: next.nodeId, scope: next.scope, at: now() })
        return
      }
      this.dispatch(next)
      if (this.stepLatch) {
        this.stepLatch = false
        this.state = 'paused'
        return
      }
    }
    this.terminateIfDone()
  }

  /** The action's RESOLVED input parameters, for the `start` debug log so a run
   * trace shows what actually went in: each typed-value config operand resolved
   * to its concrete / live value (`a: 5`, `b: <cpt's value>`), plus primitive
   * config (operator, name, level…), with any WIRED input overlaid on top (a
   * link supersedes the inline value). Structural config (arrays, nested
   * objects like `parallelism` / `cases`) is omitted to keep the line readable. */
  private startLogParams(act: InternalActivation): Record<string, unknown> {
    const node = this.scenario.nodes.find((n) => n.id === act.nodeId)
    const config = node?.config ?? {}
    // An input node declares MANY params (`config.params`) — surface every one
    // by NAME (`string: …, string2: …`), resolving each default and overlaying
    // the seeded/prompted value from the combined `value` object. The generic
    // config walk below can't do this (it skips the `params` array and would
    // leak the stale legacy `name`/`valueType` keys that linger post-migration).
    if (node?.kind === 'input') {
      const wired = act.inputs['value']
      const wiredObj = typeof wired === 'object' && wired !== null && !Array.isArray(wired)
        ? (wired as Record<string, unknown>)
        : undefined
      const out: Record<string, unknown> = {}
      for (const param of readInputParams(config)) {
        const name = param.name.trim()
        if (!name) continue
        out[name] = wiredObj && name in wiredObj
          ? wiredObj[name]
          : (param.valueType !== undefined && param.valueType !== null ? resolveOperand(undefined, param.valueType, this.variables) : undefined)
      }
      return out
    }
    const params: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(config)) {
      if (v === null || v === undefined) continue
      if (typeof v === 'object') {
        if (!Array.isArray(v) && 'type' in v) params[k] = resolveOperand(undefined, v, this.variables)
        // else: structural config (array / nested object) — skip.
      } else {
        params[k] = v
      }
    }
    for (const [k, v] of Object.entries(act.inputs)) params[k] = v
    return params
  }

  /** Hand an activation to its executor + wire up the completion
   * machinery (emit events, route emissions, update counters). */
  private dispatch(act: InternalActivation): void {
    const executor = this.executors.get(act.nodeId)
    if (!executor) {
      this.log.push({ ts: now(), runId: this.runId, level: 'error', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `no executor for node ${act.nodeId}` })
      this.emit({ type: 'node-failed', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now(), error: 'no executor' })
      this.scopes.leave(act.scope)
      return
    }
    this.activations += 1
    if (this.activations > this.maxActivations) {
      this.fail(`scenario exceeded max-activations safety net (${this.maxActivations})`)
      return
    }
    this.inFlight += 1
    const startParams = this.startLogParams(act)
    this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `start ${act.kind}`, ...(Object.keys(startParams).length > 0 ? { data: logData(startParams) } : {}) })
    this.emit({ type: 'node-started', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now() })
    const ctx: ExecContext = {
      signal: this.abortCtl.signal,
      log: (entry) => {
        this.log.push({
          ts: now(),
          runId: this.runId,
          source: entry.source ?? 'user',
          ...entry
        } as RunLogEntry)
      },
      variables: this.variables,
      runSubScenario: this.runSubScenario ?? (() => Promise.reject<Record<string, unknown>>(new Error('runSubScenario not wired'))),
      requestUserInput: (req) => this.openUserInputRequest(act.nodeId, req),
      interactive: this.interactive,
      node: this.findNode(act.nodeId)
    }
    const startedAt = now()
    void (async () => {
      try {
        const result = await executor(act, ctx)
        if (this.abortCtl.signal.aborted) {
          // run was cancelled while we awaited — silently land.
          return
        }
        const doneData: Record<string, unknown> = {}
        for (const o of result.outputs) doneData[o.port] = o.value
        this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `done ${act.kind}`, ...(result.outputs.length > 0 ? { data: logData(doneData) } : {}) })
        this.handleExecResult(act, result)
        // A `forEach` / conditional loop doesn't "complete" when its executor
        // returns — it's still orchestrating its iterations. The deferred
        // `node-completed` fires once every iteration scope has closed (and,
        // for a loop, the condition has turned false).
        if (result.scopeAction?.type !== 'openForEach' && result.scopeAction?.type !== 'conditionalLoop') {
          this.emit({ type: 'node-completed', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now(), outputs: result.outputs })
          // The executor returned: arm the universal `done` port. It fires now
          // if the box has no data descendants, else once they all drain.
          this.markReturned(act)
        }
      } catch (err) {
        // The run was cancelled while we awaited (Stop) — silently land,
        // exactly like the success branch. Don't route to `error` / fail:
        // an aborted run isn't a node error.
        if (this.abortCtl.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        this.log.push({ ts: now(), runId: this.runId, level: 'error', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: msg })
        // Route to the node's `error` output if anything is wired
        // there; otherwise fail the whole run.
        const errorEdges = this.outgoingByPort.get(`${act.nodeId}:error`) ?? []
        if (errorEdges.length > 0) {
          this.handleExecResult(act, { outputs: [{ port: 'error', value: { message: msg, startedAt } }] })
          this.emit({ type: 'node-failed', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now(), error: msg })
          // Keep the completion tree consistent: the error route IS this box's
          // outcome, so arm `done` against the error-handler subtree (else an
          // ancestor waiting on this box would stall forever).
          this.markReturned(act)
        } else {
          this.emit({ type: 'node-failed', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now(), error: msg })
          this.fail(msg)
        }
      } finally {
        this.inFlight -= 1
        this.scopes.leave(act.scope)
        // Re-tick the queue if we're still runnable. Done via
        // microtask to avoid blowing the stack on long synchronous
        // chains (a `now` → `arithmetic` → `if` → ... pipeline).
        queueMicrotask(() => { this.tick() })
      }
    })()
  }

  /** Turn an executor's `ExecResult` into outgoing tokens, push them
   * into the buffer, and enqueue any newly-fireable activations. */
  private handleExecResult(act: InternalActivation, result: ExecResult): void {
    const action = result.scopeAction
    if (action?.type === 'openForEach') {
      // An absent / non-positive batchSize means "no bound" → open every
      // item at once (preserves the legacy fully-parallel behaviour).
      const n = typeof action.batchSize === 'number' && action.batchSize > 0 ? action.batchSize : action.items.length
      this.runForEach(act, action.items, Math.max(1, n))
      return
    }
    if (action?.type === 'conditionalLoop') {
      this.runConditionalLoop(act, action.mode)
      return
    }
    // Plain emissions: route each one to the edges leaving the port.
    // An edge `selector` reshapes the value in transit (e.g. picking
    // `body.data.cooldown.total_seconds` out of an HTTP response).
    const cid = act.completionId
    for (const out of result.outputs) {
      const edges = this.outgoingByPort.get(`${act.nodeId}:${out.port}`) ?? []
      for (const edge of edges) {
        const routed = edge.selector !== undefined && edge.selector !== ''
          ? resolveSelectorPath(out.value, edge.selector)
          : out.value
        // Each routed data token is one obligation on the emitter's subtree:
        // its `done` waits until this token's downstream chain has drained.
        if (cid !== undefined) this.pending.set(cid, (this.pending.get(cid) ?? 0) + 1)
        this.enqueueToken({
          value: deepClone(routed),
          fromNodeId: act.nodeId,
          fromPort: out.port,
          toNodeId: edge.toNodeId,
          toPort: edge.toPort,
          scope: act.scope,
          tokenId: ++this.tokenSeq,
          ...(cid !== undefined ? { emitter: cid } : {})
        })
        this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
      }
    }
  }

  // ------------------------------------------------------------------
  // Completion tree — universal `done` port (post-order subtree drain)
  // ------------------------------------------------------------------

  /** Assign a completion id + record the activation's subtree parents (the
   * emitters of the tokens it consumed). Called once, when the activation is
   * created — before it is queued. */
  private registerActivation(act: InternalActivation, parents: number[]): void {
    const cid = ++this.completionSeq
    act.completionId = cid
    this.parentsOf.set(cid, parents)
    this.pending.set(cid, 0)
    this.actById.set(cid, act)
  }

  /** A non-loop executor returned: mark it returned, and if its subtree is
   * already empty (no pending data descendants) fire `done` right away. */
  private markReturned(act: InternalActivation): void {
    const cid = act.completionId
    if (cid === undefined) return
    this.returned.add(cid)
    if ((this.pending.get(cid) ?? 0) <= 0) this.onSubtreeDrained(cid)
  }

  /** A non-loop box's whole data subtree has drained → fire its `done` port
   * (a continuation, untagged) then release it from each parent's count. */
  private onSubtreeDrained(cid: number): void {
    const act = this.actById.get(cid)
    if (!act) return // already drained — keep idempotent
    this.actById.delete(cid)
    this.returned.delete(cid)
    this.pending.delete(cid)
    const parents = this.parentsOf.get(cid) ?? []
    this.parentsOf.delete(cid)
    this.fireDonePort(act)
    this.releaseParents(parents)
  }

  /** A loop fully completed (every iteration scope closed; it already emitted
   * its OWN `done`). Don't re-fire `done` — just release it from its parents
   * so a box that fed the loop waits for the whole loop to finish. */
  private completeLoop(act: InternalActivation): void {
    const cid = act.completionId
    if (cid === undefined || !this.actById.has(cid)) return
    this.actById.delete(cid)
    this.returned.delete(cid)
    this.pending.delete(cid)
    const parents = this.parentsOf.get(cid) ?? []
    this.parentsOf.delete(cid)
    this.releaseParents(parents)
  }

  /** Decrement each parent's pending-descendant count; a parent that reaches
   * 0 after its executor already returned has now fully drained → cascade. */
  private releaseParents(parents: number[]): void {
    for (const p of parents) {
      const n = (this.pending.get(p) ?? 0) - 1
      this.pending.set(p, n)
      if (n <= 0 && this.returned.has(p)) this.onSubtreeDrained(p)
    }
  }

  /** Route a token off a box's implicit `done` port to its outgoing edges.
   * Carries no value (a pure signal) and no `emitter` (a continuation, not a
   * child of the box that just finished). */
  private fireDonePort(act: InternalActivation): void {
    const edges = this.outgoingByPort.get(`${act.nodeId}:done`) ?? []
    for (const edge of edges) {
      this.enqueueToken({
        value: true,
        fromNodeId: act.nodeId,
        fromPort: 'done',
        toNodeId: edge.toNodeId,
        toPort: edge.toPort,
        scope: act.scope,
        tokenId: ++this.tokenSeq
      })
      this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
    }
  }

  /**
   * Run a `forEach` with bounded concurrency. At most `batchSize` item
   * scopes are open at once; the window slides forward as each item's
   * whole chain completes (its child scope closes — the "token" coming
   * back to the forEach). When every item has closed, the `done` port
   * fires and the forEach's own `node-completed` is emitted (deferred
   * here, NOT in `dispatch`, so the node's running beam spans the
   * entire iteration rather than the instant the executor returned).
   */
  private runForEach(act: InternalActivation, items: unknown[], batchSize: number): void {
    const eachEdges = this.outgoingByPort.get(`${act.nodeId}:each`) ?? []
    const total = items.length
    let nextIndex = 0
    let completed = 0

    const fireDone = (): void => {
      const doneEdges = this.outgoingByPort.get(`${act.nodeId}:done`) ?? []
      for (const edge of doneEdges) {
        this.enqueueToken({
          value: total,
          fromNodeId: act.nodeId,
          fromPort: 'done',
          toNodeId: edge.toNodeId,
          toPort: edge.toPort,
          scope: act.scope,
          tokenId: ++this.tokenSeq
        })
        this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
      }
      // Deferred completion: the forEach box stops "running" only now,
      // once every batch has drained.
      this.emit({ type: 'node-completed', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now(), outputs: [] })
      // The loop already emitted its own `done`; release it from its parents
      // so a box that fed this loop waits for the WHOLE loop to finish.
      this.completeLoop(act)
    }

    const openItem = (i: number): void => {
      // Cancelled mid-iteration: don't open further items (and don't
      // register their scope-close listeners — an un-entered scope would
      // close synchronously and cascade through the rest, churning the
      // log + falsely reporting completion after a Stop).
      if (this.abortCtl.signal.aborted) return
      this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `forEach open item ${i} (${completed}/${total} done, batch≤${batchSize})` })
      const child: ScopeStack = [...act.scope, { scopeNodeId: act.nodeId, index: i }]
      for (const edge of eachEdges) {
        this.enqueueToken({
          value: deepClone(items[i]),
          fromNodeId: act.nodeId,
          fromPort: 'each',
          toNodeId: edge.toNodeId,
          toPort: edge.toPort,
          scope: child,
          tokenId: ++this.tokenSeq
        })
        this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
      }
      // The item is done when its whole chain has drained this scope.
      this.scopes.onClose(child, () => {
        completed += 1
        this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `forEach item ${i} closed (${completed}/${total} done)` })
        if (nextIndex < total) openItem(nextIndex++)
        if (completed === total) fireDone()
      })
    }

    if (total === 0) {
      fireDone()
      return
    }
    const initial = Math.min(batchSize, total)
    this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `forEach start: ${total} items, batchSize=${batchSize}, opening first ${initial}` })
    nextIndex = initial
    for (let i = 0; i < initial; i++) openItem(i)
  }

  /**
   * Run a `while` / `doWhile` as an engine-managed loop. Each iteration
   * runs the body (the subgraph wired off `then`) in its own child scope;
   * when that scope closes (the iteration finished), the condition is
   * re-evaluated and — while true — another iteration opens. When the
   * condition turns false the `else` port fires and the loop node's own
   * `node-completed` is emitted (deferred here so its running beam spans
   * the WHOLE loop, like a forEach). `while` tests before the first body;
   * `doWhile` runs the body once before the first test. No manual loop-back
   * edge is needed — the scheduler closes the loop itself.
   */
  private runConditionalLoop(act: InternalActivation, mode: 'while' | 'doWhile'): void {
    const thenEdges = this.outgoingByPort.get(`${act.nodeId}:then`) ?? []
    const node = this.findNode(act.nodeId)
    let iter = 0

    const evalCond = (): boolean => {
      try { return evaluateCondition(node.config, act.inputs, this.variables) } catch { return false }
    }

    const fireExit = (): void => {
      // The loop exit IS the box's completion: it routes through the universal
      // implicit `done` port (the old `else` output was removed as a duplicate).
      const doneEdges = this.outgoingByPort.get(`${act.nodeId}:done`) ?? []
      for (const edge of doneEdges) {
        this.enqueueToken({ value: iter, fromNodeId: act.nodeId, fromPort: 'done', toNodeId: edge.toNodeId, toPort: edge.toPort, scope: act.scope, tokenId: ++this.tokenSeq })
        this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
      }
      this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `${mode} done after ${iter} iteration(s)` })
      this.emit({ type: 'node-completed', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now(), outputs: [] })
      // Loop fully exited (it emitted its own `done`): release it from its
      // parents so an upstream box's `done` waits for the whole loop.
      this.completeLoop(act)
    }

    const openBody = (): void => {
      if (this.abortCtl.signal.aborted) return
      const i = iter
      iter += 1
      const child: ScopeStack = [...act.scope, { scopeNodeId: act.nodeId, index: i }]
      this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `${mode} iteration ${i}` })
      for (const edge of thenEdges) {
        // `then` is a pure signal: fire the body, carry no per-iteration value.
        this.enqueueToken({ value: true, fromNodeId: act.nodeId, fromPort: 'then', toNodeId: edge.toNodeId, toPort: edge.toPort, scope: child, tokenId: ++this.tokenSeq })
        this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
      }
      // Iteration is done when its whole body chain has drained the scope;
      // then re-evaluate and loop while true.
      this.scopes.onClose(child, () => {
        if (this.abortCtl.signal.aborted) return
        if (!evalCond()) { fireExit(); return }
        // Anti-freeze: a synchronous body would chain the next iteration on a
        // microtask, and an unbounded loop starves the macrotask queue — so a
        // Stop (an IPC macrotask) never lands and the app freezes. Every N
        // iterations, hand control back to the macrotask queue so the run
        // stays interruptible. Counted as `pendingReentry` so the scheduler
        // doesn't report "done" while a re-entry is still on the timer.
        if (iter % LOOP_YIELD_EVERY === 0) {
          this.pendingReentry += 1
          setImmediate(() => {
            this.pendingReentry -= 1
            if (this.abortCtl.signal.aborted) { this.terminateIfDone(); return }
            openBody()
            this.tick()
          })
        } else {
          openBody()
        }
      })
    }

    // A loop with no body wired can't iterate — just take the exit branch.
    if (thenEdges.length === 0) { fireExit(); return }
    if (mode === 'doWhile') openBody()
    else if (evalCond()) openBody()
    else fireExit()
  }

  /** Push a token into the buffer; if a node becomes fireable, queue
   * an activation. */
  private enqueueToken(token: Token): void {
    // Once cancelled, accept no new tokens — otherwise a forEach's
    // scope-close handler keeps opening the next item (and its
    // sub-scenario) after a Stop.
    if (this.abortCtl.signal.aborted) return
    // A streaming aggregate collects per-iteration contributions itself
    // (buffered, not buffered-into-an-activation) and fires once on close.
    if (this.streamingAggregates.has(token.toNodeId)) {
      this.collectForAggregate(token)
      return
    }
    const decision = this.buffer.put(token)
    if (!decision) return
    const node = this.scenario.nodes.find((n) => n.id === token.toNodeId)
    if (!node) return
    const inputs: Record<string, unknown> = {}
    for (const portId of Object.keys(decision.tokensByPort)) {
      inputs[portId] = deepClone(decision.tokensByPort[portId]?.value)
    }
    // Subtree parents: the emitters of the matched tokens, counted once each
    // (a latched token re-read on a later firing has already transferred its
    // obligation, so it must not re-attribute its emitter here).
    const parents = new Set<number>()
    for (const m of decision.matched) {
      if (this.consumedTokens.has(m.token)) continue
      this.consumedTokens.add(m.token)
      if (typeof m.token.emitter === 'number') parents.add(m.token.emitter)
    }
    this.buffer.consume(node.id, decision)
    const act: InternalActivation = { nodeId: node.id, kind: node.kind, scope: decision.scope, inputs }
    this.registerActivation(act, [...parents])
    this.queue.push(act)
    this.scopes.enter(decision.scope)
  }

  /** Seed the queue with root activations — nodes that have NO
   * incoming edge at all. Requiredness is edge-driven (see
   * `registerPorts`): a node waits only for the input ports that are
   * actually wired, and a node wired to nothing fires immediately.
   * This matches the spec ("nodes without predecessors all start at
   * once; a node with predecessors waits for all its inputs"). */
  private seedRoots(params: Record<string, unknown>, interactive: boolean): void {
    for (const node of this.scenario.nodes) {
      if (this.nodesWithIncoming.has(node.id)) continue
      if (node.kind === 'input') {
        // The input declares N params; it emits ONE object `{ name: value, … }`
        // (the shape the static preview + executor model) so a wired selector
        // resolves identically.
        const inputParams = readInputParams(node.config)
        const paramName = (p: { name: string }): string => (p.name.trim() !== '' ? p.name.trim() : 'value')
        const passthrough = (valueObj: Record<string, unknown>): void => {
          const act: InternalActivation = { nodeId: node.id, kind: node.kind, scope: [], inputs: { value: valueObj }, seeded: true }
          this.registerActivation(act, [])
          this.queue.push(act)
        }
        const allSupplied = inputParams.every((p) => paramName(p) in params)
        if (allSupplied) {
          // Every param was supplied up-front — no prompt.
          const obj: Record<string, unknown> = {}
          for (const p of inputParams) obj[paramName(p)] = params[paramName(p)]
          passthrough(obj)
        } else if (interactive) {
          // UI run, missing value(s) — the input RUNS and prompts the user for
          // each param; it beams and a cancel routes to `error`. The renderer
          // groups these start-time prompts into one "run parameters" modal.
          const act: InternalActivation = { nodeId: node.id, kind: node.kind, scope: [], inputs: {}, seeded: false }
          this.registerActivation(act, [])
          this.queue.push(act)
        } else {
          // Headless run (MCP / sub-scenario) — supplied params win, the rest
          // fall back to each param's configured default; there's no UI.
          const obj: Record<string, unknown> = {}
          for (const p of inputParams) {
            const n = paramName(p)
            obj[n] = n in params ? params[n] : (p.valueType !== undefined && p.valueType !== null ? concreteValue(p.valueType) : undefined)
          }
          passthrough(obj)
        }
        this.scopes.enter([])
        continue
      }
      const act: InternalActivation = { nodeId: node.id, kind: node.kind, scope: [], inputs: {}, seeded: true }
      this.registerActivation(act, [])
      this.queue.push(act)
      this.scopes.enter([])
    }
  }

  /** Build the (port → outgoing edges) index + the set of input ports
   * that have an incoming edge, per node. Both feed the edge-driven
   * requiredness model. */
  private indexEdges(): void {
    for (const e of this.scenario.edges) {
      const k = `${e.from.nodeId}:${e.from.portId}`
      const arr = this.outgoingByPort.get(k) ?? []
      arr.push({ edgeId: e.id, toNodeId: e.to.nodeId, toPort: e.to.portId, ...(e.selector !== undefined ? { selector: e.selector } : {}) })
      this.outgoingByPort.set(k, arr)
      // Record the wired input ports per target node.
      this.nodesWithIncoming.add(e.to.nodeId)
      const ports = this.incomingPortsByNode.get(e.to.nodeId) ?? new Set<string>()
      ports.add(e.to.portId)
      this.incomingPortsByNode.set(e.to.nodeId, ports)
      // Record the source edges per (node, port) for the AND-join.
      const byPort = this.incomingSourcesByNodePort.get(e.to.nodeId) ?? new Map<string, Set<string>>()
      const srcs = byPort.get(e.to.portId) ?? new Set<string>()
      srcs.add(`${e.from.nodeId}:${e.from.portId}`)
      byPort.set(e.to.portId, srcs)
      this.incomingSourcesByNodePort.set(e.to.nodeId, byPort)
      // An `aggregate` fed by a loop's `done` port is a scope-close collector:
      // `done` only exists on `forEach` / `for`, so this edge marks the
      // aggregate as streaming (collect per iteration, fire once on close).
      if (e.from.portId === 'done') {
        const target = this.scenario.nodes.find((n) => n.id === e.to.nodeId)
        if (target?.kind === 'aggregate') this.streamingAggregates.add(target.id)
      }
    }
  }

  /**
   * Streaming-aggregate intake. While the loop runs, each iteration's
   * contribution arrives on `items` inside that iteration's scope — buffer
   * it by index, don't activate. When the loop closes, its `done` token
   * arrives on the aggregate's trigger (any non-`items` port) in the parent
   * scope: fire the aggregate ONCE with the contributions reordered by index,
   * plus the indices that produced nothing (the default-policy error list).
   *
   * Contract: the aggregate collects from the loop whose `done` triggers it —
   * contributions must arrive exactly one scope frame deeper than the trigger
   * (i.e. directly inside that loop). An aggregate triggered by an OUTER loop
   * while its `items` are fed from a nested inner loop is unsupported (the
   * contributions won't match the trigger's scope, so the run logs them as
   * missing rather than guessing a cross-level ordering).
   */
  private collectForAggregate(token: Token): void {
    const node = this.scenario.nodes.find((n) => n.id === token.toNodeId)
    if (!node) return
    if (token.toPort === 'items') {
      // A streaming aggregate only collects per-iteration contributions, which
      // arrive one scope frame deeper than the trigger. A token at the
      // aggregate's own (root) scope is a contract violation (a ready-made
      // array wired into a node that's also a scope-close collector): drop it
      // rather than mistake it for the trigger — the real `done` then fires
      // once and the default policy's warn surfaces the empty collection.
      if (token.scope.length === 0) return
      // Per-iteration contribution → buffer by iteration index. A second
      // contribution at the same index (a loop-back) is last-write-wins: the
      // model is one collected value per iteration.
      const parent = token.scope.slice(0, -1)
      const idx = token.scope[token.scope.length - 1]?.index ?? 0
      const key = `${node.id}@${scopeKey(parent)}`
      const m = this.aggregateCollect.get(key) ?? new Map<number, unknown>()
      m.set(idx, token.value)
      this.aggregateCollect.set(key, m)
      return
    }
    // Trigger (`done`): collect, reorder by index, surface missing indices.
    const key = `${node.id}@${scopeKey(token.scope)}`
    const collected = this.aggregateCollect.get(key) ?? new Map<number, unknown>()
    this.aggregateCollect.delete(key)
    const total = typeof token.value === 'number' && token.value >= 0 ? token.value : collected.size
    const items: unknown[] = []
    const missingIndices: number[] = []
    for (let i = 0; i < total; i++) {
      if (collected.has(i)) items.push(collected.get(i))
      else missingIndices.push(i)
    }
    const act: InternalActivation = {
      nodeId: node.id,
      kind: node.kind,
      scope: token.scope,
      inputs: { items, __aggregate: { total, missingIndices } }
    }
    // The aggregate is triggered by a loop's `done` (a continuation), so it
    // roots a fresh subtree — no parents.
    this.registerActivation(act, [])
    this.queue.push(act)
    this.scopes.enter(token.scope)
  }

  private registerPorts(overrides?: Map<RuntimeId, PortSpec[]>): void {
    for (const node of this.scenario.nodes) {
      const override = overrides?.get(node.id)
      if (override) {
        this.buffer.registerNode(node.id, override)
        continue
      }
      // Edge-driven requiredness: a port is "required" (the node waits
      // for it) only when it has an incoming edge. Ports with no wire
      // are not awaited — so a node fires once every WIRED input has a
      // token. All ports latch (withLatestFrom). Register EVERY wired
      // port id — including derived slot ports (`pathParams:<key>`,
      // `headers:<key>`, …) that aren't in the node's persisted
      // `inputs` array — so a token routed to a slot port actually
      // matches. An unwired node never reaches the buffer (it's a
      // root, seeded directly).
      const wired = this.incomingPortsByNode.get(node.id) ?? new Set<string>()
      const sourcesByPort = this.incomingSourcesByNodePort.get(node.id)
      const spec: PortSpec[] = [...wired].map((portId) => {
        const sources = [...(sourcesByPort?.get(portId) ?? [])]
        // AND-join barrier: ONLY the launch trigger `in`, and only when
        // it's fed by several FORWARD edges (no cycle). Then the node
        // waits for every branch and fires once — "wait for several
        // actions to finish before continuing on a common path". Such
        // a barrier consumes its branch tokens (no latch).
        //
        // Everything else keeps the classic withLatestFrom MERGE: a
        // port re-fires on each arrival, latching the other ports. This
        // is what loops rely on (a loop-back edge merges into a data
        // port — or into `in` — and must re-trigger, not deadlock
        // waiting for a token that only exists after it fires).
        if (portId === 'in' && sources.length > 1 && this.isForwardFanIn(node.id, sources)) {
          return { portId, required: true, latch: false, sources }
        }
        return { portId, required: true, latch: true }
      })
      this.buffer.registerNode(node.id, spec)
    }
  }

  /** A multi-edge `in` port is an AND-join barrier only when none of
   * its incoming edges closes a loop — i.e. the target node cannot
   * reach any source node by following edges forward. A loop-back edge
   * (target reaches source) means this `in` is a loop merge point and
   * must keep fire-on-each MERGE semantics, or the barrier would
   * deadlock waiting for a token produced only after it fires. */
  private isForwardFanIn(targetNodeId: string, sources: string[]): boolean {
    for (const src of sources) {
      // `src` is `${fromNodeId}:${fromPort}`; match it back to the edge
      // it came from rather than parsing colons (port ids may contain
      // them, e.g. `output:name`).
      const srcNode = this.scenario.edges.find((e) => `${e.from.nodeId}:${e.from.portId}` === src)?.from.nodeId
      if (srcNode !== undefined && this.reachableForward(targetNodeId, srcNode)) return false
    }
    return true
  }

  /** Is `to` reachable from `from` by following edges forward (BFS over
   * the node adjacency)? Used to spot loop-back edges. */
  private reachableForward(from: string, to: string): boolean {
    const adj = new Map<string, string[]>()
    for (const e of this.scenario.edges) {
      const arr = adj.get(e.from.nodeId) ?? []
      arr.push(e.to.nodeId)
      adj.set(e.from.nodeId, arr)
    }
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length > 0) {
      const cur = stack.pop()
      if (cur === undefined) break
      for (const next of adj.get(cur) ?? []) {
        if (next === to) return true
        if (!seen.has(next)) { seen.add(next); stack.push(next) }
      }
    }
    return false
  }

  private terminateIfDone(): void {
    if (this.state === 'completed' || this.state === 'cancelled' || this.state === 'failed') {
      this.flushWaiters()
      return
    }
    if (this.queue.length > 0 || this.inFlight > 0 || this.pendingReentry > 0) return
    this.state = 'completed'
    this.logRunBoundary('end')
    this.emit({ type: 'run-completed', runId: this.runId, at: now() })
    this.flushWaiters()
  }

  private fail(reason: string): void {
    if (this.state === 'completed' || this.state === 'cancelled' || this.state === 'failed') return
    this.state = 'failed'
    this.queue = []
    this.logRunBoundary('end', 'failed')
    this.abortCtl.abort(reason)
    this.emit({ type: 'run-failed', runId: this.runId, at: now(), error: reason })
    this.flushWaiters()
  }

  /** A scenario-boundary log entry (started / ended), `source: 'run'` so the
   * inspector shows it by default — a run that produced no user `log` entries
   * (e.g. a loop whose condition was false at once) still shows it ran + ended,
   * and a sub-scenario's own start/end nest in the run tree. */
  private logRunBoundary(phase: 'start' | 'end', outcome?: string): void {
    const name = this.scenario.name && this.scenario.name.trim() !== '' ? this.scenario.name : 'scénario'
    const message = phase === 'start' ? `▶ ${name}` : `■ ${name}${outcome !== undefined ? ` (${outcome})` : ''}`
    this.log.push({ ts: now(), runId: this.runId, level: 'info', source: 'run', message })
  }

  /** Surface a single-field input request to the renderer + return a
   * Promise the input executor awaits. Cancellation via the run's
   * AbortSignal rejects pending requests so the executor unwinds. */
  private openUserInputRequest(nodeId: string, req: { name: string; defaultValue: unknown; hint: 'string' | 'number' | 'boolean' | 'object'; valueType?: unknown }): Promise<unknown> {
    const requestId = `${this.runId}:input:${++this.userInputSeq}`
    return new Promise<unknown>((resolve, reject) => {
      const info: PendingUserInputInfo = {
        requestId,
        nodeId,
        name: req.name,
        defaultValue: req.defaultValue,
        hint: req.hint,
        ...(req.valueType !== undefined ? { valueType: req.valueType } : {})
      }
      this.pendingInputRequests.set(requestId, { resolve, reject, info })
      this.emit({
        type: 'user-input-requested',
        runId: this.runId,
        nodeId,
        requestId,
        name: req.name,
        defaultValue: req.defaultValue,
        hint: req.hint,
        ...(req.valueType !== undefined ? { valueType: req.valueType } : {}),
        at: now()
      })
      // If the run aborts while we wait, reject so the executor's
      // `try/catch` lands cleanly.
      const onAbort = (): void => {
        const pending = this.pendingInputRequests.get(requestId)
        if (!pending) return
        this.pendingInputRequests.delete(requestId)
        pending.reject(new Error('cancelled'))
      }
      this.abortCtl.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Resolve a pending input request with the user-confirmed value.
   * Called from the IPC bridge after the renderer's modal submits. */
  resolveUserInput(requestId: string, value: unknown): void {
    const pending = this.pendingInputRequests.get(requestId)
    if (!pending) return
    this.pendingInputRequests.delete(requestId)
    pending.resolve(value)
  }

  /** Reject a pending input request because the user cancelled the prompt.
   * The input executor's `await` throws, which the run loop routes to the
   * node's `error` output (or fails the run if `error` is unwired) — the
   * same path as any executor error. Distinct from a run abort (Stop):
   * cancelling one prompt is a node-level error, not a run teardown. */
  cancelUserInput(requestId: string): void {
    const pending = this.pendingInputRequests.get(requestId)
    if (!pending) return
    this.pendingInputRequests.delete(requestId)
    pending.reject(new Error('Input cancelled by user'))
  }

  /** The input prompts this run is currently awaiting (an interactive run that
   * hit an `input` node). Lets a non-UI consumer (the MCP status tool) SEE the
   * pending question and answer it via {@link resolveUserInput}. */
  pendingUserInputs(): PendingUserInputInfo[] {
    return [...this.pendingInputRequests.values()].map((p) => p.info)
  }

  private findNode(nodeId: string): typeof this.scenario.nodes[number] {
    const n = this.scenario.nodes.find((x) => x.id === nodeId)
    if (!n) throw new Error(`scheduler: unknown node id ${nodeId}`)
    return n
  }

  private completionPromise(): Promise<void> {
    if (this.state === 'completed' || this.state === 'cancelled' || this.state === 'failed') return Promise.resolve()
    return new Promise<void>((resolve) => { this.completionWaiters.push(resolve) })
  }

  private flushWaiters(): void {
    const ws = this.completionWaiters.splice(0)
    for (const w of ws) w()
  }
}

function now(): string {
  return new Date().toISOString()
}

function randomId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function deepClone<T>(v: T): T {
  if (v === undefined) return v
  return structuredClone(v)
}

/** Snapshot a value for a log entry's `data` (so the inspector can render
 * it as a tree). Cloned so a later in-place mutation by the executor can't
 * rewrite the logged value; never throws (a non-cloneable value collapses
 * to a marker instead of breaking the dispatch / the IPC event send). */
function logData(v: unknown): unknown {
  try { return structuredClone(v) } catch { return '[unserializable]' }
}

// Suppress unused-import warning: ScopeFrame is part of the public
// type surface (used via Activation.scope).
export type { ScopeFrame, ScopeStack, Activation, EngineEvent, Emission, NodeExecutor }
