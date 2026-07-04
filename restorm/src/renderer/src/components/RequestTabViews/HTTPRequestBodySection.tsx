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
}

interface BodyFieldsTableProps {
  variables: VariableDefinition[]
  helpers: TranslatedHelperDefinition[]
  initialRows: KeyValue[] | undefined
  onRowsChange: (rows: KeyValue[]) => void
  persistenceId: string
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
  persistenceId
}) => {
  const { t } = useTranslation()
  const tableRef = useRef<KeyValueTableHandle | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex' }}>
        <Button
          small
          icon="add"
          options={{
            ariaLabel: t('requestTab.body.addField', 'Add field'),
            title: t('requestTab.body.addField', 'Add field')
          }}
          onClick={() => { tableRef.current?.addRow() }}
          data-testid="http-request-body-add-field-button"
        >
          {t('requestTab.body.addField', 'Add field')}
        </Button>
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
  helpers
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

  const radioItems = useMemo(() => ({
    items: BODY_MODES.map((mode) => ({ text: mode, isActive: bodyMode === mode }))
  }), [bodyMode])

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
              language="json"
              value={body}
              onChange={(value) => { onBodyChange(value ?? '') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true }}
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
          />
        )}
        {bodyMode === 'file' && (
          <div style={fileRowStyle}>
            <span style={fileLabelStyle}>{t('requestTab.body.fileLabel')}</span>
            <div style={fileInputWrapperStyle}>
              <InputBox options={{ placeholder: '', type: 'text' }} value={bodyFilePath} onChange={(value: string) => { onBodyFilePathChange(value) }} data-testid="http-request-body-file-input" />
            </div>
            <Button
              options={{ ariaLabel: t('requestTab.body.browse'), title: t('requestTab.body.browse') }}
              onClick={() => { filePickerRef.current?.click() }}
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
