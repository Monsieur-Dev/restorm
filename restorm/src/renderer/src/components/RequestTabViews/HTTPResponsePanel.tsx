import { type CSSProperties, type ReactNode } from 'react'
import i18n from 'i18next'
import type { TFunction } from 'i18next'
import {
  ListView,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import type { HTTPResponse, KeyValue } from '../../../../shared/types/collections'
import type { CookiePair } from '../../../../shared/cookies/cookieTypes'
import type { OperationDocumentation } from '../../../../shared/types/apiDocumentation'
import { ResponseInfoStatusCodeTooltip } from '../documentation/StatusCodeTooltip'
import { statusCodeColor } from '../documentation/statusCodeColor'
import { ResponseBodyViewer } from './ResponseBodyViewer'
import { classifyResponseBody, formatBytes } from './responseBody'

const flexRowStyle: CSSProperties = { display: 'flex', gap: 8 }
const boldLabelStyle: CSSProperties = { fontWeight: 600 }
const kvKeyStyle: CSSProperties = { fontWeight: 600, color: 'var(--symbolIcon-propertyForeground)' }
const kvValueStyle: CSSProperties = { color: 'var(--descriptionForeground)' }
const fullHeightBoxStyle: CSSProperties = { height: '100%', boxSizing: 'border-box' }
const errorTextStyle: CSSProperties = { color: 'var(--testing-iconFailed)' }

/** Format duration in a human-readable way */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Format bytes in a human-readable way */

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
  cookiesContent: ReactNode | null
  jsonData: unknown
}

/** Build a Sent/Received cookies tree for the response-side Cookies tab.
 * Structurally typed on just the two cookie arrays so every protocol's response
 * (all extend `BaseResponse`) can reuse it, not only HTTP. */
export function buildCookiesContent(
  response: { sentCookies?: CookiePair[] | undefined; receivedCookies?: CookiePair[] | undefined } | null
): ReactNode | null {
  if (!response) return null
  // Localize via the global i18n instance so every protocol view gets the
  // translated section labels without threading its own `t` in.
  const tr = (key: string, fallback: string): string => i18n.t(key, { defaultValue: fallback })
  const pairRows = (pairs: CookiePair[], prefix: string): ListViewItemData[] =>
    pairs.map((c, i) => ({
      id: `${prefix}-${i}`,
      icon: 'blank',
      title: (
        <span style={flexRowStyle} data-testid={`${prefix}-row`} data-cookie-name={c.name}>
          <span style={kvKeyStyle}>{c.name}</span>
          <span style={kvValueStyle}>{c.value}</span>
        </span>
      )
    }))
  const section = (pairs: CookiePair[], id: string, label: string, icon: string, prefix: string): ListViewItemData => ({
    id,
    title: `${label} (${pairs.length})`,
    icon,
    isExpandable: true,
    isExpanded: true,
    children: pairs.length > 0
      ? pairRows(pairs, prefix)
      : [{ id: `${id}-empty`, icon: 'blank', title: <span style={kvValueStyle}>{tr('requestTab.responses.cookies.none', 'None')}</span> }]
  })
  const items: ListViewItemData[] = [
    // 'call-outgoing' = sent (like the Infos request-headers group), 'call-incoming' = received.
    section(response.sentCookies ?? [], 'cookies-sent', tr('requestTab.responses.cookies.sent', 'Sent'), 'call-outgoing', 'cookie-sent'),
    section(response.receivedCookies ?? [], 'cookies-received', tr('requestTab.responses.cookies.received', 'Received'), 'call-incoming', 'cookie-received')
  ]
  return (
    <div style={fullHeightBoxStyle}>
      <ListView items={items} rootRole="tree" ariaLabel="Cookies sent and received" data-testid="http-response-cookies-list" />
    </div>
  )
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
    // (The old cookies chip that deep-linked to the global Cookie jar lived
    // here; it's superseded by the dedicated per-request Cookies tab.)
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

  // The body: an always-present Download button + a viewer picked from the
  // Content-Type (image / video / audio / markdown / code editor / binary
  // notice). Shared with the history and the recording capture pane.
  // A response without a body (204, an error page with nothing to show…)
  // keeps no Response tab, so the Infos tab stays the landing tab.
  const responseContent = response && classifyResponseBody(response).kind !== 'empty' ? (
    <ResponseBodyViewer response={response} t={labels?.t ?? i18n.t} />
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

  const cookiesContent = buildCookiesContent(response)

  return { infosContent, responseContent, cookiesContent, jsonData }
}
