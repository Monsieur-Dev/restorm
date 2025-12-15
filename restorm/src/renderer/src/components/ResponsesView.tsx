import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Graph, type GraphRef } from 'jsoncrack-react'
import {
  Tabs,
  Button,
  ListView,
  CodeEditor
} from 'electron-core-ui/renderer'
import type { Tab, ListViewItemData } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import './responsesView.css'
import { HttpMethodBadge } from './HttpMethodBadge'

export interface ResponsesViewProps {
  requestTitle: string
}

export const ResponsesView: React.FC<ResponsesViewProps> = ({ requestTitle }) => {
  const { t } = useTranslation()
  const [activeTabId, setActiveTabId] = useState<string>('raw')
  const [rawResponse, setRawResponse] = useState<string>(
    JSON.stringify(
      {
        status: 200,
        headers: {
          'content-type': 'application/json'
        },
        body: {
          id: 1,
          name: 'Fluffy',
          tags: ['cat', 'pet']
        }
      },
      null,
      2
    )
  )
  const [prettyResponse, setPrettyResponse] = useState<string>('') // will be wired later
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
    return themeAttr === 'dark' || themeAttr === 'hc'
  })

  const graphRef = useRef<GraphRef | null>(null)

  const renderModalTitle = useCallback((suffix: string): React.ReactNode => {
    const parts = requestTitle.split(' ')
    const method = parts[0] ?? 'GET'
    const path = parts.slice(1).join(' ') || requestTitle

    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <HttpMethodBadge method={method.toUpperCase()} />
        <span>{path}{suffix ? ` - ${suffix}` : ''}</span>
      </span>
    )
  }, [requestTitle])

  useEffect(() => {
    if (typeof document === 'undefined') return

    const handleThemeChange = (): void => {
      const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
      const dark = themeAttr === 'dark' || themeAttr === 'hc'
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

  const generalItems: ListViewItemData[] = useMemo(
    () => [
      {
        id: 'general-request-url',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Request URL</span>
            <span className="response-value">
              https://events.launchdarkly.com/events/bulk/60645109ece3b60c64ac5e02
            </span>
          </span>
        )
      },
      {
        id: 'general-request-method',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Request Method</span>
            <span className="response-value">POST</span>
          </span>
        )
      },
      {
        id: 'general-status-code',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Status Code</span>
            <span className="response-value">202 Accepted</span>
          </span>
        )
      },
      {
        id: 'general-remote-address',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Remote Address</span>
            <span className="response-value">52.207.169.67:443</span>
          </span>
        )
      },
      {
        id: 'general-referrer-policy',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Referrer Policy</span>
            <span className="response-value">no-referrer-when-downgrade</span>
          </span>
        )
      }
    ],
    []
  )

  const responseHeaderItems: ListViewItemData[] = useMemo(
    () => [
      {
        id: 'resp-header-ac-allow-headers',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Access-Control-Allow-Headers</span>
            <span className="response-value">
              Accept, Content-Type, Content-Length, Accept-Encoding, X-LaunchDarkly-Event-Schema,
              X-LaunchDarkly-User-Agent, X-LaunchDarkly-Payload-ID, X-LaunchDarkly-Wrapper,
              X-LaunchDarkly-Tags
            </span>
          </span>
        )
      },
      {
        id: 'resp-header-ac-allow-methods',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Access-Control-Allow-Methods</span>
            <span className="response-value">POST, OPTIONS</span>
          </span>
        )
      },
      {
        id: 'resp-header-ac-allow-origin',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Access-Control-Allow-Origin</span>
            <span className="response-value">*</span>
          </span>
        )
      },
      {
        id: 'resp-header-ac-expose-headers',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Access-Control-Expose-Headers</span>
            <span className="response-value">Date</span>
          </span>
        )
      },
      {
        id: 'resp-header-ac-max-age',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Access-Control-Max-Age</span>
            <span className="response-value">300</span>
          </span>
        )
      },
      {
        id: 'resp-header-content-length',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Content-Length</span>
            <span className="response-value">0</span>
          </span>
        )
      },
      {
        id: 'resp-header-content-type',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Content-Type</span>
            <span className="response-value">application/json</span>
          </span>
        )
      },
      {
        id: 'resp-header-date',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Date</span>
            <span className="response-value">Thu, 04 Dec 2025 00:33:10 GMT</span>
          </span>
        )
      },
      {
        id: 'resp-header-hsts',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Strict-Transport-Security</span>
            <span className="response-value">
              max-age=31536000; includeSubDomains
            </span>
          </span>
        )
      }
    ],
    []
  )

  const requestHeaderItems: ListViewItemData[] = useMemo(
    () => [
      {
        id: 'req-header-authority',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">:authority</span>
            <span className="response-value">events.launchdarkly.com</span>
          </span>
        )
      },
      {
        id: 'req-header-method',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">:method</span>
            <span className="response-value">POST</span>
          </span>
        )
      },
      {
        id: 'req-header-path',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">:path</span>
            <span className="response-value">/events/bulk/60645109ece3b60c64ac5e02</span>
          </span>
        )
      },
      {
        id: 'req-header-scheme',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">:scheme</span>
            <span className="response-value">https</span>
          </span>
        )
      },
      {
        id: 'req-header-accept',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Accept</span>
            <span className="response-value">*/*</span>
          </span>
        )
      },
      {
        id: 'req-header-accept-encoding',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Accept-Encoding</span>
            <span className="response-value">gzip, deflate, br, zstd</span>
          </span>
        )
      },
      {
        id: 'req-header-accept-language',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Accept-Language</span>
            <span className="response-value" style={{ fontSize: 12 }}>
              fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7
            </span>
          </span>
        )
      },
      {
        id: 'req-header-content-length',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Content-Length</span>
            <span className="response-value">15268</span>
          </span>
        )
      },
      {
        id: 'req-header-content-type',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Content-Type</span>
            <span className="response-value">application/json</span>
          </span>
        )
      },
      {
        id: 'req-header-origin',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Origin</span>
            <span className="response-value">https://web.postman.co</span>
          </span>
        )
      },
      {
        id: 'req-header-priority',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Priority</span>
            <span className="response-value">u=1, i</span>
          </span>
        )
      },
      {
        id: 'req-header-referer',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Referer</span>
            <span className="response-value" style={{ fontSize: 12 }}>
              https://web.postman.co/workspace/My-Workspace-…/request/13977675-97a362f6-ebb4-44ad-8a35-462af245ad5e?tab=body
            </span>
          </span>
        )
      },
      {
        id: 'req-header-sec-ch-ua',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Sec-CH-UA</span>
            <span className="response-value" style={{ fontSize: 12 }}>
              &quot;Chromium&quot;;v=&quot;142&quot;, &quot;Google Chrome&quot;;v=&quot;142&quot;, &quot;Not_A Brand&quot;;v=&quot;99&quot;
            </span>
          </span>
        )
      },
      {
        id: 'req-header-sec-ch-ua-mobile',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Sec-CH-UA-Mobile</span>
            <span className="response-value">?0</span>
          </span>
        )
      },
      {
        id: 'req-header-sec-ch-ua-platform',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Sec-CH-UA-Platform</span>
            <span className="response-value">&quot;Linux&quot;</span>
          </span>
        )
      },
      {
        id: 'req-header-sec-fetch-dest',
        icon: 'blank',
        title: (
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="response-key">Sec-Fetch-Dest</span>
            <span className="response-value">empty</span>
          </span>
        )
      }
    ],
    []
  )

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
        title: 'Response headers',
        icon: 'call-incoming',
        isExpandable: true,
        isExpanded: true,
        children: responseHeaderItems
      },
      {
        id: 'group-request-headers',
        title: 'Request headers',
        icon: 'call-outgoing',
        isExpandable: true,
        isExpanded: true,
        children: requestHeaderItems
      }
    ],
    [generalItems, responseHeaderItems, requestHeaderItems]
  )

  const tabs = useMemo<Tab[]>(
    () => [
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
              padding: '8px 0px 0px 8px',
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
                value={rawResponse}
                onChange={(value) => {
                  setRawResponse(value ?? '')
                }}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true
                }}
              />
            </div>
          </div>
        )
      },
      {
        id: 'pretty',
        label: t('requestTab.responses.tabs.prettyfied'),
        useScrollableElement: false,
        allowFullscreen: true,
        fullscreenModalTitle: renderModalTitle('Response prettified'),
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
                value={prettyResponse}
                onChange={(value) => {
                  setPrettyResponse(value ?? '')
                }}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true
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
              // Intercept the wheel event before JSONCrack so we can smooth zoom
              // and keep the graph centered in the viewport.
              event.preventDefault()
              event.stopPropagation()

              const api = graphRef.current
              if (!api) return

              if (event.deltaY < 0) {
                api.zoomIn()
              } else if (event.deltaY > 0) {
                api.zoomOut()
              }

              //api.centerView()
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
                  json={rawResponse || '{}'}
                  layout={{ theme: isDarkTheme ? 'dark' : 'light' }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            </div>
          </div>
        )
      }
    ],
    [t, isDarkTheme, rawResponse, prettyResponse, headersItems, renderModalTitle]
  )

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
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
      />
    </div>
  )
}
