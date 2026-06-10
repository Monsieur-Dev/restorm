import { type ReactNode } from 'react'
import type { ScenarioNodeKind, ScenarioPort, ScenarioPortRole, PortFlow } from '../../../../../shared/types/collections'
import { ROLE_COLOR } from '../scenarioGraphMapping'
import { inputPortFlow, outputPortFlow } from '../scenarioNodePorts'
import type { ScenarioNodeCell } from './ScenarioNodeBoxBase'
import { ScenarioCellLabel } from './ScenarioCellLabel'

/**
 * Ring class for a port handle, by its flow class: a yellow ring for a
 * trigger (signal) port, purple for a data (value) port, and a half-yellow /
 * half-purple ring for a `both` port (carries data AND triggers). The handle's
 * centre fill (role colour / required-red) is unchanged — the ring is the flow.
 */
export function inputFlowRingClass(handleId: string, inputs: ScenarioPort[], kind: ScenarioNodeKind): string {
  return `scn-handle--flow-${inputPortFlow(inputs, handleId, kind)}`
}
export function outputFlowRingClass(handleId: string, outputs: ScenarioPort[], kind: ScenarioNodeKind): string {
  return `scn-handle--flow-${outputPortFlow(outputs, handleId, kind)}`
}

/** A cell port's flow-ring class, honouring an explicit `flow` first: a
 * runScenario's derived ports (param/output/`done`) carry their own flow but
 * aren't in the node's static port list, so the by-id lookup would mis-default
 * them to `value`. */
export function cellInputRingClass(port: { id: string; flow?: PortFlow }, inputs: ScenarioPort[], kind: ScenarioNodeKind): string {
  return port.flow ? `scn-handle--flow-${port.flow}` : inputFlowRingClass(port.id, inputs, kind)
}
export function cellOutputRingClass(port: { id: string; flow?: PortFlow }, outputs: ScenarioPort[], kind: ScenarioNodeKind): string {
  return port.flow ? `scn-handle--flow-${port.flow}` : outputFlowRingClass(port.id, outputs, kind)
}

const NEUTRAL_ANCHOR = '#9ca3af'
/** Red flag for a required input still missing its (mandatory) incoming link. */
const REQUIRED_UNMET = '#ef4444'

/** Colour for a port anchor by its role (neutral grey when unspecified). */
export function anchorColor(role?: ScenarioPortRole): string {
  return role ? ROLE_COLOR[role] ?? NEUTRAL_ANCHOR : NEUTRAL_ANCHOR
}

/**
 * Anchor colour for a port. A *required* input with no incoming connection is
 * flagged red until a valid link points to it; otherwise the role colour.
 */
export function portAnchorColor(
  port: { id: string; role?: ScenarioPortRole; type: 'target' | 'source'; required?: boolean; orphan?: boolean },
  connectedInputs: Set<string>
): string {
  // A stale port — kept only to anchor an edge whose real port vanished — is
  // flagged red regardless of connection state.
  if (port.orphan) return REQUIRED_UNMET
  if (port.required && port.type === 'target' && !connectedInputs.has(port.id)) return REQUIRED_UNMET
  return anchorColor(port.role)
}

/** Render a cell's body: explicit `content`, a `name ↔ value` KV pair, or a plain label. */
export function cellBody(cell: ScenarioNodeCell): ReactNode {
  if (cell.content !== undefined) return cell.content
  if (cell.value !== undefined) {
    return (
      <span className="scn-kv">
        <ScenarioCellLabel cell={cell} />
        <span className="scn-kv-value">{cell.value}</span>
      </span>
    )
  }
  if (cell.label !== undefined) return <ScenarioCellLabel cell={cell} />
  return null
}
