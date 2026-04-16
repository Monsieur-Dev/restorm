import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyValueTable,
  InputBox,
  Button,
  ColorPicker,
  DateTimePicker,
  Toggle,
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
import type { KeyValue, ValueType } from '../../../../shared/types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue, ExpressionValue, BooleanValue } from '../../../../shared/types/collections'
import { inferValueFromString, isHexColorString, tryParseDateString, tryParseNumberString } from '../../../../shared/utils/valueCasting'
import { normalizeValueType } from '../../utils/normalizeValueType'

export type VariableContext = Record<string, string>

type ValueTypeKind = 'string' | 'secret' | 'number' | 'dateTime' | 'color' | 'expression' | 'boolean'

function resolveValueTypeKind(value: ValueType | undefined): ValueTypeKind {
  if (value instanceof PasswordValue) return 'secret'
  if (value instanceof NumericValue) return 'number'
  if (value instanceof DateTimeValue) return 'dateTime'
  if (value instanceof ColorValue) return 'color'
  if (value instanceof ExpressionValue) return 'expression'
  if (value instanceof BooleanValue) return 'boolean'
  return 'string'
}

/**
 * Small square indicator button rendered to the right of a value cell so
 * the user can see at a glance what type a variable holds without having
 * to click into the cell. Mirrors the visual weight of the date / colour
 * picker buttons already present for those types. Decorative for now —
 * the click handler is reserved for a future "transform value type"
 * shortcut.
 */
interface TypeIndicatorProps {
  icon: string
  ariaLabel: string
  dataTestId?: string | undefined
}

const TypeIndicator: React.FC<TypeIndicatorProps> = ({ icon, ariaLabel, dataTestId }) => (
  <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
    <Button
      line
      icon={icon}
      options={{ ariaLabel }}
      onClick={(e) => { e.preventDefault() }}
      {...(dataTestId && { 'data-testid': dataTestId })}
    />
  </div>
)

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
        <Button
          line
          options={{ ariaLabel: 'Open color picker' }}
          onClick={(e) => {
            e.preventDefault()
            setIsOpen((prev) => !prev)
          }}
          style={{ backgroundColor: hex }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-color-button` })}
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

  const castToType = useCallback((target: 'string' | 'secret' | 'number' | 'dateTime' | 'color' | 'expression' | 'boolean'): void => {
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
      case 'expression': {
        nextValue = new ExpressionValue(raw)
        nextDisplayValue = raw
        break
      }
      case 'boolean': {
        const asBool = raw.trim().toLowerCase() === 'true' || raw.trim() === '1'
        nextValue = new BooleanValue(asBool)
        nextDisplayValue = asBool ? 'true' : 'false'
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
      const transform = (target: 'string' | 'secret' | 'number' | 'dateTime' | 'color' | 'expression' | 'boolean'): void => {
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
          case 'expression': {
            nextValue = new ExpressionValue(raw)
            nextDisplayValue = raw
            break
          }
          case 'boolean': {
            const asBool = raw.trim().toLowerCase() === 'true' || raw.trim() === '1'
            nextValue = new BooleanValue(asBool)
            nextDisplayValue = asBool ? 'true' : 'false'
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
        },
        { id: 'sep-2', label: '', isSeparator: true },
        {
          id: 'transform-expression',
          label: t('keyValueTable.types.expression'),
          checked: activeType === 'expression',
          onClick: () => { transform('expression') }
        },
        {
          id: 'transform-boolean',
          label: t('keyValueTable.types.boolean'),
          checked: activeType === 'boolean',
          onClick: () => { transform('boolean') }
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
              {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-separator-1` })}
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
            <MenuItemSeparator
              {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-separator-2` })}
            />
            <MenuItem
              title={t('keyValueTable.types.expression')}
              checked={contextMenu.activeType === 'expression'}
              onClick={() => { castToType('expression') }}
              {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-expression` })}
            />
            <MenuItem
              title={t('keyValueTable.types.boolean')}
              checked={contextMenu.activeType === 'boolean'}
              onClick={() => { castToType('boolean') }}
              {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-boolean` })}
            />
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
        // Infer the value type from the actual string value (color, datetime, etc.)
        const cast = inferValueFromString(value)
        let inferred: ValueType
        if (cast.kind === 'color') {
          inferred = new ColorValue(cast.color)
        } else if (cast.kind === 'datetime') {
          inferred = new DateTimeValue(cast.date, cast.format)
        } else if (cast.kind === 'numeric') {
          inferred = new NumericValue(cast.number, cast.format)
        } else {
          inferred = new StringValue(value)
        }
        valueTypeByRowIdRef.current.set(id, inferred)
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
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: '100%', minWidth: 0 }}
            onContextMenu={handleContextMenu}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
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
            <TypeIndicator
              icon="lock"
              ariaLabel="Password value"
              {...(dataTestId && { dataTestId: `${dataTestId}-value-type-password` })}
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
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: '100%', minWidth: 0 }}
            onContextMenu={handleContextMenu}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
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
            <TypeIndicator
              icon="symbol-numeric"
              ariaLabel="Numeric value"
              {...(dataTestId && { dataTestId: `${dataTestId}-value-type-numeric` })}
            />
          </div>
        )
      }

      if (resolved instanceof BooleanValue) {
        const isTrue = resolved.value
        return (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: '100%', minWidth: 0 }}
            onContextMenu={handleContextMenu}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Toggle
                isChecked={isTrue}
                onChange={(next) => {
                  if (id) valueTypeByRowIdRef.current.set(id, new BooleanValue(next))
                  onChange(next ? 'true' : 'false')
                }}
                {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-boolean` })}
              />
            </div>
            <TypeIndicator
              icon="symbol-boolean"
              ariaLabel="Boolean value"
              {...(dataTestId && { dataTestId: `${dataTestId}-value-type-boolean` })}
            />
          </div>
        )
      }

      if (resolved instanceof ExpressionValue) {
        return (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: '100%', minWidth: 0 }}
            onContextMenu={handleContextMenu}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <RestormVariableInputBox
                value={value}
                onChange={(next) => {
                  if (id) {
                    valueTypeByRowIdRef.current.set(id, new ExpressionValue(next))
                  }
                  onChange(next)
                }}
                variables={variablesRef.current}
                helpers={helpersRef.current}
                variableId={id}
                contextMenuItems={
                  id ? buildTransformMenuItems(id, value, onChange, activeType) : undefined
                }
                {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-expression` })}
              />
            </div>
            <TypeIndicator
              icon="code"
              ariaLabel="Expression (Handlebars template)"
              {...(dataTestId && { dataTestId: `${dataTestId}-value-type-expression` })}
            />
          </div>
        )
      }

      return (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: '100%', minWidth: 0 }}
          onContextMenu={handleContextMenu}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <RestormVariableInputBox
              value={value}
              onChange={(next) => {
                if (id) {
                  valueTypeByRowIdRef.current.set(id, new StringValue(next))
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
          </div>
          <TypeIndicator
            icon="symbol-string"
            ariaLabel="String value"
            {...(dataTestId && { dataTestId: `${dataTestId}-value-type-string` })}
          />
        </div>
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
