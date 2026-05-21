import React from 'react'
import type { NodeProps } from '@xyflow/react'
import type { ScenarioPort } from '../../../../../shared/types/collections'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell } from './ScenarioNodeBoxBase'

function cellFromPort(p: ScenarioPort, type: 'target' | 'source'): ScenarioNodeCell {
  return {
    id: p.id,
    ...(p.name ? { label: p.name } : {}),
    port: { id: p.id, ...(p.role ? { role: p.role } : {}), type, ...(p.required ? { required: true } : {}) }
  }
}

/**
 * Fallback node box for kinds without a bespoke component: derives its
 * columns straight from the node's ports (inputs left, outputs right). The
 * run button is green when the node has no required input (it can fire on its
 * own), grey otherwise.
 */
export const DefaultNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left = [{ id: 'main', rows: data.inputs.map((p) => cellFromPort(p, 'target')) }]
  const right = data.outputs.map((p) => cellFromPort(p, 'source'))
  const canPlay = !data.inputs.some((p) => p.required)
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} canPlay={canPlay} />
}

export default DefaultNodeBox
