import React from 'react'
import { useNodeConnections, useNodesData } from '@xyflow/react'
import type { ScenarioNodeKind, ScenarioPort } from '../../../../../shared/types/collections'
import { inputPortFlow, outputPortFlow } from '../../../../../shared/scenarioNodePorts'
import { isDataLink } from '../scenarioPathTree'
import { cellBody } from './scenarioCellRender'
import type { ScenarioNodeCell } from './ScenarioNodeBoxBase'
import { ScenarioPathSelector } from './ScenarioPathSelector'
import { useScenarioFieldInvalid } from '../scenarioErrorsContext'

export interface ScenarioInputCellProps {
  cell: ScenarioNodeCell
  nodeId: string
  nodeKind: ScenarioNodeKind
  nodeInputs: ScenarioPort[]
  scenarioId?: string
}

/**
 * A left-column (input) cell. When a data link feeds this value input — an
 * upstream `value`/`both` output wired into a non-header input — the cell shows
 * the JSON-path selector on that edge instead of a plain label. Otherwise it
 * renders the normal cell body.
 */
export const ScenarioInputCell: React.FC<ScenarioInputCellProps> = ({ cell, nodeId, nodeKind, nodeInputs, scenarioId }) => {
  const portId = cell.port?.type === 'target' ? cell.port.id : undefined
  // Hooks run unconditionally; a missing port resolves to no connection.
  const connections = useNodeConnections({ handleType: 'target', handleId: portId ?? '' })
  const incoming = connections[0]
  const sourceData = useNodesData(incoming?.source ?? '')
  // This cell's field is the target of a validation error (e.g. an empty
  // JSON-path on the data link) → outline its control group in red.
  const invalid = useScenarioFieldInvalid(nodeId, cell.id)

  // An orphan stub (a stale port kept only to anchor a broken edge) keeps its
  // red warning label rather than a JSON-path selector.
  // The `object` builder AND the `output` node keep their own cell rendering
  // even when wired — the cell carries an editable name field (and swaps only
  // its value sub-area internally) that the JSON-path selector swap would
  // otherwise replace, losing the name.
  if (portId && incoming && sourceData && nodeKind !== 'object' && nodeKind !== 'output' && cell.port?.orphan !== true) {
    const data = sourceData.data as { kind?: ScenarioNodeKind; outputs?: ScenarioPort[] }
    const inFlow = inputPortFlow(nodeInputs, portId, nodeKind)
    const outFlow = outputPortFlow(data.outputs ?? [], incoming.sourceHandle ?? 'out', data.kind ?? 'httpRequest')
    if (isDataLink(inFlow, outFlow)) {
      return (
        <ScenarioPathSelector
          edgeId={incoming.edgeId}
          sourceNodeId={incoming.source}
          invalid={invalid}
          {...(scenarioId !== undefined ? { scenarioId } : {})}
          {...(cell.label !== undefined ? { label: cell.label } : {})}
        />
      )
    }
  }

  return <>{cellBody(cell)}</>
}
