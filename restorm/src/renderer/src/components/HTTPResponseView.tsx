import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Graph, type GraphRef } from 'jsoncrack-react'
import {
  Tabs,
  Button,
  ListView,
  CodeEditor,
  Tooltip
} from 'electron-core-ui/renderer'
import type { Tab, ListViewItemData } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import './responsesView.css'
import { HttpMethodBadge } from './HttpMethodBadge'
import type { HTTPResponse, KeyValue } from '../types/collections'

export interface HTTPResponseViewProps {
  /** The HTTP response to display */
  response: HTTPResponse | null
  /** Request title for modal display */
  requestTitle: string
  /** Whether a request is currently in progress */
  isLoading?: boolean
}

/** Format duration in a human-readable way */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

/** Format bytes in a human-readable way */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Format date in a human-readable way */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString)
    return date.toLocaleString()
  } catch {
    return isoString
  }
}

/** Get status color based on status code */
function getStatusColor(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) {
    return 'var(--vscode-testing-iconPassed, #73c991)'
  }
  if (statusCode >= 300 && statusCode < 400) {
    return 'var(--vscode-editorWarning-foreground, #cca700)'
  }
  if (statusCode >= 400) {
    return 'var(--vscode-testing-iconFailed, #f14c4c)'
  }
  return 'var(--vscode-foreground)'
}

/** Status code badge with tooltip showing description */
const StatusCodeBadge: React.FC<{ statusCode: number; statusText: string }> = ({
  statusCode,
  statusText
}) => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLSpanElement>(null)
  const [showTooltip, setShowTooltip] = useState(false)

  const statusKey = `httpStatus.${statusCode}`
  const statusName = t(`${statusKey}.name`, { defaultValue: '' })
  const statusDescription = t(`${statusKey}.description`, {
    defaultValue: t('httpStatus.unknown.description')
  })

  const tooltipContent = (
    <div style={{ maxWidth: 300 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
        {statusCode} {statusName || statusText}
      </div>
      <div style={{ fontSize: 12, opacity: 0.9 }}>{statusDescription}</div>
    </div>
  )

  return (
    <>
      <span
        ref={containerRef}
        className="response-value"
        style={{
          color: getStatusColor(statusCode),
          cursor: 'help',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textUnderlineOffset: 2
        }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {statusCode} {statusText}
      </span>
      <Tooltip
        targetRef={containerRef}
        content={tooltipContent}
        show={showTooltip}
        placement="below"
      />
    </>
  )
}

/** Convert KeyValue array to ListView items */
function keyValuesToListItems(keyValues: KeyValue[], prefix: string): ListViewItemData[] {
  return keyValues.map((kv, index) => ({
    id: `${prefix}-${index}`,
    icon: 'blank',
    title: (
      <span style={{ display: 'flex', gap: 8 }}>
        <span className="response-key">{kv.key}</span>
        <span className="response-value">{kv.value}</span>
      </span>
    )
  }))
}

export const HTTPResponseView: React.FC<HTTPResponseViewProps> = ({
  response,
  requestTitle,
  isLoading = false
}) => {
  const { t } = useTranslation()
  const [activeTabId, setActiveTabId] = useState<string>('response-summary')
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
    return themeAttr === 'dark' || themeAttr === 'hcDark'
  })

  const graphRef = useRef<GraphRef | null>(null)

  // Auto-select tab based on response status
  useEffect(() => {
    if (!response) return

    const isSuccess = response.statusCode >= 200 && response.statusCode < 300
    const hasBody = response.responseBody && response.responseBody.trim().length > 0

    if (isSuccess && hasBody) {
      setActiveTabId('raw')
    } else {
      setActiveTabId('response-summary')
    }
  }, [response])

  const renderModalTitle = useCallback(
    (suffix: string): React.ReactNode => {
      const parts = requestTitle.split(' ')
      const method = parts[0] ?? 'GET'
      const path = parts.slice(1).join(' ') || requestTitle

      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <HttpMethodBadge method={method.toUpperCase()} />
          <span>
            {path}
            {suffix ? ` - ${suffix}` : ''}
          </span>
        </span>
      )
    },
    [requestTitle]
  )

  useEffect(() => {
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

  // Build general info items
  const generalItems: ListViewItemData[] = useMemo(() => {
    if (!response) return []

    const items: ListViewItemData[] = [
      {
        id: 'general-request-url',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Request URL</span>
            <span className="response-value">{response.requestUrl}</span>
          </span>
        )
      },
      {
        id: 'general-request-method',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Request Method</span>
            <span className="response-value">{response.requestMethod}</span>
          </span>
        )
      },
      {
        id: 'general-status-code',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Status Code</span>
            <StatusCodeBadge statusCode={response.statusCode} statusText={response.statusText} />
          </span>
        )
      },
      {
        id: 'general-duration',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Duration</span>
            <span className="response-value">{formatDuration(response.timings.durationMs)}</span>
          </span>
        )
      },
      {
        id: 'general-started-at',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Started At</span>
            <span className="response-value">{formatDate(response.timings.startedAt)}</span>
          </span>
        )
      }
    ]

    if (response.contentType) {
      items.push({
        id: 'general-content-type',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Content-Type</span>
            <span className="response-value">{response.contentType}</span>
          </span>
        )
      })
    }

    if (response.contentLength !== undefined) {
      items.push({
        id: 'general-content-length',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Content-Length</span>
            <span className="response-value">{formatBytes(response.contentLength)}</span>
          </span>
        )
      })
    }

    if (response.network?.remoteAddress) {
      items.push({
        id: 'general-remote-address',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Remote Address</span>
            <span className="response-value">{response.network.remoteAddress}</span>
          </span>
        )
      })
    }

    if (response.network?.protocol) {
      items.push({
        id: 'general-protocol',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Protocol</span>
            <span className="response-value">{response.network.protocol}</span>
          </span>
        )
      })
    }

    if (response.referrerPolicy) {
      items.push({
        id: 'general-referrer-policy',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Referrer Policy</span>
            <span className="response-value">{response.referrerPolicy}</span>
          </span>
        )
      })
    }

    if (response.error) {
      items.push({
        id: 'general-error',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Error</span>
            <span className="response-value" style={{ color: 'var(--vscode-testing-iconFailed)' }}>
              {response.error}
            </span>
          </span>
        )
      })
    }

    return items
  }, [response])

  // Build response headers items
  const responseHeaderItems = useMemo(() => {
    if (!response) return []
    return keyValuesToListItems(response.responseHeaders, 'resp-header')
  }, [response])

  // Build request headers items
  const requestHeaderItems = useMemo(() => {
    if (!response) return []
    return keyValuesToListItems(response.requestHeaders, 'req-header')
  }, [response])

  // Build headers tree
  const headersItems: ListViewItemData[] = useMemo(
    () => [
      {
        id: 'group-general',
        title: 'General',
        icon: 'info',
        isExpandable: true,
        isExpanded: true,
        children: generalItems
      },
      {
        id: 'group-response-headers',
        title: `Response headers (${responseHeaderItems.length})`,
        icon: 'call-incoming',
        isExpandable: true,
        isExpanded: true,
        children: responseHeaderItems
      },
      {
        id: 'group-request-headers',
        title: `Request headers (${requestHeaderItems.length})`,
        icon: 'call-outgoing',
        isExpandable: true,
        isExpanded: true,
        children: requestHeaderItems
      }
    ],
    [generalItems, responseHeaderItems, requestHeaderItems]
  )

  // Format response body for display
  const formattedResponseBody = useMemo(() => {
    if (!response) return ''
    const body = response.responseBody

    // Try to pretty-print JSON
    if (response.contentType?.includes('application/json')) {
      try {
        const parsed: unknown = JSON.parse(body)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return body
      }
    }

    return body
  }, [response])

  const tabs = useMemo<Tab[]>(() => {
    if (!response) {
      return [
        {
          id: 'empty',
          label: t('requestTab.responses.tabs.response'),
          useScrollableElement: false,
          content: (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--vscode-descriptionForeground)'
              }}
            >
              {isLoading
                ? t('requestTab.responses.loading')
                : t('requestTab.responses.noResponse')}
            </div>
          )
        }
      ]
    }

    return [
      {
        id: 'response-summary',
        label: 'Infos',
        useScrollableElement: false,
        allowFullscreen: true,
        fullscreenModalTitle: renderModalTitle('Response infos'),
        content: (
          <div
            style={{
              height: '100%',
              boxSizing: 'border-box',
              padding: '8px 0px 0px 8px'
            }}
          >
            <ListView
              items={headersItems}
              rootRole="tree"
              ariaLabel="HTTP request and response headers"
            />
          </div>
        )
      },
      {
        id: 'raw',
        label: 'Response',
        useScrollableElement: false,
        allowFullscreen: true,
        fullscreenModalTitle: renderModalTitle('Response'),
        content: (
          <div
            style={{
              padding: '8px 0px 0px 8px',
              boxSizing: 'border-box',
              width: '100%',
              height: '100%'
            }}
          >
            <div
              style={{
                height: '100%',
                border: '1px solid var(--vscode-panel-border, #3c3c3c)',
                borderRadius: 3,
                boxSizing: 'border-box'
              }}
            >
              <CodeEditor
                height="100%"
                language="json"
                value={formattedResponseBody}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  readOnly: true
                }}
              />
            </div>
          </div>
        )
      },
      {
        id: 'jsoncrack',
        label: t('requestTab.responses.tabs.jsoncrack'),
        useScrollableElement: false,
        allowFullscreen: true,
        fullscreenModalTitle: renderModalTitle('Response JSONCrack'),
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
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                height: '100%'
              }}
            >
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  border: '1px solid var(--vscode-panel-border, #3c3c3c)',
                  borderRadius: 3,
                  boxSizing: 'border-box',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 4,
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    zIndex: 1
                  }}
                >
                  <Button
                    secondary
                    small
                    options={{ ariaLabel: 'Zoom in', title: 'Zoom in' }}
                    onClick={() => {
                      const api = graphRef.current
                      if (!api) return
                      api.zoomIn()
                    }}
                  >
                    <i className="codicon codicon-zoom-in" />
                  </Button>
                  <Button
                    secondary
                    small
                    options={{ ariaLabel: 'Zoom out', title: 'Zoom out' }}
                    onClick={() => {
                      const api = graphRef.current
                      if (!api) return
                      api.zoomOut()
                    }}
                  >
                    <i className="codicon codicon-zoom-out" />
                  </Button>
                  <Button
                    secondary
                    small
                    options={{ ariaLabel: 'Center view', title: 'Center view' }}
                    onClick={() => {
                      const api = graphRef.current
                      if (!api) return
                      api.centerView()
                    }}
                  >
                    <i className="codicon codicon-screen-full" />
                  </Button>
                </div>
                <Graph
                  ref={graphRef}
                  json={formattedResponseBody || '{}'}
                  layout={{ theme: isDarkTheme ? 'dark' : 'light' }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          </div>
        )
      }
    ]
  }, [t, isDarkTheme, response, formattedResponseBody, headersItems, renderModalTitle, isLoading])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0
      }}
    >
      <Tabs tabs={tabs} activeTabId={activeTabId} onTabChange={setActiveTabId} />
    </div>
  )
}

