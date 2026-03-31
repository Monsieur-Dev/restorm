import React, { useCallback } from 'react'
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
    const modes: BodyMode[] = ['text', 'form-data', 'x-www-form-urlencoded', 'file']
    onBodyModeChange(modes[index] ?? 'text')
  }, [onBodyModeChange])

  return (
    <div style={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <RadioGroup
        options={{
          items: [
            { text: 'text', isActive: bodyMode === 'text' },
            { text: 'form-data', isActive: bodyMode === 'form-data' },
            { text: 'x-www-form-urlencoded', isActive: bodyMode === 'x-www-form-urlencoded' },
            { text: 'file', isActive: bodyMode === 'file' }
          ]
        }}
        data-testid="http-request-body-mode-radio"
        onSelect={handleSelect}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        {bodyMode === 'text' && (
          <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flexShrink: 0, fontSize: 12 }}>{t('requestTab.body.fileLabel')}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
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
