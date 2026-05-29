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

/**
 * Hard-cap on activations executed in a single run. Protects against
 * a malformed graph that fans out without bound (a cycle whose `if`
 * never reaches `else`). Per-run override possible via `RunOptions`.
 */
const DEFAULT_MAX_ACTIVATIONS = 10_000

export interface RunOptions {
  /** Params for the scenario's `input` nodes (keyed by param name). */
  params?: Record<string, unknown>
  /** Override the run-wide max activations safety net. */
  maxActivations?: number
  /** Begin paused — first `resume()` ticks the first activation. */
  startPaused?: boolean
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
  runSubScenario?: (scenarioId: RuntimeId, params: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** Optional input-port spec override. By default each node's
   * required inputs come from the persisted `inputs` array. */
  portSpecOverrides?: Map<RuntimeId, PortSpec[]>
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
  private readonly outgoingByPort = new Map<string, { edgeId: string; toNodeId: string; toPort: string }[]>()
  private readonly runSubScenario?: SchedulerInit['runSubScenario']

  private queue: InternalActivation[] = []
  private state: State = 'idle'
  private inFlight = 0
  private tokenSeq = 0
  private activations = 0
  private maxActivations = DEFAULT_MAX_ACTIVATIONS
  private completionWaiters: (() => void)[] = []

  constructor(init: SchedulerInit) {
    this.runId = randomId()
    this.scenario = init.scenario
    this.executors = init.executors
    if (init.runSubScenario) this.runSubScenario = init.runSubScenario
    this.registerPorts(init.portSpecOverrides)
    this.indexEdges()
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
    this.seedRoots(opts.params ?? {})
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
        this.handleExecResult(act, result)
        this.emit({ type: 'node-completed', runId: this.runId, nodeId: act.nodeId, scope: act.scope, at: now(), outputs: result.outputs })
      } catch (err) {
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
      // `each` port emits one token per item, with the scope stack
      // extended by `(forEachNodeId, index)`.
      const eachEdges = this.outgoingByPort.get(`${act.nodeId}:each`) ?? []
      for (let i = 0; i < action.items.length; i++) {
        const child: ScopeStack = [...act.scope, { scopeNodeId: act.nodeId, index: i }]
        for (const edge of eachEdges) {
          this.enqueueToken({
            value: deepClone(action.items[i]),
            fromNodeId: act.nodeId,
            fromPort: 'each',
            toNodeId: edge.toNodeId,
            toPort: edge.toPort,
            scope: child,
            tokenId: ++this.tokenSeq
          })
          this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
        }
      }
      // The `done` port fires when the scope closes.
      this.scopes.onClose(act.scope, () => {
        const doneEdges = this.outgoingByPort.get(`${act.nodeId}:done`) ?? []
        for (const edge of doneEdges) {
          this.enqueueToken({
            value: action.items.length,
            fromNodeId: act.nodeId,
            fromPort: 'done',
            toNodeId: edge.toNodeId,
            toPort: edge.toPort,
            scope: act.scope,
            tokenId: ++this.tokenSeq
          })
          this.emit({ type: 'data-flow-emitted', runId: this.runId, edgeId: edge.edgeId, tokenId: this.tokenSeq, at: now() })
        }
      })
      return
    }
    // Plain emissions: route each one to the edges leaving the port.
    for (const out of result.outputs) {
      const edges = this.outgoingByPort.get(`${act.nodeId}:${out.port}`) ?? []
      for (const edge of edges) {
        this.enqueueToken({
          value: deepClone(out.value),
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

  /** Push a token into the buffer; if a node becomes fireable, queue
   * an activation. */
  private enqueueToken(token: Token): void {
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

  /** Seed the queue with root activations (no required inputs) +
   * `input` nodes (parameters from the run options). */
  private seedRoots(params: Record<string, unknown>): void {
    for (const node of this.scenario.nodes) {
      const requiredInputs = node.inputs.filter(isRequiredInput)
      if (requiredInputs.length > 0) continue
      // `input` nodes are special: their config carries the param
      // name + a default. The seed activation's inputs map contains
      // the resolved value so the executor doesn't need to read
      // params separately.
      const seedInputs: Record<string, unknown> = {}
      if (node.kind === 'input') {
        const cfg = node.config as { name?: string; value?: unknown; valueType?: unknown }
        const paramName = typeof cfg.name === 'string' ? cfg.name : ''
        seedInputs['value'] = paramName !== '' && paramName in params ? params[paramName] : (cfg.value ?? cfg.valueType)
      }
      this.queue.push({ nodeId: node.id, kind: node.kind, scope: [], inputs: seedInputs })
      this.scopes.enter([])
    }
  }

  /** Build the (port → outgoing edges) index once per run. */
  private indexEdges(): void {
    for (const e of this.scenario.edges) {
      const k = `${e.from.nodeId}:${e.from.portId}`
      const arr = this.outgoingByPort.get(k) ?? []
      arr.push({ edgeId: e.id, toNodeId: e.to.nodeId, toPort: e.to.portId })
      this.outgoingByPort.set(k, arr)
    }
  }

  private registerPorts(overrides?: Map<RuntimeId, PortSpec[]>): void {
    for (const node of this.scenario.nodes) {
      const override = overrides?.get(node.id)
      if (override) {
        this.buffer.registerNode(node.id, override)
        continue
      }
      // Default: every persisted input port is required + latched.
      // The data ports are latched (`withLatestFrom`); the engine
      // doesn't currently distinguish a header `in` flow port (the
      // editor draws one but the runner treats it like any other
      // required input).
      const spec: PortSpec[] = node.inputs.map((p) => ({
        portId: p.id,
        required: p.role !== 'optional' && p.role !== 'aux',
        latch: true
      }))
      this.buffer.registerNode(node.id, spec)
    }
  }

  private terminateIfDone(): void {
    if (this.state === 'completed' || this.state === 'cancelled' || this.state === 'failed') {
      this.flushWaiters()
      return
    }
    if (this.queue.length > 0 || this.inFlight > 0) return
    this.state = 'completed'
    this.emit({ type: 'run-completed', runId: this.runId, at: now() })
    this.flushWaiters()
  }

  private fail(reason: string): void {
    if (this.state === 'completed' || this.state === 'cancelled' || this.state === 'failed') return
    this.state = 'failed'
    this.queue = []
    this.abortCtl.abort(reason)
    this.emit({ type: 'run-failed', runId: this.runId, at: now(), error: reason })
    this.flushWaiters()
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

function isRequiredInput(port: { role?: string }): boolean {
  return port.role !== 'optional' && port.role !== 'aux'
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

// Suppress unused-import warning: ScopeFrame is part of the public
// type surface (used via Activation.scope).
export type { ScopeFrame, ScopeStack, Activation, EngineEvent, Emission, NodeExecutor }
