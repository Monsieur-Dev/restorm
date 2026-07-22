import React, { useState, useMemo, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  MarkdownViewer,
  MarkdownEditor,
  VerticalSashContainer,
  JsonViewer,
  eventBus,
  fieldDiffStyle,
  type Tab
} from 'electron-core-ui/renderer'
import { DocumentEvents } from '../../services/DocumentEvents'

// ============================================================================
// Types
// ============================================================================

export interface BaseRequestTabViewProps {
  /** Unique ID of the request (used to reset notes editor when switching requests) */
  requestId: string
  /** URL input section (verb select + URL input + send / run button).
   * Rendered as the first row of the Request sub-tab content; the
   * progress bar (if any) sits above the tab strip. Each protocol
   * passes its own composed UI here so the host doesn't need to
   * know about HTTP / GraphQL / gRPC / SOAP / OData / WebSocket
   * specifics. */
  urlSection: ReactNode
  /** Content for the "Request" tab */
  requestContent: ReactNode
  /** Code snippets markdown content */
  codeSnippetsContent: string
  /** Structured documentation viewer rendered as the Docs tab. Set
   * by the per-protocol RequestTabView using `<DocumentationHost />`
   * with the request's resolved route as the filter. */
  docsContent?: ReactNode | undefined
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
  /** JSON data for the Graph tab (if any) */
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
  /** Seeds the INITIAL request-side tab, then lets the user freely switch
   * tabs afterward — unlike `activeRequestTabId` (which is fully
   * controlled: once passed, the caller owns every subsequent selection),
   * this only affects `useState`'s initial value. Mirrors
   * `BaseFolderView`'s `defaultActiveTabId`. Used by the conflict-
   * resolution panel to preselect the tab holding the conflicting field
   * (AC#5) without locking the user out of exploring other tabs. Defaults
   * to `'request'`. */
  defaultActiveTabId?: string
  /** Conflict-resolution field-diff (AC#4): red-borders the Notes editor
   * (`fieldDiffStyle`) — mirrors `BaseFolderView`'s matching prop. Only
   * ever set by `ConflictEntityPanel`; `undefined`/`false` in the live
   * (non-conflict) editor. */
  notesDiffers?: boolean
  /** Conflict resolution: restrict the request-side strip to these tab ids.
   * A conflict view shows what is contested and nothing else — a tab with
   * no divergence is noise the user has to rule out by hand. `undefined`
   * (the live editor) keeps every tab. An empty array hides the strip
   * entirely, which is the "only the name changed" case. */
  visibleRequestTabIds?: string[]
  /** Conflict resolution: tabs appended to the request-side strip that the
   * live editor has no equivalent for (today: the contested tag list).
   * Filtered by `visibleRequestTabIds` like every other tab. */
  extraRequestTabs?: Tab[]
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
  docsContent,
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
  initialLeftRatio,
  defaultActiveTabId,
  notesDiffers,
  visibleRequestTabIds,
  extraRequestTabs
}) => {
  const { t } = useTranslation()
  const [internalActiveTabId, setInternalActiveTabId] = useState(defaultActiveTabId ?? 'request')
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

  // In-flight indicator: announce execution start/end (on `isLoading`) so the
  // request's sidebar badge runs the border-beam. The in-tab progress bar was
  // removed in favour of the beam (Send button + sidebar badge).
  useEffect(() => {
    if (!isLoading) return undefined
    eventBus.emitLocalSync(DocumentEvents.REQUEST_EXECUTION_STARTED, { requestId })
    return () => { eventBus.emitLocalSync(DocumentEvents.REQUEST_EXECUTION_ENDED, { requestId }) }
  }, [isLoading, requestId])

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

  const hasDocs = docsContent !== undefined && docsContent !== null

  // Build request tabs (Request, Docs, Notes, Code Snippets)
  const requestTabs: Tab[] = useMemo(() => {
    // The URL bar (verb select + URL input + send/run button) is
    // rendered INSIDE the Request tab so the affordance only shows
    // when the user is actually editing the request — not over the
    // Docs / Notes / Code snippets tabs where it would be off-topic.
    // The protocol-specific tab views still pass it via the
    // `urlSection` prop; placement is the host's call.
    const requestTabContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0 }}>
        {/* `marginTop` reserves a small visual gap between the tab
         * strip above and the URL controls — without it the verb
         * select + URL input would butt up against the active-tab
         * underline on the Request strip. */}
        <div style={{ marginTop: 8 }}>{urlSection}</div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {requestContent}
        </div>
      </div>
    )
    const tabs: Tab[] = [
      {
        id: 'request',
        label: t('requestTab.tabs.requestLayout'),
        useScrollableElement: false,
        content: requestTabContent
      }
    ]

    if (additionalRequestTabs && additionalRequestTabs.length > 0) {
      for (const extra of additionalRequestTabs) tabs.push(extra)
    }

    if (hasDocs) {
      tabs.push({
        id: 'docs',
        label: t('requestTab.tabs.docs'),
        // Wrap in ECUI's `ScrollableElement` (Monaco-style scrollbars)
        // so a long doc — model graph + responses + parameters table
        // + payload examples — scrolls naturally inside the tab
        // without inheriting the outer workbench scrollbar.
        useScrollableElement: true,
        content: docsContent
      })
    }

    if (showNotes) {
      tabs.push({
        id: 'notes',
        label: t('requestTab.tabs.notes'),
        useScrollableElement: false,
        content: (
          <div style={{ height: '100%', boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!notesDiffers) }}>
            <MarkdownEditor
              key={requestId}
              initialValue={notes ?? ''}
              onChange={handleNotesChange}
              data-testid="base-request-markdown-editor-notes"
            />
          </div>
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

    if (extraRequestTabs) tabs.push(...extraRequestTabs)
    if (!visibleRequestTabIds) return tabs
    return tabs.filter((tab) => visibleRequestTabIds.includes(tab.id))
  }, [requestId, notes, requestContent, urlSection, docsContent, hasDocs, handleNotesChange, codeSnippetsContent, additionalRequestTabs, showNotes, showCodeSnippets, notesDiffers, visibleRequestTabIds, extraRequestTabs, t])

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

  // Build response tabs (Response, Infos, Graph)
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

    // Shown on the body-bearing tabs (Response / Graph) once the request has
    // resolved but produced no body — e.g. a connection error or an empty
    // response. Distinct from `loadingPlaceholder`: the "Sending…" text must
    // never linger past resolution, and the error details live on Infos.
    const noResponseBodyPlaceholder = (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--descriptionForeground)'
      }}>
        {t('requestTab.responses.noResponseBody')}
      </div>
    )

    // A resolved-but-empty body shows the no-body notice; the "Sending…"
    // placeholder is reserved for a genuinely in-flight request.
    const emptyBodyPlaceholder = isLoading ? loadingPlaceholder : noResponseBodyPlaceholder

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
            {responseContent ?? emptyBodyPlaceholder}
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

    // Show Graph tab once it has been seen at least once
    if (formattedJson || hadJsonOnce) {
      tabs.push({
        id: 'graph',
        label: t('requestTab.responses.tabs.graph'),
        useScrollableElement: false,
        content: formattedJson ? (
          <JsonViewer
            json={formattedJson}
            darkTheme={isDarkTheme}
            minimapToggleLabel={t('scenario.minimap.toggle')}
            data-testid="base-request-graph"
          />
        ) : emptyBodyPlaceholder
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
        gap: 4,
        width: '100%',
        height: '100%',
        padding: '0 0 8px 0',
        boxSizing: 'border-box'
      }}
    >
      {/* The URL section (verb select + URL input + send/run) is rendered
       * inside the Request tab itself — see `requestTabs` above. The in-flight
       * indicator is no longer a progress bar here: it's the border-beam on the
       * Send button + on the request's sidebar badge (driven by `isLoading`
       * via REQUEST_EXECUTION_* events, see the effect above). */}

      {useCompactLayout ? (
        /* Compact: single tab group with all tabs merged */
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Tabs
            data-testid="base-request-tabs-request"
            tabs={mergedTabs}
            activeTabId={effectiveCompactTabId}
            onTabChange={handleCompactTabChange}
            mountStrategy="lazy-once"
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
                mountStrategy="lazy-once"
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
                mountStrategy="lazy-once"
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
            mountStrategy="lazy-once"
          />
        </div>
      )}
    </div>
  )
}
