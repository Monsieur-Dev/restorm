import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { NumericValue } from '../../../../../shared/types/collections'
import { MATH_OPS, MATH_BINARY_OPS, MATH_CLAMP_OP, isMathOp, type MathOp } from '../../../../../shared/scenarioMath'

/** Scalar math operands only offer numbers (and variables / environment whose
 * runtime value resolves later). */
const MATH_NON_NUMBER_TYPES: ValueTypeKind[] = ['string', 'secret', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'dateTime', 'color', 'list', 'null']

/**
 * `math` — scalar functions that complement `arithmetic` (which only does the
 * binary + − × ÷ % ^): round / floor / ceil / trunc / abs / sign / sqrt plus the
 * two-operand min / max and the bounded clamp. The op picker drives the extra
 * fields: `precision` (round), the second operand `b` (min/max), and the
 * `min`/`max` bounds (clamp). A non-finite operand surfaces on the `error` port.
 */
export const MathNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: MathOp = isMathOp(config['op']) ? config['op'] : 'round'
  const precision = typeof config['precision'] === 'number' ? config['precision'] : 0

  const opOptions = MATH_OPS.map((o) => ({ text: o, label: t(`scenario.math.op.${o}`, o) }))

  const numberField = (cfgKey: string, captionKey: string, captionDefault: string): ScenarioNodeCell => ({
    id: cfgKey,
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t(captionKey, captionDefault)}</div>
        <TypedValueField
          value={config[cfgKey] !== undefined ? normalizeValueType(config[cfgKey]) : new NumericValue(0, 'decimal')}
          onChange={(next) => { data.onSetConfig?.(id, { [cfgKey]: serializeValueForPersistence(next) }) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={MATH_NON_NUMBER_TYPES}
          allowAllVariables
          dataTestId={`scn-math-${cfgKey}-${id}`}
        />
      </div>
    )
  })

  const rows: ScenarioNodeCell[] = [
    {
      id: 'a',
      label: t('scenario.math.a', 'value'),
      port: { id: 'a', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['a'] !== undefined ? normalizeValueType(config['a']) : new NumericValue(0, 'decimal')}
            onChange={(next) => { data.onSetConfig?.(id, { a: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={MATH_NON_NUMBER_TYPES}
            allowAllVariables
            dataTestId={`scn-math-a-${id}`}
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.math.operation', 'operation')}</div>
          <SelectBox
            id={`scn-math-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, MATH_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = MATH_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-math-op"
          />
        </div>
      )
    }
  ]

  if (op === 'round') {
    rows.push({
      id: 'precision',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.math.precision', 'precision')}</div>
          <InputBox
            value={String(precision)}
            onChange={(next) => { const n = Number(next); data.onSetConfig?.(id, { precision: Number.isFinite(n) ? n : 0 }) }}
            options={{ type: 'number', placeholder: '0' }}
            data-testid="scn-math-precision"
          />
        </div>
      )
    })
  }
  if (MATH_BINARY_OPS.includes(op)) {
    rows.push(numberField('b', 'scenario.math.b', 'with'))
  }
  if (op === MATH_CLAMP_OP) {
    rows.push(numberField('min', 'scenario.math.min', 'min'))
    rows.push(numberField('max', 'scenario.math.max', 'max'))
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.math.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default MathNodeBox
