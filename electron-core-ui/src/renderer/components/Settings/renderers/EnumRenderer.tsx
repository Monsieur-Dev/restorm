import React, { useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectBox } from '../../SelectBox'
import type { ISelectData } from '../../SelectBox/types'
import type { SettingRendererProps } from './types'
import type { EnumParams } from '../../../../types/settings'
import { formatLanguageOptionLabel } from '../languages'

export const EnumRenderer: React.FC<SettingRendererProps> = ({ setting, value, onChange }) => {
  const { t } = useTranslation()
  const params = setting.params as EnumParams | undefined

  const enumValues = useMemo(() => params?.values ?? [], [params?.values])

  const options = useMemo(() =>
    enumValues.map(ev => ({
      text: formatLanguageOptionLabel(t(ev.labelKey, ev.value), ev.flag)
    })),
    [enumValues, t]
  )

  const selectedIndex = useMemo(() => {
    const idx = enumValues.findIndex(ev => ev.value === String(value))
    return idx >= 0 ? idx : 0
  }, [enumValues, value])

  const handleSelect = useCallback((data: ISelectData) => {
    const selected = enumValues[data.index]
    if (selected) {
      onChange(selected.value)
    }
  }, [enumValues, onChange])

  return (
    <SelectBox
      id={`setting-enum-${setting.id}`}
      className="settings-select"
      options={options}
      selected={selectedIndex}
      onDidSelect={handleSelect}
    />
  )
}
