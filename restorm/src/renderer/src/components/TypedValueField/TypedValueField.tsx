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
import type { Icon } from 'electron-core-ui/types'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import type { ValueType, EnumDefinition, CustomValueList } from '../../../../shared/types/collections'
import { StringValue, ColorValue, DateTimeValue, NumericValue, ExpressionValue, BooleanValue, EnumValue, EnumListValue, CustomListValue, CustomListMultiValue, VariableValue, EnvironmentValue, NullValue, ListValue } from '../../../../shared/types/collections'
import { SecretValue } from '../../../../shared/types/valueTypes/SecretValue'
import { valueSourceRegistry } from '../../../../shared/secrets/valueSourceRegistry'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { SecretRetrievalModal } from './sources/SecretRetrievalModal'
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
  // A codicon shorthand string, or a full ECUI Icon (library glyph) — the ECUI
  // Button renders either via IconView.
  icon: string | Icon
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

/**
 * Read-only preview for an `envVar` {@link SecretValue}. Resolves the secret's
 * plaintext on demand (on mount + on each refresh) via
 * `window.restorm.secrets.resolve` and shows it as `$<name>=<resolvedValue>` in
 * a non-editable {@link InputBox}. The resolved plaintext is shown to the user
 * (their own secret) but never written back into the value / document. A pencil
 * button opens the retrieval-edit modal (next slice).
 */
/**
 * The precise resolution-error message to surface, taken verbatim from the
 * provider (e.g. "environment variable RESTORM_E2E_SECRET is not set") — the
 * same text the retrieval modal shows. Falls back to a generic message when the
 * resolve IPC returned no error string (e.g. it never reached the provider).
 */
function secretErrorText(
  result: { value?: string; error?: string } | undefined,
  t: (key: string, fallback: string) => string
): string {
  const err = result?.error
  return err !== undefined && err !== '' ? err : t('secrets.fetchFailed', 'Récupération impossible')
}

interface SecretCellProps {
  secret: SecretValue
  /** Commit an edited secret back into the document (used by the retrieval modal). */
  onChange: (next: SecretValue) => void
  /** Report the current resolution error (the precise provider message) up to the
   * field, which outlines the whole control group in red + shows it as a tooltip.
   * `null` clears the error (resolving / success). */
  onErrorChange?: (message: string | null) => void
  /** Report whether the retrieval modal is open, so the field can suppress the
   * error tooltip while editing — otherwise its stuck hover state leaves the
   * bubble floating over the modal. */
  onModalOpenChange?: (open: boolean) => void
  dataTestId?: string | undefined
}

/**
 * The default chrome for a secret value, identical for EVERY source: a
 * read-only input previewing the resolved plaintext, stretched inside the
 * control group up to a refresh button and an always-present pencil (edit)
 * button. Configuring HOW the secret is fetched (env-var name, fake value,
 * env-file write-field, …) lives entirely in the pencil's retrieval modal —
 * the cell itself is purely a preview, whatever the source.
 *
 * The resolved plaintext is shown to the user (their own credential) but never
 * written back into the value / document — it is fetched on demand here.
 */
const SecretCell: React.FC<SecretCellProps> = ({ secret, onChange, onErrorChange, onModalOpenChange, dataTestId }) => {
  const { t } = useTranslation()
  const [resolved, setResolved] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  // Mirror the modal-open state up so the field suppresses the error tooltip
  // while editing (the click leaves the tooltip's hover state stuck otherwise).
  const onModalOpenChangeRef = useRef(onModalOpenChange)
  onModalOpenChangeRef.current = onModalOpenChange
  useEffect(() => { onModalOpenChangeRef.current?.(isModalOpen) }, [isModalOpen])
  // True while a resolution is in flight (mount, param change, or refresh) — the
  // refresh button becomes a spinner for the duration.
  const [isResolving, setIsResolving] = useState(false)

  // `onErrorChange` is reported through a ref so the resolve effect doesn't list
  // it as a dependency (a fresh closure on every parent render would otherwise
  // re-run the resolution). The cell pushes its error verdict up; the field
  // turns it into the red control-group outline + the precise tooltip.
  const onErrorChangeRef = useRef(onErrorChange)
  onErrorChangeRef.current = onErrorChange

  // Re-resolve when the source or its params change (e.g. after the retrieval
  // modal commits). Serialising the lookup descriptor gives a stable effect dep
  // that survives the params object being recreated on each edit.
  const lookupKey = JSON.stringify({ source: secret.source, params: secret.params })

  // The resolve effect keys off `lookupKey` ALONE (a stable string). The live
  // secret + `t` are read through refs so the effect never re-runs merely
  // because the parent re-rendered with a new `secret.params` object identity —
  // a re-run would cancel the in-flight resolve and, since reporting an error up
  // (`onErrorChange`) re-renders the parent, spin a feedback loop that pins the
  // cell on its "resolving" spinner forever.
  const secretRef = useRef(secret)
  secretRef.current = secret
  const tRef = useRef(t)
  tRef.current = t

  const refresh = useCallback(async (): Promise<void> => {
    // Blank the preview immediately so the cell reflects the in-flight refresh.
    setResolved(null)
    setHasError(false)
    onErrorChangeRef.current?.(null)
    setIsResolving(true)
    try {
      // `refresh` drops the main-side cache AND recomputes every env context
      // that uses this secret (so the context preview + any expression composing
      // it clear during the re-resolution); then re-resolve this cell's preview.
      await window.restorm?.secrets.refresh({ source: secret.source, params: secret.params })
      const result = await window.restorm?.secrets.resolve({ source: secret.source, params: secret.params })
      if (result && typeof result.value === 'string') {
        setResolved(result.value)
        setHasError(false)
        onErrorChangeRef.current?.(null)
      } else {
        setResolved(null)
        setHasError(true)
        onErrorChangeRef.current?.(secretErrorText(result, t))
      }
    } finally {
      setIsResolving(false)
    }
  }, [secret.source, secret.params, t])

  // Resolve on mount + whenever the lookup descriptor changes. The cancelled
  // flag lives on a holder object (not a `let`) so the post-await `if` guard
  // isn't narrowed to `false` — the cleanup closure flips it after the await.
  useEffect(() => {
    const state = { cancelled: false }
    void (async () => {
      // Blank the previous result up front so a source/params change doesn't keep
      // the old preview + stale red error outline visible until the new resolve
      // lands (mirrors the refresh path).
      setResolved(null)
      setHasError(false)
      onErrorChangeRef.current?.(null)
      setIsResolving(true)
      const s = secretRef.current
      const result = await window.restorm?.secrets.resolve({ source: s.source, params: s.params })
      if (state.cancelled) return
      if (result && typeof result.value === 'string') {
        setResolved(result.value)
        setHasError(false)
        onErrorChangeRef.current?.(null)
      } else {
        setResolved(null)
        setHasError(true)
        onErrorChangeRef.current?.(secretErrorText(result, tRef.current))
      }
      setIsResolving(false)
    })()
    return () => { state.cancelled = true }
    // Keyed on the serialised descriptor only — see `secretRef` note above.
  }, [lookupKey])

  // Clear the field's error verdict when the secret cell goes away (recast to a
  // non-secret type), so a stale red outline doesn't linger on the new widget.
  useEffect(() => () => { onErrorChangeRef.current?.(null) }, [])

  // Collapsed preview: `$<name>=<resolved>`. The env-var name (the lookup key,
  // not a secret) is known immediately; the resolved value fills in once
  // resolution lands. Empty until then so the placeholder + spinner show.
  const name = typeof secret.params['name'] === 'string' ? secret.params['name'] : ''
  const value = resolved !== null ? `$${name}=${resolved}` : ''
  // Show a placeholder while the value is empty — either still resolving / not
  // yet configured, or a genuine resolution error.
  const showPlaceholder = hasError || value === ''

  return (
    <>
      <InputBox
        value={value}
        disabled
        options={{
          type: 'text',
          // Suppress the native `title` tooltip ECUI derives from the placeholder
          // — otherwise it stacks under the ECUI error tooltip (two overlapping
          // bubbles) and the styled hover label is the one we want.
          tooltip: '',
          ...(showPlaceholder && { placeholder: t('secrets.envVarUnresolved', '(non résolu)') })
        }}
        {...(dataTestId && { 'data-testid': `${dataTestId}-secret-preview` })}
      />
      <HeaderHoverTooltip label={isResolving ? t('secrets.resolving', 'Résolution…') : t('secrets.refresh', 'Rafraîchir le secret')}>
        {isResolving ? (
          <span
            className="tvf-secret-spinner"
            role="status"
            aria-label={t('secrets.resolving', 'Résolution…')}
            {...(dataTestId && { 'data-testid': `${dataTestId}-secret-refreshing` })}
          >
            <i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
          </span>
        ) : (
          <Button
            medium
            secondary
            icon="refresh"
            onClick={() => { void refresh() }}
            options={{ ariaLabel: t('secrets.refresh', 'Rafraîchir le secret') }}
            {...(dataTestId && { 'data-testid': `${dataTestId}-secret-refresh` })}
          />
        )}
      </HeaderHoverTooltip>
      <HeaderHoverTooltip label={t('secrets.editRetrieval', 'Éditer la récupération')}>
        <Button
          medium
          secondary
          icon="edit"
          onClick={() => { setIsModalOpen(true) }}
          options={{ ariaLabel: t('secrets.editRetrieval', 'Éditer la récupération') }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-secret-edit` })}
        />
      </HeaderHoverTooltip>
      <SecretRetrievalModal
        secret={secret}
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false) }}
        onChange={onChange}
        {...(dataTestId && { dataTestId })}
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
  // Precise secret-resolution error for the current value (null when healthy /
  // not a secret). Reported up by the SecretCell; drives the red control-group
  // outline + the exact-message tooltip on the cell.
  const [secretError, setSecretError] = useState<string | null>(null)
  // Whether the secret's retrieval modal is open — suppresses the error tooltip
  // while editing so it doesn't float over the modal with its hover state stuck.
  const [secretModalOpen, setSecretModalOpen] = useState(false)

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
    o: { icon: string | Icon; ariaLabel: string; typeTestid: string },
    // Present ONLY for a secret cell (whatever its health) — its `.message` is the
    // precise resolution error, or null when healthy. When present, the control
    // group is ALWAYS wrapped in the (possibly suppressed) error tooltip so the
    // tree shape never toggles between renders: a conditional wrap/unwrap would
    // remount the SecretCell on every error↔healthy flip and spin a resolve loop.
    // `modalOpen` suppresses the tooltip while the retrieval modal edits the
    // secret (the click that opened it left the hover state stuck).
    secretError?: { message: string | null; modalOpen: boolean }
  ): React.ReactNode => {
    const errorMessage = secretError?.message
    const inError = errorMessage !== null && errorMessage !== undefined && errorMessage !== ''
    const group = (
      <ControlGroup className={inError ? 'tvf-control-group tvf-control-group--secret-error' : 'tvf-control-group'}>
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
    // Non-secret types: no wrapper (their structure stays stable on its own).
    if (!secretError) return group
    // Secret types: always wrapped, tooltip suppressed while healthy.
    return (
      <HeaderHoverTooltip
        className="tvf-secret-error-tooltip"
        label={errorMessage ?? ''}
        suppressed={!inError || secretError.modalOpen}
        placement="above"
        {...(dataTestId && { 'data-testid': `${dataTestId}-secret-error-tooltip` })}
      >
        {group}
      </HeaderHoverTooltip>
    )
  }

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
    // `secret` becomes an "Autres ▸" submenu: one child per registered value
    // source (env-file secret, env var, …). Picking a child casts to a fresh
    // `SecretValue(source, {})`; its per-source config UI then collects the
    // params. The active source (if the value is already a secret) is checked.
    if (!isExcluded('secret')) {
      const activeSource = value instanceof SecretValue ? value.source : undefined
      // NB: no per-source `icon` on these menu items — the menu's icon slot is
      // the active-type checkmark, and a source glyph there would mask it. The
      // source icon lives only on the type-indicator button that opens the menu.
      const sourceItems: ContextMenuItem[] = valueSourceRegistry.list().map((descriptor) => ({
        id: `secret-source-${descriptor.id}`,
        label: t(descriptor.labelKey, descriptor.id),
        checked: activeType === 'secret' && activeSource === descriptor.id,
        onClick: () => { onChange(new SecretValue(descriptor.id, {})); closeMenu() },
        ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-item-secret-${descriptor.id}` })
      }))
      if (sourceItems.length > 0) {
        tail.push({
          id: 'secret',
          label: t('secrets.others', 'Others'),
          items: sourceItems,
          ...(dataTestId && { 'data-testid': `${dataTestId}-context-menu-secret` })
        })
      }
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
  }, [t, cast, dataTestId, groups, activeType, activeDefId, isExcluded, variableNames, allowAllVariables, allowEnvironment, allowNull, allowList, value, onChange, closeMenu, onRemove, removeLabel])

  // When the type-pick menu offers at most ONE selectable type, the choice is
  // forced: hide the type button (keep it for `lockType`, whose icon is purely
  // informational). Derived from the SAME live `menuItems`, so adding a scenario
  // variable (which can grow a variable-only field from 0→1→2 options)
  // re-evaluates the button's visibility automatically.
  const typeLeaves = useMemo(() => collectTypeLeaves(menuItems), [menuItems])
  const hideTypeButton = !lockType && typeLeaves.length <= 1
  // With exactly one option, force the value onto it (so the left widget already
  // shows the right type — e.g. a boolean-only slot renders its toggle).
  // Guarded by a ref so a menuItems rebuild TRIGGERED by this onClick (which can
  // re-run the effect before `checked` reflects) can't re-fire into a loop —
  // we only auto-force once per value identity.
  const forcedSingleForValueRef = useRef<unknown>(undefined)
  useEffect(() => {
    if (typeLeaves.length !== 1) {
      forcedSingleForValueRef.current = undefined
      return
    }
    if (forcedSingleForValueRef.current === value) return
    const only = typeLeaves[0]
    if (only && only.checked !== true && only.onClick) {
      forcedSingleForValueRef.current = value
      only.onClick()
    }
  }, [typeLeaves, value])

  const widget = ((): React.ReactNode => {
    if (value instanceof SecretValue) {
      // Every secret source renders the same default chrome: a read-only
      // resolved-value preview + refresh + an always-present pencil. The lock
      // icon is the type indicator; configuring the retrieval lives in the
      // pencil's modal (per-source surface), not inline.
      const secret = value
      return withTypeControl(
        <SecretCell
          secret={secret}
          onChange={(next) => { onChange(next) }}
          onErrorChange={setSecretError}
          onModalOpenChange={setSecretModalOpen}
          {...(dataTestId && { dataTestId })}
        />,
        // Each source paints its own glyph on the type button (a brand mark, a
        // codicon, …); fall back to the generic lock when it declares none.
        { icon: valueSourceRegistry.get(secret.source)?.icon ?? 'lock', ariaLabel: 'Secret value', typeTestid: 'secret' },
        { message: secretError, modalOpen: secretModalOpen }
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
    // A plain `StringValue` is LITERAL: it is never Handlebars-resolved at
    // execution time (only an `ExpressionValue` opts into resolution, via the
    // type-pick menu). So it gets a bare `InputBox` — dressing it with the
    // `{{}}`-highlighting editor would advertise a substitution that never
    // happens.
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
