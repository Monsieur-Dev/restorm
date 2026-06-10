import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { ListValue, NumericValue, StringValue } from '../../../../../shared/types/collections'
import { RANDOM_OPS, isRandomOp, type RandomOp } from '../../../../../shared/scenarioRandom'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { NUMERIC_VALUE_EXCLUDE } from './valueTypePolicies'

/** seed accepts a number OR a string (both reproducible), + variable / env. */
const SEED_EXCLUDE: ValueTypeKind[] = ['dateTime', 'color', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'null', 'list']

/**
 * `random` — generates a value (no data input). The operation picker drives the
 * fields: int/float show `min`/`max`, string shows `length`, pick shows an
 * `items` list. A `seed` (always available) makes the output deterministic /
 * reproducible. The result persists nothing — only the config does.
 */
export const RandomNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: RandomOp = isRandomOp(config['op']) ? config['op'] : 'int'
  const length = typeof config['length'] === 'number' ? config['length'] : 16

  const opOptions = RANDOM_OPS.map((o) => ({ text: o, label: t(`scenario.random.op.${o}`, o) }))
  const numField = (key: 'length', val: number, fallback: number): ScenarioNodeCell => ({
    id: key,
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t(`scenario.random.${key}`, key)}</div>
        <InputBox
          value={String(val)}
          onChange={(next) => { const n = Number(next); data.onSetConfig?.(id, { [key]: Number.isFinite(n) ? n : fallback }) }}
          options={{ type: 'number' }}
          data-testid={`scn-random-${key}`}
        />
      </div>
    )
  })

  // min / max — a numeric typed value (so the user can pick a variable / env or
  // wire the port), with an input port.
  const numericRow = (key: 'min' | 'max', fallback: number): ScenarioNodeCell => ({
    id: key,
    port: { id: key, type: 'target' },
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t(`scenario.random.${key}`, key)}</div>
        <TypedValueField
          value={config[key] !== undefined ? normalizeValueType(config[key]) : new NumericValue(fallback, 'decimal')}
          onChange={(next) => { data.onSetConfig?.(id, { [key]: serializeValueForPersistence(next) }) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={NUMERIC_VALUE_EXCLUDE}
          allowAllVariables
          dataTestId={`scn-random-${key}`}
        />
      </div>
    )
  })

  const rows: ScenarioNodeCell[] = [
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.random.operation', 'operation')}</div>
          <SelectBox
            id={`scn-random-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, RANDOM_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = RANDOM_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-random-op"
          />
        </div>
      )
    }
  ]

  if (op === 'int' || op === 'float') {
    rows.push(numericRow('min', 0), numericRow('max', op === 'float' ? 1 : 100))
  }
  if (op === 'string') {
    rows.push(numField('length', length, 16))
  }
  if (op === 'pick') {
    rows.push({
      id: 'items',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.random.items', 'items')}</div>
          <TypedValueField
            value={config['items'] !== undefined ? normalizeValueType(config['items']) : new ListValue([])}
            onChange={(next) => { data.onSetConfig?.(id, { items: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            allowAllVariables
            dataTestId={`scn-random-items-${id}`}
          />
        </div>
      )
    })
  }

  rows.push({
    id: 'seed',
    port: { id: 'seed', type: 'target' },
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t('scenario.random.seed', 'seed (optional)')}</div>
        <TypedValueField
          value={config['seed'] !== undefined ? normalizeValueType(config['seed']) : new StringValue('')}
          onChange={(next) => { data.onSetConfig?.(id, { seed: serializeValueForPersistence(next) }) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={SEED_EXCLUDE}
          allowAllVariables
          dataTestId={`scn-random-seed-${id}`}
        />
      </div>
    )
  })

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.random.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default RandomNodeBox
