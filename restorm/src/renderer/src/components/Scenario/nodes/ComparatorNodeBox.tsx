import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { OperatorToggle, OPERATOR_OPTIONS, type OperatorOption } from './OperatorToggle'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'

/**
 * `comparator` — compares two operands `a`/`b` with the operator toggle
 * (< ≤ = ≥ > ≠ ∋), producing a boolean `result`. Each operand is a typed-value
 * selector (like the `if` operands), accepting any type (a comparison is valid
 * across kinds); {@link ScenarioInputCell} swaps an operand for the JSON-path
 * selector once a data link is wired. Operands + operator persist in config.
 */
export const ComparatorNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const rawOp = config['operator']
  const operator: OperatorOption | undefined =
    typeof rawOp === 'string' && (OPERATOR_OPTIONS as readonly string[]).includes(rawOp) ? (rawOp as OperatorOption) : undefined

  const operand = (key: 'a' | 'b'): ScenarioNodeCell => ({
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
          allowNull
          allowList
          dataTestId={`scn-comparator-${key}`}
        />
      </div>
    )
  })

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        operand('a'),
        {
          id: 'op',
          content: (
            <OperatorToggle
              {...(operator !== undefined ? { value: operator } : {})}
              onChange={(op) => { data.onSetConfig?.(id, { operator: op }) }}
            />
          )
        },
        operand('b')
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.comparator.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
