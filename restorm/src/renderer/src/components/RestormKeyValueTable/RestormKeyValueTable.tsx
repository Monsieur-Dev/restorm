import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyValueTable,
  InputBox,
  ColorPicker,
  DateTimePicker,
  Button,
  Tooltip,
  MenuItem,
  MenuItemSeparator,
  type KeyValueTableHandle,
  type KeyValueTableRow,
  type CellRendererProps,
  type ContextMenuItem,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import type { KeyValue, ValueType } from '../../types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue } from '../../types/collections'
import { inferValueFromString, isHexColorString, tryParseDateString, tryParseNumberString } from '../../../../shared/utils/valueCasting'

export type VariableContext = Record<string, string>

interface ColorValueCellProps {
  hex: string
  onChangeHex: (nextHex: string) => void
}

const ColorValueCell: React.FC<ColorValueCellProps> = ({ hex, onChangeHex }) => {
  const targetRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const tooltipClassName = 'restorm-color-picker-tooltip'

  useEffect(() => {
    if (!isOpen) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return

      // Ignore clicks on the trigger button
      if (targetRef.current?.contains(target)) return

      // Ignore clicks inside the tooltip
      const tooltipEl = document.querySelector(`.${tooltipClassName}`)
      if (tooltipEl?.contains(target)) return

      setIsOpen(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [isOpen])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        height: '100%',
        minWidth: 0
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <InputBox
          value={hex}
          options={{ type: 'text' }}
          disabled
        />
      </div>

      <div ref={targetRef} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
        <Button
          small
          secondary
          icon="symbol-color"
          options={{ ariaLabel: 'Open color picker' }}
          onClick={(e) => {
            e.preventDefault()
            setIsOpen((prev) => !prev)
          }}
        />
      </div>

      <Tooltip
        targetRef={targetRef as unknown as React.RefObject<HTMLElement | null>}
        show={isOpen}
        placement="below"
        className={tooltipClassName}
        content={
          <div
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
          >
            <ColorPicker
              value={hex}
              onChange={(nextHex: string) => {
                onChangeHex(nextHex)
              }}
              disableAlpha
            />
          </div>
        }
      />
    </div>
  )
}

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
}

export const RestormKeyValueTable = React.forwardRef<KeyValueTableHandle, RestormKeyValueTableProps>((
  {
    variables,
    helpers = [],
    initialRows,
    onRowsChange
  },
  ref
) => {
  const { t } = useTranslation()

  // Keep refs to avoid recreating cell renderers
  const variablesRef = useRef(variables)
  const helpersRef = useRef(helpers)
  const valueTypeByRowIdRef = useRef<Map<string, ValueType>>(new Map())

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    rowId: string
    currentValue: string
    onChange: (next: string) => void
  } | null>(null)
  
  // Update refs via useEffect to avoid accessing during render
  useEffect(() => {
    variablesRef.current = variables
  }, [variables])
  
  useEffect(() => {
    helpersRef.current = helpers
  }, [helpers])

  useEffect(() => {
    if (!initialRows) return
    const nextMap = new Map<string, ValueType>()
    for (const row of initialRows) {
      if (row.id) {
        nextMap.set(row.id, row.value)
      }
    }
    valueTypeByRowIdRef.current = nextMap
  }, [initialRows])

  const closeContextMenu = useCallback((): void => {
    setContextMenu((prev) => (prev ? { ...prev, visible: false } : null))
  }, [])

  useEffect(() => {
    if (!contextMenu?.visible) return

    const handleMouseDown = (event: MouseEvent): void => {
      // close on any click outside (or inside) - leaf items close explicitly anyway
      const target = event.target as Node | null
      if (!target) return
      const menuEl = document.querySelector('.restorm-kv-context-menu')
      if (menuEl?.contains(target)) return
      closeContextMenu()
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [contextMenu?.visible, closeContextMenu])

  const castToType = useCallback((target: 'string' | 'secret' | 'number' | 'dateTime' | 'color'): void => {
    if (!contextMenu) return

    const { rowId, currentValue, onChange } = contextMenu
    const raw = currentValue

    let nextValue: ValueType
    let nextDisplayValue = raw

    switch (target) {
      case 'string': {
        nextValue = new StringValue(raw)
        nextDisplayValue = raw
        break
      }
      case 'secret': {
        nextValue = new PasswordValue(raw)
        nextDisplayValue = raw
        break
      }
      case 'number': {
        const parsed = tryParseNumberString(raw.trim())
        nextValue = new NumericValue(parsed ?? 0, 'decimal')
        nextDisplayValue = parsed !== null ? String(parsed) : '0'
        break
      }
      case 'dateTime': {
        // If it's a string and is castable, keep the parsed date; otherwise default to now.
        const parsed = tryParseDateString(raw.trim())
        nextValue = new DateTimeValue(parsed ?? new Date(), 'YYYY-MM-DD HH:mm:ss')
        nextDisplayValue = (parsed ?? new Date()).toString()
        break
      }
      case 'color': {
        const trimmed = raw.trim()
        const color = isHexColorString(trimmed) ? trimmed : '#000000'
        nextValue = new ColorValue(color)
        nextDisplayValue = color
        break
      }
    }

    valueTypeByRowIdRef.current.set(rowId, nextValue)
    onChange(nextDisplayValue)
    closeContextMenu()
  }, [contextMenu, closeContextMenu])

  const buildTransformMenuItems = useCallback(
    (rowId: string, currentValue: string, onChange: (next: string) => void): ContextMenuItem[] => {
      const transform = (target: 'string' | 'secret' | 'number' | 'dateTime' | 'color'): void => {
        const raw = currentValue
        let nextValue: ValueType
        let nextDisplayValue = raw

        switch (target) {
          case 'string': {
            nextValue = new StringValue(raw)
            nextDisplayValue = raw
            break
          }
          case 'secret': {
            nextValue = new PasswordValue(raw)
            nextDisplayValue = raw
            break
          }
          case 'number': {
            const parsed = tryParseNumberString(raw.trim())
            nextValue = new NumericValue(parsed ?? 0, 'decimal')
            nextDisplayValue = parsed !== null ? String(parsed) : '0'
            break
          }
          case 'dateTime': {
            const parsed = tryParseDateString(raw.trim())
            nextValue = new DateTimeValue(parsed ?? new Date(), 'YYYY-MM-DD HH:mm:ss')
            nextDisplayValue = (parsed ?? new Date()).toString()
            break
          }
          case 'color': {
            const trimmed = raw.trim()
            const color = isHexColorString(trimmed) ? trimmed : '#000000'
            nextValue = new ColorValue(color)
            nextDisplayValue = color
            break
          }
        }

        valueTypeByRowIdRef.current.set(rowId, nextValue)
        onChange(nextDisplayValue)
      }

      return [
        {
          id: 'transform-to',
          label: t('keyValueTable.transformTo'),
          items: [
            { id: 'transform-string', label: t('keyValueTable.types.string'), onClick: () => { transform('string') } },
            { id: 'transform-secret', label: t('keyValueTable.types.secret'), onClick: () => { transform('secret') } },
            { id: 'sep-1', label: '', isSeparator: true },
            { id: 'transform-number', label: t('keyValueTable.types.number'), onClick: () => { transform('number') } },
            { id: 'transform-datetime', label: t('keyValueTable.types.dateTime'), onClick: () => { transform('dateTime') } },
            { id: 'transform-color', label: t('keyValueTable.types.color'), onClick: () => { transform('color') } }
          ]
        }
      ]
    },
    [t]
  )

  const contextMenuNode = useMemo(() => {
    if (!contextMenu?.visible) return null

    return (
      <div
        className="restorm-kv-context-menu menu menubar-menu-items-holder menu-container"
        style={{
          position: 'fixed',
          top: contextMenu.y,
          left: contextMenu.x,
          zIndex: 3000
        }}
        onContextMenu={(e) => { e.preventDefault() }}
      >
        <div className="menu">
          <ul className="actions-container" role="menu">
            <MenuItem title={t('keyValueTable.transformTo')}>
              <MenuItem title={t('keyValueTable.types.string')} onClick={() => { castToType('string') }} />
              <MenuItem title={t('keyValueTable.types.secret')} onClick={() => { castToType('secret') }} />
              <MenuItemSeparator />
              <MenuItem title={t('keyValueTable.types.number')} onClick={() => { castToType('number') }} />
              <MenuItem title={t('keyValueTable.types.dateTime')} onClick={() => { castToType('dateTime') }} />
              <MenuItem title={t('keyValueTable.types.color')} onClick={() => { castToType('color') }} />
            </MenuItem>
          </ul>
        </div>
      </div>
    )
  }, [contextMenu, t, castToType])

  const tableInitialRows = React.useMemo<KeyValueTableRow[] | undefined>(() => {
    if (!initialRows) return undefined
    return initialRows.map((r) => ({
      id: r.id,
      key: r.key,
      value: r.value.toString(),
      description: r.description,
      enabled: r.enabled
    }))
  }, [initialRows])

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
      } else if (currentType instanceof PasswordValue) {
        nextValue = new PasswordValue(raw)
      } else {
        nextValue = new StringValue(raw)
      }

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
      />
    ),
    []
  )

  // RestormVariableInputBox renderer for values (with resolved value tooltips)
  // Use refs to avoid recreating the renderer when variables/helpers change
  const ValueCellRenderer = useCallback<React.FC<CellRendererProps>>(
    ({ value, onChange, rowId }) => {
      const id = rowId
      const existing = id ? valueTypeByRowIdRef.current.get(id) : undefined

      if (id && !existing) {
        valueTypeByRowIdRef.current.set(id, new StringValue(value))
      }

      const resolved = id ? (valueTypeByRowIdRef.current.get(id) ?? new StringValue(value)) : new StringValue(value)

      const handleContextMenu = (e: React.MouseEvent): void => {
        e.preventDefault()
        if (!id) return
        setContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          rowId: id,
          currentValue: value,
          onChange
        })
      }

      if (resolved instanceof PasswordValue) {
        return (
          <div style={{ width: '100%', height: '100%' }} onContextMenu={handleContextMenu}>
            <InputBox
              value={value}
              onChange={(next) => {
                if (id) valueTypeByRowIdRef.current.set(id, new PasswordValue(next))
                onChange(next)
              }}
              options={{ type: 'text' }}
              password
            />
          </div>
        )
      }

      if (resolved instanceof ColorValue) {
        const hex = value || '#000000'
        return (
          <div style={{ width: '100%', height: '100%' }} onContextMenu={handleContextMenu}>
            <ColorValueCell
              hex={hex}
              onChangeHex={(nextHex: string) => {
                if (id) valueTypeByRowIdRef.current.set(id, new ColorValue(nextHex))
                onChange(nextHex)
              }}
            />
          </div>
        )
      }

      if (resolved instanceof DateTimeValue) {
        const outputMode =
          resolved.format === 'unix' || resolved.format === 'epoch' || resolved.format === 'iso' ? resolved.format : 'pattern'
        const pattern = outputMode === 'pattern' ? resolved.format : 'YYYY-MM-DD HH:mm:ss'
        return (
          <div style={{ width: '100%', height: '100%' }} onContextMenu={handleContextMenu}>
            <DateTimePicker
              value={resolved.value}
              onChange={(nextDate: Date) => {
                if (id) valueTypeByRowIdRef.current.set(id, new DateTimeValue(nextDate, resolved.format))
                onChange(new DateTimeValue(nextDate, resolved.format).toString())
              }}
              outputMode={outputMode}
              format={pattern}
              onOutputModeChange={(nextMode: 'pattern' | 'unix' | 'epoch' | 'iso') => {
                if (!id) return
                const nextFormat = nextMode === 'pattern' ? pattern : nextMode
                valueTypeByRowIdRef.current.set(id, new DateTimeValue(resolved.value, nextFormat))
                onChange(new DateTimeValue(resolved.value, nextFormat).toString())
              }}
              onFormatChange={(nextPattern: string) => {
                if (!id) return
                valueTypeByRowIdRef.current.set(id, new DateTimeValue(resolved.value, nextPattern))
                onChange(new DateTimeValue(resolved.value, nextPattern).toString())
              }}
            />
          </div>
        )
      }

      if (resolved instanceof NumericValue) {
        return (
          <div style={{ width: '100%', height: '100%' }} onContextMenu={handleContextMenu}>
            <InputBox
              value={value}
              onChange={(next) => {
                const parsed = Number(next)
                if (id && Number.isFinite(parsed)) {
                  valueTypeByRowIdRef.current.set(id, new NumericValue(parsed, resolved.format))
                }
                onChange(next)
              }}
              options={{ type: 'number' }}
            />
          </div>
        )
      }

      return (
        <RestormVariableInputBox
          value={value}
          onChange={(next) => {
            if (id) {
              // When the current value is a string, and it can be casted (date/number/color),
              // we keep the casted type (same logic as import).
              const inferred = inferValueFromString(next)
              if (resolved instanceof StringValue) {
                switch (inferred.kind) {
                  case 'datetime':
                    valueTypeByRowIdRef.current.set(id, new DateTimeValue(inferred.date, inferred.format))
                    break
                  case 'numeric':
                    valueTypeByRowIdRef.current.set(id, new NumericValue(inferred.number, inferred.format))
                    break
                  case 'color':
                    valueTypeByRowIdRef.current.set(id, new ColorValue(inferred.color))
                    break
                  default:
                    valueTypeByRowIdRef.current.set(id, new StringValue(inferred.value))
                }
              } else {
                valueTypeByRowIdRef.current.set(id, new StringValue(next))
              }
            }
            onChange(next)
          }}
          variables={variablesRef.current}
          helpers={helpersRef.current}
          variableId={id}
          contextMenuItems={id ? buildTransformMenuItems(id, value, onChange) : undefined}
        />
      )
    },
    [buildTransformMenuItems]
  )

  return (
    <>
      <KeyValueTable
        ref={ref}
        initialRows={tableInitialRows}
        onRowsChange={handleRowsChange}
        renderKeyCell={KeyCellRenderer}
        renderValueCell={ValueCellRenderer}
      />
      {contextMenuNode}
    </>
  )
})

RestormKeyValueTable.displayName = 'RestormKeyValueTable'
