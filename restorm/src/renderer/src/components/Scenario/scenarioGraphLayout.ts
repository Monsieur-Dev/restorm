import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'

/** A node to lay out: its id + its measured (or estimated) box size. */
export interface LayoutNodeInput {
  id: string
  width: number
  height: number
}

/** A directed edge between two node ids (ports are ignored — only the
 * source→target relationship drives the layered placement). */
export interface LayoutEdgeInput {
  id: string
  source: string
  target: string
}

const elk = new ELK()

/** Fallbacks when a node hasn't been measured by React Flow yet (e.g. just
 * created): roughly the size of a small action box. */
export const SCENARIO_NODE_FALLBACK_WIDTH = 240
export const SCENARIO_NODE_FALLBACK_HEIGHT = 110

/**
 * Run an ELK "layered" left-to-right auto-layout over a scenario graph and
 * return the new top-left position for every node. Uses each node's measured
 * size so boxes never overlap, and routes flow left→right (entry points on the
 * left, downstream actions to the right) — the natural reading order of a
 * dataflow scenario. Disconnected nodes are placed by ELK in their own band.
 */
export async function layoutScenarioGraph(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  options?: { direction?: 'RIGHT' | 'DOWN' }
): Promise<Map<string, { x: number; y: number }>> {
  const positions = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return positions

  const children: ElkNode[] = nodes.map((n) => ({
    id: n.id,
    width: n.width > 0 ? n.width : SCENARIO_NODE_FALLBACK_WIDTH,
    height: n.height > 0 ? n.height : SCENARIO_NODE_FALLBACK_HEIGHT
  }))

  // Only keep edges whose both endpoints exist as nodes (a dangling edge would
  // make ELK throw).
  const ids = new Set(nodes.map((n) => n.id))
  const elkEdges = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': options?.direction ?? 'RIGHT',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.spacing.edgeNode': '28',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.thoroughness': '40',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.semiInteractive': 'true'
    },
    children,
    edges: elkEdges
  }

  const result = await elk.layout(graph)
  for (const c of result.children ?? []) {
    positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 })
  }
  return positions
}
