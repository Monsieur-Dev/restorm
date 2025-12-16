/**
 * SearchBar component - Search input with results dropdown
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '../Tooltip/Tooltip'
import { MarkdownViewer } from '../MarkdownViewer/MarkdownViewer'
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

  // Tooltip state
  const [hoveredResultId, setHoveredResultId] = useState<string | null>(null)
  const [isTooltipHovered, setIsTooltipHovered] = useState(false)
  const tooltipTargetRef = useRef<HTMLElement | null>(null)
  const hideTooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const placeholderText = placeholder ?? t('search.placeholder', 'Search...')
  const noResultsText = t('search.noResults', 'No results found')

  // Clear tooltip hide timeout
  const clearHideTooltipTimeout = useCallback(() => {
    if (hideTooltipTimeoutRef.current) {
      clearTimeout(hideTooltipTimeoutRef.current)
      hideTooltipTimeoutRef.current = null
    }
  }, [])

  // Schedule tooltip hide after 300ms
  const scheduleHideTooltip = useCallback(() => {
    clearHideTooltipTimeout()
    hideTooltipTimeoutRef.current = setTimeout(() => {
      setHoveredResultId(null)
      setIsTooltipHovered(false)
    }, 300)
  }, [clearHideTooltipTimeout])

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
    setHoveredResultId(null)
    setIsTooltipHovered(false)
    clearHideTooltipTimeout()
  }, [clearHideTooltipTimeout])

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

  // Cleanup debounce and tooltip timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      clearHideTooltipTimeout()
    }
  }, [clearHideTooltipTimeout])


  // Determine state
  const hasResults = results.length > 0
  const hasQuery = query.trim().length > 0

  // Get currently hovered result for tooltip
  const hoveredResult = useMemo(() => {
    if (!hoveredResultId) return null
    for (const group of results) {
      const found = group.items.find((item) => item.id === hoveredResultId)
      if (found) return found
    }
    return null
  }, [hoveredResultId, results])

  // Tooltip content
  const tooltipContent = useMemo(() => {
    if (!hoveredResult) return null

    const { category, icon, title: resultTitle, description } = hoveredResult

    if (category === 'request' && icon) {
      const method = icon.toUpperCase()
      return (
        <div style={{ width: 400 }}>
          <div style={{ marginBottom: 8 }}>
            <span className={`http-method-badge method-${method.toLowerCase()}`}>{method}</span>{' '}
            <strong>{resultTitle}</strong>
          </div>
          {description && (
            <ScrollableElement
              options={{ vertical: 'auto', horizontal: 'auto', useShadows: false, fitContent: true }}
              style={{ maxHeight: 'calc(100vh - 90px)' }}
            >
              <MarkdownViewer value={description} />
            </ScrollableElement>
          )}
        </div>
      )
    }

    // Folder or other category
    return (
      <div style={{ width: 400 }}>
        <div style={{ marginBottom: 8 }}>
          <strong>{resultTitle}</strong>
        </div>
        {description && (
          <ScrollableElement
            options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, fitContent: true }}
            style={{ maxHeight: 'calc(100vh - 90px)' }}
          >
            <MarkdownViewer value={description} />
          </ScrollableElement>
        )}
      </div>
    )
  }, [hoveredResult])

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
            <div onMouseDown={(e) => e.preventDefault()}>
              <ScrollableElement
                className="search-results-wrapper"
                options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, fitContent: true }}
                style={{ maxHeight: 350 }}
              >
              <div className="search-results-content" role="tree" aria-label={t('search.resultsAriaLabel', 'Search results')} style={{ maxHeight: '350px' }}>
                {results.map((group) => (
                  <div key={group.category} className="search-results-group">
                    <div className="search-results-category">
                      <i className={`codicon codicon-${group.icon} category-icon`} />
                      <span>{group.label.startsWith('search.') ? t(group.label, group.label) : group.label}</span>
                    </div>
                    {group.items.map((result) => {
                      const { category, icon, title: resultTitle, description } = result
                      const shortDescription = description && description.length > 100
                        ? description.slice(0, 100) + '...'
                        : description

                      return (
                        <div
                          key={result.id}
                          className="search-result-item"
                          role="treeitem"
                          tabIndex={0}
                          onClick={() => handleResultClick(result)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleResultClick(result)
                          }}
                          onMouseEnter={(event) => {
                            if (hoveredResultId && hoveredResultId !== result.id) {
                              setHoveredResultId(null)
                              tooltipTargetRef.current = null
                            }
                            clearHideTooltipTimeout()
                            setHoveredResultId(result.id)
                            tooltipTargetRef.current = event.currentTarget
                          }}
                          onMouseLeave={() => {
                            scheduleHideTooltip()
                          }}
                        >
                          {category === 'request' && icon ? (
                            <div className="result-content">
                              <div className="result-title result-http-title">
                                <span className={`http-method-badge method-${icon.toLowerCase()}`}>{icon.toUpperCase()}</span>
                                <span className="http-route">{resultTitle}</span>
                              </div>
                              {shortDescription && <div className="result-description">{shortDescription}</div>}
                            </div>
                          ) : (
                            <>
                              <i className={`codicon codicon-${icon ?? 'symbol-misc'} result-icon`} />
                              <div className="result-content">
                                <div className="result-title">{resultTitle}</div>
                                {shortDescription && <div className="result-description">{shortDescription}</div>}
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
              </ScrollableElement>
            </div>
          )}

          <Tooltip
            targetRef={tooltipTargetRef}
            show={hoveredResultId !== null || isTooltipHovered}
            content={tooltipContent}
            side="right"
            fixedTop={25}
            repositionKey={hoveredResultId}
            onMouseEnter={() => {
              clearHideTooltipTimeout()
              setIsTooltipHovered(true)
            }}
            onMouseLeave={() => {
              setIsTooltipHovered(false)
              scheduleHideTooltip()
            }}
            onMouseDown={(e) => e.preventDefault()}
          />
        </div>
      )}
    </div>
  )
}

export default SearchBar
