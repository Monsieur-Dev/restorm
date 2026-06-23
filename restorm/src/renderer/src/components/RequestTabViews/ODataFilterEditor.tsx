/**
 * ODataFilterEditor — a single-line Monaco input for the OData
 * `$filter` query option with metadata-driven autocomplete, hover type
 * hints, and light validation.
 *
 * Wraps the ECUI `VariableInputBox` (which already handles the
 * single-line Monaco styling, context menu, and paste-collapse) in
 * `odata-filter` language mode with the default Handlebars providers
 * disabled, then attaches the OData completion / hover / marker
 * providers on mount. `{{env.var}}` templating keeps working: the
 * grammar treats `{{…}}` spans as opaque literals (no validation, no
 * double-completion) and runtime resolution is unchanged because it
 * happens in the serializer, not the editor.
 *
 * Suggestions are driven by the request's bound entity type
 * (`entityTypeRef`) resolved against the owning folder's
 * `apiDocumentation`. A hand-authored request with no metadata simply
 * offers no suggestions (no errors).
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type * as monacoEditor from 'monaco-editor'
import { VariableInputBox } from 'electron-core-ui/renderer'
import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
import {
  ODATA_FILTER_LANGUAGE_ID,
  registerODataFilterLanguage,
  setODataFilterModelData,
  validateODataFilterModel,
  type ODataFilterLabels
} from '../../services/monaco/odataFilterLanguage'

export interface ODataFilterEditorProps {
  value: string
  onChange: (next: string) => void
  apiDocumentation: ApiDocumentation | undefined
  entityTypeRef: string | undefined
  placeholder?: string
  'data-testid'?: string
}

export const ODataFilterEditor: React.FC<ODataFilterEditorProps> = ({
  value,
  onChange,
  apiDocumentation,
  entityTypeRef,
  placeholder,
  'data-testid': dataTestId
}) => {
  const { t } = useTranslation()
  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monacoEditor | null>(null)

  const labels: ODataFilterLabels = useMemo(
    () => ({
      property: t('odataFilter.detail.property', 'property'),
      navigation: t('odataFilter.detail.navigation', 'navigation'),
      operator: t('odataFilter.detail.operator', 'operator'),
      logical: t('odataFilter.detail.logical', 'logical operator'),
      function: t('odataFilter.detail.function', 'function'),
      enumValue: t('odataFilter.detail.enumValue', 'enum value'),
      unknownProperty: t('odataFilter.validation.unknownProperty', 'Unknown property'),
      wrongTypeOperator: t(
        'odataFilter.validation.wrongTypeOperator',
        'Operator not applicable to this property type'
      )
    }),
    [t]
  )

  // The providers read metadata from the per-model map live, so the
  // mount handler must always apply the latest values. A ref holds the
  // current metadata so the (stable) mount callback never goes stale.
  // It is written from the effect below (never during render).
  const dataRef = useRef<{
    apiDocumentation: typeof apiDocumentation
    entityTypeRef: typeof entityTypeRef
    labels: ODataFilterLabels
  }>({ apiDocumentation, entityTypeRef, labels })

  // Keep the per-model metadata + markers in sync whenever the bound
  // entity type or imported documentation changes (incl. a re-import
  // replacing apiDocumentation — picked up with no app reload).
  const syncModel = useCallback(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    const model = editor.getModel()
    if (!model) return
    setODataFilterModelData(model, dataRef.current)
    validateODataFilterModel(monaco, model)
  }, [])

  useEffect(() => {
    dataRef.current = { apiDocumentation, entityTypeRef, labels }
    syncModel()
    // `labels` is rebuilt each render but its values only change with
    // locale; the validation-message strings cover that change.
  }, [apiDocumentation, entityTypeRef, labels, syncModel])

  const handleMount = useCallback(
    (editor: monacoEditor.editor.IStandaloneCodeEditor, monaco: typeof monacoEditor) => {
      editorRef.current = editor
      monacoRef.current = monaco
      registerODataFilterLanguage(monaco)
      // A `$filter` is free-form text: never auto-accept a suggestion
      // on a commit character (space / quote) or Enter — that would
      // silently rewrite what the user typed (e.g. `Name eq 'Rex'`
      // becoming a half-accepted suggestion). Suggestions are accepted
      // only by an explicit Tab / click.
      editor.updateOptions({
        acceptSuggestionOnCommitCharacter: false,
        acceptSuggestionOnEnter: 'off',
        // Don't auto-close quotes / parens — in a filter expression the
        // user types the closing quote themselves, and an auto-inserted
        // `'` would land a stray quote mid-expression.
        autoClosingQuotes: 'never',
        autoClosingBrackets: 'never'
      })
      const model = editor.getModel()
      if (model) {
        setODataFilterModelData(model, dataRef.current)
        validateODataFilterModel(monaco, model)
        model.onDidChangeContent(() => {
          validateODataFilterModel(monaco, model)
        })
      }
    },
    []
  )

  return (
    <VariableInputBox
      value={value}
      onChange={onChange}
      variables={[]}
      languageId={ODATA_FILTER_LANGUAGE_ID}
      disableDefaultProviders
      onMount={handleMount}
      changeDebounceMs={0}
      {...(placeholder !== undefined && { placeholder })}
      {...(dataTestId !== undefined && { 'data-testid': dataTestId })}
    />
  )
}
