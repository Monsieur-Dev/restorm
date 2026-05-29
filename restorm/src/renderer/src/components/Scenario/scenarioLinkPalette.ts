import type { ScenarioNodeKind, ScenarioPort } from '../../../../shared/types/collections'
import { SCENARIO_NODE_CATALOGUE } from './scenarioNodeCatalogue'
import { defaultPortsForKind, outputPortFlow, inputPortFlow, canConnectFlow } from './scenarioNodePorts'

/** A kind offered by the link-drop palette + the port to auto-wire on it. */
export interface LinkPaletteEntry {
  kind: ScenarioNodeKind
  /** Port id on the new node the dragged link wires to. */
  wirePort: string
}

/**
 * The kinds offered when a link dragged off a port is released on empty canvas,
 * plus which port to auto-wire on the new node. Pure (no React / catalogue
 * labels) so the wiring rule is unit-testable.
 *
 * Dragging from an OUTPUT (`fromIsSource`): the new node wires on its **header
 * (signal) input** when the dragged output can trigger it — a `signal`
 * (trigger) or `both` (response-like) output; otherwise its first **body**
 * input the output can feed. A kind with no reachable input is omitted — so a
 * pure-trigger output only lists kinds that own a header input.
 *
 * Dragging from an INPUT: symmetric — the new node's first output the dragged
 * input accepts.
 */
export function linkPaletteEntries(
  src: { kind: ScenarioNodeKind; inputs: ScenarioPort[]; outputs: ScenarioPort[] },
  srcHandle: string,
  fromIsSource: boolean
): LinkPaletteEntry[] {
  const entries: LinkPaletteEntry[] = []
  for (const meta of SCENARIO_NODE_CATALOGUE) {
    const { inputs, outputs } = defaultPortsForKind(meta.kind)
    let wirePort: string | undefined
    if (fromIsSource) {
      const srcFlow = outputPortFlow(src.outputs, srcHandle, src.kind)
      // Header input = the signal launch trigger (conventionally `in`).
      const header = inputs.find((i) => inputPortFlow(inputs, i.id, meta.kind) === 'signal')
      if (header && canConnectFlow(srcFlow, 'signal')) {
        wirePort = header.id
      } else {
        wirePort = inputs.find((i) => i.id !== header?.id && canConnectFlow(srcFlow, inputPortFlow(inputs, i.id, meta.kind)))?.id
      }
    } else {
      const accepts = inputPortFlow(src.inputs, srcHandle, src.kind)
      wirePort = outputs.find((o) => canConnectFlow(outputPortFlow(outputs, o.id, meta.kind), accepts))?.id
    }
    if (wirePort) entries.push({ kind: meta.kind, wirePort })
  }
  return entries
}
