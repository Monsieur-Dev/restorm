import React from 'react'
import { type NodeProps, useNodeConnections } from '@xyflow/react'
import { Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioPathSelector } from './ScenarioPathSelector'
import { useScenarioFieldInvalid } from '../scenarioErrorsContext'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { ListValue } from '../../../../../shared/types/collections'
import { useAllEnvValueTypeGroups, type EnvValueTypeGroup } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence, type PersistedValue } from '../../../../../shared/utils/valuePersistence'
import { LIST_MUTATION_DEFAULT_VALUE_ID } from '../../../../../shared/scenarioListMutationValues'

/** The `list` target offers only list-typed sources: a list literal, an
 * enum/custom list, or a list-typed variable (the value selector filters the
 * Variables menu by each variable's declared type). Scalars are excluded. */
const NON_LIST_TYPES: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'customList'
]

const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

interface ValueRow {
  id: string
  value: PersistedValue
}

function valueRowId(): string {
  return `val-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readValues(config: Record<string, unknown>): ValueRow[] {
  const raw = config['values']
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is ValueRow => typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string')
}

/** A single value row inside the list mutation editor — its own component so
 * `useNodeConnections` (a React hook) can run per port: when an upstream edge
 * feeds this row, the cell swaps from the literal selector to the JSON-path
 * selector (same affordance as the object node's property rows). */
interface ValueRowCellProps {
  nodeId: string
  row: ValueRow
  scenarioId?: string | undefined
  valueTypeGroups: EnvValueTypeGroup[]
  t: TFunction
  onValueChange: (value: PersistedValue) => void
  onRemove: () => void
  removeLabel: string
  dataTestId: string
}

const ValueRowCell: React.FC<ValueRowCellProps> = ({
  nodeId,
  row,
  scenarioId,
  valueTypeGroups,
  onValueChange,
  onRemove,
  removeLabel,
  dataTestId
}) => {
  const connections = useNodeConnections({ handleType: 'target', handleId: row.id })
  const incoming = connections[0]
  const valueInvalid = useScenarioFieldInvalid(nodeId, row.id)
  return (
    <div className="nodrag" onMouseDown={stop}>
      {incoming ? (
        <ScenarioPathSelector
          edgeId={incoming.edgeId}
          sourceNodeId={incoming.source}
          invalid={valueInvalid}
          {...(scenarioId !== undefined ? { scenarioId } : {})}
        />
      ) : (
        <TypedValueField
          value={normalizeValueType(row.value)}
          onChange={(next) => { onValueChange(serializeValueForPersistence(next)) }}
          valueTypeGroups={valueTypeGroups}
          allowAllVariables
          allowEnvironment
          allowNull
          allowList
          onRemove={onRemove}
          removeLabel={removeLabel}
          dataTestId={dataTestId}
        />
      )}
    </div>
  )
}

/**
 * `addToList` / `removeFromList` — both render the same box: a `list` target (a
 * list-typed source / variable, connectable) and N `values` rows (the items to
 * add/remove, each connectable via its own port, exactly like the object node's
 * properties), reducing to a new `result` list. The kind (add vs remove) only
 * changes the executor + the header label/icon, so one box serves both. The "+"
 * adds a value row; each row's type menu offers "Supprimer". Rows persist in
 * `config.values` as `{ id, value }[]`.
 */
export const ListMutationNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const values = readValues(config)
  // A fresh / emptied box shows ONE ready-to-fill value row by default. It is
  // NOT persisted (so an unconfigured box stays empty) — it materialises into
  // config only once the user edits it, via the row handlers below.
  const displayValues: ValueRow[] = values.length > 0
    ? values
    : [{ id: LIST_MUTATION_DEFAULT_VALUE_ID, value: { type: 'string', value: '' } }]

  const setValues = (next: ValueRow[]): void => { data.onSetConfig?.(id, { values: next }) }

  const rows: ScenarioNodeCell[] = [
    {
      id: 'list',
      label: t('scenario.listMutation.list', 'list'),
      port: { id: 'list', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={stop}>
          <TypedValueField
            // The list target only accepts list-typed sources, so an
            // unconfigured field starts as an empty List — never a string (which
            // isn't even offered in this field's type menu).
            value={config['list'] !== undefined ? normalizeValueType(config['list']) : new ListValue([])}
            onChange={(next) => { data.onSetConfig?.(id, { list: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={NON_LIST_TYPES}
            allowList
            dataTestId="scn-listmut-list"
          />
        </div>
      )
    }
  ]
  displayValues.forEach((row) => {
    rows.push({
      id: row.id,
      label: t('scenario.listMutation.values', 'values'),
      port: { id: row.id, type: 'target' },
      content: (
        <ValueRowCell
          nodeId={id}
          row={row}
          {...(data.scenarioId !== undefined ? { scenarioId: data.scenarioId } : {})}
          valueTypeGroups={valueTypeGroups}
          t={t}
          onValueChange={(value) => { setValues(displayValues.map((x) => (x.id === row.id ? { ...x, value } : x))) }}
          onRemove={() => { setValues(displayValues.filter((x) => x.id !== row.id)) }}
          removeLabel={t('scenario.listMutation.removeValue', 'Supprimer')}
          dataTestId={`scn-listmut-${row.id}`}
        />
      )
    })
  })
  rows.push({
    id: 'add-value',
    content: (
      <Button
        small
        secondary
        icon="add"
        onClick={() => { setValues([...displayValues, { id: valueRowId(), value: { type: 'string', value: '' } }]) }}
        options={{ ariaLabel: t('scenario.listMutation.addValue', 'Add value'), title: t('scenario.listMutation.addValue', 'Add value') }}
        data-testid="scenario-listmut-add-value"
      />
    )
  })

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.listMutation.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default ListMutationNodeBox
