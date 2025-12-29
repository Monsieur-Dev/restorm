import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { Toggle } from '../Toggle'
import { InputBox } from '../InputBox'
import { ScrollableElement } from '../ScrollableElement'
import { Button } from '../Button'
import './keyValueTable.css'

export interface KeyValueTableRow {
  /** Runtime ID for the row (optional) */
  id?: string | undefined
  key: string
  value: string
  description?: string | undefined
  /** Whether this row is enabled (default: true) */
  enabled?: boolean
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
  /** Runtime ID of the row (if provided in KeyValueTableRow) */
  rowId?: string | undefined
}

/**
 * Default cell renderer using InputBox
 */
const DefaultCellRenderer: React.FC<CellRendererProps> = ({ value, onChange, placeholder }) => {
  const [localValue, setLocalValue] = useState<string>(value)

  React.useEffect(() => {
    setLocalValue(value)
  }, [value])

  return (
    <InputBox
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
  initialRows?: KeyValueTableRow[]
  /**
   * Optional callback when rows change (for persisting edits).
   */
  onRowsChange?: (rows: KeyValueTableRow[]) => void
  /**
   * Custom renderer for key cells. Defaults to InputBox.
   */
  renderKeyCell?: React.ComponentType<CellRendererProps>
  /**
   * Custom renderer for value cells. Defaults to InputBox.
   */
  renderValueCell?: React.ComponentType<CellRendererProps>
  /**
   * Custom renderer for description cells. Defaults to InputBox.
   */
  renderDescriptionCell?: React.ComponentType<CellRendererProps>
}

export interface KeyValueTableHandle {
  addRow: () => void
}

export const KeyValueTable = React.forwardRef<KeyValueTableHandle, KeyValueTableProps>((
  {
    initialRows,
    onRowsChange,
    renderKeyCell: KeyCellRenderer = DefaultCellRenderer,
    renderValueCell: ValueCellRenderer = DefaultCellRenderer,
    renderDescriptionCell: DescriptionCellRenderer = DefaultCellRenderer
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
      enabled: kv.enabled !== false, // Default to true if undefined
      key: kv.key,
      value: kv.value,
      description: kv.description ?? ''
    }))
  }, [initialRows])

  const [rows, setRows] = useState<ParamRow[]>(defaultRows)
  // dropIndex represents the insertion position between rows (0..rows.length)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragGhostRef = useRef<HTMLDivElement | null>(null)

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
    // Only notify if rows actually changed (avoid initial call)
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

  const handleRemoveRow = useCallback((rowIndex: number) => {
    setRows((oldRows) => oldRows.filter((_, index) => index !== rowIndex))
  }, [])

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>, index: number) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(index))

      // Clean up any previous ghost
      if (dragGhostRef.current) {
        document.body.removeChild(dragGhostRef.current)
        dragGhostRef.current = null
      }

      // Create a mini table containing only the cloned row
      const maybeRow = event.currentTarget.closest('tr')
      const rowElement = (maybeRow ?? event.currentTarget) as HTMLElement
      const rect = rowElement.getBoundingClientRect()

      const table = document.createElement('table')
      const tbody = document.createElement('tbody')
      const ghostRow = rowElement.cloneNode(true) as HTMLTableRowElement

      table.appendChild(tbody)
      tbody.appendChild(ghostRow)

      const container = document.createElement('div')
      container.style.position = 'fixed'
      container.style.top = '-1000px'
      container.style.left = '-1000px'
      container.style.pointerEvents = 'none'
      container.style.backgroundColor = 'var(--editor-background)'
      container.style.borderRadius = '2px'
      container.appendChild(table)

      document.body.appendChild(container)
      dragGhostRef.current = container

      // Keep same relative position between mouse and row
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top
      event.dataTransfer.setDragImage(container, offsetX, offsetY)
    },
    []
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLTableRowElement>) => {
      event.preventDefault()
      const sourceIndexText = event.dataTransfer.getData('text/plain')
      const sourceIndex = Number(sourceIndexText)
      if (Number.isNaN(sourceIndex) || dropIndex === null) return

      const insertionFromState = dropIndex

      setRows((oldRows) => {
        const updated = [...oldRows]
        const [moved] = updated.splice(sourceIndex, 1)
        if (!moved) return oldRows
        let insertionIndex = insertionFromState
        if (sourceIndex < insertionIndex) {
          insertionIndex -= 1
        }

        if (insertionIndex < 0) insertionIndex = 0
        if (insertionIndex > updated.length) insertionIndex = updated.length

        updated.splice(insertionIndex, 0, moved)
        return updated
      })

      setDropIndex(null)
    },
    [dropIndex]
  )

  useImperativeHandle(
    ref,
    () => ({
      addRow: handleAddRow
    }),
    [handleAddRow]
  )

  return (
    <div className="params-table-root">
      <div className="params-table-frame">
        <ScrollableElement
          options={{ vertical: 'auto', horizontal: 'auto', useShadows: true }}
          style={{ flex: 1, minHeight: 0 }}
        >
          <div className="params-table-wrapper">
            <table className="params-table">
              <thead>
                <tr>
                  <th />
                  <th />
                  <th>Key</th>
                  <th>Value</th>
                  <th>Description</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isDropBefore = dropIndex === index
                  const isDropAfter = dropIndex === index + 1
                  const rowClassName = [
                    isDropBefore ? 'params-table-row-drop-before' : '',
                    isDropAfter ? 'params-table-row-drop-after' : ''
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined

                  return (
                    <tr
                      key={index}
                      className={rowClassName}
                      onDragOver={(e) => {
                        e.preventDefault()
                        const rect = e.currentTarget.getBoundingClientRect()
                        const offsetY = e.clientY - rect.top
                        const after = offsetY > rect.height / 2
                        const insertionIndex = index + (after ? 1 : 0)
                        setDropIndex(insertionIndex)
                      }}
                      onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                        setDropIndex((current) => {
                          if (current === null) return null
                          const beforeIndex = index
                          const afterIndex = index + 1
                          return current === beforeIndex || current === afterIndex ? null : current
                        })
                      }}
                      onDrop={(e) => {
                        handleDrop(e)
                      }}
                      onDragEnd={() => {
                        setDropIndex(null)
                        if (dragGhostRef.current) {
                          document.body.removeChild(dragGhostRef.current)
                          dragGhostRef.current = null
                        }
                      }}
                    >
                      <td>
                        <span
                          className="params-table-drag-handle"
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation()
                            handleDragStart(e, index)
                          }}
                        >
                          ⋮⋮
                        </span>
                      </td>
                      <td>
                        <Toggle
                          isChecked={row.enabled}
                          notFocusable
                          onChange={(newChecked) => {
                            updateData(index, 'enabled', newChecked)
                          }}
                        />
                      </td>
                      <td>
                        <KeyCellRenderer
                          value={row.key}
                          onChange={(v) => { updateData(index, 'key', v) }}
                          rowId={row.id}
                        />
                      </td>
                      <td>
                        <ValueCellRenderer
                          value={row.value}
                          onChange={(v) => { updateData(index, 'value', v) }}
                          rowId={row.id}
                        />
                      </td>
                      <td>
                        <DescriptionCellRenderer
                          value={row.description}
                          onChange={(v) => { updateData(index, 'description', v) }}
                          placeholder="Description"
                          rowId={row.id}
                        />
                      </td>
                      <td>
                        <Button
                          small
                          secondary
                          options={{ ariaLabel: 'Delete row', title: 'Delete row' }}
                          onClick={() => {
                            handleRemoveRow(index)
                          }}
                        >
                          <i className="codicon codicon-trash" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ScrollableElement>
      </div>
    </div>
  )
})

KeyValueTable.displayName = 'KeyValueTable'
