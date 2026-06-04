import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { SegmentedToggle } from './SegmentedToggle'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { BooleanValue } from '../../../../../shared/types/collections'

const BOOL_OPS = ['AND', 'OR', 'XOR'] as const

/**
 * Boolean operators combine booleans, so the operands are restricted to the
 * boolean type (plus variables, whose runtime type is checked later).
 */
const NON_BOOL_TYPES: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'expression', 'enum', 'enumList', 'customList', 'customListMulti'
]

/**
 * `boolean` — combines two boolean operands `a`/`b` with the logic toggle
 * (AND / OR / XOR), producing a boolean `result`. Each operand is a typed-value
 * selector restricted to booleans (like the `if` operands otherwise);
 * {@link ScenarioInputCell} swaps an operand for the JSON-path selector once a
 * data link is wired. Operands + operator persist in config.
 */
export const BooleanNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const rawOp = config['operator']
  const operator = typeof rawOp === 'string' && (BOOL_OPS as readonly string[]).includes(rawOp) ? rawOp : 'AND'

  const operand = (key: 'a' | 'b'): ScenarioNodeCell => ({
    id: key,
    label: key,
    port: { id: key, type: 'target' },
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <TypedValueField
          // Default to a boolean — a boolean op operates on booleans, not the
          // generic string default `normalizeValueType` would otherwise yield.
          value={config[key] !== undefined ? normalizeValueType(config[key]) : new BooleanValue(false)}
          onChange={(next) => { data.onSetConfig?.(id, { [key]: serializeValueForPersistence(next) }) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={NON_BOOL_TYPES}
          // List every run variable regardless of declared type — the op coerces
          // to a boolean at run time, so any variable is a valid operand.
          allowAllVariables
          allowNull
          dataTestId={`scn-boolean-${key}`}
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
            <SegmentedToggle
              options={BOOL_OPS}
              value={operator}
              onChange={(op) => { data.onSetConfig?.(id, { operator: op }) }}
              ariaLabel="operator"
            />
          )
        },
        operand('b')
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.boolean.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default BooleanNodeBox
