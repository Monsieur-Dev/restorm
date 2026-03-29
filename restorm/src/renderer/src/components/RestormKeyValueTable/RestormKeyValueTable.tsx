import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyValueTable,
  InputBox,
  ColorPicker,
  DateTimePicker,
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
import { normalizeValueType } from '../../utils/normalizeValueType'

export type VariableContext = Record<string, string>

type ValueTypeKind = 'string' | 'secret' | 'number' | 'dateTime' | 'color'

function resolveValueTypeKind(value: ValueType | undefined): ValueTypeKind {
  if (value instanceof PasswordValue) return 'secret'
  if (value instanceof NumericValue) return 'number'
  if (value instanceof DateTimeValue) return 'dateTime'
  if (value instanceof ColorValue) return 'color'
  return 'string'
}

interface ColorValueCellProps {
  hex: string
  onChangeHex: (nextHex: string) => void
  dataTestId?: string | undefined
}

const ColorValueCell: React.FC<ColorValueCellProps> = ({ hex, onChangeHex, dataTestId }) => {
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
          {...(dataTestId && { 'data-testid': `${dataTestId}-color-input` })}
        />
      </div>

      <div ref={targetRef} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          aria-label="Open color picker"
          onClick={(e) => {
            e.preventDefault()
            setIsOpen((prev) => !prev)
          }}
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            border: '1px solid var(--input-border, rgba(0, 0, 0, 0.3))',
            backgroundColor: hex,
            padding: 0,
            cursor: 'pointer'
          }}
        />
      </div>

      <Tooltip
        targetRef={targetRef as unknown as React.RefObject<HTMLElement | null>}
        show={isOpen}
        placement="below"
        className={tooltipClassName}
        {...(dataTestId && { 'data-testid': `${dataTestId}-color-tooltip` })}
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
              {...(dataTestId && { 'data-testid': `${dataTestId}-color-picker` })}
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
  /** Optional test id applied to the table root element. */
  'data-testid'?: string
}

const RestormKeyValueTableInner = React.forwardRef<KeyValueTableHandle, RestormKeyValueTableProps>((
  {
    variables,
    helpers = [],
    initialRows,
    onRowsChange,
    'data-testid': dataTestId
  },
  ref
) => {
  const { t } = useTranslation()

  // Keep refs to avoid recreating cell renderers
  const variablesRef = useRef(variables)
  const helpersRef = useRef(helpers)
  const valueTypeByRowIdRef = useRef<Map<string, ValueType>>(new Map())
  const initialRowsRef = useRef<KeyValue[] | undefined>(initialRows)

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    rowId: string
    currentValue: string
    onChange: (next: string) => void
    activeType: ValueTypeKind
  } | null>(null)
  
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

  useEffect(() => {
    if (!initialRows) return
    const nextMap = new Map<string, ValueType>()
    for (const row of initialRows) {
      if (row.id) {
        nextMap.set(row.id, normalizeValueType(row.value as unknown))
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
        nextValue = new DateTimeValue(parsed ?? new Date(), 'yyyy-MM-dd HH:mm:ss')
        nextDisplayValue = nextValue.toString()
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
    // Force persistence of the ValueType even if display value didn't change
    if (initialRows && onRowsChange) {
      const nextRows = initialRows.map((r) => (r.id === rowId ? { ...r, value: nextValue } : r))
      onRowsChange(nextRows)
    }
    closeContextMenu()
  }, [contextMenu, closeContextMenu, initialRows, onRowsChange])

  const buildTransformMenuItems = useCallback(
    (
      rowId: string,
      currentValue: string,
      onChange: (next: string) => void,
      activeType: ValueTypeKind
    ): ContextMenuItem[] => {
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
            nextValue = new DateTimeValue(parsed ?? new Date(), 'yyyy-MM-dd HH:mm:ss')
            nextDisplayValue = nextValue.toString()
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
        // Force persistence of the ValueType even if display value didn't change
        const currentRows = initialRowsRef.current
        if (currentRows && onRowsChange) {
          const nextRows = currentRows.map((r) => (r.id === rowId ? { ...r, value: nextValue } : r))
          onRowsChange(nextRows)
        }
      }

      return [
        {
          id: 'transform-to',
          label: t('keyValueTable.transformTo'),
          items: [
            {
              id: 'transform-string',
              label: t('keyValueTable.types.string'),
              checked: activeType === 'string',
              onClick: () => { transform('string') }
            },
            {
              id: 'transform-secret',
              label: t('keyValueTable.types.secret'),
              checked: activeType === 'secret',
              onClick: () => { transform('secret') }
            },
            { id: 'sep-1', label: '', isSeparator: true },
            {
              id: 'transform-number',
              label: t('keyValueTable.types.number'),
              checked: activeType === 'number',
              onClick: () => { transform('number') }
            },
            {
              id: 'transform-datetime',
              label: t('keyValueTable.types.dateTime'),
              checked: activeType === 'dateTime',
              onClick: () => { transform('dateTime') }
            },
            {
              id: 'transform-color',
              label: t('keyValueTable.types.color'),
              checked: activeType === 'color',
              onClick: () => { transform('color') }
            }
          ]
        }
      ]
    },
    [t, onRowsChange]
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
        {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu` })}
      >
        <div className="menu">
          <ul className="actions-container" role="menu">
            <MenuItem
              title={t('keyValueTable.transformTo')}
              {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-transform-to` })}
            >
              <MenuItem
                title={t('keyValueTable.types.string')}
                checked={contextMenu.activeType === 'string'}
                onClick={() => { castToType('string') }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-string` })}
              />
              <MenuItem
                title={t('keyValueTable.types.secret')}
                checked={contextMenu.activeType === 'secret'}
                onClick={() => { castToType('secret') }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-secret` })}
              />
              <MenuItemSeparator
                {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-separator` })}
              />
              <MenuItem
                title={t('keyValueTable.types.number')}
                checked={contextMenu.activeType === 'number'}
                onClick={() => { castToType('number') }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-number` })}
              />
              <MenuItem
                title={t('keyValueTable.types.dateTime')}
                checked={contextMenu.activeType === 'dateTime'}
                onClick={() => { castToType('dateTime') }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-datetime` })}
              />
              <MenuItem
                title={t('keyValueTable.types.color')}
                checked={contextMenu.activeType === 'color'}
                onClick={() => { castToType('color') }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-color` })}
              />
            </MenuItem>
          </ul>
        </div>
      </div>
    )
  }, [contextMenu, t, castToType, dataTestId])

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
        {...(dataTestId && { 'data-testid': `${dataTestId}-key-input` })}
      />
    ),
    [dataTestId]
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
      const activeType = resolveValueTypeKind(resolved)

      const handleContextMenu = (e: React.MouseEvent): void => {
        e.preventDefault()
        if (!id) return
        setContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          rowId: id,
          currentValue: value,
          onChange,
          activeType
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
              {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-password` })}
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
              dataTestId={dataTestId ? `${dataTestId}-value-color` : undefined}
            />
          </div>
        )
      }

      if (resolved instanceof DateTimeValue) {
        const outputMode =
          resolved.format === 'unix' || resolved.format === 'epoch' || resolved.format === 'iso' ? resolved.format : 'pattern'
        const pattern = outputMode === 'pattern' ? resolved.format : 'yyyy-MM-dd HH:mm:ss'
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
              {...(dataTestId && { 'data-testid': `${dataTestId}-value-datetime-picker` })}
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
              {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-number` })}
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
          contextMenuItems={
            id ? buildTransformMenuItems(id, value, onChange, activeType) : undefined
          }
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-variable` })}
        />
      )
    },
    [buildTransformMenuItems, dataTestId]
  )

  return (
    <>
      <KeyValueTable
        ref={ref}
        initialRows={tableInitialRows}
        onRowsChange={handleRowsChange}
        renderKeyCell={KeyCellRenderer}
        renderValueCell={ValueCellRenderer}
        {...(dataTestId && { 'data-testid': dataTestId })}
      />
      {contextMenuNode}
    </>
  )
})

RestormKeyValueTableInner.displayName = 'RestormKeyValueTable'

export const RestormKeyValueTable = React.memo(RestormKeyValueTableInner)
