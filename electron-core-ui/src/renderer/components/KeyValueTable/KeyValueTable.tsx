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
    return [
      {
        id: 'enabled',
        header: '',
        autoWidth: true,
        renderCell: (row) => {
          const idx = rows.findIndex((r) => r.id === row.id)
          return (
            <div {...(dataTestId && { 'data-testid': `${dataTestId}-row-${row.id}-enabled` })}>
              <Toggle
                isChecked={row.enabled}
                notFocusable
                onChange={(newChecked) => { updateData(idx, 'enabled', newChecked) }}
              />
            </div>
          )
        }
      },
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
        minWidth: 80,
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
      },
      {
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
      }
    ]
  }, [KeyCellRenderer, ValueCellRenderer, DescriptionCellRenderer, rows, updateData, dataTestId, handleRemoveRow])

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
