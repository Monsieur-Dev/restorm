import React, { useState } from 'react'
import { useNodeConnections, type NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { SegmentedToggle } from './SegmentedToggle'

/**
 * Inline numeric field for an unwired operand — mirrors the wait node's inline
 * duration (visual-only local state until the node config schema lands).
 */
const InlineNumber: React.FC = () => {
  const [value, setValue] = useState<string>('0')
  return (
    <input
      type="number"
      className="scn-wait-input nodrag"
      value={value}
      onMouseDown={(e) => { e.stopPropagation() }}
      onChange={(e) => { setValue(e.target.value) }}
    />
  )
}

/**
 * Two operands `a` / `b` with an operator toggle between them and a single
 * `result` output. Shared shape for comparator / arithmetic / boolean (they
 * differ only by the operator set). `a` is always required. When
 * `bNumericWhenUnwired` is set (arithmetic), `b` is optional: wire a value into
 * it, or set a literal inline with a numeric field. Otherwise `b` is required.
 */
function makeBinaryOpBox(options: readonly string[], defaultValue: string, displayName: string, bNumericWhenUnwired = false): React.FC<NodeProps<ScenarioNodeBoxType>> {
  const Comp: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
    const bConnections = useNodeConnections({ handleType: 'target', handleId: 'b' })
    const bWired = bConnections.length > 0
    const bRow: ScenarioNodeCell =
      bNumericWhenUnwired && !bWired
        ? { id: 'b', content: <InlineNumber />, port: { id: 'b', type: 'target' } }
        : { id: 'b', label: 'b', port: { id: 'b', type: 'target', ...(bNumericWhenUnwired ? {} : { required: true }) } }
    const left: ScenarioNodeSection[] = [
      {
        id: 'main',
        rows: [
          { id: 'a', label: 'a', port: { id: 'a', type: 'target', required: true } },
          { id: 'op', content: <SegmentedToggle options={options} defaultValue={defaultValue} ariaLabel="operator" /> },
          bRow
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
export const ArithmeticNodeBox = makeBinaryOpBox(['+', '−', '×', '÷'], '+', 'ArithmeticNodeBox', true)
export const BooleanNodeBox = makeBinaryOpBox(['AND', 'OR', 'XOR'], 'AND', 'BooleanNodeBox')
