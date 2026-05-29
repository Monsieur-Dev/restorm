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
 * react to flags carried via `data.runningStatus` /
 * `data.fakeDebugToken` — this hook flips those flags in response to
 * incoming events.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type RunState = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'

export interface EngineEventLike {
  type: string
  runId?: string
  nodeId?: string
  edgeId?: string
  tokenId?: number
}

interface Bridge {
  scenarioEngineStart?: (scenarioId: string, params?: Record<string, unknown>) => Promise<{ runId: string }>
  scenarioEnginePause?: (runId: string) => Promise<{ ok: boolean }>
  scenarioEngineResume?: (runId: string) => Promise<{ ok: boolean }>
  scenarioEngineStep?: (runId: string) => Promise<{ ok: boolean }>
  scenarioEngineAbort?: (runId: string, reason?: string) => Promise<{ ok: boolean }>
  onScenarioEngineEvent?: (cb: (event: EngineEventLike) => void) => () => void
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
  /** Monotonically-increasing token bump per edge — the
   * `ScenarioDebugBezierEdge` watches `data.debugToken` to fire its
   * single-shot travelling beam. */
  edgeTokens: ReadonlyMap<string, number>
  start: (scenarioId: string, params?: Record<string, unknown>) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  step: () => Promise<void>
  stop: () => Promise<void>
}

export function useScenarioEngine(): UseScenarioEngineResult {
  const [state, setState] = useState<RunState>('idle')
  const [runId, setRunId] = useState<string | null>(null)
  const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(new Set())
  const [edgeTokens, setEdgeTokens] = useState<Map<string, number>>(new Map())
  // Mirror runId into a ref via useEffect — never assign during
  // render. The ref lets the event subscription (which closes over a
  // stale state at mount time) read the latest value.
  const runIdRef = useRef<string | null>(null)
  useEffect(() => { runIdRef.current = runId }, [runId])

  useEffect(() => {
    const sub = bridge()?.onScenarioEngineEvent?.((event) => {
      const eventRunId = event.runId
      // Ignore events from sub-scenarios (different runId).
      if (eventRunId !== undefined && runIdRef.current !== null && eventRunId !== runIdRef.current) return
      switch (event.type) {
        case 'run-started':
          setState('running')
          break
        case 'run-paused':
          setState('paused')
          break
        case 'run-resumed':
          setState('running')
          break
        case 'run-completed':
          setState('completed')
          setRunningNodeIds(new Set())
          break
        case 'run-cancelled':
          setState('cancelled')
          setRunningNodeIds(new Set())
          break
        case 'run-failed':
          setState('failed')
          setRunningNodeIds(new Set())
          break
        case 'node-started': {
          const id = event.nodeId
          if (id !== undefined) setRunningNodeIds((prev) => new Set(prev).add(id))
          break
        }
        case 'node-completed':
        case 'node-failed': {
          const id = event.nodeId
          if (id !== undefined) {
            setRunningNodeIds((prev) => {
              if (!prev.has(id)) return prev
              const next = new Set(prev)
              next.delete(id)
              return next
            })
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
        default: break
      }
    })
    return () => { sub?.() }
  }, [])

  const start = useCallback(async (scenarioId: string, params?: Record<string, unknown>): Promise<void> => {
    const b = bridge()
    if (!b?.scenarioEngineStart) return
    const { runId: newRunId } = await b.scenarioEngineStart(scenarioId, params)
    setRunId(newRunId)
    setState('running')
    setRunningNodeIds(new Set())
    setEdgeTokens(new Map())
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

  return { state, runId, runningNodeIds, edgeTokens, start, pause, resume, step, stop }
}
