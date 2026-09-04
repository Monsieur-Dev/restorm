import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KeyValueTable,
  type CellRendererProps,
  type KeyValueTableHandle,
  type KeyValueTableRow,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import type { TemplateVariableDecl } from '../../../../shared/design/templateVariables'
import { RestormVariableInputBox } from '../RestormVariableInputBox'

/** The enclosing pane's header "Add" button appends a row through this handle
 * (it is the underlying {@link KeyValueTableHandle}). */
export type CodegenVariablesEditorHandle = KeyValueTableHandle

export interface CodegenVariablesEditorProps {
  /** Current values for this template + entity: variable name → Handlebars
   * expression. */
  values: Record<string, string>
  /** Variables this template DECLARES for this scope — pre-filled as rows (in
   * declaration order) even when unset, so the user sees the expected keys.
   * Keys stay FREE: extra rows can be added and declared ones removed. */
  decls: TemplateVariableDecl[]
  /** Persist the full set (blank-named + empty-valued rows are dropped — an
   * empty value inherits the next level, per the cascade). */
  onChange: (values: Record<string, string>) => void
  /** Contextual variables offered by the Handlebars value editor (the entity's
   * codegen context, dotted, + the env variables). Must be content-stable. */
  variables: VariableDefinition[]
  helpers?: TranslatedHelperDefinition[]
  testIdPrefix: string
}

/**
 * One template's code-generation variables for one entity (a design, a model, a
 * route): the standard ECUI {@link KeyValueTable} where the KEY is the variable
 * name and the VALUE is a Handlebars expression edited with
 * {@link RestormVariableInputBox} — so a value can read the entity's context
 * (`{{route.method}}`, `{{model.name}}`, `{{eq route.method 'GET'}}`, env
 * variables…). Remount (via a `key` on the entity) resets the rows.
 */
export const CodegenVariablesEditor = forwardRef<CodegenVariablesEditorHandle, CodegenVariablesEditorProps>(
  ({ values, decls, onChange, variables, helpers, testIdPrefix }, ref) => {
    const { t } = useTranslation()
    // Keep the autocomplete inputs behind refs so the (stable) value-cell
    // renderer reads the current set without being recreated — recreating it
    // would re-init every Monaco value editor and steal focus mid-typing.
    const variablesRef = useRef(variables)
    const helpersRef = useRef(helpers)
    useEffect(() => { variablesRef.current = variables }, [variables])
    useEffect(() => { helpersRef.current = helpers }, [helpers])

    // Seed the table once — it owns its row state afterwards; `onChange`
    // persists edits back to our `Record` model. Entity switches (and the
    // manifest decls arriving) remount via the caller's `key`. Declared
    // variables come first (in declaration order), then any extra stored keys.
    const [initialRows] = useState<KeyValueTableRow[]>(() => {
      const rows: KeyValueTableRow[] = []
      const seen = new Set<string>()
      for (const decl of decls) {
        rows.push({ key: decl.name, value: values[decl.name] ?? '' })
        seen.add(decl.name)
      }
      for (const [key, value] of Object.entries(values)) {
        if (!seen.has(key)) rows.push({ key, value })
      }
      return rows
    })

    const handleRowsChange = useCallback((rows: KeyValueTableRow[]): void => {
      const map: Record<string, string> = {}
      for (const row of rows) {
        const key = row.key.trim()
        // An empty value inherits the next cascade level, so it is not stored —
        // this also keeps untouched pre-filled declared rows out of the design.
        if (key !== '' && row.value !== '') map[key] = row.value
      }
      onChange(map)
    }, [onChange])

    const ValueCell = useMemo<React.FC<CellRendererProps>>(() => {
      const Cell: React.FC<CellRendererProps> = ({ value, onChange: cellChange, placeholder, 'data-testid': cellTestId, disabled }) => (
        <RestormVariableInputBox
          value={value}
          onChange={cellChange}
          variables={variablesRef.current}
          {...(helpersRef.current !== undefined ? { helpers: helpersRef.current } : {})}
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...(cellTestId !== undefined ? { 'data-testid': cellTestId } : {})}
          {...(disabled !== undefined ? { disabled } : {})}
        />
      )
      Cell.displayName = 'CodegenVarValueCell'
      return Cell
    }, [])

    return (
      <KeyValueTable
        ref={ref}
        initialRows={initialRows}
        onRowsChange={handleRowsChange}
        renderValueCell={ValueCell}
        keyHeader={t('design.codegen.vars.name', 'Variable')}
        valueHeader={t('design.codegen.vars.value', 'Value (Handlebars)')}
        showDescription={false}
        showEnabledToggle={false}
        data-testid={testIdPrefix}
      />
    )
  }
)
CodegenVariablesEditor.displayName = 'CodegenVariablesEditor'
