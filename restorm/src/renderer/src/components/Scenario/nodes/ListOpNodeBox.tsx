import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { SegmentedToggle } from './SegmentedToggle'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { ListValue } from '../../../../../shared/types/collections'
import { LIST_OPS, isListOp, type ListOp } from '../../../../../shared/scenarioList'

/** The `value` operand is a list, so only list-resolving types are offered. */
const LISTOP_NON_LIST_TYPES: ValueTypeKind[] = ['string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'customList', 'null']

const ORDERS = ['asc', 'desc'] as const

/**
 * `listOp` — reshapes a whole list → list (distinct from `aggregate`, which
 * reduces, and `map`/`filter`, which work item-by-item). The operation picker
 * drives the extra fields: `key` (sort/unique/groupBy), `order` (sort), `depth`
 * (flatten), `size` (chunk) and `start`/`end` (slice). A non-list operand
 * surfaces on the implicit `error` port.
 */
export const ListOpNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: ListOp = isListOp(config['op']) ? config['op'] : 'sort'
  const key = typeof config['key'] === 'string' ? config['key'] : ''
  const order = config['order'] === 'desc' ? 'desc' : 'asc'
  const depth = typeof config['depth'] === 'number' ? config['depth'] : 1
  const size = typeof config['size'] === 'number' ? config['size'] : 2
  const start = typeof config['start'] === 'number' ? config['start'] : 0
  const end = typeof config['end'] === 'number' ? config['end'] : 0

  const opOptions = LIST_OPS.map((o) => ({ text: o, label: t(`scenario.listOp.op.${o}`, o) }))

  const numRow = (cfgKey: string, val: number, testid: string, placeholder: string): ScenarioNodeCell => ({
    id: cfgKey,
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t(`scenario.listOp.${cfgKey}`, cfgKey)}</div>
        <InputBox
          value={String(val)}
          onChange={(next) => { const n = Number(next); data.onSetConfig?.(id, { [cfgKey]: Number.isFinite(n) ? n : 0 }) }}
          options={{ type: 'number', placeholder }}
          data-testid={testid}
        />
      </div>
    )
  })

  const textRow = (cfgKey: string, val: string, testid: string, placeholder: string): ScenarioNodeCell => ({
    id: cfgKey,
    content: (
      <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
        <div className="scn-field-caption">{t(`scenario.listOp.${cfgKey}`, cfgKey)}</div>
        <InputBox
          value={val}
          onChange={(next) => { data.onSetConfig?.(id, { [cfgKey]: next }) }}
          options={{ type: 'text', placeholder }}
          data-testid={testid}
        />
      </div>
    )
  })

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.listOp.value', 'list'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new ListValue()}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={LISTOP_NON_LIST_TYPES}
            allowAllVariables
            dataTestId={`scn-listop-value-${id}`}
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.listOp.operation', 'operation')}</div>
          <SelectBox
            id={`scn-listop-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, LIST_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = LIST_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-listop-op"
          />
        </div>
      )
    }
  ]

  if (op === 'sort' || op === 'unique' || op === 'groupBy') {
    rows.push(textRow('key', key, 'scn-listop-key', 'meta.tag'))
  }
  if (op === 'sort') {
    rows.push({
      id: 'order',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.listOp.order', 'order')}</div>
          <SegmentedToggle
            options={ORDERS}
            value={order}
            onChange={(next) => { data.onSetConfig?.(id, { order: next }) }}
            ariaLabel={t('scenario.listOp.order', 'order')}
          />
        </div>
      )
    })
  }
  if (op === 'flatten') rows.push(numRow('depth', depth, 'scn-listop-depth', '1'))
  if (op === 'chunk') rows.push(numRow('size', size, 'scn-listop-size', '2'))
  if (op === 'slice') {
    rows.push(numRow('start', start, 'scn-listop-start', '0'))
    rows.push(numRow('end', end, 'scn-listop-end', '0'))
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.listOp.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default ListOpNodeBox
