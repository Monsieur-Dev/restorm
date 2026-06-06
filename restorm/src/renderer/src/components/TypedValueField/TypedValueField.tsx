import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { collectTypeLeaves } from './typePickMenu'
import { ScenarioInlineCodeField, type ScenarioCodeLanguage } from '../Scenario/nodes/ScenarioCodeField'
import {
  InputBox,
  Button,
  ColorPicker,
  ContextMenu,
  ControlGroup,
  DateTimePicker,
  Toggle,
  Tooltip,
  MultiSelectCombo,
  SelectBox,
  type ContextMenuItem,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import type { ValueType, EnumDefinition, CustomValueList } from '../../../../shared/types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, PasswordValue, ExpressionValue, BooleanValue, EnumValue, EnumListValue, CustomListValue, CustomListMultiValue, VariableValue, EnvironmentValue, NullValue, ListValue } from '../../../../shared/types/collections'
import { EnvironmentValueCell } from './EnvironmentValueCell'
import { ListValueCell } from './ListValueCell'
import type { EnvValueTypeGroup } from '../../hooks/collectEnvValueTypeGroups'
import { useScenarioVariables } from '../../contexts/ScenarioVariablesContext'
import { castValueToKind, resolveValueTypeKind, type ValueTypeKind } from './castValue'
import './typedValueField.css'

/**
 * Small square indicator button rendered to the right of a value cell so
 * the user can see at a glance what type a value holds without having to
 * click into the cell. Clicking (or right-clicking) it opens the type-pick
 * menu.
 */
interface TypeIndicatorProps {
  icon: string
  ariaLabel: string
  dataTestId?: string | undefined
  onMenuOpen?: (e: React.MouseEvent) => void
}

const TypeIndicator: React.FC<TypeIndicatorProps> = ({ icon, ariaLabel, dataTestId, onMenuOpen }) => (
  // A real ECUI Button (medium = 28×28 square) so it auto-styles with the theme
  // and lines up flush with the value cell inside the ControlGroup. Opens the
  // type-pick menu on either a primary or a context (right) click — UNLESS the
  // field locks its type (`onMenuOpen` omitted): then it stays a pure, inert
  // indicator (icon still shows the type, but it opens nothing and drops its
  // clickable affordance).
  <Button
    medium
    secondary
    icon={icon}
    {...(onMenuOpen ? { onClick: onMenuOpen, onContextMenu: onMenuOpen } : { className: 'tvf-type-indicator-locked' })}
    options={{ ariaLabel }}
    {...(dataTestId && { 'data-testid': dataTestId })}
  />
)

interface ColorValueCellProps {
  hex: string
  onChangeHex: (nextHex: string) => void
  dataTestId?: string | undefined
}

const ColorValueCell: React.FC<ColorValueCellProps> = ({ hex, onChangeHex, dataTestId }) => {
  const targetRef = useRef<HTMLSpanElement | null>(null)
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

    // Capture phase so an outside click on a host that stops propagation
    // before it bubbles to `document` (e.g. the React Flow canvas pane / nodes)
    // still dismisses the popover instead of leaving it stuck open.
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
    }
  }, [isOpen])

  // A fragment (not a wrapping div) so the hex field + swatch land as DIRECT
  // children of the value cell's ControlGroup — only then does the group stretch
  // the disabled InputBox to the full 28px row height (a nested InputBox stays at
  // its natural 27px, dropping its bottom border above the buttons'). The Tooltip
  // renders null / a portal, so it adds no stray control-group child.
  return (
    <>
      <InputBox
        value={hex}
        options={{ type: 'text' }}
        disabled
        {...(dataTestId && { 'data-testid': `${dataTestId}-color-input` })}
      />

      <span ref={targetRef} className="tvf-color-swatch">
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
      </span>

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
    </>
  )
}

export interface TypedValueFieldProps {
  /** The current typed value. */
  value: ValueType
  /** Called with the next typed value on any edit or type change. */
  onChange: (next: ValueType) => void
  /**
   * Enum + custom-value types grouped by API (one per environment folder). The
   * type-pick menu renders one submenu per group; value resolution flattens
   * them. Each apiDoc enum id is folder-namespaced (`${folderId}::${model}`) so
   * same-named models across APIs don't collide.
   */
  valueTypeGroups?: EnvValueTypeGroup[] | undefined
  /** Type kinds to omit from the type-pick menu (e.g. `['expression']`). */
  excludeTypes?: ValueTypeKind[] | undefined
  /**
   * A scenario variable name to omit from the "Variables" menu — e.g. a
   * `setVariable` node excludes the variable it itself declares, so it can
   * reference any variable but its own.
   */
  excludeVariableName?: string | undefined
  /**
   * Show every variable in the "Variables" menu regardless of its declared
   * type, instead of filtering by `excludeTypes`. Used by `getVariable`, whose
   * slot accepts a variable of any type (it reads, it doesn't type-constrain).
   */
  allowAllVariables?: boolean | undefined
  /**
   * Offer the `environment` type in the type-pick menu (an entry before
   * "secret") and render its env-picker button when selected. Off by default,
   * since most slots can't take an environment; the nodes that accept one
   * (input / if / switch / assert / comparator / set+getVariable, and the http
   * request node's `env` field) opt in.
   */
  allowEnvironment?: boolean | undefined
  /**
   * Offer the `null` type — an explicit "no value" (distinct from the empty
   * string). Off by default; the slots that accept it opt in (comparison nodes
   * if / switch / assert / comparator / boolean, set+object+output values, and
   * a log's `data`). NOT offered on arithmetic / wait / loop / input fields.
   */
  allowNull?: boolean | undefined
  /**
   * When set, the type-pick menu offers `list` — an agnostic, untyped list
   * edited in a popover (rows of nested TypedValueFields). Off by default; the
   * slots that accept a list value opt in.
   */
  allowList?: boolean | undefined
  /**
   * When set, the type-pick menu gains a trailing separator + a "remove" entry
   * (e.g. a switch case removing itself). The label defaults to "Supprimer".
   */
  onRemove?: (() => void) | undefined
  /** Label for the {@link onRemove} entry. Defaults to a translated "Supprimer". */
  removeLabel?: string | undefined
  /** Variables visible to the expression editor. */
  variables?: VariableDefinition[] | undefined
  /** Handlebars helpers for the expression editor's autocompletion. */
  helpers?: TranslatedHelperDefinition[] | undefined
  /**
   * Runtime id forwarded to the expression editor so the backend can push
   * resolved-value tooltips for that variable (KeyValue.id in the KV table).
   */
  expressionVariableId?: string | undefined
  /** Test id prefix; widget + menu testids are derived from it. */
  dataTestId?: string | undefined
  /**
   * Extra control(s) appended INSIDE the value's ControlGroup, right after the
   * type-indicator button — so they sit flush beside the field like the colour /
   * date pickers (e.g. the expression field's "expand to full-screen editor"
   * button). Rendered for every type, so callers that lock the type (expression)
   * get a single, predictable trailing button.
   */
  trailingControls?: React.ReactNode | undefined
  /**
   * Render a STRING value as a roomy multiline preview + a full-screen editor
   * modal (in the given language) instead of the single-line input — for
   * document operands (json / xml / yaml / csv value, writeFile content, …). The
   * type-pick button is kept, so the value can still be recast / wired.
   */
  multilineLanguage?: ScenarioCodeLanguage | undefined
  /**
   * Lock the value's TYPE: keep the type-indicator button (it still shows which
   * type the value holds) but suppress its type-pick menu, so the type can't be
   * recast. Used by the run-parameters prompt, where each field's type is fixed
   * by the input node's declared param type — the user supplies a VALUE, not a
   * new type.
   */
  lockType?: boolean | undefined
}

/**
 * Reusable typed-value editor: a per-type widget (text / number / boolean /
 * date / colour / enum / custom-list / expression / secret) plus a type-pick
 * indicator that opens a menu to recast the value. The contract is purely
 * `value: ValueType` + `onChange(next: ValueType)` — the caller owns
 * persistence / serialization.
 */
export const TypedValueField: React.FC<TypedValueFieldProps> = ({
  value,
  onChange,
  valueTypeGroups,
  excludeTypes,
  excludeVariableName,
  allowAllVariables,
  allowEnvironment,
  allowNull,
  allowList,
  onRemove,
  removeLabel,
  variables = [],
  helpers = [],
  expressionVariableId,
  dataTestId,
  lockType,
  trailingControls,
  multilineLanguage
}) => {
  const { t } = useTranslation()

  // Scenario variables in scope (empty outside a scenario), minus this field's
  // own variable, so a setVariable can reference any variable but itself.
  const scenarioVariables = useScenarioVariables()
  const variableNames = useMemo(
    () => scenarioVariables.filter((v) => v.name !== excludeVariableName),
    [scenarioVariables, excludeVariableName]
  )

  const [menu, setMenu] = useState<{ visible: boolean; x: number; y: number } | null>(null)

  const closeMenu = useCallback((): void => {
    setMenu((prev) => (prev ? { ...prev, visible: false } : null))
  }, [])

  const isExcluded = useCallback(
    (kind: ValueTypeKind): boolean => excludeTypes?.includes(kind) ?? false,
    [excludeTypes]
  )

  // Flatten the per-API groups into single lookup lists used for value
  // resolution + casting; a single value resolves the same as before because
  // ids are globally unique (apiDoc enum ids are folder-namespaced upstream).
  const groups = useMemo(() => valueTypeGroups ?? [], [valueTypeGroups])
  const enumDefinitions = useMemo<EnumDefinition[]>(
    () => groups.flatMap((g) => g.enumDefinitions),
    [groups]
  )
  const customValueLists = useMemo<CustomValueList[]>(
    () => groups.flatMap((g) => g.customValueLists),
    [groups]
  )

  const activeType = resolveValueTypeKind(value)
  const activeDefId =
    (value as { enumDefinitionId?: string }).enumDefinitionId ??
    (value as { listId?: string }).listId

  const cast = useCallback(
    (targetKind: ValueTypeKind, defId?: string): void => {
      onChange(castValueToKind(value, targetKind, defId, customValueLists))
      closeMenu()
    },
    [value, customValueLists, onChange, closeMenu]
  )

  const openMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    setMenu({ visible: true, x: e.clientX, y: e.clientY })
  }, [])

  const withTypeControl = (
    editor: React.ReactNode,
    o: { icon: string; ariaLabel: string; typeTestid: string }
  ): React.ReactNode => (
    <ControlGroup className="tvf-control-group">
      {editor}
      {trailingControls}
      {!hideTypeButton && (
        <TypeIndicator
          icon={o.icon}
          ariaLabel={o.ariaLabel}
          {...(!lockType && { onMenuOpen: openMenu })}
          {...(dataTestId && { dataTestId: `${dataTestId}-value-type-${o.typeTestid}` })}
        />
      )}
    </ControlGroup>
  )

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    const listWord = t('keyValueTable.listSuffix')
    const enumsAllowed = !isExcluded('enum')
    const enumListAllowed = !isExcluded('enumList')
    const customListAllowed = !isExcluded('customList')
    const customListMultiAllowed = !isExcluded('customListMulti')
    const showEnums = enumsAllowed || enumListAllowed
    const showCustomLists = customListAllowed || customListMultiAllowed

    const items: ContextMenuItem[] = []

    if (!isExcluded('string')) {
      items.push({
        id: 'string',
        label: t('keyValueTable.types.string'),
        checked: activeType === 'string',
        onClick: () => { cast('string') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-string` })
      })
    }
    if (!isExcluded('number')) {
      items.push({
        id: 'number',
        label: t('keyValueTable.types.number'),
        checked: activeType === 'number',
        onClick: () => { cast('number') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-number` })
      })
    }
    if (!isExcluded('dateTime')) {
      items.push({
        id: 'datetime',
        label: t('keyValueTable.types.dateTime'),
        checked: activeType === 'dateTime',
        onClick: () => { cast('dateTime') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-datetime` })
      })
    }
    if (!isExcluded('boolean')) {
      items.push({
        id: 'boolean',
        label: t('keyValueTable.types.boolean'),
        checked: activeType === 'boolean',
        onClick: () => { cast('boolean') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-boolean` })
      })
    }
    if (!isExcluded('color')) {
      items.push({
        id: 'color',
        label: t('keyValueTable.types.color'),
        checked: activeType === 'color',
        onClick: () => { cast('color') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-color` })
      })
    }

    for (const group of groups) {
      const groupLists = showCustomLists
        ? [...group.customValueLists].sort((a, b) => a.name.localeCompare(b.name))
        : []
      const groupEnums = showEnums
        ? [...group.enumDefinitions].sort((a, b) => a.name.localeCompare(b.name))
        : []
      if (groupLists.length === 0 && groupEnums.length === 0) continue

      const subItems: ContextMenuItem[] = []
      for (const list of groupLists) {
        if (customListAllowed) {
          subItems.push({
            id: `customlist-${list.id}`,
            label: list.name,
            checked: activeType === 'customList' && activeDefId === list.id,
            onClick: () => { cast('customList', list.id) },
            ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-customlist-${list.id}` })
          })
        }
        if (customListMultiAllowed) {
          subItems.push({
            id: `customlistmulti-${list.id}`,
            label: `${list.name} (${listWord})`,
            checked: activeType === 'customListMulti' && activeDefId === list.id,
            onClick: () => { cast('customListMulti', list.id) },
            ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-customlistmulti-${list.id}` })
          })
        }
      }

      const hasBoth = groupLists.length > 0 && groupEnums.length > 0
      if (hasBoth) {
        subItems.push({ id: `sep-${group.id}`, label: '', isSeparator: true })
      }

      for (const def of groupEnums) {
        if (enumsAllowed) {
          subItems.push({
            id: `enum-${def.id}`,
            label: def.name,
            checked: activeType === 'enum' && activeDefId === def.id,
            onClick: () => { cast('enum', def.id) },
            ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-enum-${def.id}` })
          })
        }
        if (enumListAllowed) {
          subItems.push({
            id: `enumlist-${def.id}`,
            label: `${def.name} (${listWord})`,
            checked: activeType === 'enumList' && activeDefId === def.id,
            onClick: () => { cast('enumList', def.id) },
            ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-enumlist-${def.id}` })
          })
        }
      }

      items.push({
        id: `api-${group.id}`,
        label: group.name,
        items: subItems,
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-api-${group.id}` })
      })
    }

    // Only offer variables whose declared type this slot accepts: a slot that
    // excludes a kind (e.g. arithmetic excludes `string`) must also hide
    // variables declared with that kind.
    const selectableVariables = allowAllVariables ? variableNames : variableNames.filter((v) => !isExcluded(v.type))
    if (selectableVariables.length > 0 && !isExcluded('variable')) {
      const activeVar = activeType === 'variable' ? value.toString() : undefined
      items.push({
        id: 'variables',
        label: t('keyValueTable.types.variables', 'Variables'),
        items: selectableVariables.map(({ name }) => ({
          id: `variable-${name}`,
          label: name,
          checked: activeVar === name,
          onClick: () => { cast('variable', name) },
          ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-variable-${name}` })
        })),
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-variables` })
      })
    }

    // `secret` + `expression` sit below a separator — but only emit that
    // separator when this trailing group actually has entries AND something
    // precedes it, otherwise an all-excluded tail (e.g. the list-only forEach
    // `items` selector) leaves an orphan divider with nothing to separate.
    const tail: ContextMenuItem[] = []
    // `null` — an explicit "no value" — heads the trailing group where the slot
    // opted in. Picking it casts to a `NullValue` (no editable widget).
    if (allowNull) {
      tail.push({
        id: 'null',
        label: t('keyValueTable.types.null', 'Null'),
        checked: activeType === 'null',
        onClick: () => { cast('null') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-null` })
      })
    }
    // `list` — an agnostic, untyped list edited in a popover. Picking it casts
    // to an empty `ListValue`; the field's button opens the row editor.
    if (allowList) {
      tail.push({
        id: 'list',
        label: t('keyValueTable.types.list', 'List'),
        checked: activeType === 'list',
        onClick: () => { cast('list') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-list` })
      })
    }
    // `environment` sits just before `secret`, only where the slot opted in.
    // Picking it casts to an empty EnvironmentValue; the env-picker button then
    // resolves the actual environment (there's no submenu).
    if (allowEnvironment && !isExcluded('environment')) {
      tail.push({
        id: 'environment',
        label: t('keyValueTable.types.environment', 'Environment'),
        checked: activeType === 'environment',
        onClick: () => { cast('environment') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-environment` })
      })
    }
    if (!isExcluded('secret')) {
      tail.push({
        id: 'secret',
        label: t('keyValueTable.types.secret'),
        checked: activeType === 'secret',
        onClick: () => { cast('secret') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-secret` })
      })
    }
    if (!isExcluded('expression')) {
      tail.push({
        id: 'expression',
        label: t('keyValueTable.types.expression'),
        checked: activeType === 'expression',
        onClick: () => { cast('expression') },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-expression` })
      })
    }
    if (tail.length > 0) {
      if (items.length > 0) items.push({ id: 'sep-secret', label: '', isSeparator: true })
      items.push(...tail)
    }

    if (onRemove) {
      items.push({ id: 'sep-remove', label: '', isSeparator: true })
      items.push({
        id: 'remove',
        label: removeLabel ?? t('common.remove', 'Supprimer'),
        icon: 'trash',
        onClick: onRemove,
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-remove` })
      })
    }

    return items
  }, [t, cast, dataTestId, groups, activeType, activeDefId, isExcluded, variableNames, allowAllVariables, allowEnvironment, allowNull, allowList, value, onRemove, removeLabel])

  // When the type-pick menu offers at most ONE selectable type, the choice is
  // forced: hide the type button (keep it for `lockType`, whose icon is purely
  // informational). Derived from the SAME live `menuItems`, so adding a scenario
  // variable (which can grow a variable-only field from 0→1→2 options)
  // re-evaluates the button's visibility automatically.
  const typeLeaves = useMemo(() => collectTypeLeaves(menuItems), [menuItems])
  const hideTypeButton = !lockType && typeLeaves.length <= 1
  // With exactly one option, force the value onto it (so the left widget already
  // shows the right type — e.g. a boolean-only slot renders its toggle).
  useEffect(() => {
    if (typeLeaves.length !== 1) return
    const only = typeLeaves[0]
    if (only && only.checked !== true && only.onClick) only.onClick()
  }, [typeLeaves])

  const widget = ((): React.ReactNode => {
    if (value instanceof PasswordValue) {
      return withTypeControl(
        <InputBox
          value={value.toString()}
          onChange={(next) => { onChange(new PasswordValue(next)) }}
          options={{ type: 'text' }}
          password
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-password` })}
        />,
        { icon: 'lock', ariaLabel: 'Password value', typeTestid: 'password' }
      )
    }

    if (value instanceof ColorValue) {
      const hex = value.value || '#000000'
      return withTypeControl(
        <ColorValueCell
          hex={hex}
          onChangeHex={(nextHex: string) => { onChange(new ColorValue(nextHex)) }}
          dataTestId={dataTestId ? `${dataTestId}-value-color` : undefined}
        />,
        { icon: 'symbol-color', ariaLabel: 'Color value', typeTestid: 'color' }
      )
    }

    if (value instanceof DateTimeValue) {
      const outputMode =
        value.format === 'unix' || value.format === 'epoch' || value.format === 'iso' ? value.format : 'pattern'
      const pattern = outputMode === 'pattern' ? value.format : 'yyyy-MM-dd HH:mm:ss'
      return withTypeControl(
        <DateTimePicker
          value={value.value}
          onChange={(nextDate: Date) => { onChange(new DateTimeValue(nextDate, value.format)) }}
          outputMode={outputMode}
          format={pattern}
          onOutputModeChange={(nextMode: 'pattern' | 'unix' | 'epoch' | 'iso') => {
            const nextFormat = nextMode === 'pattern' ? pattern : nextMode
            onChange(new DateTimeValue(value.value, nextFormat))
          }}
          onFormatChange={(nextPattern: string) => { onChange(new DateTimeValue(value.value, nextPattern)) }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-datetime-picker` })}
        />,
        { icon: 'calendar', ariaLabel: 'Date-time value', typeTestid: 'datetime' }
      )
    }

    if (value instanceof NumericValue) {
      return withTypeControl(
        <InputBox
          value={value.toString()}
          onChange={(next) => {
            const parsed = Number(next)
            onChange(Number.isFinite(parsed) ? new NumericValue(parsed, value.format) : value)
          }}
          options={{ type: 'number' }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-number` })}
        />,
        { icon: 'symbol-numeric', ariaLabel: 'Numeric value', typeTestid: 'numeric' }
      )
    }

    if (value instanceof BooleanValue) {
      const isTrue = value.value
      return withTypeControl(
        <Toggle
          checked={isTrue}
          onChange={(next) => { onChange(new BooleanValue(next)) }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-boolean` })}
        />,
        { icon: 'symbol-boolean', ariaLabel: 'Boolean value', typeTestid: 'boolean' }
      )
    }

    if (value instanceof ExpressionValue) {
      return withTypeControl(
        <RestormVariableInputBox
          value={value.toString()}
          onChange={(next) => { onChange(new ExpressionValue(next)) }}
          variables={variables}
          helpers={helpers}
          {...(expressionVariableId !== undefined && { variableId: expressionVariableId })}
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-expression` })}
        />,
        { icon: 'code', ariaLabel: 'Expression (Handlebars template)', typeTestid: 'expression' }
      )
    }

    // NullValue → a read-only "null" cell (no value to type); the ø icon marks
    // the type. Recast via the type menu like any other.
    if (value instanceof NullValue) {
      return withTypeControl(
        <InputBox
          value="null"
          options={{ type: 'text' }}
          disabled
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-null` })}
        />,
        { icon: 'circle-slash', ariaLabel: 'Null value', typeTestid: 'null' }
      )
    }

    // ListValue → a preview field + a popover editor (rows of nested
    // TypedValueFields). The ø/list icon marks the type.
    if (value instanceof ListValue) {
      return withTypeControl(
        <ListValueCell
          value={value}
          onChange={onChange}
          {...(valueTypeGroups ? { valueTypeGroups } : {})}
          {...(excludeVariableName ? { excludeVariableName } : {})}
          {...(dataTestId ? { dataTestId } : {})}
        />,
        { icon: 'list-unordered', ariaLabel: 'List value', typeTestid: 'list' }
      )
    }

    // VariableValue → read-only display of the referenced variable name (the
    // reference is changed via the type menu's "Variables" submenu, not typed).
    if (value instanceof VariableValue) {
      return withTypeControl(
        <InputBox
          value={value.toString()}
          options={{ type: 'text' }}
          disabled
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-variable` })}
        />,
        { icon: 'symbol-variable', ariaLabel: 'Variable reference', typeTestid: 'variable' }
      )
    }

    // EnvironmentValue → an env-picker button (left of the type control) listing
    // every environment across all environment folders.
    if (value instanceof EnvironmentValue) {
      return withTypeControl(
        <EnvironmentValueCell
          value={value}
          onChange={(next) => { onChange(next) }}
          {...(dataTestId && { dataTestId })}
        />,
        { icon: 'globe', ariaLabel: 'Environment reference', typeTestid: 'environment' }
      )
    }

    // EnumListValue → MultiSelectCombo
    if (value instanceof EnumListValue) {
      const enumDef = enumDefinitions.find((d) => d.id === value.enumDefinitionId)
      const options = (enumDef?.values ?? []).map((v) => ({ value: v, label: v }))
      return withTypeControl(
        <MultiSelectCombo
          options={options}
          selected={value.value}
          onChange={(next) => { onChange(new EnumListValue(next, value.enumDefinitionId)) }}
          placeholder={enumDef?.name ?? 'Select...'}
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-enumlist` })}
        />,
        { icon: 'list-unordered', ariaLabel: 'Enum list value', typeTestid: 'enumlist' }
      )
    }

    // CustomListMultiValue → MultiSelectCombo of the list's labels.
    if (value instanceof CustomListMultiValue) {
      const list = customValueLists.find((l) => l.id === value.listId)
      const enabled = (list?.entries ?? []).filter((e) => e.enabled !== false)
      const options = enabled.map((e) => ({ value: e.label, label: e.label }))
      const selected = value.labels.filter((l) => options.some((o) => o.value === l))
      return withTypeControl(
        <MultiSelectCombo
          options={options}
          selected={selected}
          onChange={(next) => { onChange(new CustomListMultiValue(value.listId, next)) }}
          placeholder={list?.name ?? 'Select...'}
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-customlistmulti` })}
        />,
        { icon: 'list-unordered', ariaLabel: 'Custom list multi value', typeTestid: 'customlistmulti' }
      )
    }

    // CustomListValue → SelectBox of the list's labels.
    if (value instanceof CustomListValue) {
      const list = customValueLists.find((l) => l.id === value.listId)
      const options = (list?.entries ?? []).filter((e) => e.enabled !== false).map((e) => ({ text: e.label }))
      const selectedIndex = options.findIndex((o) => o.text === value.label)
      return withTypeControl(
        <SelectBox
          options={options}
          selected={selectedIndex >= 0 ? selectedIndex : 0}
          onDidSelect={(data) => { onChange(new CustomListValue(value.listId, data.selected)) }}
          className=""
          id="customlist-select"
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-customlist` })}
        />,
        { icon: 'symbol-enum', ariaLabel: 'Custom list value', typeTestid: 'customlist' }
      )
    }

    // EnumValue → SelectBox
    if (value instanceof EnumValue) {
      const enumDef = enumDefinitions.find((d) => d.id === value.enumDefinitionId)
      const options = (enumDef?.values ?? []).map((v) => ({ text: v }))
      const selectedIndex = options.findIndex((o) => o.text === value.value)
      return withTypeControl(
        <SelectBox
          options={options}
          selected={selectedIndex >= 0 ? selectedIndex : 0}
          onDidSelect={(data) => { onChange(new EnumValue(data.selected, value.enumDefinitionId)) }}
          className=""
          id="enum-select"
          {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-enum` })}
        />,
        { icon: 'list-unordered', ariaLabel: 'Enum value', typeTestid: 'enum' }
      )
    }

    // A document operand (json / xml / yaml / csv value, writeFile content, …):
    // a roomy multiline preview + full-screen editor modal, keeping the type
    // button so the value can still be recast / wired.
    if (multilineLanguage) {
      return withTypeControl(
        <ScenarioInlineCodeField
          value={value.toString()}
          onChange={(next) => { onChange(new StringValue(next)) }}
          language={multilineLanguage}
          title={t('scenario.codeField.title', 'Edit')}
          {...(dataTestId && { dataTestId: `${dataTestId}-value-string` })}
        />,
        { icon: 'symbol-string', ariaLabel: 'String value', typeTestid: 'string' }
      )
    }
    return withTypeControl(
      <InputBox
        value={value.toString()}
        onChange={(next) => { onChange(new StringValue(next)) }}
        options={{ type: 'text' }}
        {...(dataTestId && { 'data-testid': `${dataTestId}-value-input-string` })}
      />,
      { icon: 'symbol-string', ariaLabel: 'String value', typeTestid: 'string' }
    )
  })()

  return (
    <>
      {widget}
      {/* No type-pick menu when the type is locked — the indicator is inert. */}
      {!lockType && createPortal(
        // Portal up to the `.workbench` root: `ContextMenu` is `position: fixed`,
        // but inside the scenario editor a React Flow ancestor carries a CSS
        // `transform` (pan/zoom) that would re-anchor `fixed` to that transformed
        // box and throw the menu off screen. The workbench element sits above
        // that transform AND carries the app font, so the menu both positions
        // against the viewport and inherits the font (unlike `document.body`,
        // which is outside `.workbench` and falls back to the UA serif default).
        <ContextMenu
          visible={!!menu?.visible}
          x={menu?.x ?? 0}
          y={menu?.y ?? 0}
          items={menuItems}
          onRequestClose={closeMenu}
          {...(dataTestId && { 'data-testid': `${dataTestId}-context-menu` })}
        />,
        document.querySelector('.workbench') ?? document.body
      )}
    </>
  )
}

export default TypedValueField
