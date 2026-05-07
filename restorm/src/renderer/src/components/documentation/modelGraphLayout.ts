import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
  type ElkPort
} from 'elkjs/lib/elk.bundled.js'
import type { Edge, Node } from '@xyflow/react'
import type { ModelDocumentation } from '../../../../shared/types/apiDocumentation'
import {
  MODEL_NODE_WIDTH,
  estimateModelNodeHeight,
  propertyHandleCenterY,
  sourceHandleIdForProperty,
  targetHandleCenterY,
  targetHandleIdForIncomingEdge
} from './modelNodeMetrics'
import type { ModelEdgePoint } from './ModelEdge'

export interface ModelGraphElements {
  nodes: Node[]
  edges: Edge[]
}

const elk = new ELK()

function elkPortIdForNode(modelName: string, handleId: string): string {
  return `${modelName}__${handleId}`
}

/**
 * Build React Flow nodes + edges from a deduplicated list of models,
 * then run ELK ("layered" algorithm with orthogonal edge routing) to
 * assign positions AND compute proper bend points so edges don't
 * cross through unrelated nodes. Each property carrying a
 * `targetModelRef` is exposed to ELK as an explicit port on the
 * source model's east side so the routing engine can lay out the
 * edges around obstacles.
 */
export async function buildModelGraphElements(
  models: ModelDocumentation[],
  options?: { direction?: 'RIGHT' | 'DOWN' }
): Promise<ModelGraphElements> {
  const direction = options?.direction ?? 'RIGHT'
  const modelByName = new Map<string, ModelDocumentation>()
  for (const m of models) modelByName.set(m.name, m)

  // ── Pre-pass: enumerate every cross-model edge so we know how
  //    many incoming edges land on each target. That count drives
  //    the per-incoming target-handle distribution on the destination
  //    node — without it, multiple edges would converge to the same
  //    point and overlap.
  interface EdgeMeta {
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }
  const edgeMeta = new Map<string, EdgeMeta>()
  const incomingByTarget = new Map<string, string[]>()

  for (const model of models) {
    for (const prop of model.properties) {
      if (prop.targetModelRef === undefined) continue
      if (!modelByName.has(prop.targetModelRef)) continue
      const edgeId = `${model.name}::${prop.name}->${prop.targetModelRef}`
      const sourceHandle = sourceHandleIdForProperty(prop.name)
      const targetHandle = targetHandleIdForIncomingEdge(edgeId)
      edgeMeta.set(edgeId, {
        source: model.name,
        target: prop.targetModelRef,
        sourceHandle,
        targetHandle
      })
      const list = incomingByTarget.get(prop.targetModelRef) ?? []
      list.push(edgeId)
      incomingByTarget.set(prop.targetModelRef, list)
    }
  }

  // ── ELK input ───────────────────────────────────────────────
  // Port (x, y) coordinates are expressed in the node's local
  // space (origin = top-left). They have to match the DOM
  // positions of the React Flow `<Handle>` elements rendered by
  // `ModelNode`, otherwise ELK routes from a place that doesn't
  // line up with the visible handle. We pin them with
  // `portConstraints: FIXED_POS`.
  const elkNodes: ElkNode[] = models.map((model) => {
    const nodeHeight = estimateModelNodeHeight(model)
    const incomingEdgeIds = incomingByTarget.get(model.name) ?? []
    const ports: ElkPort[] = []
    // One target port per incoming edge — spread along the left
    // side at the same Y values the DOM handle uses.
    incomingEdgeIds.forEach((edgeId, idx) => {
      ports.push({
        id: elkPortIdForNode(model.name, targetHandleIdForIncomingEdge(edgeId)),
        x: 0,
        y: targetHandleCenterY(nodeHeight, idx, incomingEdgeIds.length),
        width: 0,
        height: 0
      })
    })
    // One source port per outgoing relationship, pinned to the row
    // of the property that creates it.
    for (let i = 0; i < model.properties.length; i++) {
      const prop = model.properties[i]
      if (prop?.targetModelRef === undefined) continue
      ports.push({
        id: elkPortIdForNode(model.name, sourceHandleIdForProperty(prop.name)),
        x: MODEL_NODE_WIDTH,
        y: propertyHandleCenterY(model, i),
        width: 0,
        height: 0
      })
    }
    return {
      id: model.name,
      width: MODEL_NODE_WIDTH,
      height: nodeHeight,
      ports,
      layoutOptions: { 'portConstraints': 'FIXED_POS' }
    }
  })

  const elkEdges: ElkExtendedEdge[] = []
  for (const [edgeId, meta] of edgeMeta) {
    elkEdges.push({
      id: edgeId,
      sources: [elkPortIdForNode(meta.source, meta.sourceHandle)],
      targets: [elkPortIdForNode(meta.target, meta.targetHandle)]
    })
  }

  // Look-up table of source-property metadata so the React Flow
  // edge factory can colour and dash edges by relationship kind:
  // required vs optional × single ref vs array ref. Cheaper to
  // build once here than to hunt the property on every edge later.
  const propByEdgeId = new Map<string, { required: boolean; isArrayOfRef: boolean }>()
  for (const model of models) {
    for (const prop of model.properties) {
      if (prop.targetModelRef === undefined) continue
      if (!modelByName.has(prop.targetModelRef)) continue
      propByEdgeId.set(`${model.name}::${prop.name}->${prop.targetModelRef}`, {
        required: prop.required,
        isArrayOfRef: prop.isArrayOfRef === true
      })
    }
  }

  const layoutGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '80',
      'elk.layered.spacing.nodeNodeBetweenLayers': '180',
      'elk.spacing.edgeNode': '32',
      'elk.spacing.edgeEdge': '20',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.thoroughness': '50',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.portConstraints': 'FIXED_POS'
    },
    children: elkNodes,
    edges: elkEdges
  }

  const result = await elk.layout(layoutGraph)

  // ── React Flow output ──────────────────────────────────────
  const nodes: Node[] = (result.children ?? []).map((laid) => {
    const model = modelByName.get(laid.id)
    const incomingEdgeIds = incomingByTarget.get(laid.id) ?? []
    const nodeHeight = model ? estimateModelNodeHeight(model) : 0
    return {
      id: laid.id,
      type: 'umlClass',
      position: { x: laid.x ?? 0, y: laid.y ?? 0 },
      data: model ? { model, incomingEdgeIds, nodeHeight } : {},
      draggable: true,
      selectable: true
    }
  })

  const edges: Edge[] = (result.edges ?? []).map((laid) => {
    const meta = edgeMeta.get(laid.id)
    const section = laid.sections?.[0]
    const bendPoints: ModelEdgePoint[] = []
    if (section) {
      bendPoints.push({ x: section.startPoint.x, y: section.startPoint.y })
      for (const bp of section.bendPoints ?? []) bendPoints.push({ x: bp.x, y: bp.y })
      bendPoints.push({ x: section.endPoint.x, y: section.endPoint.y })
    }
    const propInfo = propByEdgeId.get(laid.id) ?? { required: false, isArrayOfRef: false }
    return {
      id: laid.id,
      source: meta?.source ?? '',
      target: meta?.target ?? '',
      sourceHandle: meta?.sourceHandle ?? '',
      targetHandle: meta?.targetHandle ?? '',
      type: 'modelEdge',
      // Edges are read-only signal in the doc surface — make sure
      // the user can't accidentally select one by clicking through
      // the canvas.
      selectable: false,
      focusable: false,
      data: {
        bendPoints,
        relation: propInfo.isArrayOfRef ? 'array' : 'single',
        required: propInfo.required
      }
    }
  })

  return { nodes, edges }
}
