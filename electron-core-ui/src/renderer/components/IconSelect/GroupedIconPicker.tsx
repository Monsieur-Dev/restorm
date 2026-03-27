import React, { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollableElement } from '../ScrollableElement'
import type { IconCategory } from './iconCategories'
import { getIconsForCategory, searchIcons } from './iconCategories'
import type { IconType } from '../../../types/icon'

interface GroupedIconPickerProps {
  /** All icon names for this library */
  iconNames: string[]
  /** Category definitions for this library */
  categories: IconCategory[]
  /** Render function for an icon */
  renderIcon: (name: string) => React.ReactNode
  /** Called when an icon is selected */
  onSelect: (name: string) => void
  /** Placeholder text for search input */
  searchPlaceholder: string
  /** Maximum icons to display per category */
  maxPerCategory?: number
  /** Unique prefix for DOM IDs to avoid conflicts */
  idPrefix: string
  /** Optional base test id for stable E2E selectors. */
  dataTestIdBase?: string
  /** Optional icon type string to expose in attributes. */
  iconType?: IconType
}

export const GroupedIconPicker: React.FC<GroupedIconPickerProps> = ({
  iconNames,
  categories,
  renderIcon,
  onSelect,
  searchPlaceholder,
  maxPerCategory = 100,
  idPrefix,
  dataTestIdBase,
  iconType
}) => {
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? '')

  // Build categorized icons
  const categorizedIcons = useMemo(() => {
    return categories.map(category => ({
      category,
      icons: getIconsForCategory(iconNames, category)
    })).filter(({ icons }) => icons.length > 0)
  }, [iconNames, categories])

  // Filter by search
  const filteredCategories = useMemo(() => {
    if (!searchTerm) return categorizedIcons

    const searchResults = searchIcons(iconNames, searchTerm)
    if (searchResults.length === 0) return []

    // Return a single "Search Results" section
    return [{
      category: { id: 'search', name: t('iconSelect.searchResults'), icon: 'search', patterns: [] },
      icons: searchResults.slice(0, 500)
    }]
  }, [categorizedIcons, iconNames, searchTerm, t])

  const handleCategoryClick = useCallback((categoryId: string) => {
    setActiveCategory(categoryId)
    const element = document.getElementById(`${idPrefix}-category-${categoryId}`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [idPrefix])

  const handleClearSearch = useCallback(() => {
    setSearchTerm('')
  }, [])

  // Get translated category name
  const getCategoryName = useCallback((categoryId: string, defaultName: string) => {
    const key = `iconSelect.categories.${categoryId}`
    const translated = t(key)
    return translated === key ? defaultName : translated
  }, [t])

  return (
    <div className="ecui-grouped-icon-picker" {...(dataTestIdBase ? { 'data-testid': dataTestIdBase } : {})}>
      {/* Category tabs */}
      <div className="ecui-grouped-icon-categories">
        {categories.map(cat => (
          <button
            key={cat.id}
            type="button"
            className={`ecui-grouped-icon-category ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => { handleCategoryClick(cat.id) }}
            title={getCategoryName(cat.id, cat.name)}
            {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-category-${cat.id}` } : {})}
            data-category-id={cat.id}
          >
            <i className={`codicon codicon-${cat.icon}`} />
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="ecui-icon-select-search">
        <i className="codicon codicon-search" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value) }}
          placeholder={searchPlaceholder}
          className="ecui-icon-select-search-input"
          {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-search-input` } : {})}
        />
        {searchTerm && (
          <button
            type="button"
            className="ecui-icon-select-search-clear"
            onClick={handleClearSearch}
            {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-search-clear` } : {})}
          >
            <i className="codicon codicon-close" />
          </button>
        )}
      </div>

      {/* Icon grid with categories */}
      <ScrollableElement
        options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false }}
        className="ecui-grouped-icon-scroll"
        {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-scroll` } : {})}
      >
        <div className="ecui-grouped-icon-sections">
          {filteredCategories.map(({ category, icons }) => (
            <div
              key={category.id}
              id={`${idPrefix}-category-${category.id}`}
              className="ecui-grouped-icon-section"
              {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-section-${category.id}` } : {})}
              data-category-id={category.id}
            >
              <div className="ecui-grouped-icon-section-header">
                <span>{getCategoryName(category.id, category.name)}</span>
                <span className="ecui-grouped-icon-count">({icons.length})</span>
              </div>
              <div className="ecui-icon-select-codicons-grid">
                {icons.slice(0, maxPerCategory).map(name => (
                  <button
                    key={name}
                    type="button"
                    className="ecui-icon-select-codicon"
                    title={name}
                    onClick={() => { onSelect(name) }}
                    {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-icon-${name}` } : {})}
                    {...(iconType ? { 'data-icon-type': iconType } : {})}
                    data-icon-name={name}
                  >
                    {renderIcon(name)}
                  </button>
                ))}
              </div>
              {icons.length > maxPerCategory && (
                <div className="ecui-icon-select-more-hint">
                  {t('iconSelect.more', { count: icons.length - maxPerCategory })}
                </div>
              )}
            </div>
          ))}
          {filteredCategories.length === 0 && (
            <div className="ecui-grouped-icon-empty">
              {t('iconSelect.noIconsFound')}
            </div>
          )}
        </div>
      </ScrollableElement>
    </div>
  )
}

export default GroupedIconPicker
