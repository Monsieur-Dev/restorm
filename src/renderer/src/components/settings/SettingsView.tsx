import React, { useState, useEffect, useCallback, useRef } from 'react'
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
  const [schema, setSchema] = useState<SettingsSchema | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const contentRef = useRef<HTMLDivElement>(null)
  const isScrollingProgrammatically = useRef(false)

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

        // Set first category as active by default
        const firstCategory = Object.values(loadedSchema.categories)[0]
        if (firstCategory) {
          setActiveCategory(firstCategory.key)
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData().catch(console.error)
  }, [])

  // Intersection Observer to detect which section is visible
  useEffect(() => {
    if (!schema || searchQuery || isScrollingProgrammatically.current) return

    const mainContent = document.querySelector('.settings-content__main')
    if (!mainContent) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingProgrammatically.current) return

        // Find the most visible section
        let maxRatio = 0
        let mostVisibleCategory: string | null = null

        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio
            const categoryId = entry.target.getAttribute('data-category')
            if (categoryId) {
              mostVisibleCategory = categoryId.split('-')[0] // Get root category
            }
          }
        })

        if (mostVisibleCategory && mostVisibleCategory !== activeCategory) {
          setActiveCategory(mostVisibleCategory)
        }
      },
      {
        root: mainContent,
        threshold: [0, 0.25, 0.5, 0.75, 1],
        rootMargin: '-20% 0px -70% 0px'
      }
    )

    // Observe all category sections
    const sections = mainContent.querySelectorAll('[data-category]')
    sections.forEach((section) => observer.observe(section))

    return () => {
      sections.forEach((section) => observer.unobserve(section))
    }
  }, [schema, searchQuery, activeCategory])

  // Handle search
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query)
  }, [])

  // Handle category click - scroll to section
  const handleCategoryClick = useCallback((categoryKey: string) => {
    const mainContent = document.querySelector('.settings-content__main')
    const section = document.getElementById(categoryKey)

    if (mainContent && section) {
      isScrollingProgrammatically.current = true
      setActiveCategory(categoryKey)

      section.scrollIntoView({ behavior: 'smooth', block: 'start' })

      // Reset flag after animation
      setTimeout(() => {
        isScrollingProgrammatically.current = false
      }, 1000)
    }
  }, [])

  // Handle setting change
  const handleSettingChange = useCallback(
    async (key: string, value: unknown) => {
      try {
        const success = await window.settingsAPI.setSetting(key, value)
        if (success) {
          setValues((prev) => ({ ...prev, [key]: value }))
          // Language change is now handled by the main process via LangSetting
        }
      } catch (error) {
        console.error('Failed to save setting:', error)
      }
    },
    []
  )

  // Handle setting reset
  const handleResetSetting = useCallback(
    async (key: string) => {
      try {
        const success = await window.settingsAPI.resetSetting(key)
        if (success) {
          // Reload the value to get the default
          const newValue = await window.settingsAPI.getSetting(key)
          setValues((prev) => ({ ...prev, [key]: newValue }))
          // Language change is now handled by the main process via LangSetting
        }
      } catch (error) {
        console.error('Failed to reset setting:', error)
      }
    },
    []
  )

  if (isLoading) {
    return (
      <div className="settings-view">
        <div className="settings-view__loading">Loading...</div>
      </div>
    )
  }

  if (!schema) {
    return (
      <div className="settings-view">
        <div className="settings-view__error">Failed to load settings</div>
      </div>
    )
  }

  const leftPanel = (
    <div className="settings-sidebar">
      <SettingsTreeView
        schema={schema}
        selectedCategory={activeCategory}
        onSelectCategory={handleCategoryClick}
        searchQuery={searchQuery}
      />
    </div>
  )

  const rightPanel = (
    <SettingsContent
      schema={schema}
      searchQuery={searchQuery}
      values={values}
      onSettingChange={(key: string, value: unknown) => {
        handleSettingChange(key, value).catch(console.error)
      }}
      onResetSetting={(key: string) => {
        handleResetSetting(key).catch(console.error)
      }}
      onClose={onClose}
    />
  )

  return (
    <div className="settings-view">
      <div className="settings-view__header">
        <SettingsSearchBar onSearch={handleSearch} />
        <button className="settings-view__close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="settings-view__body">
        <ResizablePanel leftPanel={leftPanel} rightPanel={rightPanel} />
      </div>
    </div>
  )
}
