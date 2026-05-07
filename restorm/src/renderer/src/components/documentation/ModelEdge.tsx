import React from 'react'
import { BaseEdge, type EdgeProps } from '@xyflow/react'

export interface ModelEdgePoint {
  x: number
  y: number
}

export type ModelEdgeRelation = 'single' | 'array'

export interface ModelEdgeData extends Record<string, unknown> {
  /** Bend points produced by ELK for this edge, including the start
   * and end. Drawn as a polyline so the edge follows ELK's
   * obstacle-avoiding orthogonal routing instead of React Flow's
   * default smoothstep heuristic. */
  bendPoints: ModelEdgePoint[]
  /** Cardinality of the relationship the edge represents. Drives the
   * stroke colour. */
  relation: ModelEdgeRelation
  /** Whether the source property is required. Drives the stroke
   * style (solid vs dashed). */
  required: boolean
}

function buildPathFromBendPoints(points: ModelEdgePoint[]): string {
  const segments: string[] = []
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    if (!pt) continue
    segments.push(`${i === 0 ? 'M' : 'L'} ${String(pt.x)},${String(pt.y)}`)
  }
  return segments.join(' ')
}

const STROKES: Record<ModelEdgeRelation, string> = {
  single: 'var(--documentation-edge-single, #4d9bf6)',
  array: 'var(--documentation-edge-array, #f0a868)'
}

/**
 * Edge that draws an SVG polyline through ELK's computed bend
 * points. Stroke colour encodes the relationship cardinality
 * (single ref vs array ref); the stroke pattern encodes the source
 * property's `required` flag (solid for required, dashed for
 * optional). The legend shipped under the graph mirrors this
 * mapping.
 */
export const ModelEdge: React.FC<EdgeProps> = ({ id, sourceX, sourceY, targetX, targetY, data, markerEnd }) => {
  const edgeData = data as ModelEdgeData | undefined
  const path = edgeData && edgeData.bendPoints.length > 0
    ? buildPathFromBendPoints(edgeData.bendPoints)
    : `M ${String(sourceX)},${String(sourceY)} L ${String(targetX)},${String(targetY)}`
  const stroke = edgeData ? STROKES[edgeData.relation] : 'var(--documentation-edge-single, #4d9bf6)'
  const strokeDasharray = edgeData?.required === false ? '4 4' : undefined
  const style: React.CSSProperties = {
    stroke,
    strokeWidth: 1.6,
    ...(strokeDasharray !== undefined ? { strokeDasharray } : {})
  }
  return (
    <BaseEdge
      id={id}
      path={path}
      style={style}
      {...(markerEnd !== undefined ? { markerEnd } : {})}
    />
  )
}
