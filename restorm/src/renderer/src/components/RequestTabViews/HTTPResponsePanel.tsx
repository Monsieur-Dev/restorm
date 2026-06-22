import { type CSSProperties, type ReactNode } from 'react'
import {
  Button,
  CodeEditor,
  ListView,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import type { HTTPResponse, KeyValue } from '../../../../shared/types/collections'
import type { OperationDocumentation } from '../../../../shared/types/apiDocumentation'
import { ResponseInfoStatusCodeTooltip } from '../documentation/StatusCodeTooltip'
import { statusCodeColor } from '../documentation/statusCodeColor'

const flexRowStyle: CSSProperties = { display: 'flex', gap: 8 }
const boldLabelStyle: CSSProperties = { fontWeight: 600 }
const kvKeyStyle: CSSProperties = { fontWeight: 600, color: 'var(--symbolIcon-propertyForeground)' }
const kvValueStyle: CSSProperties = { color: 'var(--descriptionForeground)' }
const fullHeightBoxStyle: CSSProperties = { height: '100%', boxSizing: 'border-box' }
const editorContainerStyle: CSSProperties = { flex: 1, minHeight: 0, border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }
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

/** Convert KeyValue array to ListView items.
 *
 * Each row carries `data-testid="<prefix>-row"` + `data-header-key` /
 * `data-header-value` on its key/value spans so an E2E can assert a
 * specific header (including a multi-value header, which arrives as one
 * row whose value is the comma-joined list). */
function keyValuesToListItems(keyValues: KeyValue[], prefix: string): ListViewItemData[] {
  return keyValues.map((kv, index) => ({
    id: `${prefix}-${index}`,
    icon: 'blank',
    title: (
      <span style={flexRowStyle} data-testid={`${prefix}-row`} data-header-key={kv.key}>
        <span style={kvKeyStyle}>{kv.key}</span>
        <span style={kvValueStyle} data-header-value={kv.value.toString()}>{kv.value.toString()}</span>
      </span>
    )
  }))
}

export interface HTTPResponseViewResult {
  infosContent: ReactNode | null
  responseContent: ReactNode | null
  jsonData: unknown
}

/** Build the response view data from an HTTPResponse.
 *
 *  `operation` is the matched OpenAPI operation for the request that
 *  produced this response — used to look up a per-code description so
 *  the Infos tab can decorate the status code with a hover tooltip
 *  ("the doc message + the generic RFC reason"). When undefined, or
 *  when the operation has no entry for this code, the status code
 *  renders plain (no tooltip). */
export function buildHttpResponseViewData(
  response: HTTPResponse | null,
  operation?: OperationDocumentation
): HTTPResponseViewResult {
  const generalItems: ListViewItemData[] = []
  if (response) {
    const statusColor = getStatusColor(response.statusCode) === 'green'
      ? 'var(--testing-iconPassed)'
      : getStatusColor(response.statusCode) === 'orange'
        ? 'var(--editorWarning-foreground)'
        : 'var(--testing-iconFailed)'
    const codeStr = String(response.statusCode)
    const docDescription = operation?.responses?.[codeStr]?.description
    const dotStyle: CSSProperties = {
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: statusCodeColor(codeStr),
      flexShrink: 0
    }
    const statusCodeNode = (
      <ResponseInfoStatusCodeTooltip code={codeStr} docDescription={docDescription}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: statusColor }} data-testid="http-response-status" data-status-code={codeStr}>
          <span style={dotStyle} aria-hidden="true" />
          <span>{response.statusCode} {response.statusText}</span>
        </span>
      </ResponseInfoStatusCodeTooltip>
    )
    generalItems.push(
      { id: 'general-request-url', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Request URL</span><span>{response.requestUrl}</span></span> },
      { id: 'general-request-method', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Request Method</span><span>{response.requestMethod}</span></span> },
      { id: 'general-status-code', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Status Code</span>{statusCodeNode}</span> },
      { id: 'general-duration', icon: 'blank', title: <span style={flexRowStyle}><span style={boldLabelStyle}>Duration</span><span data-testid="http-response-duration">{formatDuration(response.timings.durationMs)}</span></span> }
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

  // Binary response: the body is base64-encoded bytes (a UTF-8 text
  // render would corrupt them), so offer a download instead. Decode in
  // the browser and trigger an anchor download with a filename derived
  // from the Content-Type.
  const downloadBinary = (): void => {
    if (!response) return
    try {
      const byteChars = atob(response.responseBody)
      const bytes = new Uint8Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
      const mime = response.contentType ?? 'application/octet-stream'
      const blob = new Blob([bytes], { type: mime })
      const objectUrl = URL.createObjectURL(blob)
      const ext = mime.split('/')[1]?.split(';')[0] ?? 'bin'
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `response.${ext}`
      anchor.click()
      URL.revokeObjectURL(objectUrl)
    } catch {
      // A malformed base64 payload simply produces no download.
    }
  }

  const responseContent = response?.bodyIsBase64 ? (
    <div style={fullHeightBoxStyle} data-testid="http-response-binary">
      <div style={{ padding: 12 }}>
        <div style={{ marginBottom: 8, color: 'var(--descriptionForeground)' }}>
          Binary response ({response.contentType ?? 'unknown type'})
          {response.contentLength !== undefined ? ` — ${formatBytes(response.contentLength)}` : ''}
        </div>
        <Button onClick={downloadBinary} data-testid="http-response-download-button">
          Download
        </Button>
      </div>
    </div>
  ) : response && formattedResponseBody ? (
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
    if (response.bodyIsBase64) return undefined
    if (!response.contentType?.includes('application/json')) return undefined
    try {
      return JSON.parse(response.responseBody) as unknown
    } catch {
      return undefined
    }
  })()

  return { infosContent, responseContent, jsonData }
}
