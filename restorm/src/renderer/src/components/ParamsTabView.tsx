import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { VariableInputBox, Toggle, InputBox, ScrollableElement, Button } from 'electron-core-ui/renderer'
import type { VariableDefinition } from 'electron-core-ui/renderer'
import type { KeyValue } from '../types/collections'
import './paramsTabView.css'

interface ParamRow {
  enabled: boolean
  key: string
  value: string
  description: string
}

interface EditableCellBaseProps {
  rowIndex: number
  columnId: keyof ParamRow
  updateData: (rowIndex: number, columnId: keyof ParamRow, value: unknown) => void
}

interface VariableCellProps extends EditableCellBaseProps {
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
  const [localValue, setLocalValue] = useState<string>(value)

  React.useEffect(() => {
    setLocalValue(value)
  }, [value])

  return (
    <VariableInputBox
      value={localValue}
      onChange={(v) => {
        setLocalValue(v)
        updateData(rowIndex, columnId, v)
      }}
      variables={variables}
    />
  )
}

interface TextCellProps extends EditableCellBaseProps {
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
        updateData(rowIndex, columnId, newValue)
      }}
    />
  )
}

interface ParamsTabViewProps {
  variables: VariableDefinition[]
  /** Initial rows to populate the table */
  initialRows?: KeyValue[]
}

export interface ParamsTabViewHandle {
  addRow: () => void
}

export const ParamsTabView = React.forwardRef<ParamsTabViewHandle, ParamsTabViewProps>(({ variables, initialRows }, ref) => {
  // Convert initialRows to ParamRow format
  const defaultRows = useMemo<ParamRow[]>(() => {
    if (!initialRows || initialRows.length === 0) {
      return [{ enabled: true, key: '', value: '', description: '' }]
    }
    return initialRows.map((kv) => ({
      enabled: true,
      key: kv.key,
      value: kv.value,
      description: kv.description ?? ''
    }))
  }, [initialRows])

  const [rows, setRows] = useState<ParamRow[]>(defaultRows)
  // dropIndex représente la position d'insertion entre les lignes (0..rows.length)
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

  const handleAddRow = useCallback(() => {
    setRows((oldRows) => [
      ...oldRows,
      { enabled: true, key: '', value: '', description: '' }
    ])
  }, [])

  const handleRemoveRow = useCallback((rowIndex: number) => {
    setRows((oldRows) => oldRows.filter((_, index) => index !== rowIndex))
  }, [])

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>, index: number) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(index))

      // Nettoyer un éventuel ghost précédent
      if (dragGhostRef.current) {
        document.body.removeChild(dragGhostRef.current)
        dragGhostRef.current = null
      }

      // Créer un mini tableau contenant uniquement la ligne clonée
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
      container.style.backgroundColor = 'var(--vscode-editor-background)'
      container.style.borderRadius = '2px'
      container.appendChild(table)

      document.body.appendChild(container)
      dragGhostRef.current = container

      // Garder la même position relative entre la souris et la ligne
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top
      event.dataTransfer.setDragImage(container, offsetX, offsetY)
    },
    [dragGhostRef]
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
                        <VariableCell
                          value={row.key}
                          variables={variables}
                          rowIndex={index}
                          columnId="key"
                          updateData={updateData}
                        />
                      </td>
                      <td>
                        <VariableCell
                          value={row.value}
                          variables={variables}
                          rowIndex={index}
                          columnId="value"
                          updateData={updateData}
                        />
                      </td>
                      <td>
                        <TextCell
                          value={row.description}
                          placeholder="Description"
                          rowIndex={index}
                          columnId="description"
                          updateData={updateData}
                        />
                      </td>
                      <td>
                        <Button
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

ParamsTabView.displayName = 'ParamsTabView'

