/**
 * SearchBar component - Search input with results dropdown
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListView, type ListViewItemData } from '../ListView'
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

/** Maximum height for the results list */
const MAX_RESULTS_HEIGHT = 300

/** Get category label translation key */
function getCategoryLabel(label: string, t: (key: string, fallback: string) => string): string {
  if (label.startsWith('search.')) {
    return t(label, label)
  }
  return label
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

  // Tooltip state
  const [hoveredResultId, setHoveredResultId] = useState<string | null>(null)
  const [isTooltipHovered, setIsTooltipHovered] = useState(false)
  const tooltipTargetRef = useRef<HTMLElement | null>(null)
  const hideTooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultsWrapperRef = useRef<HTMLDivElement>(null)

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

  // Transform results to ListView items
  const listViewItems: ListViewItemData[] = useMemo(
    () =>
      results.map((group) => {
        const children: ListViewItemData[] = group.items.map((result) => {
          const { category, icon, title: resultTitle, description } = result
          const MAX_DESCRIPTION_LENGTH = 100
          const shortDescription =
            description && description.length > MAX_DESCRIPTION_LENGTH
              ? description.slice(0, MAX_DESCRIPTION_LENGTH) + '...'
              : description

          // HTTP request: method badge + route on first line, description on second line
          if (category === 'request' && icon) {
            const method = icon.toUpperCase()
            const content = (
              <div className="result-content">
                <div className="result-title result-http-title">
                  <span className={`http-method-badge method-${method.toLowerCase()}`}>{method}</span>
                  <span className="http-route">{resultTitle}</span>
                </div>
                {shortDescription && <div className="result-description">{shortDescription}</div>}
              </div>
            )

            return {
              id: result.id,
              title: content,
              data: result
            }
          }

          // Default rendering for other categories (folders, etc.)
          const content = (
            <div className="result-content">
              <div className="result-title">{resultTitle}</div>
              {shortDescription && <div className="result-description">{shortDescription}</div>}
            </div>
          )

          return {
            id: result.id,
            title: content,
            icon: <i className={`codicon codicon-${icon ?? 'symbol-misc'} result-icon`} />,
            data: result
          }
        })

        return {
          id: `category-${group.category}`,
          title: getCategoryLabel(group.label, t),
          icon: <i className={`codicon codicon-${group.icon} category-icon`} />,
          isExpanded: true,
          isExpandable: true,
          isSelectable: false,
          isStickyHeader: true,
          children
        }
      }),
    [results, t]
  )

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
    const maxTooltipHeight = 'calc(100vh - 50px)'

    if (category === 'request' && icon) {
      const method = icon.toUpperCase()
      return (
        <div style={{ maxHeight: maxTooltipHeight, width: 400, overflow: 'hidden' }}>
          <div style={{ marginBottom: 8 }}>
            <span className={`http-method-badge method-${method.toLowerCase()}`}>{method}</span>{' '}
            <strong>{resultTitle}</strong>
          </div>
          {description && (
            <ScrollableElement
              options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false }}
              style={{ maxHeight: 'calc(100vh - 120px)' }}
            >
              <MarkdownViewer value={description} />
            </ScrollableElement>
          )}
        </div>
      )
    }

    // Folder or other category
    return (
      <div style={{ maxHeight: maxTooltipHeight, width: 400, overflow: 'hidden' }}>
        <div style={{ marginBottom: 8 }}>
          <strong>{resultTitle}</strong>
        </div>
        {description && (
          <ScrollableElement
            options={{ vertical: 'auto', horizontal: 'hidden', useShadows: false }}
            style={{ maxHeight: 'calc(100vh - 120px)' }}
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

          <div
            ref={resultsWrapperRef}
            className="search-results-wrapper"
            style={{ maxHeight: hasResults ? MAX_RESULTS_HEIGHT : 0 }}
          >
            {hasResults && (
              <ListView
                items={listViewItems}
                rootRole="tree"
                ariaLabel={t('search.resultsAriaLabel', 'Search results')}
                selectionMode="single"
                onItemClick={(payload) => {
                  const result = payload.item.data as SearchResult | undefined
                  if (result) {
                    handleResultClick(result)
                  }
                }}
                onItemMouseEnter={(payload, event) => {
                  // If hovering another result, close previous tooltip immediately
                  if (hoveredResultId && hoveredResultId !== payload.item.id) {
                    setHoveredResultId(null)
                    tooltipTargetRef.current = null
                  }

                  clearHideTooltipTimeout()
                  setHoveredResultId(payload.item.id)
                  tooltipTargetRef.current = event.currentTarget
                }}
                onItemMouseLeave={() => {
                  // Schedule hide after 300ms (can be cancelled if mouse enters tooltip)
                  scheduleHideTooltip()
                }}
              />
            )}
          </div>

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
          />
        </div>
      )}
    </div>
  )
}

export default SearchBar
