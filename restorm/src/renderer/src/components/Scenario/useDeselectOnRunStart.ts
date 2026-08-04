import { useEffect, useRef } from 'react'

/** The engine states the inspector's toolbar reports. */
export type ScenarioRunState = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'

/** The only thing this hook needs to know about a graph node. */
interface SelectableNode {
  selected?: boolean
}

/**
 * Clear the graph's box selection the moment a run STARTS, so the inspector
 * leaves the selected box's configuration and shows the run logs — what the
 * user wants to watch the instant a scenario starts.
 *
 * Keyed on the engine's idle→live transition rather than on the toolbar
 * callbacks, so a launch from the keyboard, a step-mode start, a debug run and
 * an externally-triggered run all behave identically.
 *
 * The edge detection is the whole point and is easy to break by accident: a
 * plain `live` check would re-clear on every subsequent render while the run is
 * in flight, undoing a selection the user makes DURING the run (running↔paused
 * flips alone would do it while stepping). The `wasLive` ref is what makes it
 * fire exactly once per run.
 */
export function useDeselectOnRunStart<T extends SelectableNode>(
  engineState: ScenarioRunState | undefined,
  setNodes: (updater: (current: T[]) => T[]) => void
): void {
  const wasLive = useRef(false)
  useEffect(() => {
    const live = engineState === 'running' || engineState === 'paused'
    if (live && !wasLive.current) {
      // Same array back when nothing is selected — no needless re-render of
      // every box at the exact moment the run needs the frame budget.
      setNodes((current) => (
        current.some((node) => node.selected)
          ? current.map((node) => (node.selected ? { ...node, selected: false } : node))
          : current
      ))
    }
    wasLive.current = live
  }, [engineState, setNodes])
}
