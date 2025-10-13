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

  // Detect which header is currently sticky at the top
  useEffect(() => {
    if (!schema || searchQuery || isScrollingProgrammatically.current) return

    const mainContent = document.querySelector('.settings-content__main')
    if (!mainContent) return

    const handleScroll = (): void => {
      if (isScrollingProgrammatically.current) return

      // Get all sticky headers
      const categoryHeaders = mainContent.querySelectorAll('.settings-content__category-header')
      const subcategoryHeaders = mainContent.querySelectorAll('.settings-content__subcategory-header')

      // Check which subcategory header is sticky (closest to top)
      let activeSectionId: string | null = null

      // First check subcategories (they have higher priority as they're on top when sticky)
      subcategoryHeaders.forEach((header) => {
        const rect = header.getBoundingClientRect()
        const mainRect = mainContent.getBoundingClientRect()
        // Check if header is sticky at the top (within a small tolerance)
        if (rect.top - mainRect.top <= 90 && rect.top - mainRect.top >= 80) {
          const section = header.closest('[data-category]')
          if (section) {
            activeSectionId = section.getAttribute('data-category')
          }
        }
      })

      // If no subcategory is sticky, check categories
      if (!activeSectionId) {
        categoryHeaders.forEach((header) => {
          const rect = header.getBoundingClientRect()
          const mainRect = mainContent.getBoundingClientRect()
          // Check if header is sticky at the very top
          if (rect.top - mainRect.top <= 5 && rect.top - mainRect.top >= -5) {
            const section = header.closest('[data-category]')
            if (section) {
              activeSectionId = section.getAttribute('data-category')
            }
          }
        })
      }

      if (activeSectionId && activeSectionId !== activeCategory) {
        setActiveCategory(activeSectionId)
      }
    }

    mainContent.addEventListener('scroll', handleScroll)
    // Initial check
    handleScroll()

    return () => {
      mainContent.removeEventListener('scroll', handleScroll)
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
