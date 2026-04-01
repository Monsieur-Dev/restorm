import { type CSSProperties, type ReactNode } from 'react'
import {
  CodeEditor,
  ListView,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import type { HTTPResponse, KeyValue } from '../../../../shared/types/collections'

const flexRowStyle: CSSProperties = { display: 'flex', gap: 8 }
const boldLabelStyle: CSSProperties = { fontWeight: 600 }
const kvKeyStyle: CSSProperties = { fontWeight: 600, color: 'var(--symbolIcon-propertyForeground)' }
const kvValueStyle: CSSProperties = { color: 'var(--descriptionForeground)' }
const fullHeightBoxStyle: CSSProperties = { height: '100%', boxSizing: 'border-box' }
const editorContainerStyle: CSSProperties = { height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }
const errorTextStyle: CSSProperties = { color: 'var(--testing-iconFailed)' }

/** Format duration in a human-readable way */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Format bytes in a human-readable way */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Get status color based on status code */
function getStatusColor(statusCode: number): 'green' | 'red' | 'orange' {
  if (statusCode >= 200 && statusCode < 300) return 'green'
  if (statusCode >= 300 && statusCode < 400) return 'orange'
  return 'red'
}

/** Convert KeyValue array to ListView items */
function keyValuesToListItems(keyValues: KeyValue[], prefix: string): ListViewItemData[] {
  return keyValues.map((kv, index) => ({
    id: `${prefix}-${index}`,
    icon: 'blank',
    title: (
      <span style={flexRowStyle}>
        <span style={kvKeyStyle}>{kv.key}</span>
        <span style={kvValueStyle}>{kv.value.toString()}</span>
      </span>
    )
  }))
}

export interface HTTPResponseViewResult {
  infosContent: ReactNode | null
  responseContent: ReactNode | null
  jsonData: unknown
}

/** Build the response view data from an HTTPResponse */
export function buildHttpResponseViewData(response: HTTPResponse | null): HTTPResponseViewResult {
  const generalItems: ListViewItemData[] = []
  if (response) {
    generalItems.push(
      { id: 'general-request-url', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Request URL</span><span>{response.requestUrl}</span></span> },
      { id: 'general-request-method', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Request Method</span><span>{response.requestMethod}</span></span> },
      { id: 'general-status-code', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Status Code</span><span style={{ color: getStatusColor(response.statusCode) === 'green' ? 'var(--testing-iconPassed)' : getStatusColor(response.statusCode) === 'orange' ? 'var(--editorWarning-foreground)' : 'var(--testing-iconFailed)' }}>{response.statusCode} {response.statusText}</span></span> },
      { id: 'general-duration', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Duration</span><span>{formatDuration(response.timings.durationMs)}</span></span> }
    )
    if (response.contentType) {
      generalItems.push({ id: 'general-content-type', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Content-Type</span><span>{response.contentType}</span></span> })
    }
    if (response.contentLength !== undefined) {
      generalItems.push({ id: 'general-content-length', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Content-Length</span><span>{formatBytes(response.contentLength)}</span></span> })
    }
    if (response.error) {
      generalItems.push({ id: 'general-error', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Error</span><span style={errorTextStyle}>{response.error}</span></span> })
    }
  }

  const responseHeaderItems = response ? keyValuesToListItems(response.responseHeaders, 'resp-header') : []
  const requestHeaderItems = response ? keyValuesToListItems(response.requestHeaders, 'req-header') : []
  const headersTreeItems: ListViewItemData[] = [
    { id: 'group-general', title: 'General', icon: 'info', isExpandable: true, isExpanded: true, children: generalItems },
    { id: 'group-response-headers', title: `Response headers (${responseHeaderItems.length})`, icon: 'call-incoming', isExpandable: true, isExpanded: true, children: responseHeaderItems },
    { id: 'group-request-headers', title: `Request headers (${requestHeaderItems.length})`, icon: 'call-outgoing', isExpandable: true, isExpanded: true, children: requestHeaderItems }
  ]

  const infosContent = response ? (
    <div style={fullHeightBoxStyle}>
      <ListView items={headersTreeItems} rootRole="tree" ariaLabel="HTTP request and response headers" data-testid="http-response-headers-list" />
    </div>
  ) : null

  const formattedResponseBody = (() => {
    if (!response) return ''
    const responseBody = response.responseBody
    if (response.contentType?.includes('application/json')) {
      try {
        const parsed: unknown = JSON.parse(responseBody)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return responseBody
      }
    }
    return responseBody
  })()

  const responseContent = response && formattedResponseBody ? (
    <div style={editorContainerStyle}>
      <CodeEditor
        height="100%"
        language="json"
        value={formattedResponseBody}
        options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true, readOnly: true }}
        data-testid="http-response-body-editor"
      />
    </div>
  ) : null

  const jsonData = (() => {
    if (!response?.responseBody) return undefined
    if (!response.contentType?.includes('application/json')) return undefined
    try {
      return JSON.parse(response.responseBody) as unknown
    } catch {
      return undefined
    }
  })()

  return { infosContent, responseContent, jsonData }
}
