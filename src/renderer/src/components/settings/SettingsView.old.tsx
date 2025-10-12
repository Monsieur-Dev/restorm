import React, { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsSchema, FlattenedSetting } from '../../types/settings.types'
import { ResizablePanel } from './ResizablePanel'
import { SettingsSearchBar } from './SettingsSearchBar'
import { SettingsTreeView } from './SettingsTreeView'
import { SettingsContent } from './SettingsContent'
import './Settings.css'

interface SettingsViewProps {
  onClose: () => void
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onClose }) => {
  const { t, i18n } = useTranslation()
  const [schema, setSchema] = useState<SettingsSchema | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [searchResults, setSearchResults] = useState<FlattenedSetting[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load schema and settings on mount
  useEffect(() => {
    const loadData = async (): Promise<void> => {
      try {
        const [loadedSchema, loadedValues] = await Promise.all([
          window.settingsAPI.getSchema(),
          window.settingsAPI.getAllSettings()
        ])

        setSchema(loadedSchema)
        setValues(loadedValues)

        // Select first category by default
        const firstCategory = Object.values(loadedSchema.categories)[0]
        if (firstCategory) {
          setSelectedCategory(firstCategory.key)
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData().catch(console.error)
  }, [])

  // Handle search
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query)

    if (!query || query.trim() === '') {
      setSearchResults(null)
      return
    }

    try {
      const results = await window.settingsAPI.searchSettings(query)
      setSearchResults(results)
    } catch (error) {
      console.error('Failed to search settings:', error)
    }
  }, [])

  // Handle setting change
  const handleSettingChange = useCallback(
    async (key: string, value: unknown) => {
      try {
        const success = await window.settingsAPI.setSetting(key, value)
        if (success) {
          setValues((prev) => ({ ...prev, [key]: value }))

          // Special handling for language setting
          if (key === 'workbench.appearance.language') {
            await i18n.changeLanguage(value as string)
          }
        }
      } catch (error) {
        console.error('Failed to save setting:', error)
      }
    },
    [i18n]
  )

  // Handle setting reset
  const handleResetSetting = useCallback(async (key: string) => {
    try {
      const success = await window.settingsAPI.resetSetting(key)
      if (success) {
        // Reload the value to get the default
        const newValue = await window.settingsAPI.getSetting(key)
        setValues((prev) => ({ ...prev, [key]: newValue }))

        // Special handling for language setting
        if (key === 'workbench.appearance.language') {
          await i18n.changeLanguage(newValue as string)
        }
      }
    } catch (error) {
      console.error('Failed to reset setting:', error)
    }
  }, [i18n])

  if (isLoading) {
    return (
      <div className="settings-view">
        <div className="settings-view__loading">{t('settings.loading')}</div>
      </div>
    )
  }

  if (!schema) {
    return (
      <div className="settings-view">
        <div className="settings-view__error">{t('settings.loadError')}</div>
      </div>
    )
  }

  const leftPanel = (
    <div className="settings-sidebar">
      <div className="settings-sidebar__header">
        <h2 className="settings-sidebar__title">{t('settings.title')}</h2>
        <button className="settings-sidebar__close" onClick={onClose}>
          ×
        </button>
      </div>
      <SettingsSearchBar
        onSearch={(query: string) => {
          handleSearch(query).catch(console.error)
        }}
      />
      <SettingsTreeView
        schema={schema}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        searchQuery={searchQuery}
      />
    </div>
  )

  const rightPanel = (
    <SettingsContent
      schema={schema}
      selectedCategory={selectedCategory}
      searchResults={searchResults}
      values={values}
      onSettingChange={(key: string, value: unknown) => {
        handleSettingChange(key, value).catch(console.error)
      }}
      onResetSetting={(key: string) => {
        handleResetSetting(key).catch(console.error)
      }}
    />
  )

  return (
    <div className="settings-view">
      <ResizablePanel leftPanel={leftPanel} rightPanel={rightPanel} />
    </div>
  )
}

