import React, { useState, useMemo, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  MarkdownViewer,
  MarkdownEditor,
  VerticalSashContainer,
  ProgressBar,
  JsonViewer,
  type Tab
} from 'electron-core-ui/renderer'

// ============================================================================
// Types
// ============================================================================

export interface BaseRequestTabViewProps {
  /** Unique ID of the request (used to reset notes editor when switching requests) */
  requestId: string
  /** URL input section (rendered above tabs) */
  urlSection: ReactNode
  /** Content for the "Request" tab */
  requestContent: ReactNode
  /** Code snippets markdown content */
  codeSnippetsContent: string
  /** Request documentation (for Docs tab) */
  documentation?: string | undefined
  /** Request notes (for Notes tab) */
  notes?: string | undefined
  /** Callback when notes change */
  onNotesChange?: ((notes: string) => void) | undefined
  /** Whether request is in progress */
  isLoading: boolean
  /** Whether to show response panel */
  showResponse: boolean
  /** Content for the "Infos" tab in response panel */
  infosContent?: ReactNode | undefined
  /** Content for the "Response" tab in response panel */
  responseContent?: ReactNode | undefined
  /** JSON data for JsonCrack tab (if any) */
  jsonData?: unknown
  /** Extra request-side tabs inserted after the "Request" tab and
   * before Docs. Each tab is rendered verbatim. Used by the auth
   * request tab view to expose a "Configuration" tab. */
  additionalRequestTabs?: Tab[] | undefined
  /** Hide the Notes tab. Defaults to `true` (visible). Set to `false`
   * for ephemeral views — e.g. the import wizard's auth setup modal —
   * where per-request markdown notes aren't persisted and an empty
   * editor would just clutter the tab bar. */
  showNotes?: boolean
  /** Hide the Code Snippets tab. Defaults to `true` (visible). Set
   * to `false` for views where snippet generation isn't wired (the
   * auth modal doesn't hit ContextService, so snippets would always
   * be empty). */
  showCodeSnippets?: boolean
  /** Controlled active request-side tab id. When set, the caller
   * owns the selection (useful to programmatically jump to a tab on
   * an external event — e.g. switching to Configuration after a
   * successful Send). Paired with `onRequestTabChange`; if only one
   * is provided the component falls back to internal state. */
  activeRequestTabId?: string
  /** Fires when the user clicks a request-side tab. Paired with
   * `activeRequestTabId` for controlled mode. */
  onRequestTabChange?: (tabId: string) => void
  /** Override the default left-panel initial width ratio (0–1) used
   * when the response panel is visible. Defaults to an absolute
   * `initialWidth={500}` that suits the main tab view; the auth
   * modal (narrower container) overrides to `0.5` for a 50/50 split. */
  initialLeftRatio?: number
}

const COMPACT_BREAKPOINT = 750

// ============================================================================
// Component
// ============================================================================

export const BaseRequestTabView: React.FC<BaseRequestTabViewProps> = ({
  requestId,
  urlSection,
  requestContent,
  codeSnippetsContent,
  documentation,
  notes,
  onNotesChange,
  isLoading,
  showResponse,
  infosContent,
  responseContent,
  jsonData,
  additionalRequestTabs,
  showNotes = true,
  showCodeSnippets = true,
  activeRequestTabId,
  onRequestTabChange,
  initialLeftRatio
}) => {
  const { t } = useTranslation()
  const [internalActiveTabId, setInternalActiveTabId] = useState('request')
  const activeTabId = activeRequestTabId ?? internalActiveTabId
  const setActiveTabId = useCallback((tabId: string) => {
    if (onRequestTabChange) onRequestTabChange(tabId)
    if (activeRequestTabId === undefined) setInternalActiveTabId(tabId)
  }, [onRequestTabChange, activeRequestTabId])
  const [responseTabId, setResponseTabId] = useState('response')
  const [isCompact, setIsCompact] = useState(false)
  const [hadResponseOnce, setHadResponseOnce] = useState(!!responseContent)
  const [hadJsonOnce, setHadJsonOnce] = useState(!!jsonData)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
    return themeAttr === 'dark' || themeAttr === 'hcDark'
  })

  const prevResponseContentRef = useRef<typeof responseContent>(null)

  const onNotesChangeRef = useRef(onNotesChange)
  useEffect(() => { onNotesChangeRef.current = onNotesChange }, [onNotesChange])

  const handleNotesChange = useCallback((md: string) => {
    onNotesChangeRef.current?.(md)
  }, [])

  // Track when response/json content appears — once seen, keep tabs visible
  if (responseContent && !hadResponseOnce) {
    setHadResponseOnce(true)
  }
  if (jsonData && !hadJsonOnce) {
    setHadJsonOnce(true)
  }

  // Keep prevResponseContentRef in sync (used only for hadResponseOnce tracking above)
  React.useEffect(() => {
    prevResponseContentRef.current = responseContent
  }, [responseContent])

  // Theme detection
  React.useEffect(() => {
    if (typeof document === 'undefined') return

    const handleThemeChange = (): void => {
      const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
      const dark = themeAttr === 'dark' || themeAttr === 'hcDark'
      setIsDarkTheme(dark)
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          handleThemeChange()
        }
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    handleThemeChange()

    return () => {
      observer.disconnect()
    }
  }, [])

  // Responsive: measure container width
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsCompact(entry.contentRect.width < COMPACT_BREAKPOINT)
      }
    })

    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])

  // Handle response tab change
  const handleResponseTabChange = useCallback((tabId: string) => {
    setResponseTabId(tabId)
  }, [])

  // The Docs tab is hidden when there is no documentation to show — both the
  // compiled-from-apiDocumentation variant and the user-authored
  // `request.documentation` funnel through the same prop, so an empty string
  // means "nothing to render".
  const hasDocs = (documentation ?? '').trim().length > 0

  // Build request tabs (Request, Docs, Notes, Code Snippets)
  const requestTabs: Tab[] = useMemo(() => {
    const tabs: Tab[] = [
      {
        id: 'request',
        label: t('requestTab.tabs.requestLayout'),
        useScrollableElement: false,
        content: requestContent
      }
    ]

    if (additionalRequestTabs && additionalRequestTabs.length > 0) {
      for (const extra of additionalRequestTabs) tabs.push(extra)
    }

    if (hasDocs) {
      tabs.push({
        id: 'docs',
        label: t('requestTab.tabs.docs'),
        useScrollableElement: false,
        content: <MarkdownViewer value={documentation ?? ''} data-testid="base-request-markdown-viewer-docs" />
      })
    }

    if (showNotes) {
      tabs.push({
        id: 'notes',
        label: t('requestTab.tabs.notes'),
        useScrollableElement: false,
        content: (
          <MarkdownEditor
            key={requestId}
            initialValue={notes ?? ''}
            onChange={handleNotesChange}
            data-testid="base-request-markdown-editor-notes"
          />
        )
      })
    }

    if (showCodeSnippets) {
      tabs.push({
        id: 'codeSnippets',
        label: t('requestTab.tabs.codeSnippets'),
        useScrollableElement: false,
        content: <MarkdownViewer value={codeSnippetsContent} data-testid="base-request-markdown-viewer-code-snippets" />
      })
    }

    return tabs
  }, [requestId, notes, requestContent, documentation, hasDocs, handleNotesChange, codeSnippetsContent, additionalRequestTabs, showNotes, showCodeSnippets, t])

  // If the active tab vanishes (e.g., user was on Docs and the request's URL
  // changed so no operation matches anymore), fall back to the Request tab
  // during render — avoids a sync setState inside an effect.
  const effectiveActiveTabId = activeTabId === 'docs' && !hasDocs ? 'request' : activeTabId

  // Same guard for the response-side tabs: the default `responseTabId`
  // state is `'response'`, but on an error (no body → no Response tab)
  // only `infos` is pushed. Without this fallback `Tabs` receives an
  // activeTabId that matches no tab and renders an empty panel.

  // Format JSON for display
  const formattedJson = useMemo(() => {
    if (jsonData === undefined || jsonData === null) return ''
    if (typeof jsonData === 'string') {
      try {
        const parsed: unknown = JSON.parse(jsonData)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return jsonData
      }
    }
    return JSON.stringify(jsonData, null, 2)
  }, [jsonData])

  // Build response tabs (Response, Infos, JsonCrack)
  const responseTabs: Tab[] = useMemo(() => {
    const hasResponse = showResponse || isLoading

    if (!hasResponse) {
      return [{
        id: 'empty',
        label: t('requestTab.responses.tabs.response'),
        useScrollableElement: false,
        content: (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--descriptionForeground)'
          }}>
            {t('requestTab.responses.noResponse')}
          </div>
        )
      }]
    }

    const loadingPlaceholder = (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--descriptionForeground)'
      }}>
        {t('requestTab.responses.loading')}
      </div>
    )

    const tabs: Tab[] = []

    // Show Response tab once it has been seen at least once
    if (responseContent || hadResponseOnce) {
      tabs.push({
        id: 'response',
        label: 'Response',
        useScrollableElement: false,
        content: (
          // Flex column with minHeight: 0 so the CodeEditor (height: 100%)
          // inside `responseContent` can actually shrink below its
          // intrinsic content size when the modal is compressed — a
          // plain `height: 100%` wrapper leaks the flex child's natural
          // minimum, which is what was pushing Monaco below the frame.
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
            {responseContent ?? loadingPlaceholder}
          </div>
        )
      })
    }

    tabs.push({
      id: 'infos',
      label: 'Infos',
      // Scroll via the shared ecu container so a tall tree of
      // response/request headers can be read inside a constrained
      // modal without leaking past the frame.
      useScrollableElement: true,
      content: (
        <div style={{ boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
          {infosContent ?? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--descriptionForeground)'
            }}>
              {isLoading ? t('requestTab.responses.loading') : t('requestTab.responses.noResponse')}
            </div>
          )}
        </div>
      )
    })

    // Show JsonCrack tab once it has been seen at least once
    if (formattedJson || hadJsonOnce) {
      tabs.push({
        id: 'jsoncrack',
        label: t('requestTab.responses.tabs.jsoncrack'),
        useScrollableElement: false,
        content: formattedJson ? (
          <JsonViewer
            json={formattedJson}
            darkTheme={isDarkTheme}
            data-testid="base-request-jsoncrack"
          />
        ) : loadingPlaceholder
      })
    }

    return tabs
  }, [showResponse, isLoading, infosContent, responseContent, formattedJson, isDarkTheme, hadResponseOnce, hadJsonOnce, t])

  // Fall back to the first available response tab when the current
  // `responseTabId` points to one that doesn't exist (e.g. we default
  // to `'response'` but an error path only produces `'infos'`).
  const effectiveResponseTabId = responseTabs.some((tab) => tab.id === responseTabId)
    ? responseTabId
    : responseTabs[0]?.id ?? responseTabId

  // Compact mode: merge request + response tabs into a single group
  const showResponsePanel = showResponse || isLoading
  const useCompactLayout = isCompact && showResponsePanel

  // Track left/right selections independently.
  // In compact mode, a single Tabs component uses `compactTabId` derived from both.
  // leftTabId = activeTabId (already maintained above)
  // rightTabId = responseTabId (already maintained above)

  // Compute compact tab: in compact mode, show the right tab if valid, else left tab.
  // This is computed per-render, not in an effect.
  const [compactTabId, setCompactTabId] = useState<string | null>(null)
  const [prevCompact, setPrevCompact] = useState(false)

  // Detect layout transitions during render (no setState in effect)
  if (useCompactLayout && !prevCompact) {
    // Entering compact: pick right tab if available
    const rightValid = responseTabId && responseTabs.some(tab => tab.id === responseTabId)
    const newCompactTab = rightValid ? responseTabId : activeTabId
    if (compactTabId !== newCompactTab) {
      setCompactTabId(newCompactTab)
    }
    setPrevCompact(true)
  } else if (!useCompactLayout && prevCompact) {
    // Leaving compact: restore left/right from compactTabId
    if (compactTabId) {
      const isResponseTab = responseTabs.some(tab => tab.id === compactTabId)
      if (isResponseTab) {
        setResponseTabId(compactTabId)
      } else {
        setActiveTabId(compactTabId)
      }
    }
    setPrevCompact(false)
    setCompactTabId(null)
  }

  const compactSelection = compactTabId ?? activeTabId
  const effectiveCompactTabId = compactSelection === 'docs' && !hasDocs ? 'request' : compactSelection

  const mergedTabs = useMemo(() => {
    if (!useCompactLayout) return requestTabs
    return [...requestTabs, ...responseTabs]
  }, [useCompactLayout, requestTabs, responseTabs])

  const handleCompactTabChange = useCallback((tabId: string) => {
    setCompactTabId(tabId)
    // Also track in left/right for restore when leaving compact
    const isResponseTab = responseTabs.some(tab => tab.id === tabId)
    if (isResponseTab) {
      setResponseTabId(tabId)
    } else {
      setActiveTabId(tabId)
    }
  }, [responseTabs, setActiveTabId])

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        height: '100%',
        padding: '8px 0',
        boxSizing: 'border-box'
      }}
    >
      {/* URL Section */}
      {urlSection}

      {/* Progress Bar */}
      <div style={{ width: '100%', height: 4 }}>
        {isLoading && <ProgressBar mode="infinite" data-testid="base-request-progress-bar" />}
      </div>

      {useCompactLayout ? (
        /* Compact: single tab group with all tabs merged */
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Tabs
            data-testid="base-request-tabs-request"
            tabs={mergedTabs}
            activeTabId={effectiveCompactTabId}
            onTabChange={handleCompactTabChange}
            keepMounted
          />
        </div>
      ) : showResponsePanel ? (
        <VerticalSashContainer
          data-testid="base-request-sash-container"
          Left={
            <div style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              minWidth: 0
            }}>
              <Tabs
                data-testid="base-request-tabs-request"
                tabs={requestTabs}
                activeTabId={effectiveActiveTabId}
                onTabChange={setActiveTabId}
                keepMounted
              />
            </div>
          }
          Right={
            <div style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}>
              <Tabs
                data-testid="base-request-tabs-response"
                tabs={responseTabs}
                activeTabId={effectiveResponseTabId}
                onTabChange={handleResponseTabChange}
                keepMounted
              />
            </div>
          }
          initialWidth={500}
          {...(initialLeftRatio !== undefined ? { initialLeftRatio } : {})}
          minLeftWidth={320}
          minRightWidth={260}
          sashConfig={{ size: 4 }}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Tabs
            data-testid="base-request-tabs-request"
            tabs={requestTabs}
            activeTabId={effectiveActiveTabId}
            onTabChange={setActiveTabId}
            keepMounted
          />
        </div>
      )}
    </div>
  )
}
