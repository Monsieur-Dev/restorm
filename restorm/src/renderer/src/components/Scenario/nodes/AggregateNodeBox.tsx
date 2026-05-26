import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { buildListItemsCell } from './collectionItemsCell'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'

/** Reduction operations. `count` needs no field; the others read a numeric /
 * string value per item (the optional `field` path, else the item itself);
 * `join` also takes a separator. */
const AGG_OPS = ['count', 'sum', 'min', 'max', 'average', 'join'] as const
type AggOp = (typeof AGG_OPS)[number]
const AGG_OP_SET = new Set<string>(AGG_OPS)
const isAggOp = (v: unknown): v is AggOp => typeof v === 'string' && AGG_OP_SET.has(v)
const OPS_WITH_FIELD: readonly AggOp[] = ['sum', 'min', 'max', 'average', 'join']

/**
 * `aggregate` — reduce a collection to a single `result`. The operation picker
 * (count / sum / min / max / average / join) drives which extra inputs show: a
 * `field` path for the value-bearing ops, plus a `separator` for `join`. `items`
 * is the shared list-typed collection selector; a header trigger lets it chain.
 * Operation + field + separator persist in the node config bag.
 */
export const AggregateNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const op: AggOp = isAggOp(config['op']) ? config['op'] : 'count'
  const field = typeof config['field'] === 'string' ? config['field'] : ''
  const separator = typeof config['separator'] === 'string' ? config['separator'] : ','

  const opOptions = AGG_OPS.map((o) => ({ text: o, label: t(`scenario.aggregate.op.${o}`, o) }))

  const rows: ScenarioNodeCell[] = [
    buildListItemsCell({ id, data, valueTypeGroups, label: t('scenario.aggregate.items', 'items'), dataTestId: 'scn-aggregate-items' }),
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <SelectBox
            id={`scn-aggregate-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, AGG_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = AGG_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-aggregate-op"
          />
        </div>
      )
    }
  ]

  if (OPS_WITH_FIELD.includes(op)) {
    rows.push({
      id: 'field',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.aggregate.field', 'field')}</div>
          <InputBox
            value={field}
            onChange={(next) => { data.onSetConfig?.(id, { field: next }) }}
            options={{ type: 'text', placeholder: '$.price' }}
            data-testid="scn-aggregate-field"
          />
        </div>
      )
    })
  }

  if (op === 'join') {
    rows.push({
      id: 'separator',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.aggregate.separator', 'separator')}</div>
          <InputBox
            value={separator}
            onChange={(next) => { data.onSetConfig?.(id, { separator: next }) }}
            options={{ type: 'text' }}
            data-testid="scn-aggregate-separator"
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.aggregate.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default AggregateNodeBox
