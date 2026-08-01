import React, { type CSSProperties, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  RadioGroup,
  InputBox,
  CodeEditor,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { HTTPRequest, AuthenticationRequest, KeyValue } from '../../../../shared/types/collections'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'
import { resolveFilePickerPath } from '../../utils/filePicker'
import { detectBodyEditorLanguage } from '../../utils/bodyEditorLanguage'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

export type BodyMode = 'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'

const bodyContainerStyle: CSSProperties = { height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }
const flexFillStyle: CSSProperties = { flex: 1, minHeight: 0 }
const editorContainerStyle: CSSProperties = { height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }
const fileRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const fileLabelStyle: CSSProperties = { flexShrink: 0, fontSize: 12 }
const fileInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
const hiddenFilePickerStyle: CSSProperties = { display: 'none' }
const BODY_MODES: BodyMode[] = ['text', 'form-data', 'x-www-form-urlencoded', 'file']

export interface HTTPRequestBodySectionProps {
  bodyMode: BodyMode
  onBodyModeChange: (mode: BodyMode) => void
  body: string
  onBodyChange: (value: string) => void
  bodyFilePath: string
  onBodyFilePathChange: (value: string) => void
  request: HTTPRequest | AuthenticationRequest
  onBodyFieldsChange: (rows: KeyValue[]) => void
  variables: VariableDefinition[]
  helpers: TranslatedHelperDefinition[]
  /** Locks every control in the section (e.g. a mock server hosting this
   * body was snapshotted on start and is currently listening). */
  disabled?: boolean
}

interface BodyFieldsTableProps {
  variables: VariableDefinition[]
  helpers: TranslatedHelperDefinition[]
  initialRows: KeyValue[] | undefined
  onRowsChange: (rows: KeyValue[]) => void
  persistenceId: string
  disabled?: boolean
}

/** Small wrapper around RestormKeyValueTable that adds an "Add row"
 * button above the table — form-data and x-www-form-urlencoded modes
 * need an explicit affordance to create the first row since the table
 * itself doesn't expose one. */
const BodyFieldsTable: React.FC<BodyFieldsTableProps> = ({
  variables,
  helpers,
  initialRows,
  onRowsChange,
  persistenceId,
  disabled = false
}) => {
  const { t } = useTranslation()
  const tableRef = useRef<KeyValueTableHandle | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex' }}>
        {/* Icon-only: a small button clips a text label mid-word. The name
            lives on the tooltip (hover) and the aria-label (screen reader). */}
        <HeaderHoverTooltip label={t('requestTab.body.addField', 'Add field')}>
          <Button
            secondary
            small
            icon="add"
            disabled={disabled}
            options={{ ariaLabel: t('requestTab.body.addField', 'Add field') }}
            onClick={() => { tableRef.current?.addRow() }}
            data-testid="http-request-body-add-field-button"
          />
        </HeaderHoverTooltip>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <RestormKeyValueTable
          ref={tableRef}
          variables={variables}
          helpers={helpers}
          initialRows={initialRows ?? []}
          onRowsChange={onRowsChange}
          persistenceId={persistenceId}
          data-testid="http-request-body-fields-table"
          disabled={disabled}
        />
      </div>
    </div>
  )
}

export const HTTPRequestBodySection: React.FC<HTTPRequestBodySectionProps> = ({
  bodyMode,
  onBodyModeChange,
  body,
  onBodyChange,
  bodyFilePath,
  onBodyFilePathChange,
  request,
  onBodyFieldsChange,
  variables,
  helpers,
  disabled = false
}) => {
  const { t } = useTranslation()
  const filePickerRef = useRef<HTMLInputElement | null>(null)

  const handleSelect = useCallback((index: number) => {
    onBodyModeChange(BODY_MODES[index] ?? 'text')
  }, [onBodyModeChange])

  const handleFilePicked = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onBodyFilePathChange(resolveFilePickerPath(file))
  }, [onBodyFilePathChange])

  const bodyLanguage = useMemo(() => detectBodyEditorLanguage(body), [body])

  const radioItems = useMemo(() => ({
    items: BODY_MODES.map((mode) => ({ text: mode, isActive: bodyMode === mode, disabled }))
  }), [bodyMode, disabled])

  return (
    <div style={bodyContainerStyle}>
      <RadioGroup
        options={radioItems}
        data-testid="http-request-body-mode-radio"
        onSelect={handleSelect}
      />
      <div style={flexFillStyle}>
        {bodyMode === 'text' && (
          <div style={editorContainerStyle}>
            <CodeEditor
              height="100%"
              language={bodyLanguage}
              // The body is a Handlebars template as much as a payload: `{{id}}`,
              // `{{{raw}}}` and a one-line `{{#each}}` must not squiggle, while a
              // genuinely malformed payload still must.
              tolerateHandlebars
              value={body}
              onChange={(value) => { onBodyChange(value ?? '') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true, readOnly: disabled }}
              data-testid="http-request-body-editor"
            />
          </div>
        )}
        {(bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded') && (
          <BodyFieldsTable
            variables={variables}
            helpers={helpers}
            initialRows={request.body?.type === 'form-data' || request.body?.type === 'x-www-form-urlencoded' ? request.body.fields : []}
            onRowsChange={onBodyFieldsChange}
            persistenceId={`http-body-fields:${request.id}`}
            disabled={disabled}
          />
        )}
        {bodyMode === 'file' && (
          <div style={fileRowStyle}>
            <span style={fileLabelStyle}>{t('requestTab.body.fileLabel')}</span>
            <div style={fileInputWrapperStyle}>
              <InputBox options={{ placeholder: '', type: 'text' }} value={bodyFilePath} onChange={(value: string) => { onBodyFilePathChange(value) }} data-testid="http-request-body-file-input" disabled={disabled} />
            </div>
            <Button
              options={{ ariaLabel: t('requestTab.body.browse'), title: t('requestTab.body.browse') }}
              onClick={() => { filePickerRef.current?.click() }}
              disabled={disabled}
              data-testid="http-request-body-browse-button"
            >
              {t('requestTab.body.browse')}
            </Button>
            <input
              ref={filePickerRef}
              type="file"
              style={hiddenFilePickerStyle}
              onChange={handleFilePicked}
              data-testid="http-request-body-file-picker"
            />
          </div>
        )}
      </div>
    </div>
  )
}
