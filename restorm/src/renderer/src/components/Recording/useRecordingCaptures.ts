import { useEffect, useState } from 'react'
import type { RecordedCallSummary, RecordingRun } from '../../../../shared/types/recordingCapture'

export interface RecordingCapturesState {
  runs: RecordingRun[]
  captures: RecordedCallSummary[]
  loaded: boolean
}

const EMPTY: RecordingCapturesState = { runs: [], captures: [], loaded: false }

interface KeyedState extends RecordingCapturesState {
  sessionId: string
}

/**
 * The live list of a session's runs and captured calls: primed from the
 * main store, then kept current by the pushes (added / updated / removed
 * calls, run changes). Light rows only — a call's detail is fetched on
 * demand by the pane that shows it.
 */
export function useRecordingCaptures(sessionId: string): RecordingCapturesState {
  // Keyed by session: a session switch reads as empty until its own data
  // lands, without a synchronous reset inside the effect.
  const [state, setState] = useState<KeyedState | null>(null)

  useEffect(() => {
    const api = window.restorm?.recording
    if (!api) return undefined
    let cancelled = false
    const forSession = (update: (prev: RecordingCapturesState) => RecordingCapturesState): void => {
      setState((prev) => ({ sessionId, ...update(prev !== null && prev.sessionId === sessionId ? prev : EMPTY) }))
    }
    void Promise.all([api.runs(sessionId), api.list(sessionId)]).then(([runs, captures]) => {
      if (!cancelled) setState({ sessionId, runs, captures, loaded: true })
    })
    const offAdded = api.onCaptureAdded((summary) => {
      if (summary.sessionId !== sessionId) return
      forSession((prev) => ({ ...prev, captures: prev.captures.some((c) => c.id === summary.id) ? prev.captures : [...prev.captures, summary] }))
    })
    const offUpdated = api.onCaptureUpdated((summary) => {
      if (summary.sessionId !== sessionId) return
      forSession((prev) => ({ ...prev, captures: prev.captures.map((c) => (c.id === summary.id ? summary : c)) }))
    })
    const offRemoved = api.onCapturesRemoved((payload) => {
      if (payload.sessionId !== sessionId) return
      const gone = new Set(payload.ids)
      forSession((prev) => ({ ...prev, captures: prev.captures.filter((c) => !gone.has(c.id)) }))
    })
    const offRun = api.onRunChanged((run) => {
      if (run.sessionId !== sessionId) return
      forSession((prev) => ({ ...prev, runs: prev.runs.some((r) => r.id === run.id) ? prev.runs.map((r) => (r.id === run.id ? run : r)) : [...prev.runs, run] }))
    })
    const offRunRemoved = api.onRunRemoved((payload) => {
      if (payload.sessionId !== sessionId) return
      forSession((prev) => ({ ...prev, runs: prev.runs.filter((r) => r.id !== payload.runId) }))
    })
    return () => {
      cancelled = true
      offAdded()
      offUpdated()
      offRemoved()
      offRun()
      offRunRemoved()
    }
  }, [sessionId])

  return state !== null && state.sessionId === sessionId ? state : EMPTY
}
