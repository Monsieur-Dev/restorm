import React, { type CSSProperties, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  RadioGroup,
  InputBox,
  CodeEditor,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormKeyValueTable } from '../RestormKeyValueTable'
import type { HTTPRequest, KeyValue } from '../../../../shared/types/collections'
import type { TranslatedHelperDefinition } from '../../utils/handlebarsHelpersDefinitions'

export type BodyMode = 'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'

const bodyContainerStyle: CSSProperties = { height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }
const flexFillStyle: CSSProperties = { flex: 1, minHeight: 0 }
const editorContainerStyle: CSSProperties = { height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }
const fileRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const fileLabelStyle: CSSProperties = { flexShrink: 0, fontSize: 12 }
const fileInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
const BODY_MODES: BodyMode[] = ['text', 'form-data', 'x-www-form-urlencoded', 'file']

export interface HTTPRequestBodySectionProps {
  bodyMode: BodyMode
  onBodyModeChange: (mode: BodyMode) => void
  body: string
  onBodyChange: (value: string) => void
  bodyFilePath: string
  onBodyFilePathChange: (value: string) => void
  request: HTTPRequest
  onBodyFieldsChange: (rows: KeyValue[]) => void
  variables: VariableDefinition[]
  helpers: TranslatedHelperDefinition[]
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

  const handleSelect = useCallback((index: number) => {
    onBodyModeChange(BODY_MODES[index] ?? 'text')
  }, [onBodyModeChange])

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
          <RestormKeyValueTable
            variables={variables}
            helpers={helpers}
            initialRows={request.body?.type === 'form-data' || request.body?.type === 'x-www-form-urlencoded' ? request.body.fields : []}
            onRowsChange={onBodyFieldsChange}
            data-testid="http-request-body-fields-table"
          />
        )}
        {bodyMode === 'file' && (
          <div style={fileRowStyle}>
            <span style={fileLabelStyle}>{t('requestTab.body.fileLabel')}</span>
            <div style={fileInputWrapperStyle}>
              <InputBox options={{ placeholder: '', type: 'text' }} value={bodyFilePath} onChange={(value: string) => { onBodyFilePathChange(value) }} data-testid="http-request-body-file-input" />
            </div>
            <Button options={{ ariaLabel: t('requestTab.body.browse'), title: t('requestTab.body.browse') }} data-testid="http-request-body-browse-button">
              {t('requestTab.body.browse')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
