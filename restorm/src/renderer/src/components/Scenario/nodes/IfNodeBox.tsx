import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { OperatorToggle, OPERATOR_OPTIONS, type OperatorOption } from './OperatorToggle'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'

/**
 * `if` node: two operands compared by the operator toggle, branching to `then`
 * (green) / `else` (blue). Each operand is a typed-value selector (literal
 * value + type) when unwired — so `if 1 (int) = 2 (int)` works without links,
 * and there's always a left and a right value — and {@link ScenarioInputCell}
 * swaps it for the JSON-path selector once a data link is connected. Operands +
 * operator persist in the node's config bag.
 */
export const IfNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const operand = (key: 'left' | 'right'): ScenarioNodeCell => ({
    id: key,
    label: key,
    port: { id: key, type: 'target' },
    content: (
      <div className="nodrag scn-operand-field" onMouseDown={(e) => { e.stopPropagation() }}>
        <TypedValueField
          value={normalizeValueType(config[key])}
          onChange={(next) => { data.onSetConfig?.(id, { [key]: serializeValueForPersistence(next) }) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={['expression']}
          allowEnvironment
          dataTestId={`scn-if-${key}`}
        />
      </div>
    )
  })

  const rawOp = config['operator']
  const operator: OperatorOption | undefined =
    typeof rawOp === 'string' && (OPERATOR_OPTIONS as readonly string[]).includes(rawOp) ? (rawOp as OperatorOption) : undefined

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        operand('left'),
        {
          id: 'operator',
          content: (
            <OperatorToggle
              {...(operator !== undefined ? { value: operator } : {})}
              onChange={(op) => { data.onSetConfig?.(id, { operator: op }) }}
            />
          )
        },
        operand('right')
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
