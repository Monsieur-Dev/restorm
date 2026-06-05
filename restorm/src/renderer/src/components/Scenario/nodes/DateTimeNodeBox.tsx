import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { DATETIME_OPS, DATETIME_UNITS, isDateTimeOp, isDateTimeUnit, type DateTimeOp, type DateTimeUnit } from '../../../../../shared/scenarioDateTime'

/**
 * `datetime` — transforms an existing date wired/inline on `value` (the clock
 * itself is the `now` node). The operation picker drives the extra fields:
 * add/subtract show `amount` + `unit`; format shows a luxon `format` pattern;
 * diff shows a second date `other` + `unit` and returns `other − value` as a
 * number. An unreadable date surfaces on the implicit `error` port. Every field
 * persists in the node config.
 */
export const DateTimeNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: DateTimeOp = isDateTimeOp(config['op']) ? config['op'] : 'add'
  const amount = typeof config['amount'] === 'number' ? config['amount'] : 0
  const unit: DateTimeUnit = isDateTimeUnit(config['unit']) ? config['unit'] : 'days'
  const format = typeof config['format'] === 'string' ? config['format'] : ''

  const opOptions = DATETIME_OPS.map((o) => ({ text: o, label: t(`scenario.datetime.op.${o}`, o) }))
  const unitOptions = DATETIME_UNITS.map((u) => ({ text: u, label: t(`scenario.datetime.unit.${u}`, u) }))

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.datetime.value', 'date'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            allowAllVariables
            dataTestId={`scn-datetime-value-${id}`}
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.datetime.operation', 'operation')}</div>
          <SelectBox
            id={`scn-datetime-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, DATETIME_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = DATETIME_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-datetime-op"
          />
        </div>
      )
    }
  ]

  if (op === 'add' || op === 'subtract') {
    rows.push({
      id: 'amount',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.datetime.amount', 'amount')}</div>
          <InputBox
            value={String(amount)}
            onChange={(next) => { const n = Number.parseFloat(next); data.onSetConfig?.(id, { amount: Number.isFinite(n) ? n : 0 }) }}
            options={{ type: 'number', placeholder: '1' }}
            data-testid="scn-datetime-amount"
          />
        </div>
      )
    })
  }

  if (op === 'diff') {
    rows.push({
      id: 'other',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.datetime.other', 'second date')}</div>
          <TypedValueField
            value={config['other'] !== undefined ? normalizeValueType(config['other']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { other: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            allowAllVariables
            dataTestId={`scn-datetime-other-${id}`}
          />
        </div>
      )
    })
  }

  if (op === 'add' || op === 'subtract' || op === 'diff') {
    rows.push({
      id: 'unit',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.datetime.unitLabel', 'unit')}</div>
          <SelectBox
            id={`scn-datetime-unit-${id}`}
            className=""
            options={unitOptions}
            selected={Math.max(0, DATETIME_UNITS.indexOf(unit))}
            onDidSelect={(d: ISelectData) => { const next = DATETIME_UNITS[d.index]; if (next) data.onSetConfig?.(id, { unit: next }) }}
            data-testid="scn-datetime-unit"
          />
        </div>
      )
    })
  }

  if (op === 'format') {
    rows.push({
      id: 'format',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.datetime.format', 'format')}</div>
          <InputBox
            value={format}
            onChange={(next) => { data.onSetConfig?.(id, { format: next }) }}
            options={{ type: 'text', placeholder: 'yyyy-LL-dd' }}
            data-testid="scn-datetime-format"
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.datetime.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default DateTimeNodeBox
