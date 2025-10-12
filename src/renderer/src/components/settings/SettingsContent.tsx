import React from 'react'
import {
  SettingsSchema,
  SettingCategory,
  FlattenedSetting
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
}

const CategorySection: React.FC<CategorySectionProps> = ({
  category,
  categoryPath,
  values,
  onSettingChange,
  onResetSetting
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
}

const SubCategorySection: React.FC<SubCategorySectionProps> = ({
  category,
  parentPath,
  values,
  onSettingChange,
  onResetSetting
}) => {
  const categoryPath = [...parentPath, category.key]
  const sectionId = categoryPath.join('-')

  if (!category.settings || Object.keys(category.settings).length === 0) {
    return null
  }

  return (
    <div className="settings-content__subcategory" id={sectionId} data-category={sectionId}>
      <h2 className="settings-content__section-title">{category.name}</h2>
      {category.description && (
        <p className="settings-content__section-description">{category.description}</p>
      )}
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
