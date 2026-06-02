import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { useScenarioFieldInvalid } from '../scenarioErrorsContext'
import { SegmentedToggle } from './SegmentedToggle'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { NumericValue } from '../../../../../shared/types/collections'

const ARITH_OPS = ['+', '−', '×', '÷', '%'] as const

/**
 * Operands only offer types that can be combined arithmetically: numbers,
 * date-times, colours, and variables (whose runtime type is resolved later).
 * Strings, booleans, enums, lists, secrets and expressions are excluded.
 * Incompatible combinations (e.g. a colour + a number) surface at run time.
 */
const NON_ADDABLE_TYPES: ValueTypeKind[] = [
  'string', 'secret', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti'
]

/**
 * `arithmetic` — combines two operands `a`/`b` with the operator toggle
 * (+ − × ÷), producing `result`. Each operand is a typed-value selector (like
 * the `if` operands) restricted to addable types, so `2 + 3` works without
 * links; {@link ScenarioInputCell} swaps an operand for the JSON-path selector
 * once a data link is wired. Operands + operator persist in the node config.
 */
export const ArithmeticNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const rawOp = config['operator']
  const operator = typeof rawOp === 'string' && (ARITH_OPS as readonly string[]).includes(rawOp) ? rawOp : '+'
  // `b` is outlined red when it's a literal zero under a ÷ / % operator.
  const bInvalid = useScenarioFieldInvalid(id, 'b')

  const operand = (key: 'a' | 'b'): ScenarioNodeCell => ({
    id: key,
    label: key,
    port: { id: key, type: 'target' },
    content: (
      <div className={`nodrag${key === 'b' && bInvalid ? ' scn-field-invalid' : ''}`} onMouseDown={(e) => { e.stopPropagation() }}>
        <TypedValueField
          // Default to a number — arithmetic operates on numbers, not the
          // generic string default `normalizeValueType` would otherwise yield.
          value={config[key] !== undefined ? normalizeValueType(config[key]) : new NumericValue(0, 'decimal')}
          onChange={(next) => { data.onSetConfig?.(id, { [key]: serializeValueForPersistence(next) }) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={NON_ADDABLE_TYPES}
          // List EVERY run variable regardless of its declared type — arithmetic
          // coerces to a number at run time (toNumber), so a variable declared
          // as e.g. a string is still a valid operand. Without this, a variable
          // whose type the slot excludes is silently hidden from the picker.
          allowAllVariables
          dataTestId={`scn-arith-${key}`}
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
              options={ARITH_OPS}
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
    { id: 'result', label: t('scenario.arithmetic.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default ArithmeticNodeBox
