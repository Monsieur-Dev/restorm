import ELK, { type ElkNode, type ElkPort } from 'elkjs/lib/elk.bundled.js'

/** A node to lay out: its id + its measured (or estimated) box size, plus —
 * optionally — the vertical order of its ports. `outputs` / `inputs` are port
 * ids in the order the box RENDERS them top-to-bottom (the model's port arrays,
 * derived ports appended, then the implicit `error` / `done` which draw at the
 * bottom of the box). Supplying them lets the layout keep a node's successors in
 * its output order instead of an arbitrary one; omit them and the placement is
 * purely node-to-node. */
export interface LayoutNodeInput {
  id: string
  width: number
  height: number
  outputs?: string[]
  inputs?: string[]
}

/** A directed edge between two node ids. `sourcePort` / `targetPort` name the
 * ports the link leaves from and lands on; when both the port and its node's
 * port order are known the edge is anchored to that port so the vertical order
 * of the ports drives the vertical order of the boxes. Unknown / absent ports
 * degrade to a node-to-node link. */
export interface LayoutEdgeInput {
  id: string
  source: string
  target: string
  sourcePort?: string
  targetPort?: string
}

/**
 * Whether a scenario graph still needs its INITIAL auto-placement. `position`
 * is always present in the model, so an un-placed box is detected by the origin
 * sentinel `(0,0)` that the MCP/agent (`create_scenario_node` defaults to 0,0)
 * and import paths leave behind. The editor auto-arranges on first open ONLY
 * when this is true; once every box has a real position the graph is left
 * exactly as saved (re-organisation is then on-demand only). An empty graph
 * needs no placement.
 */
export function scenarioGraphNeedsPlacement(
  nodes: { position: { x: number; y: number } }[]
): boolean {
  return nodes.some((n) => n.position.x === 0 && n.position.y === 0)
}

const elk = new ELK()

/** Fallbacks when a node hasn't been measured by React Flow yet (e.g. just
 * created): roughly the size of a small action box. */
export const SCENARIO_NODE_FALLBACK_WIDTH = 240
export const SCENARIO_NODE_FALLBACK_HEIGHT = 110

/** ELK id of one port, namespaced by its node AND its side — ELK ids are global
 * to the graph, two boxes routinely share a port name (`in`, `done`, …), and a
 * single box may expose the same name as both an input and an output. */
function elkPortId(nodeId: string, side: 'out' | 'in', portId: string): string {
  return `${nodeId}::${side}:${portId}`
}

/** Local y of the port at `index` of `count` ports spread down a box `height`
 * tall — the centre of its slice, so the first port sits near the top and the
 * last near the bottom. Only the ORDER these coordinates encode matters to the
 * layout; they don't have to match the DOM handle to the pixel. */
function portCenterY(index: number, count: number, height: number): number {
  return ((index + 0.5) / count) * height
}

/**
 * Run an ELK "layered" left-to-right auto-layout over a scenario graph and
 * return the new top-left position for every node. Uses each node's measured
 * size so boxes never overlap, and routes flow left→right (entry points on the
 * left, downstream actions to the right) — the natural reading order of a
 * dataflow scenario. Disconnected nodes are placed by ELK in their own band.
 *
 * When the callers describe each box's port order, the links are anchored to
 * explicit ELK ports pinned at the ports' relative heights, so a node's
 * successors come out in the same top-to-bottom order as the outputs they hang
 * off — no needlessly crossing links. Without port data the placement is the
 * plain node-to-node layered one.
 *
 * Pure + transport-agnostic: the renderer feeds it React-Flow-measured sizes,
 * the main-process `arrange_scenario` MCP tool feeds it port-count estimates —
 * both consume the same layered placement.
 */
export async function layoutScenarioGraph(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  options?: { direction?: 'RIGHT' | 'DOWN' }
): Promise<Map<string, { x: number; y: number }>> {
  const positions = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return positions

  const sizeOf = (n: LayoutNodeInput): { width: number; height: number } => ({
    width: n.width > 0 ? n.width : SCENARIO_NODE_FALLBACK_WIDTH,
    height: n.height > 0 ? n.height : SCENARIO_NODE_FALLBACK_HEIGHT
  })

  // Only keep edges whose both endpoints exist as nodes (a dangling edge would
  // make ELK throw).
  const ids = new Set(nodes.map((n) => n.id))
  const kept = edges.filter((e) => ids.has(e.source) && ids.has(e.target))

  // ── Resolve every kept edge's endpoints to a port, when we can ────────────
  // A port is usable only if its node declared the order it renders its ports
  // in AND that list contains the port — an edge off an unlisted port (a port
  // the caller couldn't enumerate, e.g. one stranded by a rename) keeps its
  // node-level endpoint. Ports are then emitted for the resolved ids ONLY: a
  // request box derives one input port per writable slot, and pinning dozens of
  // unused ports would constrain the layout for nothing.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  interface Endpoint { nodeId: string; port: string; index: number; count: number; side: 'out' | 'in' }
  const resolve = (nodeId: string, port: string | undefined, side: 'out' | 'in'): Endpoint | null => {
    const node = byId.get(nodeId)
    if (!node || port === undefined) return null
    const list = (side === 'out' ? node.outputs : node.inputs) ?? []
    const index = list.indexOf(port)
    if (index === -1) return null
    return { nodeId, port, index, count: list.length, side }
  }
  // Keyed by side + port id, so one emitted ELK port per (box, side, port) even
  // when several links leave the same output.
  const usedPorts = new Map<string, Map<string, Endpoint>>()
  const claim = (ep: Endpoint | null): string | null => {
    if (!ep) return null
    const id = elkPortId(ep.nodeId, ep.side, ep.port)
    const perNode = usedPorts.get(ep.nodeId) ?? new Map<string, Endpoint>()
    perNode.set(id, ep)
    usedPorts.set(ep.nodeId, perNode)
    return id
  }

  const elkEdges = kept.map((e) => {
    const source = claim(resolve(e.source, e.sourcePort, 'out')) ?? e.source
    const target = claim(resolve(e.target, e.targetPort, 'in')) ?? e.target
    return { id: e.id, sources: [source], targets: [target] }
  })

  const children: ElkNode[] = nodes.map((n) => {
    const { width, height } = sizeOf(n)
    const ports: ElkPort[] = [...(usedPorts.get(n.id)?.entries() ?? [])].map(([id, ep]) => ({
      id,
      // Outputs on the east side, inputs on the west — the layered flow runs
      // left→right, so that's the side each one is drawn on.
      x: ep.side === 'out' ? width : 0,
      y: portCenterY(ep.index, ep.count, height),
      width: 0,
      height: 0
    }))
    return {
      id: n.id,
      width,
      height,
      ...(ports.length > 0 ? { ports, layoutOptions: { portConstraints: 'FIXED_POS' } } : {})
    }
  })

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
