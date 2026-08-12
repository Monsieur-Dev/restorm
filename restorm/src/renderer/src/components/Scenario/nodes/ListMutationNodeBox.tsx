import React from 'react'
import { type NodeProps, useNodeConnections } from '@xyflow/react'
import { Button, Toggle } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioPathSelector } from './ScenarioPathSelector'
import { useScenarioFieldInvalid } from '../scenarioErrorsContext'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { VariableValue } from '../../../../../shared/types/collections'
import { useAllEnvValueTypeGroups, type EnvValueTypeGroup } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence, type PersistedValue } from '../../../../../shared/utils/valuePersistence'
import { LIST_MUTATION_DEFAULT_VALUE_ID } from '../../../../../shared/scenarioListMutationValues'

/** The `list` target is a list-typed SLOT, never an authoring field: you pick a
 * variable (the Variables menu) or wire a list in. Authoring a list literal here
 * makes no sense — you'd be creating a list just to add/remove from it — so every
 * literal type (incl. `list`, `null`, environment) is excluded; only `variable`
 * remains. */
const LIST_TARGET_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti'
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

/** The `list` TARGET cell — a list-typed variable picker (no literal authoring),
 * swapped for the JSON-path selector when a list is wired into the `list` port.
 * Mirrors the getVariable selector + the value rows' wired-swap. */
const ListTargetCell: React.FC<{
  nodeId: string
  scenarioId?: string | undefined
  value: PersistedValue | undefined
  valueTypeGroups: EnvValueTypeGroup[]
  onChange: (value: PersistedValue) => void
}> = ({ nodeId, scenarioId, value, valueTypeGroups, onChange }) => {
  const connections = useNodeConnections({ handleType: 'target', handleId: 'list' })
  const incoming = connections[0]
  const invalid = useScenarioFieldInvalid(nodeId, 'list')
  return (
    <div className="nodrag" onMouseDown={stop}>
      {incoming ? (
        <ScenarioPathSelector
          edgeId={incoming.edgeId}
          sourceNodeId={incoming.source}
          invalid={invalid}
          {...(scenarioId !== undefined ? { scenarioId } : {})}
        />
      ) : (
        <TypedValueField
          // Variable-only: pick a list-typed variable. No literal authoring
          // (excludeTypes hides every value type; no allowList/allowNull/
          // allowEnvironment), so the only choice is an existing variable. A
          // legacy non-variable value (e.g. an old inline list literal) is
          // coerced to an empty variable picker rather than rendering the
          // dropped list editor.
          value={value !== undefined && (value as { type?: unknown }).type === 'variable' ? normalizeValueType(value) : new VariableValue('')}
          onChange={(next) => { onChange(serializeValueForPersistence(next)) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={LIST_TARGET_EXCLUDE}
          allowAllVariables
          dataTestId="scn-listmut-list"
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

  // The "update the source variable" toggle is only meaningful when the `list`
  // target is an (un-wired) variable reference — there's a variable to write the
  // result back into. Wired / literal targets have no variable, so the toggle is
  // hidden. Default OFF: the action stays pure (emits `result`) unless opted in.
  const listWired = useNodeConnections({ handleType: 'target', handleId: 'list' }).length > 0
  const listRef = config['list'] as { type?: unknown; value?: unknown } | undefined
  const listVarName = !listWired && listRef?.type === 'variable' && typeof listRef.value === 'string' ? listRef.value.trim() : ''
  const updateVar = config['updateSourceVariable'] === true

  const rows: ScenarioNodeCell[] = [
    {
      id: 'list',
      label: t('scenario.listMutation.list', 'list'),
      port: { id: 'list', type: 'target' },
      content: (
        <ListTargetCell
          nodeId={id}
          {...(data.scenarioId !== undefined ? { scenarioId: data.scenarioId } : {})}
          value={config['list'] as PersistedValue | undefined}
          valueTypeGroups={valueTypeGroups}
          onChange={(next) => { data.onSetConfig?.(id, { list: serializeValueForPersistence(next) }) }}
        />
      )
    }
  ]
  if (listVarName) {
    const updateLabel = t('scenario.listMutation.updateVariable', 'Update the source variable')
    rows.push({
      id: 'update-variable',
      content: (
        <div className="scn-listmut-update nodrag" onMouseDown={stop}>
          <Toggle
            checked={updateVar}
            onChange={(checked) => { data.onSetConfig?.(id, { updateSourceVariable: checked }) }}
            aria-label={updateLabel}
            data-testid="scn-listmut-update-variable"
          />
          <span className="scn-field-caption">{updateLabel}</span>
        </div>
      )
    })
  }
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
