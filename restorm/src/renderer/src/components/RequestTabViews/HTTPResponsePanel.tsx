import { type CSSProperties, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
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

/** Longest body rendered inline in the Infos tree. The point of the row is to
 *  tell two otherwise-identical calls apart at a glance, not to be an editor —
 *  the untruncated payload is one tab away in "Request body". */
const INLINE_BODY_MAX_CHARS = 2000

const bodyTextStyle: CSSProperties = {
  color: 'var(--descriptionForeground)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  fontFamily: 'var(--monaco-monospace-font, monospace)'
}

function truncateForInline(text: string): string {
  return text.length > INLINE_BODY_MAX_CHARS ? `${text.slice(0, INLINE_BODY_MAX_CHARS)}…` : text
}

/**
 * Rows describing the body that was actually SENT, for the Infos tree. Two
 * calls to the same URL with the same headers are distinguished by their body
 * and nothing else, so an entry that omits it can't explain why two responses
 * differ.
 *
 * Returns an empty array when the request carried no body (a GET, typically) —
 * the caller drops the group entirely rather than showing an empty node.
 */
function requestBodyToListItems(
  body: HTTPResponse['requestBody'],
  t: TFunction
): ListViewItemData[] {
  if (!body) return []

  if (body.type === 'text') {
    if (!body.content) return []
    return [{
      id: 'request-body-text',
      icon: 'blank',
      title: (
        <span style={bodyTextStyle} data-testid="http-response-request-body-text">
          {truncateForInline(body.content)}
        </span>
      )
    }]
  }

  if (body.type === 'file') {
    if (!body.path) return []
    return [{
      id: 'request-body-file',
      icon: 'blank',
      title: (
        <span style={flexRowStyle} data-testid="http-response-request-body-file">
          <span style={kvKeyStyle}>{t('requestTab.responses.infos.requestBodyFile')}</span>
          <span style={kvValueStyle}>{body.path}</span>
        </span>
      )
    }]
  }

  // form-data / x-www-form-urlencoded: one row per field, same key/value
  // shaping as the header groups so the tree reads uniformly.
  const enabled = body.fields.filter((field) => field.enabled !== false)
  return keyValuesToListItems(enabled, 'request-body-field')
}

export interface HTTPResponseViewResult {
  infosContent: ReactNode | null
  responseContent: ReactNode | null
  jsonData: unknown
}

/**
 * Translation + date formatting for the rows this module adds. Passed in
 * rather than pulled from a hook because `buildHttpResponseViewData` is a
 * plain function called from `useMemo`, not a component — the same convention
 * the scenario node boxes use for their `TFunction`.
 *
 * Optional so the existing callers that only need the untranslated legacy rows
 * keep compiling; when absent, the sent-at and request-body rows are skipped
 * rather than rendered with a raw key.
 */
export interface HTTPResponseViewLabels {
  t: TFunction
  /** Bind from `useUserDateFormat` so the timestamp honours the user's
   *  `behavior:dateTimeFormat` choice instead of hard-coding a locale. */
  formatDate: (date: Date) => string
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
  operation?: OperationDocumentation,
  labels?: HTTPResponseViewLabels
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
    // When the call went out. A list of calls with no clock on them can't be
    // lined up against a server log or a scenario run, which is most of what
    // someone opens the history for.
    if (labels && response.timings.startedAt) {
      const sentAt = new Date(response.timings.startedAt)
      if (!isNaN(sentAt.getTime())) {
        generalItems.push({
          id: 'general-sent-at',
          icon: 'blank',
          title: (
            <span style={flexRowStyle}>
              <span style={boldLabelStyle}>{labels.t('requestTab.responses.infos.sentAt')}</span>
              <span data-testid="http-response-sent-at">{labels.formatDate(sentAt)}</span>
            </span>
          )
        })
      }
    }
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
  const requestBodyItems = response && labels ? requestBodyToListItems(response.requestBody, labels.t) : []
  const headersTreeItems: ListViewItemData[] = [
    { id: 'group-general', title: 'General', icon: 'info', isExpandable: true, isExpanded: true, children: generalItems },
    { id: 'group-response-headers', title: `Response headers (${responseHeaderItems.length})`, icon: 'call-incoming', isExpandable: true, isExpanded: true, children: responseHeaderItems },
    { id: 'group-request-headers', title: `Request headers (${requestHeaderItems.length})`, icon: 'call-outgoing', isExpandable: true, isExpanded: true, children: requestHeaderItems }
  ]
  // Bodyless requests (a GET, typically) get no group at all rather than an
  // empty one that reads as "the body was lost".
  if (labels && requestBodyItems.length > 0) {
    headersTreeItems.push({
      id: 'group-request-body',
      title: labels.t('requestTab.responses.infos.requestBody'),
      icon: 'file-code',
      isExpandable: true,
      isExpanded: true,
      children: requestBodyItems
    })
  }

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
