import React, { useState, useMemo, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  MarkdownViewer,
  MarkdownEditor,
  VerticalSashContainer,
  ProgressBar,
  type Tab
} from 'electron-core-ui/renderer'
import { JsonViewer } from '../common/JsonViewer'

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

  React.useEffect(() => {
    const hadContent = prevResponseContentRef.current !== null && prevResponseContentRef.current !== undefined
    const hasContent = responseContent !== null && responseContent !== undefined
    
    if (!hadContent && hasContent) {
      setResponseTabId('response')
    }
    else if (hadContent && !hasContent && responseTabId === 'response') {
      setResponseTabId('infos')
    }
    
    prevResponseContentRef.current = responseContent
  }, [responseContent, responseTabId])

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
  
  // Handle response tab change
  const handleResponseTabChange = useCallback((tabId: string) => {
    setResponseTabId(tabId)
  }, [])
  
  // Build request tabs (Request, Docs, Notes, Code Snippets)
  const requestTabs: Tab[] = useMemo(() => {
    const tabs: Tab[] = [
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
      content: <MarkdownViewer value={documentation ?? ''} data-testid="base-request-markdown-viewer-docs" />
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
          data-testid="base-request-markdown-editor-notes"
        />
      )
      },
      {
      id: 'codeSnippets',
      label: t('requestTab.tabs.codeSnippets'),
      useScrollableElement: false,
      content: <MarkdownViewer value={codeSnippetsContent} data-testid="base-request-markdown-viewer-code-snippets" />
      }
    ]

    return tabs
  }, [requestId, notes, requestContent, documentation, handleNotesChange, codeSnippetsContent, t])

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
          <JsonViewer
            json={formattedJson}
            darkTheme={isDarkTheme}
            data-testid="base-request-jsoncrack"
          />
        )
      })
    }
    
    return tabs
  }, [showResponse, isLoading, infosContent, responseContent, formattedJson, isDarkTheme, t])
  
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
        {isLoading && <ProgressBar mode="infinite" data-testid="base-request-progress-bar" />}
      </div>
      
      {showResponsePanel ? (
        <VerticalSashContainer
          data-testid="base-request-sash-container"
          Left={
            <div style={{ 
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              minWidth: 0
            }}>
              <Tabs 
                data-testid="base-request-tabs-request"
                tabs={requestTabs} 
                activeTabId={activeTabId} 
                onTabChange={setActiveTabId}
                keepMounted
              />
            </div>
          }
          Right={
            <div style={{ 
              minHeight: 0, 
              display: 'flex', 
              flexDirection: 'column', 
              overflow: 'hidden'
            }}>
              <Tabs 
                data-testid="base-request-tabs-response"
                tabs={responseTabs} 
                activeTabId={responseTabId} 
                onTabChange={handleResponseTabChange} 
              />
            </div>
          }
          initialWidth={500}
          minLeftWidth={320}
          minRightWidth={260}
          sashConfig={{ size: 4 }}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Tabs 
            data-testid="base-request-tabs-request"
            tabs={requestTabs} 
            activeTabId={activeTabId} 
            onTabChange={setActiveTabId}
            keepMounted
          />
        </div>
      )}
    </div>
  )
}

export default BaseRequestTabView
