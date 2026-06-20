import React, { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollableElement } from '../ScrollableElement'
import { EMOJI_CATEGORIES, type EmojiCategory } from './emojiData'

export interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void
  theme?: 'light' | 'dark'
  dataTestIdBase?: string
}

/**
 * Custom emoji picker component with categories and search
 * Replaces emoji-mart with a lightweight custom implementation
 */
export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onEmojiSelect, dataTestIdBase }) => {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>(EMOJI_CATEGORIES[0]?.id ?? 'people')

  // Filter emojis based on search
  const filteredCategories = useMemo((): EmojiCategory[] => {
    if (!searchQuery) return EMOJI_CATEGORIES
    
    const lowerQuery = searchQuery.toLowerCase()
    return EMOJI_CATEGORIES
      .map(category => ({
        ...category,
        emojis: category.emojis.filter(() => 
          category.name.toLowerCase().includes(lowerQuery) ||
          category.id.toLowerCase().includes(lowerQuery)
        )
      }))
      .filter(category => category.emojis.length > 0 || 
        category.name.toLowerCase().includes(lowerQuery) ||
        category.id.toLowerCase().includes(lowerQuery))
      .map(category => {
        // If category matches, show all emojis
        if (category.name.toLowerCase().includes(lowerQuery) ||
            category.id.toLowerCase().includes(lowerQuery)) {
          const original = EMOJI_CATEGORIES.find(c => c.id === category.id)
          return original ?? category
        }
        return category
      })
  }, [searchQuery])

  const handleEmojiClick = useCallback((emoji: string) => {
    onEmojiSelect(emoji)
  }, [onEmojiSelect])

  const handleCategoryClick = useCallback((categoryId: string) => {
    setActiveCategory(categoryId)
    // Scroll to category
    const element = document.getElementById(`emoji-category-${categoryId}`)
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
  }, [])

  // Get translated category name
  const getCategoryName = useCallback((categoryId: string, defaultName: string) => {
    const key = `iconSelect.emojiCategories.${categoryId}`
    const translated = t(key)
    return translated === key ? defaultName : translated
  }, [t])

  return (
    <div className="ecui-emoji-picker">
      {/* Category tabs */}
      <div className="ecui-emoji-picker-categories">
        {EMOJI_CATEGORIES.map(category => (
          <button
            key={category.id}
            type="button"
            className={`ecui-emoji-picker-category ${activeCategory === category.id ? 'active' : ''}`}
            onClick={() => { handleCategoryClick(category.id) }}
            aria-label={getCategoryName(category.id, category.name)}
            {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-category-${category.id}` } : {})}
            data-category-id={category.id}
          >
            {category.icon}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="ecui-emoji-picker-search">
        <i className="codicon codicon-search" />
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t('iconSelect.searchEmojis')}
          className="ecui-emoji-picker-search-input"
          {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-search-input` } : {})}
        />
        {searchQuery && (
          <button
            type="button"
            className="ecui-emoji-picker-search-clear"
            onClick={handleClearSearch}
            {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-search-clear` } : {})}
          >
            <i className="codicon codicon-close" />
          </button>
        )}
      </div>

      {/* Emoji grid with categories */}
      <ScrollableElement
        options={{
          vertical: 'auto',
          horizontal: 'hidden',
          useShadows: false
        }}
        className="ecui-emoji-picker-scroll"
      >
        <div className="ecui-emoji-picker-content">
          {filteredCategories.map(category => (
            <div
              key={category.id}
              id={`emoji-category-${category.id}`}
              className="ecui-emoji-picker-section"
              {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-section-${category.id}` } : {})}
              data-category-id={category.id}
            >
              <div className="ecui-emoji-picker-section-title">{getCategoryName(category.id, category.name)}</div>
              <div className="ecui-emoji-picker-grid">
                {category.emojis.map((emoji, index) => (
                  <button
                    key={`${category.id}-${index}`}
                    type="button"
                    className="ecui-emoji-picker-emoji"
                    onClick={() => { handleEmojiClick(emoji) }}
                    aria-label={emoji}
                    {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-emoji-${category.id}-${index}` } : {})}
                    data-emoji={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {filteredCategories.length === 0 && (
            <div className="ecui-emoji-picker-empty">{t('iconSelect.noEmojisFound')}</div>
          )}
        </div>
      </ScrollableElement>
    </div>
  )
}

export default EmojiPicker
