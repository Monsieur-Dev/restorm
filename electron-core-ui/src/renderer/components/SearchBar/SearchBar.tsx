/**
 * SearchBar component - Search input with results dropdown
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollableElement } from '../ScrollableElement'
import { searchService, type SearchResult, type GroupedResults } from '../../services/SearchService'
import { logger } from '../../services/logger'
import './searchBar.css'

export interface SearchBarProps {
  /** Title to display when search bar is closed */
  title?: string
  /** Callback when a search result is clicked */
  onResultClick?: ((result: SearchResult) => void) | undefined
  /** Placeholder text for the search input */
  placeholder?: string
}

/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 150

/** Get codicon class for an icon name */
function getCodiconClass(icon: string | undefined, fallback: string): string {
  if (!icon) return `codicon codicon-${fallback}`

  // HTTP methods use text instead of icon
  const method = icon.toLowerCase()
  if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) {
    return ''
  }

  return `codicon codicon-${icon}`
}

/** Render HTTP method badge or codicon */
function renderIcon(result: SearchResult): React.ReactNode {
  const { category, icon } = result

  // HTTP requests don't use icon in the same way
  if (category === 'request') {
    return null
  }

  const codiconClass = getCodiconClass(icon, 'symbol-misc')
  return <i className={`${codiconClass} result-icon`} />
}

/** Render result content based on category */
function renderResultContent(result: SearchResult): React.ReactNode {
  const { category, icon, title, description } = result

  // HTTP request: display method badge + route on first line, description below
  if (category === 'request' && icon) {
    const method = icon.toUpperCase()
    return (
      <div className="result-content">
        <div className="result-title result-http-title">
          <span className={`http-method-badge method-${method.toLowerCase()}`}>{method}</span>
          <span className="http-route">{title}</span>
        </div>
        {description && (
          <div className="result-description">
            {description.slice(0, 100)}
            {description.length > 100 ? '...' : ''}
          </div>
        )}
      </div>
    )
  }

  // Default rendering for other categories
  return (
    <div className="result-content">
      <div className="result-title">{title}</div>
      {description && (
        <div className="result-description">
          {description.slice(0, 100)}
          {description.length > 100 ? '...' : ''}
        </div>
      )}
    </div>
  )
}

export const SearchBar: React.FC<SearchBarProps> = ({
  title = '',
  onResultClick,
  placeholder
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GroupedResults[]>([])

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const closedRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [openBoxPosition, setOpenBoxPosition] = useState({ top: 0, left: 0, width: 0 })

  const placeholderText = placeholder ?? t('search.placeholder', 'Search...')
  const noResultsText = t('search.noResults', 'No results found')

  // Perform search with debounce
  const performSearch = useCallback((searchQuery: string) => {
    logger.debug('[SearchBar] performSearch called', { searchQuery })
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      logger.debug('[SearchBar] Executing search', { searchQuery })
      const searchResults = searchService.search(searchQuery)
      logger.debug('[SearchBar] Search results', { count: searchResults.length, results: searchResults })
      setResults(searchResults)
    }, DEBOUNCE_MS)
  }, [])

  // Handle query change
  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newQuery = e.target.value
      logger.debug('[SearchBar] Query changed', { newQuery })
      setQuery(newQuery)

      if (newQuery.trim()) {
        performSearch(newQuery)
      } else {
        setResults([])
      }
    },
    [performSearch]
  )

  // Handle click on closed state to open
  const handleOpenClick = useCallback(() => {
    if (closedRef.current) {
      const rect = closedRef.current.getBoundingClientRect()
      setOpenBoxPosition({
        top: rect.top,
        left: rect.left,
        width: rect.width
      })
    }
    setIsOpen(true)
  }, [])

  // Handle close
  const handleClose = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setResults([])
  }, [])

  // Handle result click
  const handleResultClick = useCallback(
    (result: SearchResult) => {
      onResultClick?.(result)
      handleClose()
    },
    [onResultClick, handleClose]
  )

  // Handle key down
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    },
    [handleClose]
  )

  // Handle blur with delay to allow click on results
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // Check if the related target is within the container
      const relatedTarget = e.relatedTarget as Node | null
      if (containerRef.current?.contains(relatedTarget)) {
        return
      }

      // Delay close to allow click events on results to fire
      setTimeout(() => {
        handleClose()
      }, 150)
    },
    [handleClose]
  )

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // Get category label (translate if it's a translation key)
  const getCategoryLabel = (label: string): string => {
    if (label.startsWith('search.')) {
      return t(label, label)
    }
    return label
  }

  // Determine state
  const hasResults = results.length > 0
  const hasQuery = query.trim().length > 0

  return (
    <div className="search-bar-container" ref={containerRef}>
      {!isOpen ? (
        <div
          className="search-bar-closed"
          ref={closedRef}
          onClick={handleOpenClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleOpenClick()
            }
          }}
        >
          <i className="codicon codicon-search search-icon" />
          <span className="search-title">{title}</span>
        </div>
      ) : (
        <div
          className={`search-bar-open ${hasResults ? 'has-results' : ''} ${hasQuery && !hasResults ? 'no-results' : ''}`}
          style={{
            top: openBoxPosition.top,
            left: openBoxPosition.left,
            width: openBoxPosition.width
          }}
        >
          <div className="search-bar-input-row">
            <input
              ref={inputRef}
              type="text"
              className="search-bar-input"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder={placeholderText}
              aria-label={placeholderText}
            />
          </div>

          {hasQuery && !hasResults && (
            <div className="search-results-empty">{noResultsText}</div>
          )}

          {hasResults && (
            <ScrollableElement
              options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
              style={{ maxHeight: 320 }}
            >
              <div className="search-results-content">
                {results.map((group) => (
                  <div key={group.category}>
                    <div className="search-results-category">
                      <i className={`codicon codicon-${group.icon} category-icon`} />
                      <span>{getCategoryLabel(group.label)}</span>
                    </div>
                    {group.items.map((result) => (
                      <div
                        key={result.id}
                        className="search-result-item"
                        onClick={() => {
                          handleResultClick(result)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleResultClick(result)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {renderIcon(result)}
                        {renderResultContent(result)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ScrollableElement>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchBar

