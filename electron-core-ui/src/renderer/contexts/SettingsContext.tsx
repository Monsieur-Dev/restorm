import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingValue, ResolvedSetting } from '../../types/settings'
import { SettingsContext } from './settingsContextDef'

interface SettingsProviderProps {
  children: React.ReactNode
}

export function SettingsProvider({ children }: SettingsProviderProps): React.ReactElement {
  const { i18n } = useTranslation()
  const [groups, setGroups] = useState<import('../../types/settings').SettingsGroup[]>([])
  const [settingsList, setSettingsList] = useState<ResolvedSetting[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filteredSettings, setFilteredSettings] = useState<ResolvedSetting[]>([])
  const [workspacePath, setWorkspacePathState] = useState<string | null>(null)
  const [workspaceValues, setWorkspaceValues] = useState<Record<string, SettingValue>>({})
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
      const [fetchedGroups, fetchedSettings, wsPath, wsValues] = await Promise.all([
        window.api.settings.getGroups(),
        window.api.settings.getAll(),
        window.api.settings.getWorkspacePath(),
        window.api.settings.getWorkspaceValues()
      ])
      setGroups(fetchedGroups)
      setSettingsList(fetchedSettings)
      setWorkspacePathState(wsPath)
      setWorkspaceValues(wsValues)
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

  // ── Workspace overlay sync ──────────────────────────────────────
  // The provider mirrors the main-process workspace path + values
  // so the UI can pick which layer to read/write per active tab.
  // `settings:workspace-changed` fires on path swaps; the existing
  // `settings:changed` already covers value updates.
  useEffect(() => {
    const cleanup = window.api.settings.onWorkspaceChanged((path: string | null) => {
      setWorkspacePathState(path)
      void window.api.settings.getWorkspaceValues().then((values: Record<string, SettingValue>) => {
        setWorkspaceValues(values)
      })
    })
    return cleanup
  }, [])

  const setWorkspaceSetting = useCallback(async (storageKey: string, value: SettingValue): Promise<void> => {
    await window.api.settings.setWorkspaceValue(storageKey, value)
    setWorkspaceValues(prev => ({ ...prev, [storageKey]: value }))
  }, [])

  const resetWorkspaceSetting = useCallback(async (storageKey: string): Promise<void> => {
    await window.api.settings.resetWorkspaceValue(storageKey)
    setWorkspaceValues(prev => {
      // Object spread + filter avoids the `no-dynamic-delete` rule —
      // `Object.fromEntries` on the kept entries is the project's
      // preferred shape for omitting one key from a record.
      return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== storageKey))
    })
  }, [])

  const value = useMemo(() => ({
    groups,
    settings: settingsMap,
    isLoading,
    getSetting,
    setSetting,
    resetSetting,
    searchQuery,
    setSearchQuery,
    filteredSettings,
    workspacePath,
    workspaceValues,
    setWorkspaceSetting,
    resetWorkspaceSetting
  }), [groups, settingsMap, isLoading, getSetting, setSetting, resetSetting, searchQuery, filteredSettings, workspacePath, workspaceValues, setWorkspaceSetting, resetWorkspaceSetting])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
