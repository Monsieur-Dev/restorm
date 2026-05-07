import type { ModelDocumentation } from '../../../../shared/types/apiDocumentation'

export const MODEL_NODE_WIDTH = 280
export const MODEL_NODE_HEADER_HEIGHT_BASE = 36
export const MODEL_NODE_HEADER_DESCRIPTION_HEIGHT = 18
/** Backwards-compat alias. The base value still maps the simple
 * "no description" case so old code paths keep working. */
export const MODEL_NODE_HEADER_HEIGHT = MODEL_NODE_HEADER_HEIGHT_BASE
export const MODEL_NODE_PROPERTY_HEIGHT = 22
export const MODEL_NODE_PROPERTY_LIST_PADDING_Y = 6

/** Effective header height for the given model. Adds an extra
 * description row when the model carries a non-empty description
 * string — keeps every per-property port Y aligned with the
 * actual DOM offsetTop for that row. */
export function modelHeaderHeight(model: ModelDocumentation): number {
  const hasDescription = model.description !== undefined && model.description.length > 0
  return MODEL_NODE_HEADER_HEIGHT_BASE + (hasDescription ? MODEL_NODE_HEADER_DESCRIPTION_HEIGHT : 0)
}

/**
 * Vertical centre of the property at `propertyIndex`, expressed in
 * the node's local coordinate space (origin = top-left corner of
 * the node — there is no border on the node container, so DOM
 * `offsetTop` of children matches this calculation directly).
 * Mirrors the DOM layout used by `ModelNode.tsx`:
 *   header (variable) | UL padding-top | row N | row N+1 | …
 * so ELK places its ports at the same Y as the React Flow
 * `<Handle>` rendered inside that property's `<li>`.
 */
export function propertyHandleCenterY(model: ModelDocumentation, propertyIndex: number): number {
  return (
    modelHeaderHeight(model) +
    MODEL_NODE_PROPERTY_LIST_PADDING_Y +
    propertyIndex * MODEL_NODE_PROPERTY_HEIGHT +
    MODEL_NODE_PROPERTY_HEIGHT / 2
  )
}

/** Each property that owns a relationship gets its own source handle
 * on the right side of its row. The id encodes the property name so
 * the layout / edge factory can address the right anchor. */
export function sourceHandleIdForProperty(propertyName: string): string {
  return `src:${propertyName}`
}

/** Each incoming edge gets its own target handle along the left
 * side of the destination node. Without this, several incoming
 * edges would converge to a single point and overlap. The edge id
 * is the disambiguator — same id on both sides of the wire. */
export function targetHandleIdForIncomingEdge(edgeId: string): string {
  return `tgt:${edgeId}`
}

/**
 * Vertical position of the `incomingIndex`-th target handle when a
 * node has `totalIncoming` incoming edges. Distributes the handles
 * evenly along the left side of the node, leaving margin at top
 * and bottom so the topmost handle doesn't clash with the header
 * border-radius and the bottom one stays inside the card.
 */
export function targetHandleCenterY(
  nodeHeight: number,
  incomingIndex: number,
  totalIncoming: number
): number {
  if (totalIncoming <= 1) return nodeHeight / 2
  // Reserve a fraction of the node for the handle row so the
  // outermost handles don't sit on the rounded corners.
  const usable = nodeHeight - MODEL_NODE_HEADER_HEIGHT
  const top = MODEL_NODE_HEADER_HEIGHT
  return top + ((incomingIndex + 1) / (totalIncoming + 1)) * usable
}

export function estimateModelNodeHeight(model: ModelDocumentation): number {
  return (
    modelHeaderHeight(model) +
    MODEL_NODE_PROPERTY_LIST_PADDING_Y * 2 +
    model.properties.length * MODEL_NODE_PROPERTY_HEIGHT
  )
}
