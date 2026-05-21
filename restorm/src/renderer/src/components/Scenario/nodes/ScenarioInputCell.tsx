import React from 'react'
import { useNodeConnections, useNodesData } from '@xyflow/react'
import type { ScenarioNodeKind, ScenarioPort } from '../../../../../shared/types/collections'
import { inputPortFlow, outputPortFlow } from '../../../../../shared/scenarioNodePorts'
import { isDataLink } from '../scenarioPathTree'
import { cellBody } from './scenarioCellRender'
import type { ScenarioNodeCell } from './ScenarioNodeBoxBase'
import { ScenarioPathSelector } from './ScenarioPathSelector'

export interface ScenarioInputCellProps {
  cell: ScenarioNodeCell
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
export const ScenarioInputCell: React.FC<ScenarioInputCellProps> = ({ cell, nodeKind, nodeInputs, scenarioId }) => {
  const portId = cell.port?.type === 'target' ? cell.port.id : undefined
  // Hooks run unconditionally; a missing port resolves to no connection.
  const connections = useNodeConnections({ handleType: 'target', handleId: portId ?? '' })
  const incoming = connections[0]
  const sourceData = useNodesData(incoming?.source ?? '')

  if (portId && incoming && sourceData) {
    const data = sourceData.data as { kind?: ScenarioNodeKind; outputs?: ScenarioPort[] }
    const inFlow = inputPortFlow(nodeInputs, portId, nodeKind)
    const outFlow = outputPortFlow(data.outputs ?? [], incoming.sourceHandle ?? 'out', data.kind ?? 'request')
    if (isDataLink(inFlow, outFlow)) {
      return (
        <ScenarioPathSelector
          edgeId={incoming.edgeId}
          sourceNodeId={incoming.source}
          {...(scenarioId !== undefined ? { scenarioId } : {})}
          {...(cell.label !== undefined ? { label: cell.label } : {})}
        />
      )
    }
  }

  return <>{cellBody(cell)}</>
}

export default ScenarioInputCell
