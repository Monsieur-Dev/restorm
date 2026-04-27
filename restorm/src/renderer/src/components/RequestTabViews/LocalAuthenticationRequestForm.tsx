/**
 * LocalAuthenticationRequestForm — a self-contained, context-free
 * HTTP request editor tailored to the auth route an import wizard
 * needs to configure.
 *
 * Layout is identical to HTTPRequestTabView (BaseRequestTabView
 * shell + SplitView / Pane layout for the request panes + the same
 * Configuration tab), so the ergonomics — collapsible panes with
 * inline "Add row" actions, URL bar on top, response pane on the
 * right — match the main tab view pixel-for-pixel.
 *
 * What changes vs. HTTPRequestTabView:
 *   - No reactive proxy (mutates the passed-in instance directly).
 *   - No ContextService registration / broadcast subscriptions.
 *   - No Monaco variable inputs (plain InputBox cells) — there are
 *     no variables to resolve for a request that isn't in a
 *     collection yet.
 *   - No handlebars helpers wired up (the Configuration tab's
 *     {{expires_in}} / {{access_token}} expressions are evaluated
 *     main-side against the auth response body at Send time).
 *   - No code-snippets / docs tabs — those are tied to ContextService
 *     state we're deliberately not maintaining.
 *   - "Send" fires `auth:prefetch` (the same one-shot IPC that
 *     powers the modal's Save & retry import action), so the form
 *     can run the auth route without registering the request.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import Handlebars from 'handlebars'
import {
  Button,
  SelectBox,
  ControlGroup,
  InputBox,
  KeyValueTable,
  RadioGroup,
  CodeEditor,
  ScrollableElement,
  StaticPane,
  Tooltip,
  type CellRendererProps,
  type KeyValueTableHandle,
  type KeyValueTableRow,
  type ISelectOptionItem,
  type ISelectData,
  type Tab,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import type { AuthenticationRequest, HTTPResponse, HTTPMethod } from '../../../../shared/types/collections'
import { StringValue } from '../../../../shared/types/collections'
import { KeyValue } from '../../../../shared/models'
import { Badge } from '../common/Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'
import { BaseRequestTabView } from './BaseRequestTabView'
import { buildHttpResponseViewData } from './HTTPResponsePanel'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useCurlPaste, type ParsedCurl } from '../../hooks/useCurlPaste'
import { CurlPasteCallout } from '../CurlPasteCallout'

// Stable reference for the Configuration-tab Handlebars fields that
// don't have any source of runtime variables (there's no
// ContextService in this form). Keeps `RestormVariableInputBox` from
// seeing a new `[]` on every render.
const EMPTY_VARIABLES: VariableDefinition[] = []
import { buildAuthPrefetchPayload } from '../Modals/authPrefetchPayload'

const METHODS: HTTPMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
type BodyMode = 'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'
const BODY_MODES: BodyMode[] = ['text', 'form-data', 'x-www-form-urlencoded', 'file']

const methodSelectWrapperStyle: CSSProperties = { width: 90, flexShrink: 0 }
const urlInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
const editorContainerStyle: CSSProperties = { height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }
const fileRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const fileLabelStyle: CSSProperties = { flexShrink: 0, fontSize: 12 }
const fileInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
const configContainerStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
const hintStyle: CSSProperties = { fontSize: 11, color: 'var(--descriptionForeground)', fontStyle: 'italic' }
const configInputWrapperStyle: CSSProperties = { maxWidth: 360 }

function readBodyMode(request: AuthenticationRequest): BodyMode {
  const raw = (request.body?.type ?? 'text') as string
  if (raw === 'form-data' || raw === 'formData') return 'form-data'
  if (raw === 'x-www-form-urlencoded' || raw === 'xWwwFormUrlEncoded') return 'x-www-form-urlencoded'
  if (raw === 'file') return 'file'
  return 'text'
}

function readBodyText(request: AuthenticationRequest): string {
  if (request.body?.type === 'text') return request.body.content
  return ''
}

function readBodyFilePath(request: AuthenticationRequest): string {
  const body = request.body as { type?: string; path?: string } | undefined
  return body?.type === 'file' ? body.path ?? '' : ''
}

function readBodyFields(request: AuthenticationRequest): KeyValueTableRow[] {
  const body = request.body as
    | { type?: string; fields?: { id?: string; key?: string; value?: { toString(): string } | string; enabled?: boolean }[] }
    | undefined
  if (!body?.fields) return []
  return body.fields.map((f) => {
    const raw = f.value
    const stringified = typeof raw === 'string'
      ? raw
      : raw !== undefined
        ? raw.toString()
        : ''
    const row: KeyValueTableRow = {
      id: f.id,
      key: f.key ?? '',
      value: stringified
    }
    if (f.enabled !== undefined) row.enabled = f.enabled
    return row
  })
}

function keyValuesFromRows(rows: KeyValueTableRow[]): KeyValue[] {
  return rows.map((r) =>
    KeyValue.fromPlain({
      ...(r.id !== undefined ? { id: r.id } : {}),
      key: r.key,
      value: r.value,
      ...(r.enabled !== undefined ? { enabled: r.enabled } : {})
    })
  )
}

// Accepts either the class `KeyValue` (shared/models) or its shared/types
// interface counterpart — both have the fields we touch here. Avoids a
// cast chain when wiring request.headers / request.producedHeaders
// (typed via shared/types) into the form.
interface KeyValueLike {
  id?: string | undefined
  key: string
  value: { toString(): string }
  enabled?: boolean | undefined
}
function keyValuesToRows(kvs: readonly KeyValueLike[] | undefined): KeyValueTableRow[] {
  if (!kvs) return []
  return kvs.map((kv) => {
    const row: KeyValueTableRow = {
      key: kv.key,
      value: kv.value.toString()
    }
    if (kv.id !== undefined) row.id = kv.id
    if (kv.enabled !== undefined) row.enabled = kv.enabled
    return row
  })
}

function parseErrorCodes(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
}

function formatErrorCodes(codes: readonly number[]): string {
  return codes.join(', ')
}

export interface LocalAuthenticationRequestFormProps {
  request: AuthenticationRequest
}

export const LocalAuthenticationRequestForm: React.FC<LocalAuthenticationRequestFormProps> = ({ request }) => {
  const { t } = useTranslation()

  // Snapshot-backed state. The form owns re-renders; the request
  // object is the caller's source of truth — we mutate it in place
  // so the modal reads the latest values on submit without any
  // event wiring.
  const [method, setMethod] = useState<string>(request.method)
  const [url, setUrl] = useState<string>(request.url)
  const [bodyMode, setBodyMode] = useState<BodyMode>(readBodyMode(request))
  const [bodyText, setBodyText] = useState<string>(readBodyText(request))
  const [bodyFilePath, setBodyFilePath] = useState<string>(readBodyFilePath(request))
  const [errorCodesText, setErrorCodesText] = useState<string>(formatErrorCodes(request.authErrorCodes))
  const [expirationExpression, setExpirationExpression] = useState<string>(request.expirationExpression ?? '')

  const [isSending, setIsSending] = useState(false)
  const [httpResponse, setHttpResponse] = useState<HTTPResponse | null>(null)
  const [activeRequestTabId, setActiveRequestTabId] = useState<string>('request')
  // Bumped to force a remount of the produced-headers KeyValueTable
  // so it re-reads `initialProducedHeaders` — used when we auto-fill
  // an Authorization row from a detected OAuth response.
  const [producedHeadersRemountKey, setProducedHeadersRemountKey] = useState(0)
  // Same trick for the inbound headers + form-data tables — bumped on
  // smart-paste apply so they remount with the freshly-mutated request.
  const [transportEpoch, setTransportEpoch] = useState(0)
  const urlSectionHostRef = useRef<HTMLDivElement | null>(null)

  // Last auth response parsed as JSON, kept in a ref so the read-only
  // "Resolved value" cells of the producedHeaders table can compile
  // handlebars against it without depending on a state value that
  // would churn on every keystroke. Mutated from handleSend; React
  // re-renders via setHttpResponse which cascades into the cells.
  const parsedResponseRef = useRef<Record<string, unknown> | null>(null)

  const handlebarsHelpers = useHandlebarsHelpers()

  // Stable custom cell renderer for the produced-headers KVTable's
  // Value column: Monaco-backed `{{access_token}}` / `{{expires_in}}`
  // authoring with syntax highlighting and helper autocomplete, but
  // `variables=[]` since there's no runtime context to resolve
  // against (the placeholders match fields on the auth response body
  // at Send time, evaluated main-side). Memoized so the cell
  // component keeps a stable identity across renders — otherwise
  // every keystroke would remount Monaco and thrash focus.
  const ProducedHeaderValueCell = useMemo<React.ComponentType<CellRendererProps>>(() => {
    const Cell: React.FC<CellRendererProps> = ({ value, onChange, placeholder, 'data-testid': dataTestId }) => (
      <RestormVariableInputBox
        value={value}
        onChange={onChange}
        variables={EMPTY_VARIABLES}
        helpers={handlebarsHelpers}
        {...(placeholder !== undefined ? { placeholder } : {})}
        {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
      />
    )
    return Cell
  }, [handlebarsHelpers])

  // Resolved-value cell for the same table: compiles the handlebars
  // template against the last successful auth response JSON. No
  // dependency on state — the ref is read at render time, and a
  // render is triggered by `setHttpResponse` right after the ref is
  // updated in handleSend. Returns the raw value verbatim when
  // there's no response yet or the template fails to compile.
  //
  // Long resolved tokens (bearer JWTs etc.) are ellipsized and the
  // full string is shown via `Tooltip` on hover — better visual than
  // the native `title` attribute (consistent theme, little beak).
  const ResolvedProducedHeaderCell = useMemo<React.ComponentType<CellRendererProps>>(() => {
    const Cell: React.FC<CellRendererProps> = ({ value, 'data-testid': dataTestId }) => {
      const spanRef = useRef<HTMLSpanElement>(null)
      const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
      const [tooltipVisible, setTooltipVisible] = useState(false)
      const parsed = parsedResponseRef.current
      const resolved = (() => {
        if (!parsed) return ''
        if (!value.includes('{{')) return value
        try {
          return Handlebars.compile(value, { noEscape: true })(parsed)
        } catch {
          return ''
        }
      })()

      // Show/hide dance: the ecu Tooltip is rendered via a portal
      // with a small gap (the beak) between the target and the bubble.
      // When the mouse crosses that gap, `onMouseLeave` fires on the
      // span and `onMouseEnter` on the tooltip, but not atomically —
      // there's a brief "over neither" window that would hide the
      // tooltip, then the mouse re-enters the span and flashes it
      // back. We debounce the hide by 100ms and cancel it when the
      // mouse reaches the tooltip (or comes back onto the span).
      const cancelHide = useCallback(() => {
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current)
          hideTimerRef.current = null
        }
      }, [])
      const scheduleHide = useCallback(() => {
        cancelHide()
        hideTimerRef.current = setTimeout(() => {
          setTooltipVisible(false)
          hideTimerRef.current = null
        }, 100)
      }, [cancelHide])
      useEffect(() => () => { cancelHide() }, [cancelHide])

      return (
        <>
          <span
            ref={spanRef}
            style={{
              display: 'block',
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--descriptionForeground)',
              fontFamily: 'var(--vscode-editor-font-family, monospace)',
              fontSize: 12
            }}
            onMouseEnter={() => {
              if (!resolved) return
              cancelHide()
              setTooltipVisible(true)
            }}
            onMouseLeave={scheduleHide}
            {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
          >
            {resolved}
          </span>
          {resolved ? (
            <Tooltip
              targetRef={spanRef}
              content={<span>{resolved}</span>}
              show={tooltipVisible}
              placement="below"
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
              {...(dataTestId !== undefined ? { 'data-testid': `${dataTestId}-tooltip` } : {})}
            />
          ) : null}
        </>
      )
    }
    return Cell
  }, [])

  const headersRef = useRef<KeyValueTableHandle | null>(null)
  const bodyFieldsRef = useRef<KeyValueTableHandle | null>(null)
  const producedHeadersRef = useRef<KeyValueTableHandle | null>(null)

  // Read live on every render instead of memoizing by `[request]`:
  // we mutate the instance in place, so the reference never changes
  // and a memo with `[request]` would freeze the initial rows at
  // mount time. When BaseRequestTabView re-mounts the KeyValueTable
  // (layout swap on Send when showResponsePanel toggles), the table
  // would then seed from the stale snapshot and blank out the user's
  // input — even though the values are still on the request object.
  const initialHeaders = keyValuesToRows(request.headers)
  const initialBodyFields = readBodyFields(request)
  const initialProducedHeaders = keyValuesToRows(request.producedHeaders)

  const handleMethodChange = useCallback((data: ISelectData) => {
    const next = data.selected as HTTPMethod
    setMethod(next)
    request.method = next
  }, [request])

  const handleUrlChange = useCallback((next: string) => {
    setUrl(next)
    request.url = next
  }, [request])

  const handleHeadersChange = useCallback((rows: KeyValueTableRow[]) => {
    request.headers = keyValuesFromRows(rows)
  }, [request])

  const handleBodyModeChange = useCallback((index: number) => {
    const next = BODY_MODES[index] ?? 'text'
    setBodyMode(next)
    // Write a body shell matching the new mode. Fields are only
    // carried across form-data ↔ x-www-form-urlencoded since those
    // share the same shape; switching to text/file resets the
    // inverse buffers to keep the persisted shape coherent.
    if (next === 'text') {
      request.body = { type: 'text' as never, content: bodyText }
    } else if (next === 'file') {
      request.body = { type: 'file' as never, path: bodyFilePath }
    } else {
      const existingFields = readBodyFields(request)
      request.body = { type: next as never, fields: keyValuesFromRows(existingFields) }
    }
  }, [request, bodyText, bodyFilePath])

  const handleBodyTextChange = useCallback((next: string) => {
    setBodyText(next)
    request.body = { type: 'text' as never, content: next }
  }, [request])

  const handleBodyFilePathChange = useCallback((next: string) => {
    setBodyFilePath(next)
    request.body = { type: 'file' as never, path: next }
  }, [request])

  const handleBodyFieldsChange = useCallback((rows: KeyValueTableRow[]) => {
    request.body = { type: bodyMode as never, fields: keyValuesFromRows(rows) }
  }, [request, bodyMode])

  const handleProducedHeadersChange = useCallback((rows: KeyValueTableRow[]) => {
    request.producedHeaders = keyValuesFromRows(rows)
  }, [request])

  /**
   * Smart-paste: when the user pastes a curl command on the URL row of
   * this form, replace `request.url` / method / headers / body in place.
   * The form mutates the instance directly (no reactive proxy here);
   * `transportEpoch` forces the headers + body-fields tables to remount
   * with `initialRows` re-read from the freshly-mutated request.
   */
  const applyParsedCurl = useCallback((parsed: ParsedCurl): void => {
    request.method = parsed.method
    setMethod(parsed.method)
    request.url = parsed.url
    setUrl(parsed.url)
    request.headers = parsed.headers
    if (parsed.body) {
      const next = parsed.body
      if (next.type === 'text') {
        request.body = { type: 'text' as never, content: next.content }
        setBodyMode('text')
        setBodyText(next.content)
      } else if (next.type === 'form-data') {
        request.body = { type: 'form-data' as never, fields: next.fields }
        setBodyMode('form-data')
      }
    } else {
      request.body = { type: 'text' as never, content: '' }
      setBodyMode('text')
      setBodyText('')
    }
    setTransportEpoch((n) => n + 1)
  }, [request])

  const { pendingPaste } = useCurlPaste({
    hostRef: urlSectionHostRef,
    apply: applyParsedCurl
  })

  const handleExpirationChange = useCallback((next: string) => {
    setExpirationExpression(next)
    if (next) {
      request.expirationExpression = next
    } else {
      delete (request as { expirationExpression?: string }).expirationExpression
    }
  }, [request])

  const handleErrorCodesChange = useCallback((next: string) => {
    setErrorCodesText(next)
    const parsed = parseErrorCodes(next)
    request.authErrorCodes = parsed.length > 0 ? parsed : [401, 403]
  }, [request])

  const methodOptions = useMemo<ISelectOptionItem[]>(
    () => METHODS.map((verb) => ({ text: verb, label: <Badge type={mapToBadgeType(verb)} /> })),
    []
  )

  const handleSend = useCallback(async () => {
    if (isSending) return
    setIsSending(true)
    setHttpResponse(null)
    parsedResponseRef.current = null
    try {
      const api = window.restorm?.auth
      if (!api) {
        setHttpResponse({
          id: `resp_${Date.now()}`,
          type: 'http',
          requestId: request.id,
          requestUrl: request.url,
          requestMethod: request.method,
          requestHeaders: request.headers,
          requestParams: request.params,
          requestPathParams: request.pathParams,
          statusCode: 0,
          statusText: 'IPC unavailable',
          responseHeaders: [],
          responseBody: '',
          error: t('authSetupModal.ipcUnavailable', 'Authentication IPC bridge unavailable'),
          timings: { startedAt: new Date().toISOString(), durationMs: 0 }
        })
        return
      }
      const startedAt = Date.now()
      const result = await api.prefetch(buildAuthPrefetchPayload(request))
      const durationMs = Date.now() - startedAt
      // Detect JSON payloads so `buildHttpResponseViewData` pretty-
      // prints the body with `JSON.stringify(_, null, 2)` and the
      // JsonCrack tab receives parsed data. `auth:prefetch` doesn't
      // surface the raw Content-Type header today; inferring from the
      // body works for the OAuth token endpoints that dominate this
      // flow (Entra ID / Dynamics / Google / etc. all return JSON).
      const responseBody = result.responseBody ?? ''
      const looksLikeJson = (() => {
        const trimmed = responseBody.trim()
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
        try {
          JSON.parse(trimmed)
          return true
        } catch {
          return false
        }
      })()
      // Synthesize an HTTPResponse so BaseRequestTabView's response
      // panel gets its usual shape. responseHeaders stays empty
      // because auth:prefetch doesn't surface them today — acceptable
      // since the Infos tab still shows status / URL / method /
      // duration, and the body is the real payload for debugging.
      const nextResponse: HTTPResponse = {
        id: `resp_${Date.now()}`,
        type: 'http',
        requestId: request.id,
        requestUrl: request.url,
        requestMethod: request.method,
        requestHeaders: request.headers,
        requestParams: request.params,
        requestPathParams: request.pathParams,
        ...(request.body ? { requestBody: request.body } : {}),
        statusCode: result.statusCode,
        statusText: result.success ? 'OK' : 'Error',
        responseHeaders: Object.entries(result.headers).map(([k, v]) => ({
          key: k,
          value: new StringValue(v)
        })),
        responseBody,
        ...(looksLikeJson ? { contentType: 'application/json' } : {}),
        timings: { startedAt: new Date(startedAt).toISOString(), durationMs },
        ...(result.error ? { error: result.error } : {})
      }
      // Parse the body once so the resolved-value column can evaluate
      // producedHeaders templates against it. Kept even on non-2xx so
      // the displayed resolved values always reflect the current
      // response (e.g. an error JSON's fields are still addressable).
      const parsed: Record<string, unknown> | null = (() => {
        if (!looksLikeJson) return null
        try {
          return JSON.parse(responseBody) as Record<string, unknown>
        } catch {
          return null
        }
      })()
      parsedResponseRef.current = parsed
      setHttpResponse(nextResponse)
      // On a 2xx, jump the user to Configuration so they can review
      // the producedHeaders / expiration expressions against the
      // response they just got back (the body is visible side-by-side
      // in the Response tab). We also try to auto-fill the two
      // fields that an OAuth 2.0 Access Token Response (RFC 6749 §5.1)
      // always supplies, because that shape covers the vast majority
      // of providers (Microsoft Entra, Google, Okta, Auth0, Keycloak…)
      // and saves the user from re-typing the obvious.
      if (result.statusCode >= 200 && result.statusCode < 300) {
        setActiveRequestTabId('configuration')
        if (parsed) {
          // Expiration: empty field + `expires_in` present → plug
          // in the standard handlebars expression. Non-destructive:
          // a user-typed value is left as-is.
          if (!request.expirationExpression && parsed['expires_in'] !== undefined) {
            setExpirationExpression('{{expires_in}}')
            request.expirationExpression = '{{expires_in}}'
          }
          // Authorization header: only inject when BOTH fields are
          // present (the token itself is useless without its type)
          // and no Authorization is already configured. We also
          // strip out blank placeholder rows (the KeyValueTable seeds
          // one by default to give users something to type into) so
          // the auto-filled Authorization doesn't land below an
          // empty row in the table.
          const existingNonEmpty = request.producedHeaders.filter(
            (h) => h.key.trim() !== '' || h.value.toString().trim() !== ''
          )
          const hasAuthHeader = existingNonEmpty.some(
            (h) => h.key.toLowerCase() === 'authorization'
          )
          if (!hasAuthHeader && parsed['token_type'] !== undefined && parsed['access_token'] !== undefined) {
            request.producedHeaders = [
              ...existingNonEmpty,
              KeyValue.fromPlain({
                key: 'Authorization',
                value: '{{token_type}} {{access_token}}',
                enabled: true
              })
            ]
            // Bump the remount key so the KeyValueTable re-reads
            // `initialProducedHeaders` and shows the appended row.
            setProducedHeadersRemountKey((k) => k + 1)
          }
        }
      }
    } catch (err) {
      setHttpResponse({
        id: `resp_${Date.now()}`,
        type: 'http',
        requestId: request.id,
        requestUrl: request.url,
        requestMethod: request.method,
        requestHeaders: request.headers,
        requestParams: request.params,
        requestPathParams: request.pathParams,
        statusCode: 0,
        statusText: 'Error',
        responseHeaders: [],
        responseBody: '',
        error: err instanceof Error ? err.message : String(err),
        timings: { startedAt: new Date().toISOString(), durationMs: 0 }
      })
    } finally {
      setIsSending(false)
    }
  }, [isSending, request, t])

  const handleCancel = useCallback(() => {
    // auth:prefetch is a single-shot IPC; there's no cancellation
    // hook exposed. Leaving the button as a visual affordance only.
    setIsSending(false)
  }, [])

  // URL section (identical structure to HTTPRequestTabView's)
  const urlSection = (
    <div ref={urlSectionHostRef} data-testid="local-auth-form-url-section-host">
      {pendingPaste && (
        <CurlPasteCallout
          onConfirm={pendingPaste.confirm}
          onCancel={pendingPaste.cancel}
          data-testid="local-auth-form-curl-paste-callout"
        />
      )}
    <ControlGroup data-testid="local-auth-form-url-section">
      <div style={methodSelectWrapperStyle}>
        <SelectBox
          id="local-auth-form-method-select"
          className=""
          options={methodOptions}
          selected={methodOptions.findIndex((opt) => opt.text === method)}
          onDidSelect={handleMethodChange}
          selectBoxOptions={{ ariaLabel: t('requestTab.methodSelect', 'Method'), useCustomDrawn: true }}
          data-testid="local-auth-form-method-select"
        />
      </div>
      <div style={urlInputWrapperStyle}>
        <InputBox
          value={url}
          onChange={handleUrlChange}
          options={{ placeholder: t('requestTab.urlPlaceholder', 'Enter a URL'), type: 'text' }}
          data-testid="local-auth-form-url-input"
        />
      </div>
      {isSending ? (
        <Button
          icon="close"
          onClick={handleCancel}
          options={{ title: t('requestTab.cancel', 'Cancel'), ariaLabel: t('requestTab.cancel', 'Cancel') }}
          data-testid="local-auth-form-cancel-button"
        />
      ) : (
        <Button
          icon="send"
          emphasis={1}
          onClick={() => { void handleSend() }}
          options={{ title: t('requestTab.send', 'Send'), ariaLabel: t('requestTab.send', 'Send') }}
          data-testid="local-auth-form-send-button"
        />
      )}
    </ControlGroup>
    </div>
  )

  // Request content: vertical stack of static panes, mirroring the
  // Configuration tab. We drop the Authorization pane entirely (an
  // auth *route* setup is itself the authorization), the Path Params
  // pane and the Params pane (an auth token request doesn't use
  // URL-level params in practice). Only Headers and Body remain.
  const requestContent = (
    <ScrollableElement
      options={{ vertical: 'auto', horizontal: 'auto', useShadows: true }}
      style={{ flex: 1, minHeight: 0 }}
      data-testid="local-auth-form-request-scroll"
    >
      <div style={configContainerStyle}>
        <StaticPane
          title={t('requestTab.tabs.headers', 'Headers')}
          data-testid="local-auth-form-headers-pane"
          headerActions={
            <Button
              secondary
              small
              icon="add"
              options={{ ariaLabel: t('requestTab.addHeader', 'Add header'), title: t('requestTab.addHeader', 'Add header') }}
              data-testid="local-auth-form-add-header-button"
              onClick={() => { headersRef.current?.addRow() }}
            />
          }
        >
          <KeyValueTable
            key={`headers-${transportEpoch}`}
            ref={headersRef}
            initialRows={initialHeaders}
            onRowsChange={handleHeadersChange}
            showDescription={false}
            data-testid="local-auth-form-headers-table"
          />
        </StaticPane>

        <StaticPane
          title={t('requestTab.tabs.body', 'Body')}
          data-testid="local-auth-form-body-pane"
          headerActions={
            (bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded')
              ? (
                  <Button
                    secondary
                    small
                    icon="add"
                    options={{ ariaLabel: t('requestTab.body.addField', 'Add field'), title: t('requestTab.body.addField', 'Add field') }}
                    data-testid="local-auth-form-add-body-field-button"
                    onClick={() => { bodyFieldsRef.current?.addRow() }}
                  />
                )
              : undefined
          }
        >
          <RadioGroup
            options={{ items: BODY_MODES.map((mode) => ({ text: mode, isActive: bodyMode === mode })) }}
            onSelect={handleBodyModeChange}
            data-testid="local-auth-form-body-mode"
          />
          {bodyMode === 'text' && (
            <div style={editorContainerStyle}>
              <CodeEditor
                height="300px"
                language="json"
                value={bodyText}
                onChange={(value) => { handleBodyTextChange(value ?? '') }}
                options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true }}
                data-testid="local-auth-form-body-editor"
              />
            </div>
          )}
          {(bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded') && (
            <KeyValueTable
              key={`body-fields-${transportEpoch}`}
              ref={bodyFieldsRef}
              initialRows={initialBodyFields}
              onRowsChange={handleBodyFieldsChange}
              showDescription={false}
              data-testid="local-auth-form-body-fields-table"
            />
          )}
          {bodyMode === 'file' && (
            <div style={fileRowStyle}>
              <span style={fileLabelStyle}>{t('requestTab.body.fileLabel', 'File')}</span>
              <div style={fileInputWrapperStyle}>
                <InputBox
                  value={bodyFilePath}
                  onChange={handleBodyFilePathChange}
                  options={{ placeholder: '/path/to/file', type: 'text' }}
                  data-testid="local-auth-form-body-file-input"
                />
              </div>
              <Button
                options={{ ariaLabel: t('requestTab.body.browse', 'Browse'), title: t('requestTab.body.browse', 'Browse') }}
                data-testid="local-auth-form-body-browse-button"
              >
                {t('requestTab.body.browse', 'Browse')}
              </Button>
            </div>
          )}
        </StaticPane>
      </div>
    </ScrollableElement>
  )

  // Configuration tab — same structure as AuthenticationConfigurationTab
  // but without the Monaco / variable wrappers, since there's nothing
  // to autocomplete against at this stage.
  const configurationTabContent = (
    <ScrollableElement
      options={{ vertical: 'auto', horizontal: 'auto', useShadows: true }}
      style={{ flex: 1, minHeight: 0 }}
      data-testid="local-auth-form-configuration-scroll"
    >
      <div style={configContainerStyle} data-testid="local-auth-form-configuration">
        <StaticPane
          title={t('authRequestTab.producedHeaders', 'Produced headers')}
          data-testid="local-auth-form-produced-headers-pane"
          headerActions={
            <Button
              secondary
              small
              icon="add"
              options={{
                ariaLabel: t('authRequestTab.addProducedHeader', 'Add produced header'),
                title: t('authRequestTab.addProducedHeader', 'Add produced header')
              }}
              onClick={() => { producedHeadersRef.current?.addRow() }}
              data-testid="local-auth-form-add-produced-header-button"
            />
          }
        >
          <span style={hintStyle}>
            {t(
              'authRequestTab.producedHeadersHint',
              'Each value is a handlebars expression evaluated against the auth response (e.g. Bearer {{access_token}}).'
            )}
          </span>
          <KeyValueTable
            key={producedHeadersRemountKey}
            ref={producedHeadersRef}
            initialRows={initialProducedHeaders}
            onRowsChange={handleProducedHeadersChange}
            renderValueCell={ProducedHeaderValueCell}
            showResolvedValue
            renderResolvedValueCell={ResolvedProducedHeaderCell}
            showDescription={false}
            showEnabledToggle={false}
            data-testid="local-auth-form-produced-headers-table"
          />
        </StaticPane>

        <StaticPane
          title={t('authRequestTab.expiration', 'Expiration (seconds)')}
          data-testid="local-auth-form-expiration-pane"
        >
          <span style={hintStyle}>
            {t(
              'authRequestTab.expirationHint',
              'Handlebars expression yielding the seconds after which the cached headers are stale (e.g. {{expires_in}}). Empty ⇒ never auto-expire.'
            )}
          </span>
          <div style={configInputWrapperStyle}>
            <RestormVariableInputBox
              value={expirationExpression}
              onChange={handleExpirationChange}
              variables={EMPTY_VARIABLES}
              helpers={handlebarsHelpers}
              placeholder="{{expires_in}}"
              data-testid="local-auth-form-expiration"
            />
          </div>
        </StaticPane>

        <StaticPane
          title={t('authRequestTab.authErrorCodes', 'Auth error codes')}
          data-testid="local-auth-form-error-codes-pane"
        >
          <span style={hintStyle}>
            {t(
              'authRequestTab.authErrorCodesHint',
              'Comma-separated HTTP status codes. When a downstream request returns one of these, the auth cache is invalidated and the call is retried exactly once. Defaults to 401, 403.'
            )}
          </span>
          <div style={configInputWrapperStyle}>
            <InputBox
              value={errorCodesText}
              onChange={handleErrorCodesChange}
              options={{ placeholder: '401, 403', type: 'text' }}
              data-testid="local-auth-form-error-codes"
            />
          </div>
        </StaticPane>
      </div>
    </ScrollableElement>
  )

  const additionalRequestTabs: Tab[] = [
    {
      id: 'configuration',
      label: t('authRequestTab.tabs.configuration', 'Configuration'),
      useScrollableElement: false,
      content: configurationTabContent
    }
  ]

  const { infosContent, responseContent, jsonData } = useMemo(
    () => buildHttpResponseViewData(httpResponse),
    [httpResponse]
  )

  return (
    <BaseRequestTabView
      requestId={request.id}
      urlSection={urlSection}
      requestContent={requestContent}
      codeSnippetsContent=""
      isLoading={isSending}
      showResponse={httpResponse !== null}
      infosContent={infosContent}
      responseContent={responseContent}
      jsonData={jsonData}
      additionalRequestTabs={additionalRequestTabs}
      showNotes={false}
      showCodeSnippets={false}
      activeRequestTabId={activeRequestTabId}
      onRequestTabChange={setActiveRequestTabId}
      initialLeftRatio={0.5}
    />
  )
}
