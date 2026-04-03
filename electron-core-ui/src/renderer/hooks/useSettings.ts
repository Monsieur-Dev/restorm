import { useContext, useCallback, useMemo } from 'react'
import { SettingsContext } from '../contexts/settingsContextDef'
import type { SettingsContextValue } from '../contexts/settingsContextDef'
import type { SettingValue } from '../../types/settings'

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}

export function useSetting(storageKey: string): [SettingValue, (v: SettingValue) => Promise<void>, boolean] {
  const { getSetting, setSetting } = useSettings()
  const setting = getSetting(storageKey)

  const value: SettingValue = setting?.currentValue ?? ''
  const isModified = setting?.isModified ?? false

  const setValue = useCallback(
    (v: SettingValue) => setSetting(storageKey, v),
    [storageKey, setSetting]
  )

  return useMemo(() => [value, setValue, isModified], [value, setValue, isModified])
}
