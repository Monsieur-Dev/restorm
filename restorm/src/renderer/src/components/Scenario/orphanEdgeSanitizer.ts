import type { ScenarioNodeKind } from '../../../../shared/types/collections'

/** Collect the dynamic handle ids declared by a node's per-kind config
 * (object property ids + switch case ids). Other kinds have no dynamic handles
 * — only static `inputs` / `outputs` + the always-on header anchors. */
export function dynamicHandleIds(kind: ScenarioNodeKind, config: Record<string, unknown> | undefined): { ids: Set<string>; prefix: 'prop-' | 'case-' } | null {
  if (kind === 'object') {
    const raw = config ? config['properties'] : undefined
    if (!Array.isArray(raw)) return { ids: new Set(), prefix: 'prop-' }
    const ids = new Set<string>()
    for (const p of raw) {
      const id = (p as { id?: unknown }).id
      if (typeof id === 'string') ids.add(id)
    }
    return { ids, prefix: 'prop-' }
  }
  if (kind === 'switch') {
    const raw = config ? config['cases'] : undefined
    if (!Array.isArray(raw)) return { ids: new Set(), prefix: 'case-' }
    const ids = new Set<string>()
    for (const c of raw) {
      const id = (c as { id?: unknown }).id
      if (typeof id === 'string') ids.add(id)
    }
    return { ids, prefix: 'case-' }
  }
  return null
}

/** Drop edges whose dynamic handle (prop- / case-) on `nodeId` is no longer
 * declared by the node's config. Static handles (input/output/header anchors)
 * are stable per kind, so they're not filtered here. */
export function pruneOrphanDynamicEdges<E extends { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }>(
  edges: E[], nodeId: string, valid: Set<string>, prefix: 'prop-' | 'case-'
): E[] {
  return edges.filter((e) => {
    if (e.target === nodeId && typeof e.targetHandle === 'string' && e.targetHandle.startsWith(prefix) && !valid.has(e.targetHandle)) return false
    if (e.source === nodeId && typeof e.sourceHandle === 'string' && e.sourceHandle.startsWith(prefix) && !valid.has(e.sourceHandle)) return false
    return true
  })
}

/** Whether an edge endpoint is a dynamic handle that no longer exists on its
 * node (object property removed, switch case removed, …). Covers BOTH ends:
 * target-side for object props (`prop-…` handles are on the target node), and
 * source-side for switch cases (`case-…` handles are emit ports — they appear
 * as the edge's source). Used by the load filter + sweep effect to drop
 * persisted orphans either side of an edge. */
export function isOrphanDynamicEdge(
  edge: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null },
  nodeBy: (id: string) => { kind: ScenarioNodeKind; config?: Record<string, unknown> } | undefined
): boolean {
  if (edge.target && typeof edge.targetHandle === 'string') {
    const tgt = nodeBy(edge.target)
    if (tgt) {
      const dyn = dynamicHandleIds(tgt.kind, tgt.config)
      if (dyn && edge.targetHandle.startsWith(dyn.prefix) && !dyn.ids.has(edge.targetHandle)) return true
    }
  }
  if (edge.source && typeof edge.sourceHandle === 'string') {
    const src = nodeBy(edge.source)
    if (src) {
      const dyn = dynamicHandleIds(src.kind, src.config)
      if (dyn && edge.sourceHandle.startsWith(dyn.prefix) && !dyn.ids.has(edge.sourceHandle)) return true
    }
  }
  return false
}
