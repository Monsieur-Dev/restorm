import { createContext, useContext } from 'react'

/**
 * Lets a data link's receiving input read + write that edge's JSON-path
 * selector. The editor owns the edge store + persistence, so it provides the
 * implementation; the per-input selector control consumes it. Null when no
 * editor is mounted above (e.g. isolated component tests).
 */
export interface ScenarioEdgeSelectorApi {
  /** Current selector on the edge, or undefined when none is set. */
  getSelector: (edgeId: string) => string | undefined
  /** Set (or, with an empty string, clear) the edge's selector and persist. */
  setSelector: (edgeId: string, selector: string) => void
}

export const ScenarioEdgeSelectorContext = createContext<ScenarioEdgeSelectorApi | null>(null)

export function useScenarioEdgeSelector(): ScenarioEdgeSelectorApi | null {
  return useContext(ScenarioEdgeSelectorContext)
}
