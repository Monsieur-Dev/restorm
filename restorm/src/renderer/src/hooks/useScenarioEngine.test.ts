import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenarioEngine, type EngineEventLike } from './useScenarioEngine'

/**
 * The yellow "paused-here" frame must mark the box that was IN FLIGHT at the
 * pause — never a box (and its successor) that finished just before it. A fast
 * pure-node chain drains in a microtask burst, so its boxes' min-duration beam
 * removals can fire DURING a slightly-later pause; the frame must not latch onto
 * them. These tests drive the hook's event stream directly to pin that down.
 */

type Emit = (e: EngineEventLike) => void

describe('useScenarioEngine — yellow "paused-here" frame', () => {
  let cb: Emit | null = null
  let emit: Emit

  beforeEach(() => {
    vi.useFakeTimers()
    cb = null
    emit = (e) => { act(() => { cb?.(e) }) }
    const runtime = {
      onScenarioEngineEvent: (fn: Emit): (() => void) => { cb = fn; return () => { cb = null } }
    }
    ;(window as unknown as { restorm?: { runtime?: typeof runtime } }).restorm = { runtime }
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { restorm?: unknown }).restorm
  })

  const MIN_BEAM_MS = 600
  const startRun = (): void => {
    emit({ type: 'run-started', scenarioId: 'scn-1', launcherScenarioId: 'scn-1', runId: 'r1' })
  }

  it('does NOT frame a box (or its successor) that finished BEFORE the pause', () => {
    const { result } = renderHook(() => useScenarioEngine('scn-1'))
    startRun()
    // A fast transform → log chain drains, both completing before the pause.
    emit({ type: 'node-started', runId: 'r1', nodeId: 'transform' })
    emit({ type: 'node-completed', runId: 'r1', nodeId: 'transform' })
    emit({ type: 'node-started', runId: 'r1', nodeId: 'log' })
    emit({ type: 'node-completed', runId: 'r1', nodeId: 'log' })
    // The pause lands afterwards; the held beam removals then fire during it.
    emit({ type: 'run-paused', runId: 'r1' })
    act(() => { vi.advanceTimersByTime(MIN_BEAM_MS) })

    expect(result.current.state).toBe('paused')
    expect([...result.current.completedNodeIds]).toEqual([])
  })

  it('frames the box that finished WHILE paused (the in-flight box at the pause)', () => {
    const { result } = renderHook(() => useScenarioEngine('scn-1'))
    startRun()
    emit({ type: 'node-started', runId: 'r1', nodeId: 'fight' })
    emit({ type: 'run-paused', runId: 'r1' })
    // The slow request was still running at the pause and lands afterwards.
    emit({ type: 'node-completed', runId: 'r1', nodeId: 'fight' })
    act(() => { vi.advanceTimersByTime(MIN_BEAM_MS) })

    expect([...result.current.completedNodeIds]).toEqual(['fight'])
  })

  it('drops the frame when the run resumes during the beam hold (no straggler)', () => {
    const { result } = renderHook(() => useScenarioEngine('scn-1'))
    startRun()
    emit({ type: 'node-started', runId: 'r1', nodeId: 'fight' })
    emit({ type: 'run-paused', runId: 'r1' })
    emit({ type: 'node-completed', runId: 'r1', nodeId: 'fight' })
    // Resume before the beam's min-duration hold elapses — the frame must clear.
    emit({ type: 'run-resumed', runId: 'r1' })
    act(() => { vi.advanceTimersByTime(MIN_BEAM_MS) })

    expect([...result.current.completedNodeIds]).toEqual([])
  })
})
