import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'

/**
 * `waitUntil` node — blocks until its input resolves (a timestamp or
 * condition). The input is mandatory, so the node is never runnable on its
 * own (the run button stays grey until the input is produced). No unit: the
 * value carries its own meaning.
 */
export const WaitUntilNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const left: ScenarioNodeSection[] = [
    { id: 'main', rows: [{ id: 'until', label: 'until', port: { id: 'until', type: 'target', required: true } }] }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'out', label: 'then', port: { id: 'out', role: 'then', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default WaitUntilNodeBox
