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
  RunLogEntry,
  RunStatus,
  RuntimeId,
  ScopeFrame,
  ScopeStack,
  ScenarioModel,
  Token
} from './types'
import { ScopeRegistry } from './scopeRegistry'
import { InputBuffer, type PortSpec } from './inputBuffer'
import { resolveSelectorPath, concreteValue } from '../../shared/utils/scenarioStaticPreview'
import { evaluateCondition } from './conditionEval'

/**
 * No activation cap by default — a scenario can loop intentionally for as
 * long as the user wants (days), stopped only by an explicit Stop. A finite
 * cap is still settable per-run via `RunOptions.maxActivations` (the unit
 * tests use it to assert the runaway-cycle guard still works on demand).
 */
const DEFAULT_MAX_ACTIVATIONS = Number.POSITIVE_INFINITY

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
  private inFlight = 0
  private tokenSeq = 0
  private activations = 0
  private maxActivations = DEFAULT_MAX_ACTIVATIONS
  private completionWaiters: (() => void)[] = []
  private readonly pendingInputRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private userInputSeq = 0
  /** Node ids that have ≥1 incoming edge (so they're NOT roots). */
  private readonly nodesWithIncoming = new Set<string>()
  /** Per node, the set of input port ids that carry an incoming edge. */
  private readonly incomingPortsByNode = new Map<string, Set<string>>()
  /** Per node → port → set of source keys (`${fromNodeId}:${fromPort}`)
   * feeding that port. A port fed by >1 source is an AND-join barrier. */
  private readonly incomingSourcesByNodePort = new Map<string, Map<string, Set<string>>>()

  constructor(init: SchedulerInit) {
    this.runId = randomId()
    this.scenario = init.scenario
    this.executors = init.executors
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
    this.state = opts.startPaused === true ? 'paused' : 'running'
    this.emit({ type: 'run-started', runId: this.runId, scenarioId: this.scenario.id, at: now() })
    this.logRunBoundary('start')
    this.seedRoots(opts.params ?? {}, opts.interactive === true)
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
      this.dispatch(next)
      if (this.stepLatch) {
        this.stepLatch = false
        this.state = 'paused'
        return
      }
    }
    this.terminateIfDone()
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
    this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `start ${act.kind}`, ...(Object.keys(act.inputs).length > 0 ? { data: logData(act.inputs) } : {}) })
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
    for (const out of result.outputs) {
      const edges = this.outgoingByPort.get(`${act.nodeId}:${out.port}`) ?? []
      for (const edge of edges) {
        const routed = edge.selector !== undefined && edge.selector !== ''
          ? resolveSelectorPath(out.value, edge.selector)
          : out.value
        this.enqueueToken({
          value: deepClone(routed),
          fromNodeId: act.nodeId,
          fromPort: out.port,
          toNodeId: edge.toNodeId,
          toPort: edge.toPort,
          scope: act.scope,
          tokenId: ++this.tokenSeq
        })
        this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
      }
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

    const fireElse = (): void => {
      const elseEdges = this.outgoingByPort.get(`${act.nodeId}:else`) ?? []
      for (const edge of elseEdges) {
        this.enqueueToken({ value: iter, fromNodeId: act.nodeId, fromPort: 'else', toNodeId: edge.toNodeId, toPort: edge.toPort, scope: act.scope, tokenId: ++this.tokenSeq })
        this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
      }
      this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `${mode} done after ${iter} iteration(s)` })
      this.emit({ type: 'node-completed', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now(), outputs: [] })
    }

    const openBody = (): void => {
      if (this.abortCtl.signal.aborted) return
      const i = iter
      iter += 1
      const child: ScopeStack = [...act.scope, { scopeNodeId: act.nodeId, index: i }]
      this.log.push({ ts: now(), runId: this.runId, level: 'debug', source: 'engine', nodeId: act.nodeId, scope: act.scope, message: `${mode} iteration ${i}` })
      for (const edge of thenEdges) {
        this.enqueueToken({ value: i, fromNodeId: act.nodeId, fromPort: 'then', toNodeId: edge.toNodeId, toPort: edge.toPort, scope: child, tokenId: ++this.tokenSeq })
        this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
      }
      // Iteration is done when its whole body chain has drained the scope;
      // then re-evaluate and loop while true.
      this.scopes.onClose(child, () => {
        if (this.abortCtl.signal.aborted) return
        if (evalCond()) openBody()
        else fireElse()
      })
    }

    // A loop with no body wired can't iterate — just take the exit branch.
    if (thenEdges.length === 0) { fireElse(); return }
    if (mode === 'doWhile') openBody()
    else if (evalCond()) openBody()
    else fireElse()
  }

  /** Push a token into the buffer; if a node becomes fireable, queue
   * an activation. */
  private enqueueToken(token: Token): void {
    // Once cancelled, accept no new tokens — otherwise a forEach's
    // scope-close handler keeps opening the next item (and its
    // sub-scenario) after a Stop.
    if (this.abortCtl.signal.aborted) return
    const decision = this.buffer.put(token)
    if (!decision) return
    const node = this.scenario.nodes.find((n) => n.id === token.toNodeId)
    if (!node) return
    const inputs: Record<string, unknown> = {}
    for (const portId of Object.keys(decision.tokensByPort)) {
      inputs[portId] = deepClone(decision.tokensByPort[portId]?.value)
    }
    this.buffer.consume(node.id, decision)
    this.queue.push({ nodeId: node.id, kind: node.kind, scope: decision.scope, inputs })
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
        const cfg = node.config as { name?: string; value?: unknown; valueType?: unknown }
        const paramName = typeof cfg.name === 'string' && cfg.name !== '' ? cfg.name : 'value'
        const passthrough = (value: unknown): void => {
          // Emit the `{ [name]: value }` shape the static preview models so a
          // wired selector resolves identically; `seeded` skips the prompt.
          this.queue.push({ nodeId: node.id, kind: node.kind, scope: [], inputs: { value: { [paramName]: value } }, seeded: true })
        }
        if (paramName in params) {
          // A value was supplied up-front — use it, no prompt.
          passthrough(params[paramName])
        } else if (interactive) {
          // UI run, no value — the input RUNS and prompts the user, so it
          // beams and a cancel routes to its `error` output exactly like a
          // mid-run input. The renderer groups these start-time prompts into
          // one "run parameters" modal; the run is live the whole time.
          this.queue.push({ nodeId: node.id, kind: node.kind, scope: [], inputs: {}, seeded: false })
        } else {
          // Headless run (MCP / sub-scenario), no value — fall back to the
          // node's configured default; there's no UI to prompt.
          passthrough(cfg.valueType !== undefined && cfg.valueType !== null ? concreteValue(cfg.valueType) : cfg.value)
        }
        this.scopes.enter([])
        continue
      }
      this.queue.push({ nodeId: node.id, kind: node.kind, scope: [], inputs: {}, seeded: true })
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
    }
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
    if (this.queue.length > 0 || this.inFlight > 0) return
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
  private openUserInputRequest(nodeId: string, req: { name: string; defaultValue: unknown; hint: 'string' | 'number' | 'boolean' | 'object' }): Promise<unknown> {
    const requestId = `${this.runId}:input:${++this.userInputSeq}`
    return new Promise<unknown>((resolve, reject) => {
      this.pendingInputRequests.set(requestId, { resolve, reject })
      this.emit({
        type: 'user-input-requested',
        runId: this.runId,
        nodeId,
        requestId,
        name: req.name,
        defaultValue: req.defaultValue,
        hint: req.hint,
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
