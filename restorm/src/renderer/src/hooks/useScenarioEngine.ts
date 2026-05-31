/**
 * useScenarioEngine — renderer-side controller for the Phase 2
 * dataflow engine.
 *
 * Owns the lifecycle of a single in-flight run for the scenario the
 * inspector is pointed at: tracks runId + state, exposes
 * start/pause/resume/step/abort, and subscribes to engine events so
 * the editor can drive node animations + edge beams off them.
 *
 * The animations themselves live on the node / edge components and
 * react to flags carried via the node's running flag + the edge's
 * `data.debugToken` — this hook flips those in response to incoming events.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type RunState = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'

export interface EngineEventLike {
  type: string
  runId?: string
  /** The run's OWN scenario (only on `run-started`). For a top-level run
   * this equals `launcherScenarioId`; for a sub-scenario run it's the
   * sub's id while the launcher stays the parent's. */
  scenarioId?: string
  /** Top-level scenario that launched the run (sub-scenario events
   * inherit it). The editor animates only when this matches its own id. */
  launcherScenarioId?: string
  nodeId?: string
  edgeId?: string
  tokenId?: number
  requestId?: string
  name?: string
  defaultValue?: unknown
  hint?: 'string' | 'number' | 'boolean' | 'object'
}

export interface PendingUserInput {
  requestId: string
  nodeId: string
  name: string
  defaultValue: unknown
  hint: 'string' | 'number' | 'boolean' | 'object'
}

interface Bridge {
  scenarioEngineStart?: (scenarioId: string, params?: Record<string, unknown>, startPaused?: boolean, breakpoints?: string[], debug?: boolean) => Promise<{ runId: string }>
  scenarioEnginePause?: (runId: string) => Promise<{ ok: boolean }>
  scenarioEngineResume?: (runId: string) => Promise<{ ok: boolean }>
  scenarioEngineStep?: (runId: string) => Promise<{ ok: boolean }>
  scenarioEngineSetDebug?: (runId: string, enabled: boolean) => Promise<{ ok: boolean }>
  scenarioEngineSetBreakpoints?: (runId: string, ids: string[]) => Promise<{ ok: boolean }>
  scenarioEngineAbort?: (runId: string, reason?: string) => Promise<{ ok: boolean }>
  scenarioEngineResolveUserInput?: (runId: string, requestId: string, value: unknown) => Promise<{ ok: boolean }>
  scenarioEngineCancelUserInput?: (runId: string, requestId: string) => Promise<{ ok: boolean }>
  scenarioEngineRunTree?: (runId: string) => Promise<unknown[]>
  onScenarioEngineEvent?: (cb: (event: EngineEventLike) => void) => () => void
}

/** One run-log line surfaced to the inspector. Mirrors the engine's
 * `RunLogEntry` plus the `scenarioId` of the (sub-)run it came from. */
export interface ScenarioLogEntry {
  ts: string
  runId?: string
  scenarioId?: string
  level?: 'debug' | 'info' | 'warn' | 'error'
  source?: 'engine' | 'user' | 'run'
  nodeId?: string
  message: string
  data?: unknown
}

function bridge(): Bridge | undefined {
  return (window as { restorm?: { runtime?: Bridge } }).restorm?.runtime
}

export interface UseScenarioEngineResult {
  state: RunState
  runId: string | null
  /** Set of node ids currently running. Drives the BorderBeam on each
   * box; events flip the membership. */
  runningNodeIds: ReadonlySet<string>
  /** Node ids that completed since the last play — drives the yellow
   * "just finished" frame. Cleared on play / resume. */
  completedNodeIds: ReadonlySet<string>
  /** The node a debug run is paused AT due to a BREAKPOINT (not yet executed),
   * or null. Drives the "breakpoint reached" tooltip specifically. */
  breakpointNodeId: string | null
  /** The node the run is paused right BEFORE entering — set by a breakpoint hit
   * OR a step pre-stop. Drives the yellow frame + pan-zoom onto the about-to-run
   * box. (`breakpointNodeId` is the breakpoint-only subset, for the tooltip.) */
  pausedAtNodeId: string | null
  /** The most recently started node — lets the editor pan-zoom onto each box
   * as the user steps through (and onto the box a breakpoint released into). */
  lastStartedNodeId: string | null
  /** Monotonically-increasing token bump per edge — the
   * `ScenarioDebugBezierEdge` watches `data.debugToken` to fire its
   * single-shot travelling beam. */
  edgeTokens: ReadonlyMap<string, number>
  /** Outstanding `requestUserInput` from a mid-run `input` node. The
   * UI consumes the head of the list, prompts the user, and calls
   * `resolveUserInput` to dequeue + send the answer back. */
  pendingInputs: readonly PendingUserInput[]
  /** Chronological log of the current (or last) run — the whole run
   * tree merged (parent + sub-scenario runs). Drives the inspector's
   * run-logs panel. */
  runLog: readonly ScenarioLogEntry[]
  /** Clear the displayed run log (the inspector's "clear logs" action). */
  clearRunLog: () => void
  start: (scenarioId: string, params?: Record<string, unknown>, startPaused?: boolean, breakpoints?: string[], debug?: boolean) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  step: () => Promise<void>
  /** Turn the live run into a debug run (Debug pressed mid-run) so it starts
   * honoring breakpoints. No-op when there's no active run. */
  enableDebug: () => Promise<void>
  /** Push the current breakpoint set onto the live run (a breakpoint was
   * toggled during execution). No-op when there's no active run. */
  setEngineBreakpoints: (ids: string[]) => Promise<void>
  stop: () => Promise<void>
  resolveUserInput: (requestId: string, value: unknown) => Promise<void>
  /** Cancel a pending mid-run input prompt. The engine routes the input
   * node to its `error` output (or fails the run if `error` is unwired). */
  cancelUserInput: (requestId: string) => Promise<void>
}

export function useScenarioEngine(scenarioId: string): UseScenarioEngineResult {
  const [state, setState] = useState<RunState>('idle')
  const [runId, setRunId] = useState<string | null>(null)
  // A `while`/`doWhile` loop node stays lit for the WHOLE loop because the
  // scheduler defers its `node-completed` until the loop exits (like forEach),
  // so the beam tracking below needs no special loop handling.
  const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(new Set())
  // Node ids that have COMPLETED since the last play — a yellow "just finished"
  // frame stays on them (a progress marker, handy while paused). Cleared on the
  // next play / resume; a node that re-runs drops out of the set while it runs.
  const [completedNodeIds, setCompletedNodeIds] = useState<Set<string>>(new Set())
  // The node a debug run is paused AT (breakpoint hit). Distinct from
  // `completedNodeIds` because the broken node has NOT executed yet.
  const [breakpointNodeId, setBreakpointNodeId] = useState<string | null>(null)
  // The node we're paused right before entering (breakpoint OR step pre-stop) —
  // drives the yellow frame + pan-zoom.
  const [pausedAtNodeId, setPausedAtNodeId] = useState<string | null>(null)
  // The latest node to fire `node-started` — drives step-by-step pan-zoom.
  const [lastStartedNodeId, setLastStartedNodeId] = useState<string | null>(null)
  const [edgeTokens, setEdgeTokens] = useState<Map<string, number>>(new Map())
  const [pendingInputs, setPendingInputs] = useState<PendingUserInput[]>([])
  const [runLog, setRunLog] = useState<ScenarioLogEntry[]>([])
  // Mirror runId into a ref via useEffect — never assign during
  // render. The ref lets the event subscription (which closes over a
  // stale state at mount time) read the latest value.
  const runIdRef = useRef<string | null>(null)
  useEffect(() => { runIdRef.current = runId }, [runId])
  // Mirror the paused-at node so the event subscription can tell when a
  // `node-started` belongs to the node we were paused before (stepped into it).
  const pausedAtNodeIdRef = useRef<string | null>(null)
  useEffect(() => { pausedAtNodeIdRef.current = pausedAtNodeId }, [pausedAtNodeId])
  // The scenario this editor shows — used to gate animations to runs
  // launched FROM this scenario (read via ref so the subscription needn't
  // re-bind when the id changes).
  const scenarioIdRef = useRef<string>(scenarioId)
  useEffect(() => { scenarioIdRef.current = scenarioId }, [scenarioId])
  // The runId of the TOP-LEVEL run launched for THIS scenario. Every
  // event is gated to it, so a sub-scenario run (same launcher, different
  // runId) can't drive this tab — in particular its `run-completed`
  // must not clear the parent's beams when the first sub finishes.
  const topRunIdRef = useRef<string | null>(null)

  // Minimum on-screen time for a node's running "beam". Many nodes
  // (forEach, input, arithmetic, …) complete in a single microtask —
  // their `node-started` / `node-completed` events arrive back-to-back,
  // so without a floor the beam is added + removed before a frame ever
  // paints and the user sees no feedback at all. We keep a node lit for
  // at least this long; a node that genuinely runs longer (httpRequest,
  // wait, runScenario) stays lit until its real completion.
  const MIN_BEAM_MS = 600
  const beamStartRef = useRef<Map<string, number>>(new Map())
  const beamRemovalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // A node can have several concurrent activations (e.g. one `runScenario`
  // box invoked once per `forEach` item). Reference-count them so the beam
  // stays lit until the LAST occurrence finishes, not the first.
  const beamCountRef = useRef<Map<string, number>>(new Map())
  // True only between `run-paused` and the next `run-resumed`/end. A box earns
  // the yellow "just finished" frame ONLY if its completion lands while paused
  // — i.e. it was the in-flight box AT the pause, not one finished earlier.
  const pausedRef = useRef(false)
  const clearBeamTimers = useCallback(() => {
    for (const t of beamRemovalTimersRef.current.values()) clearTimeout(t)
    beamRemovalTimersRef.current.clear()
    beamStartRef.current.clear()
    beamCountRef.current.clear()
  }, [])

  useEffect(() => {
    const sub = bridge()?.onScenarioEngineEvent?.((event) => {
      // A scenario tab reacts ONLY to the TOP-LEVEL run launched for ITS
      // scenario. The top-level run is the one whose own `scenarioId` AND
      // `launcherScenarioId` both equal this tab's scenario. We latch its
      // runId at `run-started` and gate every other event to it. This:
      //  - keeps a sub-scenario's own tab dark while a parent runs it (the
      //    sub's launcher is the parent, not this tab);
      //  - stops a sub-scenario's `run-completed` from clearing THIS tab's
      //    beams the instant the first sub finishes (the bug where the
      //    forEach animation ended after the first item).
      if (event.type === 'run-started') {
        if (event.scenarioId === scenarioIdRef.current && event.launcherScenarioId === scenarioIdRef.current) {
          topRunIdRef.current = event.runId ?? null
          setRunId(event.runId ?? null)
          setState('running')
          pausedRef.current = false
          clearBeamTimers()
          setRunningNodeIds(new Set())
          setCompletedNodeIds(new Set())
          setBreakpointNodeId(null)
          setPausedAtNodeId(null)
          setLastStartedNodeId(null)
          setEdgeTokens(new Map())
          // Clear the previous run's logs the moment a new run starts, so the
          // inspector panel doesn't show stale entries until the first poll.
          setRunLog([])
        }
        return
      }
      if (topRunIdRef.current === null || event.runId !== topRunIdRef.current) return
      switch (event.type) {
        case 'run-paused':
          setState('paused')
          // From now until resume, a box that finishes was the one running at
          // the pause → it'll earn the yellow frame.
          pausedRef.current = true
          break
        case 'run-resumed':
          setState('running')
          pausedRef.current = false
          // Resuming = the next "play": wipe the yellow just-finished frames +
          // the paused-at marker (we're moving past it).
          setCompletedNodeIds(new Set())
          setBreakpointNodeId(null)
          setPausedAtNodeId(null)
          break
        case 'breakpoint-hit':
          // Debug run paused right before entering this node (not executed yet):
          // frame it yellow, pan-zoom onto it, and show the "breakpoint reached"
          // tooltip (breakpointNodeId drives the tooltip; pausedAtNodeId the frame).
          // Clear prior just-finished frames so EXACTLY one box is yellow.
          setState('paused')
          pausedRef.current = true
          setCompletedNodeIds(new Set())
          if (event.nodeId !== undefined) { setBreakpointNodeId(event.nodeId); setPausedAtNodeId(event.nodeId) }
          break
        case 'step-paused':
          // Stepping paused right before entering this node — frame + pan-zoom,
          // but NO breakpoint tooltip (it isn't a breakpoint). Clear prior
          // just-finished frames so EXACTLY one box is yellow at a time.
          setState('paused')
          pausedRef.current = true
          setCompletedNodeIds(new Set())
          if (event.nodeId !== undefined) setPausedAtNodeId(event.nodeId)
          break
        case 'run-completed':
          setState('completed')
          pausedRef.current = false
          clearBeamTimers()
          setRunningNodeIds(new Set())
          setBreakpointNodeId(null)
          setPausedAtNodeId(null)
          break
        case 'run-cancelled':
          setState('cancelled')
          pausedRef.current = false
          clearBeamTimers()
          setRunningNodeIds(new Set())
          setBreakpointNodeId(null)
          setPausedAtNodeId(null)
          break
        case 'run-failed':
          setState('failed')
          pausedRef.current = false
          clearBeamTimers()
          setRunningNodeIds(new Set())
          setBreakpointNodeId(null)
          setPausedAtNodeId(null)
          break
        case 'node-started': {
          const id = event.nodeId
          if (id !== undefined) {
            // Cancel a pending min-duration removal if the node re-runs
            // (loop / next occurrence), and bump the concurrent count.
            const pending = beamRemovalTimersRef.current.get(id)
            if (pending) { clearTimeout(pending); beamRemovalTimersRef.current.delete(id) }
            const count = (beamCountRef.current.get(id) ?? 0) + 1
            beamCountRef.current.set(id, count)
            if (count === 1) beamStartRef.current.set(id, Date.now())
            setRunningNodeIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
            setLastStartedNodeId(id)
            // Stepped/resumed INTO the node we were paused before — it's running
            // now, so drop the paused-at marker (frame) + any breakpoint tooltip.
            if (id === pausedAtNodeIdRef.current) { setPausedAtNodeId(null); setBreakpointNodeId(null) }
            // A box starting while paused means we STEPPED forward — the front
            // advanced, so wipe the previous yellow frames (only the box about
            // to finish stays the "current" one). Outside a pause, just drop
            // this box's own leftover frame (it's running again).
            if (pausedRef.current) {
              setCompletedNodeIds((prev) => (prev.size === 0 ? prev : new Set()))
            } else {
              setCompletedNodeIds((prev) => {
                if (!prev.has(id)) return prev
                const next = new Set(prev)
                next.delete(id)
                return next
              })
            }
          }
          break
        }
        case 'node-completed':
        case 'node-failed': {
          const id = event.nodeId
          if (id !== undefined) {
            const count = Math.max(0, (beamCountRef.current.get(id) ?? 1) - 1)
            beamCountRef.current.set(id, count)
            // Other occurrences of this box are still running — keep it lit.
            if (count > 0) break
            const completedOk = event.type === 'node-completed'
            const removeNow = (): void => {
              beamRemovalTimersRef.current.delete(id)
              beamStartRef.current.delete(id)
              beamCountRef.current.delete(id)
              setRunningNodeIds((prev) => {
                if (!prev.has(id)) return prev
                const next = new Set(prev)
                next.delete(id)
                return next
              })
              // Yellow frame only for a successful completion that is STILL
              // paused at beam-end — the box that was running at the pause.
              // Re-checked live (not captured) so a resume during the beam's
              // min-duration hold doesn't leave a straggler frame.
              if (completedOk && pausedRef.current) setCompletedNodeIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
            }
            const elapsed = Date.now() - (beamStartRef.current.get(id) ?? Date.now())
            if (elapsed >= MIN_BEAM_MS) {
              removeNow()
            } else {
              // Hold the beam until it has shown for MIN_BEAM_MS so an
              // instant node (e.g. forEach) still pulses visibly.
              const existing = beamRemovalTimersRef.current.get(id)
              if (existing) clearTimeout(existing)
              beamRemovalTimersRef.current.set(id, setTimeout(removeNow, MIN_BEAM_MS - elapsed))
            }
          }
          break
        }
        case 'data-flow-emitted': {
          const eid = event.edgeId
          if (eid !== undefined) {
            setEdgeTokens((prev) => {
              const next = new Map(prev)
              next.set(eid, (prev.get(eid) ?? 0) + 1)
              return next
            })
          }
          break
        }
        case 'user-input-requested': {
          if (event.requestId && event.nodeId && event.name) {
            const pending: PendingUserInput = {
              requestId: event.requestId,
              nodeId: event.nodeId,
              name: event.name,
              defaultValue: event.defaultValue,
              hint: event.hint ?? 'string'
            }
            setPendingInputs((prev) => [...prev, pending])
          }
          break
        }
        default: break
      }
    })
    return () => { sub?.(); clearBeamTimers() }
  }, [clearBeamTimers])

  // Harvest the run log (whole tree: parent + sub-runs, merged + sorted)
  // for the inspector's logs panel. Sub-scenario activity (fights, waits)
  // doesn't emit parent-run events, so we poll every second while the run
  // is live, plus fetch once on every state change (catches the final
  // snapshot after completion / cancel). The log persists for the LAST
  // run until a new one starts.
  useEffect(() => {
    if (runId === null) return undefined
    let cancelled = false
    const fetchLog = async (): Promise<void> => {
      const tree = await bridge()?.scenarioEngineRunTree?.(runId)
      if (cancelled || runId !== runIdRef.current || !Array.isArray(tree)) return
      const merged: ScenarioLogEntry[] = []
      for (const run of tree) {
        const r = run as { scenarioId?: string; log?: unknown[] }
        for (const raw of r.log ?? []) {
          const e = raw as ScenarioLogEntry
          merged.push({ ...e, ...(r.scenarioId !== undefined ? { scenarioId: r.scenarioId } : {}) })
        }
      }
      merged.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
      setRunLog(merged)
    }
    void fetchLog()
    if (state !== 'running' && state !== 'paused') return () => { cancelled = true }
    const interval = setInterval(() => { void fetchLog() }, 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [runId, state])

  const start = useCallback(async (scenarioId: string, params?: Record<string, unknown>, startPaused?: boolean, breakpoints?: string[], debug?: boolean): Promise<void> => {
    const b = bridge()
    if (!b?.scenarioEngineStart) return
    const { runId: newRunId } = await b.scenarioEngineStart(scenarioId, params, startPaused, breakpoints, debug)
    // Latch the top-level runId so node/run events gate to this run. Set
    // `runIdRef` SYNCHRONOUSLY too (not only via the [runId] effect): a
    // step-from-idle does `await start(); await step()` back-to-back, and
    // `step`/`pause`/`stop` read `runIdRef.current` — the effect that mirrors
    // `runId` hasn't run yet by then, so without this the immediate `step()`
    // targets a stale/null runId and silently no-ops.
    topRunIdRef.current = newRunId
    runIdRef.current = newRunId
    setRunId(newRunId)
    // Armed in step mode → paused; otherwise running. (The engine also emits
    // run-started + run-paused, but set it here so it's right regardless of
    // event-vs-await ordering.)
    setState(startPaused === true ? 'paused' : 'running')
    pausedRef.current = startPaused === true
    // DON'T reset the animation state (runningNodeIds / edgeTokens / runLog)
    // here. The `run-started` event already cleared it — and crucially does so
    // BEFORE any `node-started`. Clearing AFTER this `await` would wipe the
    // beams of ROOT nodes (e.g. a `doWhile`) that fired during the await,
    // which is why a UI-launched run showed no beam on the loop node while an
    // MCP-launched run (no `start` callback) did.
  }, [])

  const pause = useCallback(async (): Promise<void> => {
    const id = runIdRef.current
    if (id === null) return
    await bridge()?.scenarioEnginePause?.(id)
  }, [])

  const resume = useCallback(async (): Promise<void> => {
    const id = runIdRef.current
    if (id === null) return
    await bridge()?.scenarioEngineResume?.(id)
  }, [])

  const enableDebug = useCallback(async (): Promise<void> => {
    const id = runIdRef.current
    if (id === null) return
    await bridge()?.scenarioEngineSetDebug?.(id, true)
  }, [])

  const setEngineBreakpoints = useCallback(async (ids: string[]): Promise<void> => {
    const id = runIdRef.current
    if (id === null) return
    await bridge()?.scenarioEngineSetBreakpoints?.(id, ids)
  }, [])

  const step = useCallback(async (): Promise<void> => {
    const id = runIdRef.current
    if (id === null) return
    await bridge()?.scenarioEngineStep?.(id)
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    const id = runIdRef.current
    if (id === null) return
    await bridge()?.scenarioEngineAbort?.(id, 'user-stop')
  }, [])

  const resolveUserInput = useCallback(async (requestId: string, value: unknown): Promise<void> => {
    const id = runIdRef.current
    if (id === null) return
    await bridge()?.scenarioEngineResolveUserInput?.(id, requestId, value)
    setPendingInputs((prev) => prev.filter((p) => p.requestId !== requestId))
  }, [])

  const cancelUserInput = useCallback(async (requestId: string): Promise<void> => {
    const id = runIdRef.current
    if (id === null) return
    await bridge()?.scenarioEngineCancelUserInput?.(id, requestId)
    setPendingInputs((prev) => prev.filter((p) => p.requestId !== requestId))
  }, [])

  const clearRunLog = useCallback((): void => { setRunLog([]) }, [])

  return { state, runId, runningNodeIds, completedNodeIds, breakpointNodeId, pausedAtNodeId, lastStartedNodeId, edgeTokens, pendingInputs, runLog, clearRunLog, start, pause, resume, step, enableDebug, setEngineBreakpoints, stop, resolveUserInput, cancelUserInput }
}
