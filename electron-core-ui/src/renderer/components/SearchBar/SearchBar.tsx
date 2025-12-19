/**
 * SearchBar component - Search input with results dropdown
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '../Tooltip/Tooltip'
import { MarkdownViewer } from '../MarkdownViewer/MarkdownViewer'
import { ScrollableElement } from '../ScrollableElement'
import InputBox from '../InputBox/InputBox'
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
  /** Custom renderer for tooltip content. If not provided, uses default rendering with description. */
  renderTooltipContent?: (result: SearchResult) => React.ReactNode
}

/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 150

export const SearchBar: React.FC<SearchBarProps> = ({
  title = '',
  onResultClick,
  placeholder,
  renderTooltipContent
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GroupedResults[]>([])
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  const containerRef = useRef<HTMLDivElement>(null)
  const openBoxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
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
      setResults(searchResults)
    }, DEBOUNCE_MS)
  }, [])

  // Handle query change
  const handleQueryChange = useCallback(
    (newQuery: string) => {
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

  // Toggle category collapse
  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
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

  // Handle blur - only close if focus goes outside search area
  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Check if the related target is within the open box (includes tooltip)
      const relatedTarget = e.relatedTarget as Node | null
      if (relatedTarget) {
        // Focus went to another element - check if it's within our search area
        if (openBoxRef.current?.contains(relatedTarget)) {
          return
        }
        // Check if it's within the tooltip (which may be positioned outside container)
        const tooltip = document.querySelector('.search-result-tooltip')
        if (tooltip?.contains(relatedTarget)) {
          return
        }
      }
      // Focus went nowhere specific (clicked on non-focusable element)
      // Let the global click handler deal with it
    },
    []
  )

  // Global click handler to close search when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleGlobalMouseDown = (e: MouseEvent): void => {
      const target = e.target as Node
      // Check if click is within the open search box
      if (openBoxRef.current?.contains(target)) {
        return
      }
      // Check if click is within the tooltip
      const tooltip = document.querySelector('.search-result-tooltip')
      if (tooltip?.contains(target)) {
        return
      }
      // Click was outside - close the search
      handleClose()
    }

    // Use mousedown to catch clicks before they trigger other events
    document.addEventListener('mousedown', handleGlobalMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleGlobalMouseDown)
    }
  }, [isOpen, handleClose])

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Update position on window resize when open
  useEffect(() => {
    if (!isOpen) return

    const handleResize = (): void => {
      if (closedRef.current) {
        const rect = closedRef.current.getBoundingClientRect()
        setOpenBoxPosition({
          top: rect.top,
          left: rect.left,
          width: rect.width
        })
      }
    }

    window.addEventListener('resize', handleResize)
    return (): void => { window.removeEventListener('resize', handleResize) }
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

    // Use custom renderer if provided
    if (renderTooltipContent) {
      return renderTooltipContent(hoveredResult)
    }

    // Default rendering: show title and description
    const { category, icon, title: resultTitle, description } = hoveredResult

    if (category === 'request' && icon) {
      const method = icon.toUpperCase()
      return (
        <div style={{ maxHeight: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 8, flexShrink: 0 }}>
            <span className={`http-method-badge method-${method.toLowerCase()}`}>{method}</span>{' '}
            <strong>{resultTitle}</strong>
          </div>
          {description && (
            <MarkdownViewer value={description} style={{ flex: 1, minHeight: 0, maxHeight: 'calc(100vh - 130px)' }} />
          )}
        </div>
      )
    }

    // Folder or other category
    return (
      <div style={{ maxHeight: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 8, flexShrink: 0 }}>
          <strong>{resultTitle}</strong>
        </div>
        {description && (
          <MarkdownViewer value={description} style={{ flex: 1, minHeight: 0, maxHeight: 'calc(100vh - 130px)' }} />
        )}
      </div>
    )
  }, [hoveredResult, renderTooltipContent])

  return (
    <div className="search-bar-container" ref={containerRef}>
      {/* Hidden element kept for position reference */}
      <div
        className="search-bar-closed"
        ref={closedRef}
        onClick={!isOpen ? handleOpenClick : undefined}
        role="button"
        tabIndex={isOpen ? -1 : 0}
        onKeyDown={(e) => {
          if (!isOpen && (e.key === 'Enter' || e.key === ' ')) {
            handleOpenClick()
          }
        }}
        style={isOpen ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
      >
        <i className="codicon codicon-search search-icon" />
        <span className="search-title">{title}</span>
      </div>
      {isOpen && (
        <div
          ref={openBoxRef}
          className={`search-bar-open ${hasResults ? 'has-results' : ''} ${hasQuery && !hasResults ? 'no-results' : ''}`}
          style={{
            top: openBoxPosition.top,
            left: openBoxPosition.left,
            width: openBoxPosition.width
          }}
        >
          <div className="search-bar-input-row">
            <InputBox
              inputRef={inputRef}
              className="search-bar-input"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              options={{
                placeholder: placeholderText,
                ariaLabel: placeholderText
              }}
            />
          </div>

          {hasQuery && !hasResults && (
            <div className="search-results-empty">{noResultsText}</div>
          )}

          {hasResults && (
            <div onMouseDown={(e) => { e.preventDefault() }}>
              <ScrollableElement
                className="search-results-wrapper"
                options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false, fitContent: true }}
                style={{ maxHeight: 350 }}
              >
              <div className="search-results-content" role="tree" aria-label={t('search.resultsAriaLabel', 'Search results')} style={{ maxHeight: '350px' }}>
                {results.map((group) => {
                  const isCollapsed = collapsedCategories.has(group.category)
                  return (
                    <div key={group.category} className="search-results-group">
                      <div
                        className="search-results-category"
                        data-sticky-level={1}
                        role="treeitem"
                        aria-expanded={!isCollapsed}
                        onClick={() => { toggleCategory(group.category) }}
                      >
                        <i className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'} category-chevron`} />
                        <i className={`codicon codicon-${group.icon} category-icon`} />
                        <span>{group.label.startsWith('search.') ? t(group.label, group.label) : group.label}</span>
                        <span className="category-count">({group.items.length})</span>
                      </div>
                      {!isCollapsed && group.items.map((result) => {
                        const { category, icon, title: resultTitle } = result

                        return (
                          <div
                            key={result.id}
                            data-result-id={result.id}
                            data-sticky-level={0}
                            className="search-result-item"
                            role="treeitem"
                            tabIndex={0}
                            onClick={() => { handleResultClick(result) }}
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
                              </div>
                            ) : (
                              <>
                                <i className={`codicon codicon-${icon ?? 'symbol-misc'} result-icon`} />
                                <div className="result-content">
                                  <div className="result-title">{resultTitle}</div>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
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
            className="search-result-tooltip"
            onMouseEnter={() => {
              clearHideTooltipTimeout()
              setIsTooltipHovered(true)
            }}
            onMouseLeave={() => {
              setIsTooltipHovered(false)
              scheduleHideTooltip()
            }}
          />
        </div>
      )}
    </div>
  )
}

export default SearchBar
