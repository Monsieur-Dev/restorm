import React, { useMemo } from 'react'
import {
  SettingsSchema,
  SettingCategory,
  SettingDefinition,
  FlattenedSetting
} from '../../types/settings.types'
import { SettingControl } from './SettingControl'
import { useTranslation } from 'react-i18next'

interface SettingsContentProps {
  schema: SettingsSchema
  selectedCategory: string | null
  searchResults: FlattenedSetting[] | null
  values: Record<string, unknown>
  onSettingChange: (key: string, value: unknown) => void
  onResetSetting: (key: string) => void
}

export const SettingsContent: React.FC<SettingsContentProps> = ({
  schema,
  selectedCategory,
  searchResults,
  values,
  onSettingChange,
  onResetSetting
}) => {
  const { t } = useTranslation()

  // Find the selected category in the schema
  const category = useMemo(() => {
    if (!selectedCategory) return null
    return findCategoryByKey(schema, selectedCategory)
  }, [schema, selectedCategory])

  // Render settings from search results
  if (searchResults) {
    if (searchResults.length === 0) {
      return (
        <div className="settings-content">
          <div className="settings-content__empty">{t('settings.noResults')}</div>
        </div>
      )
    }

    return (
      <div className="settings-content">
        <div className="settings-content__section">
          <h2 className="settings-content__title">{t('settings.searchResults')}</h2>
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
          />
        ))}
        </div>
      </div>
    )
  }

  // Render settings from selected category
  if (!category) {
    return (
      <div className="settings-content">
        <div className="settings-content__empty">{t('settings.selectCategory')}</div>
      </div>
    )
  }

  return (
    <div className="settings-content">
      <div className="settings-content__header">
        <h1 className="settings-content__title">{category.name}</h1>
        {category.description && (
          <p className="settings-content__description">{category.description}</p>
        )}
      </div>

      {category.settings && Object.keys(category.settings).length > 0 && (
        <div className="settings-content__section">
          {Object.values(category.settings).map((setting) => {
            const fullPath = buildSettingPath(schema, category.key, setting.key)
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
              />
            )
          })}
        </div>
      )}

      {category.categories &&
        Object.values(category.categories).map((subCategory) => (
          <CategorySection
            key={subCategory.key}
            category={subCategory}
            schema={schema}
            parentKey={category.key}
            values={values}
            onSettingChange={onSettingChange}
            onResetSetting={onResetSetting}
          />
        ))}
    </div>
  )
}

interface CategorySectionProps {
  category: SettingCategory
  schema: SettingsSchema
  parentKey: string
  values: Record<string, unknown>
  onSettingChange: (key: string, value: unknown) => void
  onResetSetting: (key: string) => void
}

const CategorySection: React.FC<CategorySectionProps> = ({
  category,
  parentKey,
  values,
  onSettingChange,
  onResetSetting
}) => {
  if (!category.settings || Object.keys(category.settings).length === 0) {
    return null
  }

  return (
    <div className="settings-content__section">
      <h2 className="settings-content__subtitle">{category.name}</h2>
      {category.description && (
        <p className="settings-content__description">{category.description}</p>
      )}
      {Object.values(category.settings).map((setting) => {
        const fullPath = `${parentKey}.${category.key}.${setting.key}`
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
          />
        )
      })}
    </div>
  )
}

interface SettingItemProps {
  setting: SettingDefinition
  value: unknown
  onChange: (value: unknown) => void
  onReset: () => void
}

const SettingItem: React.FC<SettingItemProps> = ({ setting, value, onChange, onReset }) => {
  const { t } = useTranslation()

  return (
    <div className="setting-item">
      <div className="setting-item__header">
        <div className="setting-item__info">
          <h3 className="setting-item__name">{setting.name}</h3>
          <p className="setting-item__description">{setting.description}</p>
        </div>
        <button className="setting-item__reset" onClick={onReset} title={t('settings.reset')}>
          ↺
        </button>
      </div>
      <div className="setting-item__control">
        <SettingControl setting={setting} value={value} onChange={onChange} />
      </div>
    </div>
  )
}

// Helper function to find a category by key
function findCategoryByKey(schema: SettingsSchema, key: string): SettingCategory | null {
  for (const category of Object.values(schema.categories)) {
    if (category.key === key) {
      return category
    }
    if (category.categories) {
      const found = findCategoryInChildren(category.categories, key)
      if (found) return found
    }
  }
  return null
}

function findCategoryInChildren(
  categories: Record<string, SettingCategory>,
  key: string
): SettingCategory | null {
  for (const category of Object.values(categories)) {
    if (category.key === key) {
      return category
    }
    if (category.categories) {
      const found = findCategoryInChildren(category.categories, key)
      if (found) return found
    }
  }
  return null
}

// Helper function to build setting path
function buildSettingPath(schema: SettingsSchema, categoryKey: string, settingKey: string): string {
  // Find the category path
  const findPath = (
    categories: Record<string, SettingCategory>,
    targetKey: string,
    currentPath: string[] = []
  ): string[] | null => {
    for (const category of Object.values(categories)) {
      const path = [...currentPath, category.key]
      if (category.key === targetKey) {
        return path
      }
      if (category.categories) {
        const found = findPath(category.categories, targetKey, path)
        if (found) return found
      }
    }
    return null
  }

  const categoryPath = findPath(schema.categories, categoryKey)
  if (categoryPath) {
    return `${categoryPath.join('.')}.${settingKey}`
  }
  return `${categoryKey}.${settingKey}`
}

