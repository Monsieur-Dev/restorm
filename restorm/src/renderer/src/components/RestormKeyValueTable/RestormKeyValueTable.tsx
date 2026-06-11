import React, { useCallback, useRef, useEffect } from 'react'
import {
  KeyValueTable,
  InputBox,
  type KeyValueTableHandle,
  type KeyValueTableRow,
  type CellRendererProps,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { TypedValueField } from '../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../hooks/useAllEnvValueTypeGroups'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import type { KeyValue, ValueType } from '../../../../shared/types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, ExpressionValue, BooleanValue, EnumValue, EnumListValue, CustomListValue, CustomListMultiValue } from '../../../../shared/types/collections'
import { SecretValue } from '../../../../shared/types/valueTypes/SecretValue'
import { inferValueFromString } from '../../../../shared/utils/valueCasting'
import { normalizeValueType } from '../../utils/normalizeValueType'
import { serializeValueShape } from './serializeValueShape'

export type VariableContext = Record<string, string>

export interface RestormKeyValueTableProps {
  /** Base variables visible to all rows (environment, folder, etc.) */
  variables: VariableDefinition[]
  /** Handlebars helpers for autocompletion */
  helpers?: TranslatedHelperDefinition[]
  /** Initial rows to populate the table */
  initialRows?: KeyValue[]
  /**
   * Optional callback when rows change (for persisting edits).
   */
  onRowsChange?: (rows: KeyValue[]) => void
  /**
   * Optional persistence key for column widths. Passed through to the
   * underlying Table, which saves widths to localStorage under
   * `ecu:table:<persistenceId>:column-widths`.
   */
  persistenceId?: string | undefined
  /** Optional test id applied to the table root element. */
  'data-testid'?: string
}

const RestormKeyValueTableInner = React.forwardRef<KeyValueTableHandle, RestormKeyValueTableProps>((
  {
    variables,
    helpers = [],
    initialRows,
    onRowsChange,
    persistenceId,
    'data-testid': dataTestId
  },
  ref
) => {
  // The type-pick menu offers enum / custom types from every API (env folder)
  // in the project, grouped per API — not just the request's nearest folder.
  const valueTypeGroups = useAllEnvValueTypeGroups()
  // Keep refs to avoid recreating cell renderers
  const variablesRef = useRef(variables)
  const helpersRef = useRef(helpers)
  const valueTypeByRowIdRef = useRef<Map<string, ValueType>>(new Map())
  const initialRowsRef = useRef<KeyValue[] | undefined>(initialRows)
  // Mirror the persistence callback so the (stable) value cell renderer can
  // force a rebuild on a type change without listing it as a dependency.
  const onRowsChangeRef = useRef(onRowsChange)
  useEffect(() => { onRowsChangeRef.current = onRowsChange }, [onRowsChange])
  // Mirror the per-API groups into a ref so the (stable) value cell renderer
  // reads the latest groups without listing them as a dependency — the hook
  // returns a fresh array on every render, which would otherwise thrash the
  // renderer identity and remount every cell. This matches the variables /
  // helpers refs above; the menu is built lazily on open from the current ref.
  const valueTypeGroupsRef = useRef(valueTypeGroups)
  useEffect(() => { valueTypeGroupsRef.current = valueTypeGroups }, [valueTypeGroups])

  // Update refs via useEffect to avoid accessing during render
  useEffect(() => {
    variablesRef.current = variables
  }, [variables])

  useEffect(() => {
    helpersRef.current = helpers
  }, [helpers])

  useEffect(() => {
    initialRowsRef.current = initialRows
  }, [initialRows])

  // Key-based type map for rows that don't have an id (e.g. freshly imported KeyValues).
  // The ValueCellRenderer uses this as a fallback when the id-based ref has no match.
  const valueTypeByKeyRef = useRef(new Map<string, ValueType>())

  useEffect(() => {
    if (!initialRows) return
    const nextMap = new Map<string, ValueType>()
    const nextKeyMap = new Map<string, ValueType>()
    for (const row of initialRows) {
      const normalized = normalizeValueType(row.value as unknown)
      if (row.id) {
        nextMap.set(row.id, normalized)
      }
      if (row.key) {
        nextKeyMap.set(row.key, normalized)
      }
    }
    valueTypeByRowIdRef.current = nextMap
    valueTypeByKeyRef.current = nextKeyMap
  }, [initialRows])

  const tableInitialRows = React.useMemo<KeyValueTableRow[] | undefined>(() => {
    if (!initialRows) return undefined
    return initialRows.map((r) => ({
      id: r.id,
      key: r.key,
      value: normalizeValueType(r.value as unknown).toString(),
      description: r.description,
      enabled: r.enabled
    }))
  }, [initialRows])

  // Ref mirror of tableInitialRows for use inside stable callbacks
  // (avoids recreating cell renderers when initialRows changes).
  const tableInitialRowsRef = useRef(tableInitialRows)
  useEffect(() => { tableInitialRowsRef.current = tableInitialRows }, [tableInitialRows])

  const handleRowsChange = useCallback((rows: KeyValueTableRow[]): void => {
    if (!onRowsChange) return

    const next: KeyValue[] = rows.map((r) => {
      const rowId = r.id
      const currentType = rowId ? valueTypeByRowIdRef.current.get(rowId) : undefined
      const raw = r.value

      let nextValue: ValueType
      if (currentType instanceof DateTimeValue) {
        const parsed = new Date(raw)
        nextValue = Number.isNaN(parsed.getTime()) ? currentType : new DateTimeValue(parsed, currentType.format)
      } else if (currentType instanceof NumericValue) {
        const parsed = Number(raw)
        nextValue = Number.isFinite(parsed) ? new NumericValue(parsed, currentType.format) : currentType
      } else if (currentType instanceof ColorValue) {
        nextValue = new ColorValue(raw)
      } else if (currentType instanceof SecretValue) {
        const updated = new SecretValue(currentType.source, currentType.params)
        updated.resolved = raw
        nextValue = updated
      } else if (currentType instanceof ExpressionValue) {
        nextValue = new ExpressionValue(raw)
      } else if (currentType instanceof BooleanValue) {
        nextValue = new BooleanValue(raw === 'true' || raw === '1')
      } else if (currentType instanceof EnumValue) {
        nextValue = new EnumValue(raw, currentType.enumDefinitionId)
      } else if (currentType instanceof EnumListValue) {
        nextValue = new EnumListValue(raw ? raw.split(',').map((s) => s.trim()) : [], currentType.enumDefinitionId)
      } else if (currentType instanceof CustomListValue) {
        nextValue = new CustomListValue(currentType.listId, raw)
      } else if (currentType instanceof CustomListMultiValue) {
        nextValue = new CustomListMultiValue(currentType.listId, raw ? raw.split(',').map((s) => s.trim()) : [])
      } else {
        nextValue = new StringValue(raw)
      }

      // Auto-toggle of the enabled flag against value emptiness now
      // lives inside `KeyValueTable.updateData` (via the
      // `autoToggleEnabledOnEmpty` prop we set above), so the local
      // state + the visible checkbox stay in sync. Doing it here
      // would only update the upstream data layer and leave the
      // checkbox visually checked.
      if (rowId) {
        valueTypeByRowIdRef.current.set(rowId, nextValue)
      }

      return {
        id: rowId,
        key: r.key,
        value: nextValue,
        description: r.description,
        enabled: r.enabled
      }
    })

    onRowsChange(next)
  }, [onRowsChange])

  // Simple InputBox renderer for keys (no variable resolution needed for keys)
  const KeyCellRenderer = useCallback<React.FC<CellRendererProps>>(
    ({ value, onChange }) => (
      <InputBox
        value={value}
        onChange={onChange}
        options={{ type: 'text' }}
        {...(dataTestId && { 'data-testid': `${dataTestId}-key-input` })}
      />
    ),
    [dataTestId]
  )

  // Value cell: resolve the row's authoritative ValueType (id ref →
  // initialRows by id/key → string inference) then hand it to the reusable
  // TypedValueField. Its `onChange(next)` writes the ValueType back to the
  // side-channel ref, drives the string `onChange` (so the table cell stays
  // in sync), and — when the *kind* changed but the display string didn't —
  // forces a full `onRowsChange` rebuild so the new ValueType is persisted
  // even though the visible cell text is unchanged.
  const ValueCellRenderer = useCallback(
    ({ value, onChange, rowId }: CellRendererProps) => {
      const id = rowId
      let existing = id ? valueTypeByRowIdRef.current.get(id) : undefined

      if (id && !existing) {
        // The useEffect that populates valueTypeByRowIdRef from initialRows
        // runs AFTER render, so on the first render with new data the ref
        // may not contain the correct type yet. Look up the authoritative
        // ValueType directly from initialRows before falling back to
        // string-based inference. Try by ID first, then by key (for imported
        // KeyValues that don't have a persistent ID yet).
        const tableRow = tableInitialRowsRef.current?.find((tr) => tr.id === id)
        const rowKey = tableRow?.key
        const sourceRow = initialRowsRef.current?.find((r) => r.id === id)
          ?? (rowKey ? initialRowsRef.current?.find((r) => r.key === rowKey) : undefined)
        if (sourceRow) {
          existing = normalizeValueType(sourceRow.value as unknown)
        } else {
          const cast = inferValueFromString(value)
          if (cast.kind === 'color') {
            existing = new ColorValue(cast.color)
          } else if (cast.kind === 'datetime') {
            existing = new DateTimeValue(cast.date, cast.format)
          } else if (cast.kind === 'numeric') {
            existing = new NumericValue(cast.number, cast.format)
          } else {
            existing = new StringValue(value)
          }
        }
        valueTypeByRowIdRef.current.set(id, existing)
      }

      const resolved = id ? (valueTypeByRowIdRef.current.get(id) ?? new StringValue(value)) : new StringValue(value)
      const priorSerialized = serializeValueShape(resolved)

      return (
        <TypedValueField
          value={resolved}
          onChange={(next) => {
            if (id) valueTypeByRowIdRef.current.set(id, next)
            onChange(next.toString())
            // The table only emits `onRowsChange` when the cell's display
            // STRING changes. An edit that keeps the same string but mutates
            // the underlying ValueType — a type recast (string → secret) OR an
            // in-place config change that doesn't surface in `toString()` (e.g.
            // editing a secret's `params.name`, whose `toString()` stays the
            // resolved/empty value) — would otherwise never persist. Compare
            // the serialized shapes and force the rebuild on ANY structural
            // change, not just a kind change.
            const forceRebuild = onRowsChangeRef.current
            if (serializeValueShape(next) !== priorSerialized && id && initialRowsRef.current && forceRebuild) {
              const nextRows = initialRowsRef.current.map((r) => (r.id === id ? { ...r, value: next } : r))
              forceRebuild(nextRows)
            }
          }}
          variables={variablesRef.current}
          helpers={helpersRef.current}
          valueTypeGroups={valueTypeGroupsRef.current}
          {...(id !== undefined && { expressionVariableId: id })}
          {...(dataTestId && { dataTestId })}
        />
      )
    },
    [dataTestId]
  )

  return (
    <KeyValueTable
      ref={ref}
      initialRows={tableInitialRows}
      onRowsChange={handleRowsChange}
      renderKeyCell={KeyCellRenderer}
      renderValueCell={ValueCellRenderer}
      autoToggleEnabledOnEmpty
      {...(persistenceId && { persistenceId })}
      {...(dataTestId && { 'data-testid': dataTestId })}
    />
  )
})

RestormKeyValueTableInner.displayName = 'RestormKeyValueTable'

export const RestormKeyValueTable = React.memo(RestormKeyValueTableInner)
