import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox } from 'electron-core-ui/renderer'

const HIGHLIGHT_NAME = 'documentation-host-search'
const ACTIVE_HIGHLIGHT_NAME = 'documentation-host-search-active'

export interface DocumentationHostSearchHandle {
  /** Programmatically open the search bar (used by Ctrl+F). */
  open: () => void
  /** Step to the next match (used by F3 / Enter). Wraps around at
   * the end. No-op when no matches. */
  next: () => void
  /** Step to the previous match (Shift+F3 / Shift+Enter). Wraps. */
  previous: () => void
  /** Close the search bar and clear the highlights. */
  close: () => void
  /** Whether the search bar is currently visible. */
  isOpen: () => boolean
}

export interface DocumentationHostSearchProps {
  /** The host root the search walks for matches. Pass a stable ref. */
  rootRef: React.RefObject<HTMLElement | null>
}

type HighlightCtor = new (...ranges: AbstractRange[]) => unknown

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

interface CSSHighlightAware {
  highlights?: HighlightRegistry
}

function getHighlightsRegistry(): HighlightRegistry | undefined {
  return (CSS as unknown as CSSHighlightAware).highlights
}

function getHighlightCtor(): HighlightCtor | undefined {
  return (window as unknown as { Highlight?: HighlightCtor }).Highlight
}

function shouldSkipNode(node: Node): boolean {
  // Skip nodes that aren't user-readable text: SVG (model graph
  // edges/paths), input boxes, hidden tooltips off-screen, the
  // search bar itself.
  let n: Node | null = node.parentNode
  while (n?.nodeType === Node.ELEMENT_NODE) {
    const el = n as Element
    if (el.tagName === 'svg' || el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return true
    if (el.classList.contains('documentation-host-search')) return true
    if (el.classList.contains('documentation-host-search-bar')) return true
    n = el.parentNode
  }
  return false
}

function buildMatchRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = []
  if (query.length === 0) return ranges
  const lowQuery = query.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node): number => {
      if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT
      return (node as Text).data.toLowerCase().includes(lowQuery)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    }
  })
  let n: Node | null = walker.nextNode()
  while (n) {
    const text = (n as Text).data
    const lowerText = text.toLowerCase()
    let cursor = 0
    let idx = lowerText.indexOf(lowQuery, cursor)
    while (idx !== -1) {
      const range = document.createRange()
      range.setStart(n, idx)
      range.setEnd(n, idx + query.length)
      ranges.push(range)
      cursor = idx + query.length
      idx = lowerText.indexOf(lowQuery, cursor)
    }
    n = walker.nextNode()
  }
  return ranges
}

/**
 * In-doc search overlay — Ctrl+F to open, F3 / Shift+F3 to step
 * through occurrences, Esc to close. Uses the CSS Custom Highlight
 * API so we never mutate the DOM the React tree owns; React Flow,
 * Monaco, and the Markdown viewer all keep their authoritative
 * structures intact.
 */
export const DocumentationHostSearch = React.forwardRef<DocumentationHostSearchHandle, DocumentationHostSearchProps>(
  ({ rootRef }, forwardedRef) => {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const [matchCount, setMatchCount] = useState(0)
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
    const matchRangesRef = useRef<Range[]>([])
    // Ref-mirror of activeIndex so the recompute-on-query effect can
    // read the latest navigation position without depending on it
    // (depending on activeIndex would re-walk the DOM on every step).
    const activeIndexRef = useRef(0)
    useEffect(() => { activeIndexRef.current = activeIndex }, [activeIndex])

    const clearHighlights = useCallback(() => {
      const registry = getHighlightsRegistry()
      if (!registry) return
      registry.delete(HIGHLIGHT_NAME)
      registry.delete(ACTIVE_HIGHLIGHT_NAME)
    }, [])

    const refreshHighlights = useCallback((nextActive: number, ranges: Range[]) => {
      const registry = getHighlightsRegistry()
      const Ctor = getHighlightCtor()
      if (!registry || !Ctor) return
      if (ranges.length === 0) {
        registry.delete(HIGHLIGHT_NAME)
        registry.delete(ACTIVE_HIGHLIGHT_NAME)
        return
      }
      const others = ranges.filter((_, i) => i !== nextActive)
      const active = ranges[nextActive]
      registry.set(HIGHLIGHT_NAME, new Ctor(...others))
      if (active) registry.set(ACTIVE_HIGHLIGHT_NAME, new Ctor(active))
    }, [])

    const recompute = useCallback((nextQuery: string, indexHint: number) => {
      const root = rootRef.current
      if (!root) return
      const ranges = buildMatchRanges(root, nextQuery)
      matchRangesRef.current = ranges
      setMatchCount(ranges.length)
      const safeIndex = ranges.length === 0 ? 0 : Math.min(indexHint, ranges.length - 1)
      setActiveIndex(safeIndex)
      refreshHighlights(safeIndex, ranges)
      const activeRange = ranges[safeIndex]
      if (activeRange) {
        const node = activeRange.startContainer.parentElement
        node?.scrollIntoView({ block: 'center', inline: 'center' })
      }
    }, [rootRef, refreshHighlights])

    const moveTo = useCallback((next: number) => {
      const total = matchRangesRef.current.length
      if (total === 0) return
      const wrapped = ((next % total) + total) % total
      setActiveIndex(wrapped)
      refreshHighlights(wrapped, matchRangesRef.current)
      const activeRange = matchRangesRef.current[wrapped]
      if (activeRange) {
        const node = activeRange.startContainer.parentElement
        node?.scrollIntoView({ block: 'center', inline: 'center' })
      }
    }, [refreshHighlights])

    const stepNext = useCallback(() => { moveTo(activeIndex + 1) }, [moveTo, activeIndex])
    const stepPrev = useCallback(() => { moveTo(activeIndex - 1) }, [moveTo, activeIndex])

    const handleClose = useCallback(() => {
      setOpen(false)
      setQuery('')
      matchRangesRef.current = []
      setMatchCount(0)
      setActiveIndex(0)
      clearHighlights()
    }, [clearHighlights])

    const handleOpen = useCallback(() => {
      setOpen(true)
      // Focus on next tick so the input exists in the DOM.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }, [])

    useEffect(() => {
      return clearHighlights
    }, [clearHighlights])

    React.useImperativeHandle(forwardedRef, () => ({
      open: handleOpen,
      next: stepNext,
      previous: stepPrev,
      close: handleClose,
      isOpen: () => open
    }), [handleOpen, stepNext, stepPrev, handleClose, open])

    useEffect(() => {
      if (open) recompute(query, activeIndexRef.current)
    }, [query, open, recompute])

    if (!open) return null

    const counter = matchCount > 0
      ? `${String(activeIndex + 1)} / ${String(matchCount)}`
      : '0 / 0'

    return (
      <div
        className="documentation-host-search-bar"
        data-testid="documentation-host-search-bar"
        role="search"
      >
        <InputBox
          inputRef={inputRef}
          className="documentation-host-search-bar__input"
          data-testid="documentation-host-search-bar-input"
          value={query}
          onChange={(value): void => { setQuery(value) }}
          changeDebounceMs={0}
          onKeyDown={(e): void => {
            if (e.key === 'Escape') {
              e.preventDefault()
              handleClose()
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) stepPrev()
              else stepNext()
            }
          }}
          options={{ placeholder: t('documentation.find.placeholder'), ariaLabel: t('documentation.find.placeholder') }}
        />
        <span className="documentation-host-search-bar__counter">{counter}</span>
        <Button
          className="documentation-host-search-bar__button"
          options={{ ariaLabel: t('documentation.find.previousMatch') }}
          onClick={stepPrev}
          disabled={matchCount === 0}
        >▲</Button>
        <Button
          className="documentation-host-search-bar__button"
          options={{ ariaLabel: t('documentation.find.nextMatch') }}
          onClick={stepNext}
          disabled={matchCount === 0}
        >▼</Button>
        <Button
          className="documentation-host-search-bar__button documentation-host-search-bar__button--close"
          options={{ ariaLabel: t('documentation.find.close') }}
          onClick={handleClose}
        >×</Button>
      </div>
    )
  }
)

DocumentationHostSearch.displayName = 'DocumentationHostSearch'
