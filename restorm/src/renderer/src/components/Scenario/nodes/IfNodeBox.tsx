import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { OperatorToggle } from './OperatorToggle'

/**
 * `if` node: a left column with the two operands and the operator toggle
 * between them, and a right column branching to `then` (green) / `else`
 * (blue). Composes the generic base box and only declares its columns.
 */
export const IfNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'left', label: 'left', port: { id: 'left', type: 'target' } },
        { id: 'operator', content: <OperatorToggle /> },
        { id: 'right', label: 'right', port: { id: 'right', type: 'target' } }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'then', label: 'then', port: { id: 'then', role: 'then', type: 'source' } },
    { id: 'else', label: 'else', port: { id: 'else', role: 'else', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default IfNodeBox
