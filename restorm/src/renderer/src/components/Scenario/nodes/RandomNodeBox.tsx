import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { ListValue } from '../../../../../shared/types/collections'
import { RANDOM_OPS, isRandomOp, type RandomOp } from '../../../../../shared/scenarioRandom'

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
  const min = typeof config['min'] === 'number' ? config['min'] : 0
  const max = typeof config['max'] === 'number' ? config['max'] : (op === 'float' ? 1 : 100)
  const length = typeof config['length'] === 'number' ? config['length'] : 16
  const seedRaw = config['seed']
  const seed = typeof seedRaw === 'string' ? seedRaw : typeof seedRaw === 'number' ? String(seedRaw) : ''

  const opOptions = RANDOM_OPS.map((o) => ({ text: o, label: t(`scenario.random.op.${o}`, o) }))
  const numField = (key: 'min' | 'max' | 'length', val: number, fallback: number): ScenarioNodeCell => ({
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
    rows.push(numField('min', min, 0), numField('max', max, op === 'float' ? 1 : 100))
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
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t('scenario.random.seed', 'seed (optional)')}</div>
        <InputBox
          value={seed}
          onChange={(next) => { data.onSetConfig?.(id, { seed: next }) }}
          options={{ type: 'text', placeholder: t('scenario.random.seedPlaceholder', 'reproducible') }}
          data-testid="scn-random-seed"
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
