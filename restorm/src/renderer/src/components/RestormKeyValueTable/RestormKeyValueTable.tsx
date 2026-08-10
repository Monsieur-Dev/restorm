import React, { useCallback, useRef, useEffect } from 'react'
import {
  KeyValueTable,
  InputBox,
  fieldDiffStyle,
  type KeyValueTableHandle,
  type KeyValueTableRow,
  type CellRendererProps,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { TypedValueField } from '../TypedValueField'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
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
  /** Locks the whole table read-only — see the `KeyValueTable` doc for the
   * exact scope (toggle/delete/reorder disabled, cells forwarded `disabled`). */
  disabled?: boolean
  /** Conflict-resolution row highlight: the KEYS of rows that differ from the
   * other side. When provided, each matching row's key + value cells get the
   * field-diff border (`fieldDiffStyle`). Left `undefined` outside the conflict
   * view, in which case no per-cell wrapper is rendered at all. */
  highlightRowKeys?: readonly string[]
  /**
   * Render the KEY cell with the Handlebars-aware editor — syntax
   * highlighting + `{{}}` autocomplete suggestions, the same experience the
   * request URL field already has — instead of a bare `InputBox`. Scoped to
   * the KEY on purpose: a key IS resolved at execution time, whereas a plain
   * string VALUE is literal (only an `ExpressionValue` value resolves), so
   * the value cell keeps its plain input rather than advertising a
   * substitution that never happens. Off by default: only the header / param
   * (path+query) / metadata tables opt in; every other consumer of this
   * table (env-folder variables, the body form-fields table, …) is
   * unaffected. When the cell is locked (`disabled`), the plain `InputBox`
   * is kept regardless — the variable-aware editor has no disabled/read-only
   * mode of its own, so the locked-row visual falls back rather than losing
   * the "greyed out" affordance.
   */
  variableAware?: boolean
}

/** Reserve a transparent 1px border on the cell so toggling the diff border on
 * doesn't shift the row — same reserve-border trick the whole-section conflict
 * wrapper uses. */
function cellDiffStyle(differs: boolean): React.CSSProperties {
  return { border: '1px solid transparent', borderRadius: 2, boxSizing: 'border-box', ...fieldDiffStyle(differs) }
}

const RestormKeyValueTableInner = React.forwardRef<KeyValueTableHandle, RestormKeyValueTableProps>((
  {
    variables,
    helpers = [],
    initialRows,
    onRowsChange,
    persistenceId,
    'data-testid': dataTestId,
    disabled = false,
    highlightRowKeys,
    variableAware = false
  },
  ref
) => {
  // Conflict-view row highlight. `highlightActive` gates the extra per-cell
  // wrapper so tables outside the conflict view render exactly as before.
  const highlightActive = highlightRowKeys !== undefined
  const highlightKeySet = React.useMemo(() => new Set(highlightRowKeys ?? []), [highlightRowKeys])
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
  // Read the groups DIRECTLY rather than through a ref.
  //
  // A ref used to hold them, on the stated grounds that "the hook returns a
  // fresh array on every render" and listing it would remount every cell.
  // That is true of `useAllEnvValueTypes`, but NOT of the grouped hook used
  // here: it memoises on `[collections, version]`, so its identity moves only
  // when the tree actually mutates or a FOLDER_UPDATED lands — never merely
  // because this component re-rendered.
  //
  // The ref's cost was a real bug: it kept the DATA fresh while nothing asked
  // the cells to look again, so renaming a custom value list left every open
  // request's type menu showing the old name until the tab was closed and
  // reopened. A ref cannot notify.

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
      // Three-level type lookup: id map → key map → the ORIGINAL KeyValue
      // from `initialRows`. The maps are populated by an effect, so an
      // `onRowsChange` fired during a mount/echo window can find them
      // EMPTY — and a row whose id was regenerated misses the id map for
      // good. Falling through to `new StringValue(raw)` must stay the very
      // last resort: for a SECRET row the display string IS the plaintext,
      // so the string fallback would persist the secret IN CLEAR in the
      // project file (and the sidecar entry would silently vanish).
      //
      // Whatever the lookup finds is re-normalized through the LOCAL
      // `normalizeValueType`: an instance minted by another copy of the
      // valueTypes module (HMR, duplicated module graph) defeats every
      // `instanceof` below, and a persisted POJO was never an instance at
      // all — both would otherwise fall through to the string branch.
      const originalValue = initialRowsRef.current?.find(
        (ir) => (rowId !== undefined && ir.id === rowId) || (r.key !== '' && ir.key === r.key)
      )?.value
      const found = (rowId ? valueTypeByRowIdRef.current.get(rowId) : undefined)
        ?? (r.key ? valueTypeByKeyRef.current.get(r.key) : undefined)
        ?? originalValue
      const currentType = found === undefined ? undefined : normalizeValueType(found as unknown)
      const raw = r.value

      // A row whose display string is UNCHANGED passes through with its
      // original value object. `onRowsChange` rebuilds every row on any
      // table change (including mount/echo emits that touched nothing), and
      // re-encoding a value we cannot positively re-type is exactly how an
      // untouched secret gets degraded to a plain string — persisting its
      // plaintext in the project file. Only a row the user actually edited
      // (raw differs from the original's own display encoding) goes through
      // the re-typing cascade below.
      const originalNormalized = originalValue !== undefined ? normalizeValueType(originalValue as unknown) : undefined
      if (originalNormalized?.toString() === raw) {
        if (rowId) {
          valueTypeByRowIdRef.current.set(rowId, originalNormalized)
        }
        return {
          id: rowId,
          key: r.key,
          value: originalNormalized,
          description: r.description,
          enabled: r.enabled
        }
      }

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

  // Key cell renderer: a plain InputBox by default, or the Handlebars-aware
  // VariableInputBox when `variableAware` opts in (header / param / metadata
  // tables) — see the `variableAware` prop doc. A locked (disabled) row
  // always keeps the plain InputBox: the variable-aware editor has no
  // disabled affordance of its own.
  const KeyCellRenderer = useCallback<React.FC<CellRendererProps>>(
    ({ value, onChange, disabled: cellDisabled }) => {
      const cell = (variableAware && !cellDisabled) ? (
        <RestormVariableInputBox
          value={value}
          onChange={onChange}
          variables={variablesRef.current}
          helpers={helpersRef.current}
          // No `variableId`: that wires up the per-row "resolved value"
          // tooltip (`useVariableTransform`), which the backend only ever
          // populates from the row's VALUE (`ContextService.resolveKeyValue`
          // reads `kv.value`, never `kv.key`). Passing the row id here would
          // pop the VALUE's resolved preview while hovering the KEY field —
          // wrong content, mislabeled. The key only needs suggestions
          // (`variables`/`helpers`), not a resolved-value subscription.
          {...(dataTestId && { 'data-testid': `${dataTestId}-key-input` })}
        />
      ) : (
        <InputBox
          value={value}
          onChange={onChange}
          options={{ type: 'text' }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-key-input` })}
          disabled={cellDisabled ?? false}
        />
      )
      // The key cell's `value` IS the row key — highlight the whole row's key
      // cell when that key differs from the other side.
      if (!highlightActive) return cell
      return (
        <div
          style={cellDiffStyle(highlightKeySet.has(value))}
          {...(dataTestId && { 'data-testid': `${dataTestId}-key-diff` })}
        >
          {cell}
        </div>
      )
    },
    [dataTestId, highlightActive, highlightKeySet, variableAware]
  )

  // Value cell: resolve the row's authoritative ValueType (id ref →
  // initialRows by id/key → string inference) then hand it to the reusable
  // TypedValueField. Its `onChange(next)` writes the ValueType back to the
  // side-channel ref, drives the string `onChange` (so the table cell stays
  // in sync), and — when the *kind* changed but the display string didn't —
  // forces a full `onRowsChange` rebuild so the new ValueType is persisted
  // even though the visible cell text is unchanged.
  const ValueCellRenderer = useCallback(
    ({ value, onChange, rowId, disabled: cellDisabled }: CellRendererProps) => {
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

      // TypedValueField has no `disabled` prop of its own (it fans out into
      // per-type widgets — color swatch, secret modal, expression editor,
      // …) — locking the cell from the outside avoids threading a new prop
      // through every one of those variants for this one read-only use-case.
      const rowKey = id ? tableInitialRowsRef.current?.find((tr) => tr.id === id)?.key : undefined
      const diffStyle = highlightActive ? cellDiffStyle(rowKey ? highlightKeySet.has(rowKey) : false) : undefined
      return (
        <div style={{ ...diffStyle, ...(cellDisabled ? { opacity: 0.6, pointerEvents: 'none' } : {}) }}>
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
            valueTypeGroups={valueTypeGroups}
            {...(id !== undefined && { expressionVariableId: id })}
            {...(dataTestId && { dataTestId })}
          />
        </div>
      )
    },
    [dataTestId, highlightActive, highlightKeySet, valueTypeGroups]
  )

  return (
    <KeyValueTable
      ref={ref}
      initialRows={tableInitialRows}
      onRowsChange={handleRowsChange}
      renderKeyCell={KeyCellRenderer}
      renderValueCell={ValueCellRenderer}
      autoToggleEnabledOnEmpty
      disabled={disabled}
      {...(persistenceId && { persistenceId })}
      {...(dataTestId && { 'data-testid': dataTestId })}
    />
  )
})

RestormKeyValueTableInner.displayName = 'RestormKeyValueTable'

export const RestormKeyValueTable = React.memo(RestormKeyValueTableInner)
