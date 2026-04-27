import React from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle } from '../../Toggle'
import type { SettingRendererProps } from './types'

export const ToggleRenderer: React.FC<SettingRendererProps> = ({ setting, value, onChange }) => {
  const { t } = useTranslation()

  return (
    <Toggle
      checked={Boolean(value)}
      onChange={(checked) => { onChange(checked) }}
    >
      {setting.descriptionKey ? t(setting.descriptionKey) : undefined}
    </Toggle>
  )
}
