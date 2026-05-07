import React, { useCallback, useEffect, useRef, useState } from 'react'

export interface DocumentationHostNativeFindHandle {
  open: () => void
  next: () => void
  previous: () => void
  close: () => void
  isOpen: () => boolean
}

/**
 * Find-in-page bar driven by Chromium's native `webContents.findInPage`.
 * The bar handles the UI (input + n-of-m counter + ↑/↓/× buttons) and
 * pumps queries through the preload bridge `restorm.find.inPage`. The
 * Chromium engine paints the yellow highlight directly on the
 * rendered DOM, gives us perfect Word/Chrome parity, and avoids the
 * cost of the JS-side TreeWalker the custom search bar runs.
 *
 * Bound to Ctrl+F by `DocumentationHost`. The custom CSS Custom
 * Highlight API bar (`DocumentationHostSearch`) lives on Ctrl+Shift+F
 * for power users who want guarantees on what gets matched (the
 * native bar matches everything in the renderer, including hidden
 * tab panels — usually fine but rare cases of false positives in
 * sibling Tabs).
 */
export const DocumentationHostNativeFind = React.forwardRef<DocumentationHostNativeFindHandle>((
  _props,
  forwardedRef
) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastRequestIdRef = useRef<number>(-1)

  // Subscribe to the main-side `'found-in-page'` forward. The
  // bridge dispatches the latest result every time Chromium
  // re-evaluates the query (incremental + final update); we only
  // commit numbers from the final update so the counter doesn't
  // flicker mid-search.
  useEffect(() => {
    // The preload bridge ships `find` from a recent build; older
    // installs (or environments with the bridge stripped, e.g.
    // tests that mock `window.restorm`) fall back gracefully.
    const api = window.restorm?.find
    if (!api) return undefined
    const unsubscribe = api.onResult((result) => {
      if (result.requestId !== lastRequestIdRef.current) return
      setActiveMatch(result.activeMatchOrdinal)
      setTotalMatches(result.matches)
    })
    return () => { unsubscribe() }
  }, [])

  // Side-effect-only IPC dispatch — never sets renderer state
  // synchronously. The result update flows back through the
  // `'find:result'` listener wired in the mount effect, which
  // calls the state setters from event scope (allowed by
  // react-hooks/set-state-in-effect).
  const dispatchFind = useCallback(
    async (text: string, options?: { forward?: boolean; findNext?: boolean }) => {
      const api = window.restorm?.find
      if (!api) return
      const res = await api.inPage(text, { forward: options?.forward ?? true, findNext: options?.findNext ?? false })
      lastRequestIdRef.current = res.requestId
    },
    []
  )

  const dispatchStop = useCallback(
    (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => {
      const api = window.restorm?.find
      if (!api) return
      void api.stop(action)
      lastRequestIdRef.current = -1
    },
    []
  )

  const handleClose = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveMatch(0)
    setTotalMatches(0)
    dispatchStop('clearSelection')
  }, [dispatchStop])

  const handleOpen = useCallback(() => {
    setOpen(true)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const stepNext = useCallback(() => {
    if (query.length === 0) return
    void dispatchFind(query, { forward: true, findNext: true })
  }, [dispatchFind, query])

  const stepPrev = useCallback(() => {
    if (query.length === 0) return
    void dispatchFind(query, { forward: false, findNext: true })
  }, [dispatchFind, query])

  React.useImperativeHandle(forwardedRef, () => ({
    open: handleOpen,
    next: stepNext,
    previous: stepPrev,
    close: handleClose,
    isOpen: () => open
  }), [handleOpen, stepNext, stepPrev, handleClose, open])

  // Re-run the query whenever the typed text changes. `findNext`
  // false ⇒ Chromium starts a fresh search from the top.
  useEffect(() => {
    if (!open) return
    if (query.length === 0) {
      dispatchStop('clearSelection')
      return
    }
    void dispatchFind(query, { forward: true, findNext: false })
  }, [query, open, dispatchFind, dispatchStop])

  if (!open) return null

  const counter = totalMatches > 0
    ? `${String(activeMatch)} / ${String(totalMatches)}`
    : '0 / 0'

  return (
    <div
      className="documentation-host-search-bar"
      data-testid="documentation-host-native-find-bar"
      role="search"
    >
      <input
        ref={inputRef}
        className="documentation-host-search-bar__input"
        type="text"
        placeholder="Find in page"
        value={query}
        onChange={(e): void => { setQuery(e.target.value) }}
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
      />
      <span className="documentation-host-search-bar__counter">{counter}</span>
      <button
        type="button"
        className="documentation-host-search-bar__button"
        aria-label="Previous match"
        onClick={stepPrev}
        disabled={totalMatches === 0}
      >▲</button>
      <button
        type="button"
        className="documentation-host-search-bar__button"
        aria-label="Next match"
        onClick={stepNext}
        disabled={totalMatches === 0}
      >▼</button>
      <button
        type="button"
        className="documentation-host-search-bar__button documentation-host-search-bar__button--close"
        aria-label="Close find"
        onClick={handleClose}
      >×</button>
    </div>
  )
})

DocumentationHostNativeFind.displayName = 'DocumentationHostNativeFind'
