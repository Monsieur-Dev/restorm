import React, { useState, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../Button'
import { InputBox } from '../InputBox'
import { ScrollableElement } from '../ScrollableElement'
import { Tooltip } from '../Tooltip'
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
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null)
  const tooltipTargetRef = useRef<HTMLElement | null>(null)

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

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
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
        {EMOJI_CATEGORIES.map(category => {
          const label = getCategoryName(category.id, category.name)
          return (
            <Button
              key={category.id}
              className={`ecui-emoji-picker-category ${activeCategory === category.id ? 'active' : ''}`}
              options={{ ariaLabel: label }}
              onClick={() => { handleCategoryClick(category.id) }}
              onMouseEnter={(e) => { tooltipTargetRef.current = e.currentTarget; setHoveredTooltip(label) }}
              onMouseLeave={() => { setHoveredTooltip(null) }}
              {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-category-${category.id}` } : {})}
            >
              {category.icon}
            </Button>
          )
        })}
      </div>

      {/* Search input */}
      <div className="ecui-emoji-picker-search">
        <i className="codicon codicon-search" />
        <InputBox
          options={{ placeholder: t('iconSelect.searchEmojis') }}
          value={searchQuery}
          onChange={handleSearchChange}
          changeDebounceMs={0}
          className="ecui-emoji-picker-search-input"
          {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-search-input` } : {})}
        />
        {searchQuery && (
          <Button
            line
            icon="close"
            className="ecui-emoji-picker-search-clear"
            onClick={handleClearSearch}
            {...(dataTestIdBase ? { 'data-testid': `${dataTestIdBase}-search-clear` } : {})}
          />
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
                    onMouseEnter={(e) => { tooltipTargetRef.current = e.currentTarget; setHoveredTooltip(emoji) }}
                    onMouseLeave={() => { setHoveredTooltip(null) }}
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
      <Tooltip
        targetRef={tooltipTargetRef as React.RefObject<HTMLElement>}
        content={hoveredTooltip}
        show={hoveredTooltip !== null}
        placement="below"
      />
    </div>
  )
}

export default EmojiPicker
