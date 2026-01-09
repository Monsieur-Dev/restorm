import React, { useState, useMemo, useRef, useCallback, Suspense, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { GraphRef } from 'jsoncrack-react'
import {
  Tabs,
  Button,
  MarkdownViewer,
  MarkdownEditor,
  Sash,
  ProgressBar,
  type Tab,
  type IVerticalSashLayoutProvider,
  type SashEvent
} from 'electron-core-ui/renderer'

// Lazy load Graph to avoid Monaco initialization conflicts at app startup
const Graph = React.lazy(() => import('jsoncrack-react').then(mod => ({ default: mod.Graph })))

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
}

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
  jsonData
}) => {
  const { t } = useTranslation()
  const [activeTabId, setActiveTabId] = useState('request')
  const [responseTabId, setResponseTabId] = useState(responseContent ? 'response' : 'infos')
  const [leftPaneWidth, setLeftPaneWidth] = useState(0)
  // Key counter to force Graph remount when switching to jsoncrack tab (Monaco disposal issue)
  const [graphKey, setGraphKey] = useState(0)
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
    return themeAttr === 'dark' || themeAttr === 'hcDark'
  })
  
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const sashStartLeftRef = useRef(0)
  const graphRef = useRef<GraphRef | null>(null)
  const prevResponseContentRef = useRef<typeof responseContent>(null)
  
  // Ref for onChange to avoid recreating tabs callback
  const onNotesChangeRef = useRef(onNotesChange)
  useEffect(() => { onNotesChangeRef.current = onNotesChange }, [onNotesChange])
  
  // Stable notes change handler that uses ref
  const handleNotesChange = useCallback((md: string) => {
    onNotesChangeRef.current?.(md)
  }, [])

  // Switch to response tab only when content becomes available (new response), or to infos if it disappears
  React.useEffect(() => {
    const hadContent = prevResponseContentRef.current !== null && prevResponseContentRef.current !== undefined
    const hasContent = responseContent !== null && responseContent !== undefined
    
    // New response arrived - switch to response tab
    if (!hadContent && hasContent) {
      setResponseTabId('response')
    }
    // Response disappeared - switch to infos if currently on response
    else if (hadContent && !hasContent && responseTabId === 'response') {
      setResponseTabId('infos')
    }
    
    prevResponseContentRef.current = responseContent
  }, [responseContent, responseTabId])

  // Watch for theme changes
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
  
  // Sash layout provider
  const splitLayoutProvider = useMemo<IVerticalSashLayoutProvider>(
    () => ({
      getVerticalSashLeft: () => {
        if (leftPaneWidth !== 0) return leftPaneWidth
        const width = splitContainerRef.current?.clientWidth ?? 0
        return width > 0 ? width / 2 : 0
      },
      getVerticalSashTop: () => 0,
      getVerticalSashHeight: () => splitContainerRef.current?.clientHeight ?? 0
    }),
    [leftPaneWidth]
  )
  
  const handleSashStart = useCallback(
    (_event: SashEvent): void => {
      if (leftPaneWidth !== 0) {
        sashStartLeftRef.current = leftPaneWidth
      } else if (splitContainerRef.current) {
        const width = splitContainerRef.current.clientWidth
        sashStartLeftRef.current = width > 0 ? width / 2 : 0
      }
    },
    [leftPaneWidth]
  )
  
  const handleSashChange = useCallback(
    (event: SashEvent): void => {
      if (!splitContainerRef.current) return
      const containerWidth = splitContainerRef.current.clientWidth
      const minLeft = 320
      const minRight = 260
      const maxLeft = containerWidth - minRight
      const newLeft = Math.max(minLeft, Math.min(maxLeft, sashStartLeftRef.current + event.currentX - event.startX))
      setLeftPaneWidth(newLeft)
    },
    []
  )
  
  // Handle response tab change - increment graphKey when switching to jsoncrack
  const handleResponseTabChange = useCallback((tabId: string) => {
    if (tabId === 'jsoncrack' && responseTabId !== 'jsoncrack') {
      setGraphKey(prev => prev + 1)
    }
    setResponseTabId(tabId)
  }, [responseTabId])
  
  // Build request tabs (Request, Docs, Notes, Code Snippets)
  const requestTabs: Tab[] = useMemo(() => [
    {
      id: 'request',
      label: t('requestTab.tabs.requestLayout'),
      useScrollableElement: false,
      content: requestContent
    },
    {
      id: 'docs',
      label: t('requestTab.tabs.docs'),
      useScrollableElement: false,
      content: <MarkdownViewer value={documentation ?? ''} />
    },
    {
      id: 'notes',
      label: t('requestTab.tabs.notes'),
      useScrollableElement: false,
      content: (
        <MarkdownEditor
          key={requestId}
          initialValue={notes ?? ''}
          onChange={handleNotesChange}
        />
      )
    },
    {
      id: 'codeSnippets',
      label: t('requestTab.tabs.codeSnippets'),
      useScrollableElement: false,
      content: <MarkdownViewer value={codeSnippetsContent} />
    }
  ], [requestId, notes, requestContent, documentation, handleNotesChange, codeSnippetsContent, t])

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
  
  // Build response tabs (Infos, Response, JsonCrack)
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

    const tabs: Tab[] = []
    
    // Add Response tab only if we have response content
    if (responseContent) {
      tabs.push({
        id: 'response',
        label: 'Response',
        useScrollableElement: false,
        content: (
          <div style={{ height: '100%', boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
            {responseContent}
          </div>
        )
      })
    }
    
    // Always add Infos tab
    tabs.push({
      id: 'infos',
      label: 'Infos',
      useScrollableElement: false,
      content: (
        <div style={{ height: '100%', boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
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
    
    // Add JsonCrack tab if we have JSON data
    if (formattedJson) {
      tabs.push({
        id: 'jsoncrack',
        label: t('requestTab.responses.tabs.jsoncrack'),
        useScrollableElement: false,
        content: (
          <div
            style={{
              boxSizing: 'border-box',
              padding: '8px 0px 0px 8px',
              width: '100%',
              height: '100%',
              overflow: 'hidden'
            }}
            onWheelCapture={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const api = graphRef.current
              if (!api) return
              if (event.deltaY < 0) {
                api.zoomIn()
              } else if (event.deltaY > 0) {
                api.zoomOut()
              }
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
              <div style={{
                flex: 1,
                minHeight: 0,
                border: '1px solid var(--panel-border)',
                borderRadius: 3,
                boxSizing: 'border-box',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 4,
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  zIndex: 1
                }}>
                  <Button
                    secondary
                    small
                    icon="zoom-in"
                    options={{ ariaLabel: 'Zoom in', title: 'Zoom in' }}
                    onClick={() => { graphRef.current?.zoomIn() }}
                  />
                  <Button
                    secondary
                    small
                    icon="zoom-out"
                    options={{ ariaLabel: 'Zoom out', title: 'Zoom out' }}
                    onClick={() => { graphRef.current?.zoomOut() }}
                  />
                  <Button
                    secondary
                    small
                    icon="screen-full"
                    options={{ ariaLabel: 'Center view', title: 'Center view' }}
                    onClick={() => { graphRef.current?.centerView() }}
                  />
                </div>
                <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><i className="codicon codicon-loading codicon-modifier-spin" /></div>}>
                  <Graph
                    key={graphKey}
                    ref={graphRef}
                    json={formattedJson || '{}'}
                    layout={{ theme: isDarkTheme ? 'dark' : 'light' }}
                    style={{ width: '100%', height: '100%' }}
                  />
                </Suspense>
              </div>
            </div>
          </div>
        )
      })
    }
    
    return tabs
  }, [showResponse, isLoading, infosContent, responseContent, formattedJson, isDarkTheme, graphKey, t])
  
  const showResponsePanel = showResponse || isLoading
  
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 8, 
      width: '100%', 
      height: '100%', 
      padding: '8px 0', 
      boxSizing: 'border-box' 
    }}>
      {/* URL Section */}
      {urlSection}
      
      {/* Progress Bar */}
      <div style={{ width: '100%', height: 4 }}>
        {isLoading && <ProgressBar mode="infinite" />}
      </div>
      
      {/* Main Content with Split */}
      <div 
        ref={splitContainerRef} 
        style={{ 
          flex: 1, 
          minHeight: 0, 
          display: 'flex', 
          position: 'relative', 
          overflow: 'hidden' 
        }}
      >
        {/* Request Tabs Pane */}
        <div style={{ 
          width: showResponsePanel ? (leftPaneWidth !== 0 ? leftPaneWidth : '50%') : '100%',
          minWidth: 320,
          maxWidth: showResponsePanel ? '80%' : '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <Tabs 
            tabs={requestTabs} 
            activeTabId={activeTabId} 
            onTabChange={setActiveTabId}
            keepMounted
          />
        </div>
        
        {/* Response Pane */}
        {showResponsePanel && (
          <>
            <Sash
              orientation="vertical"
              layoutProvider={splitLayoutProvider}
              onStart={handleSashStart}
              onChange={handleSashChange}
              size={4}
            />
            <div style={{ 
              flex: 1,
              minWidth: 260,
              minHeight: 0, 
              display: 'flex', 
              flexDirection: 'column', 
              marginLeft: 4,
              overflow: 'hidden'
            }}>
              {/* Response Tabs (Response, Infos, JsonCrack) */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Tabs 
                  tabs={responseTabs} 
                  activeTabId={responseTabId} 
                  onTabChange={handleResponseTabChange} 
                />
              </div>
              
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default BaseRequestTabView
