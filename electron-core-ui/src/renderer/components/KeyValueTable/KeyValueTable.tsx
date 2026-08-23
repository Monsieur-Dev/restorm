import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType
} from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle } from '../Toggle'
import { InputBox } from '../InputBox'
import { ScrollableElement } from '../ScrollableElement'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
import { Table, type TableColumn } from '../Table/Table'
import './keyValueTable.css'

export interface KeyValueTableRow {
  /** Runtime ID for the row (optional) */
  id?: string | undefined
  key: string
  value: string
  description?: string | undefined
  /** Whether this row is enabled (default: true) */
  enabled?: boolean | undefined
}

interface ParamRow {
  id: string
  enabled: boolean
  key: string
  value: string
  description: string
}

/** Generate a unique ID for new rows */
function generateRowId(): string {
  return crypto.randomUUID()
}

/**
 * Props passed to custom cell renderers
 */
export interface CellRendererProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Optional test id applied to the cell input. */
  'data-testid'?: string
  /** Runtime ID of the row (if provided in KeyValueTableRow) */
  rowId?: string | undefined
  /** When true, the cell must render its editor read-only/inert. Forwarded
   * from the table's own `disabled` prop. */
  disabled?: boolean | undefined
}

/**
 * The per-row delete affordance. The hover label is the styled `Tooltip`, not
 * the browser's native `title` — a `title` renders the OS bubble, unstyled and
 * out of step with the rest of the chrome. The `ariaLabel` stays: it is the
 * button's accessible name and is invisible to sighted users, so it is not the
 * thing a tooltip replaces.
 */
const DeleteRowButton: React.FC<{
  label: string
  disabled: boolean
  onClick: () => void
  'data-testid'?: string | undefined
}> = ({ label, disabled, onClick, 'data-testid': dataTestId }) => {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  return (
    <span
      ref={anchorRef}
      className="params-table-delete-anchor"
      onMouseEnter={() => { setHover(true) }}
      onMouseLeave={() => { setHover(false) }}
    >
      <Button
        line
        secondary
        disabled={disabled}
        {...(dataTestId && { 'data-testid': dataTestId })}
        options={{ ariaLabel: label }}
        onClick={onClick}
        icon="trash"
      />
      <Tooltip targetRef={anchorRef} show={hover && !disabled} placement="below" content={label} />
    </span>
  )
}

/**
 * Default cell renderer using InputBox
 */
const DefaultCellRenderer: React.FC<CellRendererProps> = ({ value, onChange, placeholder, 'data-testid': dataTestId, disabled }) => {
  const [localValue, setLocalValue] = useState<string>(value)

  React.useEffect(() => {
    setLocalValue(value)
  }, [value])

  return (
    <InputBox
      {...(dataTestId && { 'data-testid': dataTestId })}
      options={{
        placeholder: placeholder ?? '',
        type: 'text'
      }}
      value={localValue}
      onChange={(newValue: string) => {
        setLocalValue(newValue)
        onChange(newValue)
      }}
      disabled={disabled ?? false}
    />
  )
}

export interface KeyValueTableProps {
  /** Initial rows to populate the table */
  initialRows?: KeyValueTableRow[] | undefined
  /** Optional test id applied to the table root element. */
  'data-testid'?: string | undefined
  /**
   * Optional callback when rows change (for persisting edits).
   */
  onRowsChange?: ((rows: KeyValueTableRow[]) => void) | undefined
  /**
   * Custom renderer for key cells. Defaults to InputBox.
   */
  renderKeyCell?: React.ComponentType<CellRendererProps> | undefined
  /**
   * Custom renderer for value cells. Defaults to InputBox.
   */
  renderValueCell?: React.ComponentType<CellRendererProps> | undefined
  /**
   * Custom renderer for description cells. Defaults to InputBox.
   */
  renderDescriptionCell?: React.ComponentType<CellRendererProps> | undefined
  /**
   * Header of the KEY column. Defaults to `'Key'`. Consumers whose rows are
   * not key/value pairs in the HTTP sense — a label → value list, a
   * name → default map — pass their own (already translated) wording so the
   * column reads as what it actually holds.
   */
  keyHeader?: string | undefined
  /** Header of the VALUE column. Defaults to `'Value'`. See {@link keyHeader}. */
  valueHeader?: string | undefined
  /**
   * Whether the Description column is rendered. Defaults to `true`.
   * Set to `false` in use-cases where descriptions aren't meaningful
   * (e.g. a short auth-config table where the rows are obvious).
   */
  showDescription?: boolean | undefined
  /**
   * Whether the leading enabled-toggle column is rendered. Defaults
   * to `true`. Set to `false` when every row of the table is
   * unconditionally active and showing a checkbox would be
   * misleading (e.g. the produced-headers table of an auth route).
   */
  showEnabledToggle?: boolean | undefined
  /**
   * Whether to render an extra read-only "Resolved value" column
   * between Value and Description. Useful when the raw value is a
   * template (handlebars, variable expressions, etc.) and the caller
   * wants to show its evaluated form side-by-side. Defaults to `false`.
   */
  showResolvedValue?: boolean | undefined
  /**
   * Custom renderer for the resolved-value cell. Receives the raw
   * `value` (the cell's template text) plus a no-op `onChange` — the
   * cell is read-only by convention. When omitted, the raw value is
   * echoed verbatim. Pair with `showResolvedValue: true`.
   */
  renderResolvedValueCell?: React.ComponentType<CellRendererProps> | undefined
  /**
   * Optional persistence key for column widths. Widths are saved to
   * localStorage under `ecu:table:<persistenceId>:column-widths`. When
   * omitted, widths live in memory for the component lifetime only.
   */
  persistenceId?: string | undefined
  /**
   * When `true`, the enabled-toggle is auto-managed against the value
   * column: typing into an empty value re-enables the row, clearing a
   * non-empty value disables it. Off by default — consumers that
   * legitimately want a checked-but-empty row (e.g. `?filter=` to
   * reset a server-side default) should leave this off. The host app
   * passes it on for HTTP-style tables so users don't accidentally
   * send `?name=&drop=` to APIs that 422 on empty parameters.
   */
  autoToggleEnabledOnEmpty?: boolean | undefined
  /**
   * Locks the whole table read-only: the per-row enabled-toggle and delete
   * button are disabled, and `disabled` is forwarded to every cell renderer
   * (the default `InputBox` renderer honors it; a custom renderer opts in by
   * reading `CellRendererProps.disabled`). Rows can't be reordered either.
   * Default `false`.
   */
  disabled?: boolean | undefined
}

export interface KeyValueTableHandle {
  addRow: () => void
}

export const KeyValueTable = React.memo(React.forwardRef<KeyValueTableHandle, KeyValueTableProps>((
  {
    initialRows,
    onRowsChange,
    renderKeyCell: KeyCellRenderer = DefaultCellRenderer,
    renderValueCell: ValueCellRenderer = DefaultCellRenderer,
    renderDescriptionCell: DescriptionCellRenderer = DefaultCellRenderer,
    keyHeader = 'Key',
    valueHeader = 'Value',
    showDescription = true,
    showEnabledToggle = true,
    showResolvedValue = false,
    renderResolvedValueCell: ResolvedValueCellRenderer = DefaultCellRenderer,
    persistenceId,
    autoToggleEnabledOnEmpty = false,
    disabled = false,
    'data-testid': dataTestId
  },
  ref
) => {
  const { t } = useTranslation()
  // Convert initialRows to ParamRow format
  const defaultRows = useMemo<ParamRow[]>(() => {
    if (!initialRows || initialRows.length === 0) {
      return [{ id: generateRowId(), enabled: true, key: '', value: '', description: '' }]
    }
    return initialRows.map((kv): ParamRow => ({
      id: kv.id ?? generateRowId(),
      enabled: kv.enabled !== false,
      key: kv.key,
      value: kv.value,
      description: kv.description ?? ''
    }))
  }, [initialRows])

  const [rows, setRows] = useState<ParamRow[]>(defaultRows)

  const updateData = useCallback(
    (rowIndex: number, columnId: keyof ParamRow, value: unknown): void => {
      setRows((oldRows) =>
        oldRows.map((row, index) => {
          if (index !== rowIndex) return row
          const nextRow: ParamRow = {
            ...row,
            [columnId]: value as string | boolean
          }
          // Auto-track the enabled toggle against value emptiness when
          // the consumer opts in. The flip happens INSIDE this state
          // update so the visible checkbox stays in sync — doing the
          // toggle higher up (in the parent's `onRowsChange` handler)
          // mutates the upstream data layer but leaves this local
          // `rows` state stale, so the checkbox would visually stay on.
          if (autoToggleEnabledOnEmpty && columnId === 'value') {
            const prevText = typeof row.value === 'string' ? row.value : ''
            const nextText = typeof value === 'string' ? value : ''
            const prevEmpty = prevText.trim() === ''
            const nextEmpty = nextText.trim() === ''
            if (prevEmpty !== nextEmpty) {
              nextRow.enabled = !nextEmpty
            }
          }
          return nextRow
        })
      )
    },
    [autoToggleEnabledOnEmpty]
  )

  const keyValues: KeyValueTableRow[] = useMemo(
    () =>
      rows.map((row): KeyValueTableRow => ({
        id: row.id,
        key: row.key,
        value: row.value,
        description: row.description,
        enabled: row.enabled
      })),
    [rows]
  )

  // Notify parent when rows change (for persistence).
  //
  // The baseline is seeded from the FIRST render's rows, not left null and
  // filled by the first effect pass. Two things went wrong with a null seed,
  // and both silently ate exactly one user edit:
  //
  //  - the `!onRowsChange` early return skipped the assignment as well as the
  //    call, so any render without the callback left the baseline null. The
  //    next edit then became the baseline instead of being emitted.
  //  - "null means we have not established a baseline yet" and "null means do
  //    not emit" were the same value, so anything that reset the ref also
  //    bought a free swallowed change.
  //
  // A swallowed change is invisible: the checkbox moves, the row looks edited,
  // and only the parent never hears about it — so the edit is lost with no
  // error anywhere. Seeding at render time makes the first user edit a real
  // difference against a real baseline, whatever the callback was doing.
  const lastRowsRef = useRef<string | null>(JSON.stringify(keyValues))
  useEffect(() => {
    const rowsJson = JSON.stringify(keyValues)
    const previous = lastRowsRef.current
    // Record BEFORE the callback: `onRowsChange` may re-render this component,
    // and a baseline written afterwards could be skipped by an early return.
    lastRowsRef.current = rowsJson
    if (previous !== rowsJson) onRowsChange?.(keyValues)
  }, [keyValues, onRowsChange])

  // Adopt rows that changed OUTSIDE this component.
  //
  // `rows` is seeded once by `useState(defaultRows)`, so React ignores every
  // later `initialRows`. The table then keeps showing its own copy while the
  // owner's model has moved on — a toggle can read "on" while the request it
  // describes is off, and the row the user sees is not the row that ships.
  //
  // The echo test is `lastRowsRef`, the last value this table EMITTED. Props
  // matching it are our own change coming back and must be ignored — adopting
  // those would fight the user mid-edit, which is why simply syncing on every
  // prop change is wrong. Props that DIFFER came from somewhere else (a
  // scenario run, an MCP write, a reset) and are authoritative.
  // Done DURING RENDER rather than in an effect: React's documented way to
  // adjust state when a prop changes. An effect would commit the stale rows,
  // paint them, then re-render with the adopted ones — a visible flash of the
  // superseded value on every external change. Setting state here instead
  // makes React discard this render and redo it before anything is painted.
  //
  // Both trackers are STATE, not refs: render may neither read nor write a
  // ref, and a "previous props" comparison is exactly what the render-phase
  // state pattern is for.
  //
  // The echo test compares the incoming props against the rows currently
  // DISPLAYED (`keyValues` is `rows` in the same shape). Props equal to them
  // are our own change coming back and adopting would be a no-op; props that
  // differ came from elsewhere — a scenario run, an MCP write, a reset — and
  // are authoritative. Adopting re-notifies the owner through the effect
  // above, which converges in one idempotent round-trip; suppressing that
  // echo instead would re-open the swallowed-edit hole, because a user
  // editing a row back to the value the owner last sent would emit nothing.
  const incomingRows = JSON.stringify(
    defaultRows.map((r) => ({ id: r.id, key: r.key, value: r.value, description: r.description, enabled: r.enabled }))
  )
  const [prevIncomingRows, setPrevIncomingRows] = useState(incomingRows)
  if (incomingRows !== prevIncomingRows) {
    setPrevIncomingRows(incomingRows)
    if (incomingRows !== JSON.stringify(keyValues)) setRows(defaultRows)
  }

  const handleAddRow = useCallback(() => {
    if (disabled) return
    setRows((oldRows) => [
      ...oldRows,
      { id: generateRowId(), enabled: true, key: '', value: '', description: '' }
    ])
  }, [disabled])

  const handleRemoveRow = useCallback((rowId: string) => {
    if (disabled) return
    setRows((oldRows) => oldRows.filter((r) => r.id !== rowId))
  }, [disabled])

  useImperativeHandle(ref, () => ({ addRow: handleAddRow }), [handleAddRow])

  const handleRowsReorder = useCallback((orderedIds: string[]) => {
    setRows((oldRows) => {
      const byId = new Map(oldRows.map((r) => [r.id, r]))
      const next: ParamRow[] = []
      for (const id of orderedIds) {
        const row = byId.get(id)
        if (row) next.push(row)
      }
      return next
    })
  }, [])

  // Build table columns. Renderers are looked up by row id at render time
  // so the ref-stable row index never drifts from the actual row position.
  const columns = useMemo<TableColumn<ParamRow>[]>(() => {
    const KeyRenderer = KeyCellRenderer as ComponentType<CellRendererProps>
    const ValueRenderer = ValueCellRenderer as ComponentType<CellRendererProps>
    const DescRenderer = DescriptionCellRenderer as ComponentType<CellRendererProps>
    const ResolvedRenderer = ResolvedValueCellRenderer as ComponentType<CellRendererProps>
    const cols: TableColumn<ParamRow>[] = []

    if (showEnabledToggle) {
      cols.push({
        id: 'enabled',
        header: '',
        autoWidth: true,
        renderCell: (row) => {
          const idx = rows.findIndex((r) => r.id === row.id)
          return (
            <div {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-enabled` })}>
              <Toggle
                checked={row.enabled}
                notFocusable
                disabled={disabled}
                onChange={(newChecked) => { updateData(idx, 'enabled', newChecked) }}
              />
            </div>
          )
        }
      })
    }

    cols.push(
      {
        id: 'key',
        header: keyHeader,
        resizable: true,
        minWidth: 80,
        renderCell: (row) => {
          const idx = rows.findIndex((r) => r.id === row.id)
          return (
            <KeyRenderer
              value={row.key}
              onChange={(v) => { updateData(idx, 'key', v) }}
              {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-key` })}
              rowId={row.id}
              disabled={disabled}
            />
          )
        }
      },
      {
        id: 'value',
        header: valueHeader,
        resizable: true,
        // Room for an input + a trailing value-type indicator (~34px)
        // + some slack. A value column squeezed below this width makes
        // the click target of the input disappear behind the indicator
        // — Playwright click-interception in practice.
        minWidth: 140,
        renderCell: (row) => {
          const idx = rows.findIndex((r) => r.id === row.id)
          return (
            <ValueRenderer
              value={row.value}
              onChange={(v) => { updateData(idx, 'value', v) }}
              {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-value` })}
              rowId={row.id}
              disabled={disabled}
            />
          )
        }
      }
    )

    if (showResolvedValue) {
      cols.push({
        id: 'resolvedValue',
        header: 'Resolved value',
        resizable: true,
        minWidth: 80,
        renderCell: (row) => (
          <ResolvedRenderer
            value={row.value}
            // The resolved column is read-only — the renderer
            // receives the raw template value and displays its
            // evaluated form; edits flow through the regular Value
            // column. A no-op onChange keeps the contract uniform.
            onChange={() => { /* read-only */ }}
            {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-resolved-value` })}
            rowId={row.id}
          />
        )
      })
    }

    if (showDescription) {
      cols.push({
        id: 'description',
        header: t('keyValueTable.description'),
        resizable: true,
        minWidth: 120,
        renderCell: (row) => {
          const idx = rows.findIndex((r) => r.id === row.id)
          return (
            <div className="params-table-desc-cell">
              <div className="params-table-desc-input">
                <DescRenderer
                  value={row.description}
                  onChange={(v) => { updateData(idx, 'description', v) }}
                  placeholder={t('keyValueTable.description')}
                  {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-description` })}
                  rowId={row.id}
                  disabled={disabled}
                />
              </div>
              <DeleteRowButton
                label={t('keyValueTable.deleteRow')}
                disabled={disabled}
                {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-delete` })}
                onClick={() => { handleRemoveRow(row.id) }}
              />
            </div>
          )
        }
      })
    } else {
      // When the description column is hidden we still need the
      // delete affordance somewhere — promote it to its own
      // autoWidth column at the end.
      cols.push({
        id: 'delete',
        header: '',
        autoWidth: true,
        renderCell: (row) => (
          <DeleteRowButton
            label={t('keyValueTable.deleteRow')}
            disabled={disabled}
            {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-delete` })}
            onClick={() => { handleRemoveRow(row.id) }}
          />
        )
      })
    }

    return cols
  }, [KeyCellRenderer, ValueCellRenderer, DescriptionCellRenderer, ResolvedValueCellRenderer, keyHeader, valueHeader, showDescription, showResolvedValue, showEnabledToggle, rows, updateData, dataTestId, handleRemoveRow, t, disabled])

  return (
    <div
      className="params-table-root"
      {...(dataTestId && { 'data-testid': dataTestId })}
    >
      <div className="params-table-frame">
        <ScrollableElement
          options={{ vertical: 'auto', horizontal: 'auto', useShadows: true }}
          style={{ flex: 1, minHeight: 0 }}
        >
          <div className="params-table-wrapper">
            <Table<ParamRow>
              id={persistenceId}
              columns={columns}
              rows={rows}
              getRowId={(r) => r.id}
              reorderable={!disabled}
              onRowsReorder={handleRowsReorder}
              {...(dataTestId && { 'data-testid': `${dataTestId}-table` })}
            />
          </div>
        </ScrollableElement>
      </div>
    </div>
  )
}))

KeyValueTable.displayName = 'KeyValueTable'
