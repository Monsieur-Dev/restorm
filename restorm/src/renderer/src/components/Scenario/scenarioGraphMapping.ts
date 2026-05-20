import type { ScenarioEdge, ScenarioPort } from '../../../../shared/types/collections'

/**
 * Pure mapping between the scenario data model and React Flow's
 * graph shapes. Kept free of `@xyflow/react` imports so the
 * persistence-critical serialization can be unit-tested without a DOM —
 * React Flow only round-trips source/target/handles, so the reverse
 * mapping merges the rest back from the prior `ScenarioEdge`.
 */

/** The subset of a React Flow edge we read/write. */
export interface FlowEdgeShape {
  id: string
  source: string
  target: string
  sourceHandle?: string | null | undefined
  targetHandle?: string | null | undefined
  style?: { stroke: string } | undefined
}

/** Default port ids used when a flow edge carries no explicit handle. */
export const DEFAULT_SOURCE_PORT = 'out'
export const DEFAULT_TARGET_PORT = 'in'

export function scenarioEdgeToFlowEdge(e: ScenarioEdge): FlowEdgeShape {
  return {
    id: e.id,
    source: e.from.nodeId,
    target: e.to.nodeId,
    ...(e.from.portId ? { sourceHandle: e.from.portId } : {}),
    ...(e.to.portId ? { targetHandle: e.to.portId } : {}),
    ...(e.color ? { style: { stroke: e.color } } : {})
  }
}

export function flowEdgeToScenarioEdge(fe: FlowEdgeShape, prior?: ScenarioEdge): ScenarioEdge {
  return {
    id: fe.id,
    from: { nodeId: fe.source, portId: fe.sourceHandle ?? prior?.from.portId ?? DEFAULT_SOURCE_PORT },
    to: { nodeId: fe.target, portId: fe.targetHandle ?? prior?.to.portId ?? DEFAULT_TARGET_PORT },
    ...(prior?.selector !== undefined ? { selector: prior.selector } : {}),
    ...(prior?.color !== undefined ? { color: prior.color } : {})
  }
}

/** Default handle/edge colour per semantic port role (epic §5b). */
export const ROLE_COLOR: Record<string, string> = {
  then: '#22c55e',
  case: '#22c55e',
  response: '#22c55e',
  status: '#3b82f6',
  else: '#3b82f6',
  default: '#3b82f6',
  error: '#ef4444'
}

const NEUTRAL_PORT_COLOR = '#9ca3af'

/** The colour for a port handle: explicit override → role colour → neutral. */
export function portColor(p: ScenarioPort): string {
  return p.defaultEdgeColor ?? (p.role ? ROLE_COLOR[p.role] ?? NEUTRAL_PORT_COLOR : NEUTRAL_PORT_COLOR)
}

/**
 * Even vertical distribution of N handles along a node's side, as a CSS
 * `top` percentage. Collapsed nodes pin every handle to the header centre.
 */
export function handleTop(index: number, count: number, collapsed: boolean): string {
  if (collapsed) return '50%'
  const slice = 100 / (count + 1)
  return `${slice * (index + 1)}%`
}
