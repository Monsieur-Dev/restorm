import { createContext, useContext } from 'react'

/**
 * Coalesced "this node moved its handles, re-measure it" requester.
 *
 * React Flow's `updateNodeInternals(id)` triggers a full-graph internals
 * recompute per call. Every scenario box measures its own row centres after
 * mount and then asks React Flow to sync — so opening a large graph fired N
 * separate single-id updates, each O(N), i.e. O(N²) and a multi-second freeze.
 *
 * The editor provides a requester that batches every id received within a
 * frame into a single `updateNodeInternals([...ids])` flush — one O(N) pass
 * instead of N. Nodes fall back to their own per-id update when rendered
 * outside the editor (no provider).
 */
export type RequestNodeInternals = (id: string) => void

export const ScenarioInternalsContext = createContext<RequestNodeInternals | null>(null)

export function useScenarioInternalsRequester(): RequestNodeInternals | null {
  return useContext(ScenarioInternalsContext)
}
