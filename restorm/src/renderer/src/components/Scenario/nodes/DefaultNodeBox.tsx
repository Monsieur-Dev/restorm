import React from 'react'
import type { NodeProps } from '@xyflow/react'
import type { ScenarioPort } from '../../../../../shared/types/collections'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell } from './ScenarioNodeBoxBase'

function cellFromPort(p: ScenarioPort, type: 'target' | 'source'): ScenarioNodeCell {
  return {
    id: p.id,
    ...(p.name ? { label: p.name } : {}),
    port: { id: p.id, ...(p.role ? { role: p.role } : {}), type }
  }
}

/**
 * Fallback node box for kinds without a bespoke component: derives its
 * columns straight from the node's ports (inputs left, outputs right).
 */
export const DefaultNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left = [{ id: 'main', rows: data.inputs.map((p) => cellFromPort(p, 'target')) }]
  const right = data.outputs.map((p) => cellFromPort(p, 'source'))
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default DefaultNodeBox
