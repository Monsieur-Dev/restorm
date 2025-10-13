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
  searchResults: FlattenedSetting[] | null
  values: Record<string, unknown>
  onSettingChange: (key: string, value: unknown) => void
  onResetSetting: (key: string) => void
  onClose: () => void
}

export const SettingsContent: React.FC<SettingsContentProps> = ({
  schema,
  searchResults,
  values,
  onSettingChange,
  onResetSetting,
  onClose
}) => {
  const { t } = useTranslation()
  const [focusedSettingKey, setFocusedSettingKey] = useState<string | null>(null)

  // Render search results if searching
  if (searchResults) {
    if (searchResults.length === 0) {
      return (
        <div className="settings-content">
          <div className="settings-content__main">
            <div className="settings-content__empty">{t('settings.noResults')}</div>
          </div>
        </div>
      )
    }

    return (
      <div className="settings-content">
        <div className="settings-content__main">
          <div className="settings-content__section">
            <h2 className="settings-content__section-title">{t('settings.searchResults')}</h2>
            {searchResults.map((setting) => (
              <SettingItem
                key={setting.fullPath}
                setting={setting}
                value={values[setting.fullPath]}
                onChange={(value) => {
                  onSettingChange(setting.fullPath, value)
                }}
                onReset={() => {
                  onResetSetting(setting.fullPath)
                }}
                isFocused={focusedSettingKey === setting.fullPath}
                onFocus={() => {
                  setFocusedSettingKey(setting.fullPath)
                }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Render all settings grouped by category
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
}

const CategorySection: React.FC<CategorySectionProps> = ({
  category,
  categoryPath,
  values,
  onSettingChange,
  onResetSetting,
  focusedSettingKey,
  setFocusedSettingKey
}) => {
  const sectionId = categoryPath.join('-')

  return (
    <div className="settings-content__category" id={sectionId} data-category={sectionId}>
      <div className="settings-content__category-header">
        <h1 className="settings-content__category-title">{category.name}</h1>
        {category.description && (
          <p className="settings-content__category-description">{category.description}</p>
        )}
      </div>

      {/* Render settings directly in this category */}
      {category.settings && Object.keys(category.settings).length > 0 && (
        <div className="settings-content__section">
          {Object.values(category.settings).map((setting) => {
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
}

const SubCategorySection: React.FC<SubCategorySectionProps> = ({
  category,
  parentPath,
  values,
  onSettingChange,
  onResetSetting,
  focusedSettingKey,
  setFocusedSettingKey
}) => {
  const categoryPath = [...parentPath, category.key]
  const sectionId = categoryPath.join('-')

  if (!category.settings || Object.keys(category.settings).length === 0) {
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
        {Object.values(category.settings).map((setting) => {
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
