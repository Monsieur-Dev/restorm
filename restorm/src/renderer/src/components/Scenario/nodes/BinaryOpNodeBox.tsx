import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { SegmentedToggle } from './SegmentedToggle'

/**
 * Two mandatory operands `a` / `b` with an operator toggle between them and a
 * single `result` output. Shared shape for comparator / arithmetic / boolean
 * (they differ only by the operator set). Both inputs are required, so the run
 * button stays grey until they're wired.
 */
function makeBinaryOpBox(options: readonly string[], defaultValue: string, displayName: string): React.FC<NodeProps<ScenarioNodeBoxType>> {
  const Comp: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
    const left: ScenarioNodeSection[] = [
      {
        id: 'main',
        rows: [
          { id: 'a', label: 'a', port: { id: 'a', type: 'target', required: true } },
          { id: 'op', content: <SegmentedToggle options={options} defaultValue={defaultValue} ariaLabel="operator" /> },
          { id: 'b', label: 'b', port: { id: 'b', type: 'target', required: true } }
        ]
      }
    ]
    const right: ScenarioNodeCell[] = [
      { id: 'result', label: 'result', port: { id: 'result', type: 'source' } }
    ]
    return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
  }
  Comp.displayName = displayName
  return Comp
}

export const ComparatorNodeBox = makeBinaryOpBox(['<', '≤', '=', '≥', '>'], '=', 'ComparatorNodeBox')
export const ArithmeticNodeBox = makeBinaryOpBox(['+', '−', '×', '÷'], '+', 'ArithmeticNodeBox')
export const BooleanNodeBox = makeBinaryOpBox(['AND', 'OR', 'XOR'], 'AND', 'BooleanNodeBox')
