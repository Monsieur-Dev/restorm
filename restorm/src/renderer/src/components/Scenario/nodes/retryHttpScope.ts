import type { ReactFlowState } from '@xyflow/react'

/**
 * Is an `httpRequest` forward-reachable from this retry's `attempt` port? The
 * retry scope retries ANY action, but the HTTP-status conditions only bite on a
 * node whose result carries a `response.status` — i.e. an httpRequest sitting in
 * the body. Walk the dataflow forward from `attempt` (never back into the retry
 * node itself, so the post-retry continuation wired off `done`/`exhausted` is
 * out of view) and look for one. Returns a primitive so a `useStore` consumer
 * only re-renders when the answer flips, not on every graph tick.
 */
export function selectHasHttpInScope(retryId: string) {
  return (s: ReactFlowState): boolean => {
    const { edges, nodeLookup } = s
    const queue = edges.filter((e) => e.source === retryId && e.sourceHandle === 'attempt').map((e) => e.target)
    const seen = new Set<string>()
    while (queue.length > 0) {
      const nid = queue.shift()
      if (nid === undefined || nid === retryId || seen.has(nid)) continue
      seen.add(nid)
      if ((nodeLookup.get(nid)?.data as { kind?: string } | undefined)?.kind === 'httpRequest') return true
      for (const e of edges) if (e.source === nid) queue.push(e.target)
    }
    return false
  }
}
