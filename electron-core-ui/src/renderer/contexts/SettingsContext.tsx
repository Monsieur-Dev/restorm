import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingValue, ResolvedSetting } from '../../types/settings'
import type { SettingRendererProps } from '../components/Settings/renderers/types'
import { SettingsContext } from './settingsContextDef'

interface SettingsProviderProps {
  children: React.ReactNode
  customRenderers?: Record<string, ComponentType<SettingRendererProps>> | undefined
}

export function SettingsProvider({ children, customRenderers }: SettingsProviderProps): React.ReactElement {
  const { i18n } = useTranslation()
  const [groups, setGroups] = useState<import('../../types/settings').SettingsGroup[]>([])
  const [settingsList, setSettingsList] = useState<ResolvedSetting[]>([])
  const [renderers, setRenderers] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filteredSettings, setFilteredSettings] = useState<ResolvedSetting[]>([])
  const prevLanguageRef = useRef(i18n.language)

  const settingsMap = useMemo(() => {
    const map = new Map<string, ResolvedSetting>()
    for (const s of settingsList) {
      map.set(s.storageKey, s)
    }
    return map
  }, [settingsList])

  // Load everything on mount
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true)
      const [fetchedGroups, fetchedSettings, fetchedRenderers] = await Promise.all([
        window.api.settings.getGroups(),
        window.api.settings.getAll(),
        window.api.settings.getRenderers()
      ])
      setGroups(fetchedGroups)
      setSettingsList(fetchedSettings)
      setRenderers(fetchedRenderers)
    } catch {
      // Settings API may not be available
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Listen for setting changes
  useEffect(() => {
    const cleanup = window.api.settings.onSettingChanged((storageKey: string, value: SettingValue) => {
      setSettingsList(prev =>
        prev.map(s =>
          s.storageKey === storageKey
            ? { ...s, currentValue: value, isModified: value !== s.default }
            : s
        )
      )
    })
    return cleanup
  }, [])

  // Reload all data when a new config is loaded (e.g., app-specific settings loaded after init)
  useEffect(() => {
    const cleanup = window.api.settings.onConfigLoaded(() => {
      void loadData()
    })
    return cleanup
  }, [loadData])

  // Re-index on language change
  useEffect(() => {
    if (prevLanguageRef.current !== i18n.language) {
      prevLanguageRef.current = i18n.language
      void window.api.settings.reindex().then(() => loadData())
    }
  }, [i18n.language, loadData])

  // Search filtering
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredSettings(settingsList)
      return
    }

    let cancelled = false
    void window.api.settings.search(searchQuery).then((results: ResolvedSetting[]) => {
      if (!cancelled) {
        setFilteredSettings(results)
      }
    })

    return () => { cancelled = true }
  }, [searchQuery, settingsList])

  const getSetting = useCallback(
    (storageKey: string) => settingsMap.get(storageKey),
    [settingsMap]
  )

  const setSetting = useCallback(async (storageKey: string, value: SettingValue): Promise<void> => {
    await window.api.settings.set(storageKey, value)
    // Optimistic update
    setSettingsList(prev =>
      prev.map(s =>
        s.storageKey === storageKey
          ? { ...s, currentValue: value, isModified: value !== s.default }
          : s
      )
    )
    // Apply side effects for special settings
    if (storageKey === 'appearance:language' && typeof value === 'string') {
      void i18n.changeLanguage(value)
      void window.api.i18n.setLanguage(value)
    }
    if (storageKey === 'appearance:theme' && typeof value === 'string') {
      void window.api.theme.set(value)
    }
  }, [i18n])

  const resetSetting = useCallback(async (storageKey: string): Promise<void> => {
    await window.api.settings.reset(storageKey)
    // Optimistic update
    setSettingsList(prev =>
      prev.map(s =>
        s.storageKey === storageKey
          ? { ...s, currentValue: s.default, isModified: false }
          : s
      )
    )
  }, [])

  const stableCustomRenderers = useMemo(() => customRenderers ?? {}, [customRenderers])

  const value = useMemo(() => ({
    groups,
    settings: settingsMap,
    renderers,
    customRenderers: stableCustomRenderers,
    isLoading,
    getSetting,
    setSetting,
    resetSetting,
    searchQuery,
    setSearchQuery,
    filteredSettings
  }), [groups, settingsMap, renderers, stableCustomRenderers, isLoading, getSetting, setSetting, resetSetting, searchQuery, filteredSettings])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
