import type { ScenarioNodeKind, ScenarioPort, ScenarioDataType } from '../../../../shared/types/collections'
import { SCENARIO_NODE_CATALOGUE } from './scenarioNodeCatalogue'
import { defaultPortsForKind, outputPortFlow, inputPortFlow, canConnectFlow } from './scenarioNodePorts'

/** Whether a value of `out` can flow into an input declaring `inp`. `any` on
 * either side is the universal wildcard (an unconstrained port); otherwise the
 * declared types must match. So a `string` output skips an `environment` input
 * but fills a `string` one, while an `any` output fits any input. */
function dataTypesCompatible(out: ScenarioDataType, inp: ScenarioDataType): boolean {
  return out === 'any' || inp === 'any' || out === inp
}

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
 * Dragging from an OUTPUT (`fromIsSource`): the new node wires to the FIRST
 * **data** input (in port order) the output can feed AND whose declared type is
 * compatible — a data link is the meaningful wiring. Only when no data input
 * fits does it fall back to the **header (signal/event) input** (so a pure
 * trigger like `Done`, which carries no value, always lands on the event
 * input). A kind with neither a fitting data input nor a header is omitted.
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
      const srcType = src.outputs.find((o) => o.id === srcHandle)?.dataType ?? 'any'
      // First DATA input (a `value`/`both` port, never the signal header) the
      // output can feed AND whose type is compatible.
      const dataInput = inputs.find((i) => {
        const iFlow = inputPortFlow(inputs, i.id, meta.kind)
        return (iFlow === 'value' || iFlow === 'both') && canConnectFlow(srcFlow, iFlow) && dataTypesCompatible(srcType, i.dataType)
      })
      if (dataInput) {
        wirePort = dataInput.id
      } else {
        // Fall back to the header (signal/event) launch trigger.
        const header = inputs.find((i) => inputPortFlow(inputs, i.id, meta.kind) === 'signal')
        if (header && canConnectFlow(srcFlow, 'signal')) wirePort = header.id
      }
    } else {
      const accepts = inputPortFlow(src.inputs, srcHandle, src.kind)
      wirePort = outputs.find((o) => canConnectFlow(outputPortFlow(outputs, o.id, meta.kind), accepts))?.id
    }
    if (wirePort) entries.push({ kind: meta.kind, wirePort })
  }
  return entries
}
