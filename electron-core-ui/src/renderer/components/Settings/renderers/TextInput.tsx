import React, { useCallback } from 'react'
import { InputBox } from '../../InputBox'
import type { SettingRendererProps } from './types'
import type { TextParams } from '../../../../types/settings'

export const TextInput: React.FC<SettingRendererProps> = ({ setting, value, onChange }) => {
  const params = setting.params as TextParams | undefined

  const handleChange = useCallback((raw: string) => {
    if (params?.maxLength !== undefined && raw.length > params.maxLength) return
    onChange(raw)
  }, [onChange, params])

  return (
    <InputBox
      options={{
        ...(setting.descriptionKey ? { placeholder: setting.descriptionKey } : {})
      }}
      value={String(value)}
      onChange={handleChange}
      className="settings-text-input"
    />
  )
}
