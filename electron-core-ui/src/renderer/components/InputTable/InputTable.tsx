import React, { useCallback } from 'react'
import { VariableInputBox } from '../VariableInputBox'
import { Toggle } from '../Toggle'
import { InputBox } from '../InputBox'
import type { VariableDefinition } from '../VariableInputBox'
import type { InputTableProps } from './types'
import './inputTable.css'

interface BaseEditableCellProps {
  rowIndex: number
  columnId: string
  updateData?: (rowIndex: number, columnId: string, value: unknown) => void
}

interface VariableCellProps extends BaseEditableCellProps {
  value: string
  variables: VariableDefinition[]
}

const VariableCell: React.FC<VariableCellProps> = ({
  value,
  variables,
  rowIndex,
  columnId,
  updateData
}) => {
  const [localValue, setLocalValue] = React.useState<string>(value)

  React.useEffect(() => {
    setLocalValue(value)
  }, [value])

  return (
    <VariableInputBox
      value={localValue}
      onChange={(v) => {
        setLocalValue(v)
        updateData?.(rowIndex, columnId, v)
      }}
      variables={variables}
    />
  )
}

interface TextCellProps extends BaseEditableCellProps {
  value: string
  placeholder?: string | undefined
}

const TextCell: React.FC<TextCellProps> = ({
  value,
  placeholder,
  rowIndex,
  columnId,
  updateData
}) => {
  const [localValue, setLocalValue] = React.useState<string>(value)

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
        updateData?.(rowIndex, columnId, newValue)
      }}
    />
  )
}

export const InputTable: React.FC<InputTableProps> = ({
  columns,
  rows,
  onChange,
  createEmptyRow,
  getVariablesForColumn,
  className,
  style
}) => {
  const updateData = useCallback(
    (rowIndex: number, columnId: string, value: unknown): void => {
      const next = rows.map((row, index) => {
        if (index !== rowIndex) return row
        return {
          ...row,
          [columnId]: value as string | boolean
        }
      })
      onChange(next)
    },
    [rows, onChange]
  )
  const handleAddRow = useCallback(() => {
    const next = [...rows, createEmptyRow()]
    onChange(next)
  }, [rows, createEmptyRow, onChange])

  const handleDragStart = useCallback((event: React.DragEvent<HTMLTableRowElement>, index: number) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLTableRowElement>, targetIndex: number) => {
      event.preventDefault()
      const sourceIndexText = event.dataTransfer.getData('text/plain')
      const sourceIndex = Number(sourceIndexText)
      if (Number.isNaN(sourceIndex) || sourceIndex === targetIndex) return

      const updated = [...rows]
      const [moved] = updated.splice(sourceIndex, 1)
      if (!moved) return
      updated.splice(targetIndex, 0, moved)
      onChange(updated)
    },
    [rows, onChange]
  )

  const resolveColumnWidthStyle = useCallback(
    (columnId: string): React.CSSProperties | undefined => {
      const col = columns.find((c) => c.id === columnId)
      if (!col?.width) return undefined
      if (typeof col.width === 'number') return { width: `${col.width}px` }
      return { width: col.width }
    },
    [columns]
  )

  const containerClassName = ['input-table-root', className].filter(Boolean).join(' ')

  return (
    <div className={containerClassName} style={style}>
      <div className="input-table-toolbar">
        <button
          type="button"
          onClick={handleAddRow}
          style={{
            border: '1px solid var(--button-border)',
            backgroundColor: 'var(--button-secondaryBackground)',
            color: 'var(--button-secondaryForeground)',
            padding: '2px 8px',
            borderRadius: 2,
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          +
        </button>
      </div>
      <div className="ag-theme-restorm-input-table input-table-wrapper">
        <table className="input-table-table">
          <thead>
            <tr>
              <th className="input-table-drag-header" />
              {columns.map((col) => (
                <th
                  key={col.id}
                  style={resolveColumnWidthStyle(col.id)}
                >
                  {col.label ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((rowData, rowIndex) => (
              <tr
                key={rowIndex}
                draggable
                onDragStart={(e) => {
                  handleDragStart(e, rowIndex)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                }}
                onDrop={(e) => {
                  handleDrop(e, rowIndex)
                }}
              >
                <td className="input-table-drag-cell">
                  <span className="input-table-drag-handle">⋮⋮</span>
                </td>
                {columns.map((col) => {
                  const colId = col.id
                  const widthStyle = resolveColumnWidthStyle(colId)

                  if (col.type === 'checkbox') {
                    const checked = Boolean(rowData[colId])
                    return (
                      <td
                        key={colId}
                        style={widthStyle}
                      >
                        <Toggle
                          isChecked={checked}
                          notFocusable
                          onChange={(newChecked) => {
                            updateData(rowIndex, colId, newChecked)
                          }}
                        />
                      </td>
                    )
                  }

                  if (col.type === 'variable') {
                    const value = (rowData[colId] as string) || ''
                    const vars: VariableDefinition[] = getVariablesForColumn
                      ? getVariablesForColumn(colId, rowData, rowIndex)
                      : []
                    return (
                      <td
                        key={colId}
                        style={widthStyle}
                      >
                        <VariableCell
                          value={value}
                          variables={vars}
                          rowIndex={rowIndex}
                          columnId={colId}
                          updateData={updateData}
                        />
                      </td>
                    )
                  }

                  const value = (rowData[colId] as string) || ''
                  return (
                    <td
                      key={colId}
                      style={widthStyle}
                    >
                      <TextCell
                        value={value}
                        placeholder={col.label}
                        rowIndex={rowIndex}
                        columnId={colId}
                        updateData={updateData}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
