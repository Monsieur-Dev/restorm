import React, { useState, useRef, useEffect } from 'react'
import { VscSettingsGear } from 'react-icons/vsc'
import {
  SettingsSchema,
  SettingCategory,
  FlattenedSetting,
  SettingType
} from '../../types/settings.types'
import { SettingControl } from './SettingControl'
import { useTranslation } from 'react-i18next'

interface SettingsContentProps {
  schema: SettingsSchema
  searchQuery: string
  values: Record<string, unknown>
  onSettingChange: (key: string, value: unknown) => void
  onResetSetting: (key: string) => void
  onClose: () => void
}

export const SettingsContent: React.FC<SettingsContentProps> = ({
  schema,
  searchQuery,
  values,
  onSettingChange,
  onResetSetting,
  onClose
}) => {
  const { t } = useTranslation()
  const [focusedSettingKey, setFocusedSettingKey] = useState<string | null>(null)

  // Helper function to check if a setting matches the search query
  const matchesSearch = (setting: FlattenedSetting): boolean => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      setting.name.toLowerCase().includes(query) ||
      setting.description.toLowerCase().includes(query) ||
      setting.fullPath.toLowerCase().includes(query)
    )
  }

  // Render all settings grouped by category, filtered by search
  return (
    <div className="settings-content">
      <div className="settings-content__main">
        {Object.values(schema.categories).map((category) => (
          <CategorySection
            key={category.key}
            category={category}
            categoryPath={[category.key]}
            values={values}
            onSettingChange={onSettingChange}
            onResetSetting={onResetSetting}
            focusedSettingKey={focusedSettingKey}
            setFocusedSettingKey={setFocusedSettingKey}
            searchQuery={searchQuery}
            matchesSearch={matchesSearch}
          />
        ))}
      </div>
    </div>
  )
}

interface CategorySectionProps {
  category: SettingCategory
  categoryPath: string[]
  values: Record<string, unknown>
  onSettingChange: (key: string, value: unknown) => void
  onResetSetting: (key: string) => void
  focusedSettingKey: string | null
  setFocusedSettingKey: (key: string | null) => void
  searchQuery: string
  matchesSearch: (setting: FlattenedSetting) => boolean
}

const CategorySection: React.FC<CategorySectionProps> = ({
  category,
  categoryPath,
  values,
  onSettingChange,
  onResetSetting,
  focusedSettingKey,
  setFocusedSettingKey,
  searchQuery,
  matchesSearch
}) => {
  const sectionId = categoryPath.join('-')

  // Filter settings based on search
  const filteredSettings =
    category.settings &&
    Object.values(category.settings).filter((setting) => {
      const fullPath = `${categoryPath.join('.')}.${setting.key}`
      return matchesSearch({ ...setting, fullPath } as FlattenedSetting)
    })

  // Check if category has any visible content
  const hasVisibleSettings = filteredSettings && filteredSettings.length > 0
  const hasVisibleSubcategories =
    category.categories &&
    Object.values(category.categories).some((subCat) => {
      // Check if subcategory has any matching settings
      return (
        subCat.settings &&
        Object.values(subCat.settings).some((setting) => {
          const fullPath = `${categoryPath.join('.')}.${subCat.key}.${setting.key}`
          return matchesSearch({ ...setting, fullPath } as FlattenedSetting)
        })
      )
    })

  // Hide category if no visible content
  if (!hasVisibleSettings && !hasVisibleSubcategories) {
    return null
  }

  return (
    <div className="settings-content__category" id={sectionId} data-category={sectionId}>
      <div className="settings-content__category-header">
        <h1 className="settings-content__category-title">{category.name}</h1>
        {category.description && (
          <p className="settings-content__category-description">{category.description}</p>
        )}
      </div>

      {/* Render settings directly in this category */}
      {hasVisibleSettings && (
        <div className="settings-content__section">
          {filteredSettings.map((setting) => {
            const fullPath = `${categoryPath.join('.')}.${setting.key}`
            return (
              <SettingItem
                key={fullPath}
                setting={setting}
                value={values[fullPath]}
                onChange={(value) => {
                  onSettingChange(fullPath, value)
                }}
                onReset={() => {
                  onResetSetting(fullPath)
                }}
                isFocused={focusedSettingKey === fullPath}
                onFocus={() => {
                  setFocusedSettingKey(fullPath)
                }}
              />
            )
          })}
        </div>
      )}

      {/* Render subcategories */}
      {category.categories &&
        Object.values(category.categories).map((subCategory) => (
          <SubCategorySection
            key={subCategory.key}
            category={subCategory}
            parentPath={categoryPath}
            values={values}
            onSettingChange={onSettingChange}
            onResetSetting={onResetSetting}
            focusedSettingKey={focusedSettingKey}
            setFocusedSettingKey={setFocusedSettingKey}
            searchQuery={searchQuery}
            matchesSearch={matchesSearch}
          />
        ))}
    </div>
  )
}

interface SubCategorySectionProps {
  category: SettingCategory
  parentPath: string[]
  values: Record<string, unknown>
  onSettingChange: (key: string, value: unknown) => void
  onResetSetting: (key: string) => void
  focusedSettingKey: string | null
  setFocusedSettingKey: (key: string | null) => void
  searchQuery: string
  matchesSearch: (setting: FlattenedSetting) => boolean
}

const SubCategorySection: React.FC<SubCategorySectionProps> = ({
  category,
  parentPath,
  values,
  onSettingChange,
  onResetSetting,
  focusedSettingKey,
  setFocusedSettingKey,
  searchQuery,
  matchesSearch
}) => {
  const categoryPath = [...parentPath, category.key]
  const sectionId = categoryPath.join('-')

  if (!category.settings || Object.keys(category.settings).length === 0) {
    return null
  }

  // Filter settings based on search
  const filteredSettings = Object.values(category.settings).filter((setting) => {
    const fullPath = `${categoryPath.join('.')}.${setting.key}`
    return matchesSearch({ ...setting, fullPath } as FlattenedSetting)
  })

  // Hide subcategory if no visible settings
  if (filteredSettings.length === 0) {
    return null
  }

  return (
    <div className="settings-content__subcategory" id={sectionId} data-category={sectionId}>
      <div className="settings-content__subcategory-header">
        <h2 className="settings-content__section-title">{category.name}</h2>
        {category.description && (
          <p className="settings-content__section-description">{category.description}</p>
        )}
      </div>
      <div className="settings-content__section">
        {filteredSettings.map((setting) => {
          const fullPath = `${categoryPath.join('.')}.${setting.key}`
          return (
            <SettingItem
              key={fullPath}
              setting={setting}
              value={values[fullPath]}
              onChange={(value) => {
                onSettingChange(fullPath, value)
              }}
              onReset={() => {
                onResetSetting(fullPath)
              }}
              isFocused={focusedSettingKey === fullPath}
              onFocus={() => {
                setFocusedSettingKey(fullPath)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

interface SettingItemProps {
  setting: FlattenedSetting
  value: unknown
  onChange: (value: unknown) => void
  onReset: () => void
  isFocused: boolean
  onFocus: () => void
}

const SettingItem: React.FC<SettingItemProps> = ({ 
  setting, 
  value, 
  onChange, 
  onReset, 
  isFocused, 
  onFocus 
}) => {
  const { t } = useTranslation()
  const [showContextMenu, setShowContextMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const gearButtonRef = useRef<HTMLButtonElement>(null)

  // Handle click outside to close context menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        gearButtonRef.current &&
        !gearButtonRef.current.contains(event.target as Node)
      ) {
        setShowContextMenu(false)
      }
    }

    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [showContextMenu])

  const handleItemClick = (): void => {
    onFocus()
  }

  const handleGearClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setShowContextMenu(!showContextMenu)
  }

  const handleResetSetting = (): void => {
    onReset()
    setShowContextMenu(false)
  }

  const handleCopySettingId = (): void => {
    navigator.clipboard.writeText(setting.fullPath).catch((error) => {
      console.error('Failed to copy setting ID:', error)
    })
    setShowContextMenu(false)
  }

  const isBoolean = setting.type === SettingType.BOOLEAN

  return (
    <div
      className={`setting-item ${isFocused ? 'setting-item--focused' : ''} ${isBoolean ? 'setting-item--boolean' : ''}`}
      onClick={handleItemClick}
    >
      <div className="setting-item__header">
        <button
          ref={gearButtonRef}
          className="setting-item__gear"
          onClick={handleGearClick}
          title={t('settings.more')}
        >
          <VscSettingsGear />
        </button>
        <div className="setting-item__info">
          <h3 className="setting-item__name">{setting.name}</h3>
          {!isBoolean && <p className="setting-item__description">{setting.description}</p>}
        </div>
        {showContextMenu && (
          <div ref={menuRef} className="setting-context-menu">
            <div className="setting-context-menu__item" onClick={handleResetSetting}>
              {t('settings.resetSetting')}
            </div>
            <div className="setting-context-menu__item" onClick={handleCopySettingId}>
              {t('settings.copySettingId')}
            </div>
          </div>
        )}
      </div>
      <div className="setting-item__control">
        {isBoolean ? (
          <div className="setting-item__boolean-control">
            <SettingControl setting={setting} value={value} onChange={onChange} />
            <p className="setting-item__boolean-description">{setting.description}</p>
          </div>
        ) : (
          <SettingControl setting={setting} value={value} onChange={onChange} />
        )}
      </div>
    </div>
  )
}
