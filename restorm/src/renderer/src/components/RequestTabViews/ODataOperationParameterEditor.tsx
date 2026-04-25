/**
 * ODataOperationParameterEditor — typed form for action / function
 * parameters when the importer has pre-filled the parameter schema.
 *
 * Each non-binding parameter becomes a labeled ECU InputBox (typed
 * numeric / boolean / string depending on the CSDL type). The user
 * presses an Apply button to regenerate the request payload or URL
 * from the filled values — raw-editor fallback stays available for
 * power users.
 */

import React, { useCallback, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  Toggle
} from 'electron-core-ui/renderer'
import type { ODataOperationParameterSpec } from '../../../../shared/types/collections'

const rowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const nameStyle: CSSProperties = { minWidth: 140, fontFamily: 'var(--font-family-mono)', fontSize: 12, color: 'var(--symbolIcon-propertyForeground)' }
const typeStyle: CSSProperties = { minWidth: 120, fontFamily: 'var(--font-family-mono)', fontSize: 11, color: 'var(--descriptionForeground)' }
const inputWrapperStyle: CSSProperties = { flex: 1, minWidth: 160 }
const labelStyle: CSSProperties = { fontSize: 12, color: 'var(--descriptionForeground)' }

export interface ODataOperationParameterEditorProps {
  value: readonly ODataOperationParameterSpec[]
  onChange: (next: ODataOperationParameterSpec[]) => void
  onApply?: () => void
  applyLabel?: string
  /** Test-id prefix for the surrounding group. */
  testIdPrefix?: string
}

function isNumericCsdl(type: string): boolean {
  return /^Edm\.(Int16|Int32|Int64|Byte|SByte|Decimal|Single|Double)$/.test(type)
}

function isBooleanCsdl(type: string): boolean {
  return type === 'Edm.Boolean'
}

export const ODataOperationParameterEditor: React.FC<ODataOperationParameterEditorProps> = ({
  value,
  onChange,
  onApply,
  applyLabel,
  testIdPrefix = 'odata-operation-param'
}) => {
  const { t } = useTranslation()

  const setValue = useCallback((index: number, next: string): void => {
    const out = value.slice()
    const current = out[index]
    if (!current) return
    out[index] = { ...current, value: next }
    onChange(out)
  }, [value, onChange])

  const visibleParams = value.map((p, i) => ({ param: p, index: i })).filter(({ param }) => !param.isBinding)

  if (visibleParams.length === 0) {
    return (
      <span style={{ ...labelStyle, fontStyle: 'italic' }}>
        {t('odataRequestTab.paramsNone', 'No parameters expected.')}
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid={`${testIdPrefix}-editor`}>
      {visibleParams.map(({ param, index }) => (
        <div key={`${param.name}-${index}`} style={rowStyle} data-testid={`${testIdPrefix}-row-${index}`}>
          <span style={nameStyle}>{param.name}</span>
          <span style={typeStyle}>{param.type}{param.nullable ? '?' : ''}</span>
          {isBooleanCsdl(param.type) ? (
            <Toggle
              isChecked={param.value === 'true'}
              onChange={(checked: boolean) => { setValue(index, checked ? 'true' : 'false') }}
              data-testid={`${testIdPrefix}-${param.name}`}
            />
          ) : (
            <div style={inputWrapperStyle}>
              <InputBox
                value={param.value ?? ''}
                onChange={(v: string) => { setValue(index, v) }}
                options={{
                  ...(isNumericCsdl(param.type) ? { type: 'number', step: 1 } : {}),
                  placeholder: t('odataRequestTab.paramValuePlaceholder', '{{param}} value', { param: param.name })
                }}
                data-testid={`${testIdPrefix}-${param.name}`}
              />
            </div>
          )}
        </div>
      ))}
      {onApply ? (
        <div>
          <Button
            icon="check"
            onClick={onApply}
            options={{
              ariaLabel: applyLabel ?? t('odataRequestTab.paramsApply', 'Apply parameters'),
              title: applyLabel ?? t('odataRequestTab.paramsApply', 'Apply parameters')
            }}
            data-testid={`${testIdPrefix}-apply`}
          >
            {applyLabel ?? t('odataRequestTab.paramsApply', 'Apply parameters')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
