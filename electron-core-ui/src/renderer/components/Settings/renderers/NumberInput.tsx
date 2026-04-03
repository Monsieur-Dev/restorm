import React, { useCallback, useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox } from '../../InputBox'
import type { SettingRendererProps } from './types'
import type { NumberParams } from '../../../../types/settings'

export const NumberInput: React.FC<SettingRendererProps> = ({ setting, value, onChange }) => {
  const { t } = useTranslation()
  const params = setting.params as NumberParams | undefined
  const [localValue, setLocalValue] = useState(String(value))

  // Sync local value when prop changes (e.g. after reset)
  useEffect(() => {
    setLocalValue(String(value))
  }, [value])

  // Check if current local value is out of bounds
  const outOfRange = useMemo(() => {
    const parsed = parseFloat(localValue)
    if (isNaN(parsed)) return false
    if (params?.min !== undefined && parsed < params.min) return true
    if (params?.max !== undefined && parsed > params.max) return true
    return false
  }, [localValue, params])

  const handleChange = useCallback((raw: string) => {
    // Always update the display so the user can type freely
    setLocalValue(raw)

    // Only persist valid numbers within bounds
    if (raw === '' || raw === '-') return
    const parsed = params?.integer ? parseInt(raw, 10) : parseFloat(raw)
    if (isNaN(parsed)) return
    if (params?.min !== undefined && parsed < params.min) return
    if (params?.max !== undefined && parsed > params.max) return

    onChange(parsed)
  }, [onChange, params])

  const placeholder = params?.min !== undefined && params.max !== undefined
    ? `${String(params.min)} - ${String(params.max)}`
    : ''

  return (
    <div className="settings-number-input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <InputBox
        options={{
          type: 'number',
          ...(placeholder ? { placeholder } : {}),
          ...(params?.min !== undefined ? { min: params.min } : {}),
          ...(params?.max !== undefined ? { max: params.max } : {}),
          step: 1
        }}
        value={localValue}
        onChange={handleChange}
        {...(outOfRange ? { style: { borderColor: 'var(--inputValidation-errorBorder, #be1100)' } } : {})}
      />
      {outOfRange && params?.min !== undefined && params.max !== undefined && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--inputValidation-errorForeground, #f48771)',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          {t('settings.numberOutOfRange', { min: params.min, max: params.max })}
        </span>
      )}
    </div>
  )
}
