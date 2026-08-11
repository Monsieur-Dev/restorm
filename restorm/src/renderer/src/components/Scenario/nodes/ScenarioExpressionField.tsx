import React from 'react'
import { useTranslation } from 'react-i18next'
import type { VariableDefinition } from 'electron-core-ui/renderer'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { type EnvValueTypeGroup } from '../../../hooks/useAllEnvValueTypeGroups'
import { useHandlebarsHelpers } from '../../../hooks/useHandlebarsHelpers'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { ExpressionValue } from '../../../../../shared/types/collections'
import { ScenarioCodeEditButton } from './ScenarioCodeField'

/** Per-item / per-input Handlebars expression editor used by every list-op /
 * template box (`transform`, `map`, …). Centralises the wiring around
 * `TypedValueField`-locked-to-expression:
 * - the `.scn-template-field` wrapper so the Monaco editor gets a sensible
 *   minimum width (otherwise the field is unusably narrow inside React Flow
 *   nodes that fit-content their column),
 * - the Handlebars helpers suite, fetched once via `useHandlebarsHelpers`,
 *   so Ctrl+Space surfaces `formatDate`, `now`, `add`, … in the same row,
 * - the autocomplete variables the caller derives from context (the source
 *   keys for `transform`, the per-item keys for `map`, …). */
const EXPRESSION_ONLY_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'variable'
]

export interface ScenarioExpressionFieldProps {
  /** Persisted `ExpressionValue` (or any value normalised by
   * `normalizeValueType`) — defaults to an empty expression. */
  value: unknown
  onChange: (next: ReturnType<typeof serializeValueForPersistence>) => void
  /** Env-defined value type groups (forwarded to TypedValueField). */
  valueTypeGroups: EnvValueTypeGroup[]
  /** Autocomplete variables proposed in the Handlebars editor — usually the
   * keys of the available context object (input source, per-item, …). */
  variables: VariableDefinition[]
  /** Stable identifier the backend uses to scope variable resolution. */
  expressionVariableId: string
  /** Outline the field red on a validation error. */
  invalid?: boolean
  /** Optional caption rendered ABOVE the field (label-over-field layout). */
  caption?: string
  /** `data-testid` forwarded to TypedValueField. */
  dataTestId: string
}

export const ScenarioExpressionField: React.FC<ScenarioExpressionFieldProps> = ({
  value,
  onChange,
  valueTypeGroups,
  variables,
  expressionVariableId,
  invalid,
  caption,
  dataTestId
}) => {
  const { t } = useTranslation()
  const helpers = useHandlebarsHelpers()
  // The raw template string, so the full-screen editor edits the same text the
  // inline Monaco field shows. Only an `expression`-typed value exposes a
  // template body; any other type hides the expand button (nothing to grow).
  const raw = value as { type?: unknown; value?: unknown } | undefined
  const isExpression = raw === undefined || raw.type === 'expression' || raw.type === undefined
  const templateText = typeof raw?.value === 'string' ? raw.value : ''
  // The full-screen "expand" button sits INSIDE the field's control group, flush
  // beside the type-pick icon (same pattern as the colour / date pickers).
  const expand = isExpression
    ? (
        <ScenarioCodeEditButton
          value={templateText}
          onChange={(next) => { onChange(serializeValueForPersistence(new ExpressionValue(next))) }}
          language="handlebars"
          title={t('scenario.codeField.editTemplate', 'Edit template')}
          dataTestId={`${dataTestId}-expand`}
        />
      )
    : undefined
  return (
    <div className={`nodrag scn-stacked-field scn-template-field${invalid ? ' scn-field-invalid' : ''}`} onMouseDown={(e) => { e.stopPropagation() }}>
      {caption !== undefined && <div className="scn-field-caption">{caption}</div>}
      <TypedValueField
        value={value !== undefined ? normalizeValueType(value) : new ExpressionValue('')}
        onChange={(next) => { onChange(serializeValueForPersistence(next)) }}
        valueTypeGroups={valueTypeGroups}
        excludeTypes={EXPRESSION_ONLY_EXCLUDE}
        variables={variables}
        helpers={helpers}
        expressionVariableId={expressionVariableId}
        dataTestId={dataTestId}
        {...(expand && { trailingControls: expand })}
      />
    </div>
  )
}
