import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType
} from 'react'
import { Toggle } from '../Toggle'
import { InputBox } from '../InputBox'
import { ScrollableElement } from '../ScrollableElement'
import { Button } from '../Button'
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
}

/**
 * Default cell renderer using InputBox
 */
const DefaultCellRenderer: React.FC<CellRendererProps> = ({ value, onChange, placeholder, 'data-testid': dataTestId }) => {
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
    showDescription = true,
    showEnabledToggle = true,
    showResolvedValue = false,
    renderResolvedValueCell: ResolvedValueCellRenderer = DefaultCellRenderer,
    persistenceId,
    'data-testid': dataTestId
  },
  ref
) => {
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
          return {
            ...row,
            [columnId]: value as string | boolean
          }
        })
      )
    },
    []
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

  // Notify parent when rows change (for persistence)
  const lastRowsRef = useRef<string | null>(null)
  useEffect(() => {
    if (!onRowsChange) return
    const rowsJson = JSON.stringify(keyValues)
    if (lastRowsRef.current !== null && lastRowsRef.current !== rowsJson) {
      onRowsChange(keyValues)
    }
    lastRowsRef.current = rowsJson
  }, [keyValues, onRowsChange])

  const handleAddRow = useCallback(() => {
    setRows((oldRows) => [
      ...oldRows,
      { id: generateRowId(), enabled: true, key: '', value: '', description: '' }
    ])
  }, [])

  const handleRemoveRow = useCallback((rowId: string) => {
    setRows((oldRows) => oldRows.filter((r) => r.id !== rowId))
  }, [])

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
        header: 'Key',
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
            />
          )
        }
      },
      {
        id: 'value',
        header: 'Value',
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
        header: 'Description',
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
                  placeholder="Description"
                  {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-description` })}
                  rowId={row.id}
                />
              </div>
              <Button
                line
                secondary
                {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-delete` })}
                options={{ ariaLabel: 'Delete row', title: 'Delete row' }}
                onClick={() => { handleRemoveRow(row.id) }}
                icon="trash"
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
          <Button
            line
            secondary
            {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-delete` })}
            options={{ ariaLabel: 'Delete row', title: 'Delete row' }}
            onClick={() => { handleRemoveRow(row.id) }}
            icon="trash"
          />
        )
      })
    }

    return cols
  }, [KeyCellRenderer, ValueCellRenderer, DescriptionCellRenderer, ResolvedValueCellRenderer, showDescription, showResolvedValue, showEnabledToggle, rows, updateData, dataTestId, handleRemoveRow])

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
              reorderable
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
