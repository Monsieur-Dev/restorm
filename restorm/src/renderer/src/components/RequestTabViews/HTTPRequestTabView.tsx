import React, { type CSSProperties, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { computeInitialPanelCollapsed } from './conflictPanelExpansion'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  SelectBox,
  SplitView,
  Pane,
  ControlGroup,
  InputBox,
  Toggle,
  eventBus,
  logger,
  getContrastColor,
  fieldDiffStyle,
  type VariableDefinition,
  type ISelectOptionItem,
  type ISelectData,
  type Tab
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { EntityFieldDiff } from '../../services/conflictFieldDiff'
import type { HTTPRequest, HTTPResponse, HTTPMethod, KeyValue, ResponseHistoryDetail, AuthenticationRequest } from '../../../../shared/types/collections'
import { isAuthenticationRequest } from '../../../../shared/types/collections'
import { StringValue } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { useAuthRequestResolver } from '../../contexts/authRequestResolverContext'
import type { KeyValueData } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { AuthenticationConfigurationTab } from './AuthenticationConfigurationTab'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { ServerConfigLockedHint } from '../common/ServerConfigLockedHint'
import { RegistryBadge } from '../common/RegistryBadge'
import { KNOWN_HTTP_METHODS, httpBadgeIdFor } from '../../../../shared/utils/httpMethod'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../../../shared/config/constants'
import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import { buildHttpResponseViewData } from './HTTPResponsePanel'
import { HTTPRequestBodySection } from './HTTPRequestBodySection'
import type { HTTPRequestBody } from '../../../../shared/types/requestPrimitives'
import { updateReactiveProperty, toKeyValuesFromHistory } from './requestTabViewUtils'
import { useApiDocumentationFromRequest } from '../../hooks/useApiDocumentationFromRequest'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { findOperationForRoute } from '../../../../shared/utils/findOperationForRoute'
import { useCurlPaste, type ParsedCurl } from '../../hooks/useCurlPaste'
import { CurlPasteCallout } from '../CurlPasteCallout'
import { toasterService } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

const methodSelectWrapperStyle: CSSProperties = { width: 90, flexShrink: 0 }
const urlInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
// SERVER MODE (HTTP mock) URL-section pieces: a fixed "localhost:" / "/" label
// and the narrow numeric port field, mirroring the WebSocket server layout.
const serverHostLabelStyle: CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 4px', whiteSpace: 'nowrap', opacity: 0.8 }
const serverPortWrapperStyle: CSSProperties = { width: 80, flexShrink: 0 }
const requestOptionsRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 16, padding: '6px 4px', flexWrap: 'wrap' }
const timeoutFieldStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 }
const timeoutLabelStyle: CSSProperties = { color: 'var(--descriptionForeground)', whiteSpace: 'nowrap' }

/** Coarse, whole-section conflict border (AC#4) for a list-shaped Pane
 * (headers / params / pathParams / body / producedHeaders) — bordering the
 * Pane's content wrapper rather than diffing per-row, per the ticket's
 * own "URL differs → border URL input" granularity example (discrete
 * inputs only; list sections are all-or-nothing). */
function sectionDiffWrapperStyle(differs: boolean): CSSProperties {
  return { height: '100%', boxSizing: 'border-box', border: '2px solid transparent', ...fieldDiffStyle(differs) }
}

export interface HTTPRequestTabViewProps {
  /** An HTTPRequest or an AuthenticationRequest. The latter inherits
   * every HTTP field but adds a Configuration tab surfaced via
   * `additionalRequestTabs`. */
  request: HTTPRequest | AuthenticationRequest
  /** Conflict-resolution field-diff (AC#4/#5) — `computeEntityFieldDiff`'s
   * result for this request, computed once per conflict by
   * `GitConflictResolutionModal` and passed to every panel identically.
   * Red-borders the differing discrete inputs (url/method/notes/auth
   * config) and coarse-borders the differing list sections (headers/
   * params/pathParams/body) as a whole. Only ever set by
   * `ConflictEntityPanel`; `undefined` in the live (non-conflict) editor. */
  conflictFieldDiff?: EntityFieldDiff
  /** Conflict resolution: restrict the request-side tab strip to these
   * ids (forwarded verbatim to `BaseRequestTabView`). */
  conflictVisibleTabIds?: string[]
  /** Conflict resolution: extra tabs appended to the strip (the contested
   * tag list), forwarded verbatim to `BaseRequestTabView`. */
  conflictExtraTabs?: Tab[]
  /** The diff's per-section booleans, used ONLY for the initial
   * expand/collapse of the KV sections (differing sections open, identical
   * ones closed). Passed to ALL THREE conflict columns — unlike
   * `conflictFieldDiff`, which also paints red borders and is therefore
   * kept off the editable resolved panel — so the columns stay visually
   * aligned section-for-section. */
  conflictPanelFields?: Record<string, boolean>
  /** Preselects the tab holding the conflicting field (AC#5) — forwarded
   * to `BaseRequestTabView`'s `defaultActiveTabId`. */
  defaultActiveTabId?: string
  /** Fully-controlled request-side tab pair, forwarded verbatim to
   * `BaseRequestTabView`. The conflict panels use it to mirror the tab
   * selection across the three columns — any column's strip drives it
   * (`ReadOnlyOverlay` lets tab clicks through as navigation). */
  activeRequestTabId?: string
  onRequestTabChange?: (tabId: string) => void
  /** Hides the (non-editable, generated) Code Snippets tab — AC#5's "HIDE
   * non-editable tabs". Defaults to `true` (visible) for the live editor;
   * the conflict panel passes `false`. */
  showCodeSnippets?: boolean
  /** Blanket conflict-mode safety rule (AC#2/#5, see
   * `conflictSafeLiveState.ts`): forces the server-mode `isListening` beam
   * to `false` and skips the live progress/served-count subscription — a
   * conflict panel is a static historical snapshot, never a live mock
   * server. Only meaningful when `request.server === true`. */
  conflictMode?: boolean
}

function buildRequestBodyFromHistory(body: { type: string; content?: string; path?: string; fields?: { key: string; value: string; enabled?: boolean }[] } | undefined): HTTPResponse['requestBody'] {
  if (!body) return undefined
  if (body.type === 'text') {
    return { type: 'text', content: body.content ?? '' }
  }
  if (body.type === 'file') {
    return { type: 'file', path: body.path ?? '' }
  }
  if (body.type === 'form-data' || body.type === 'x-www-form-urlencoded') {
    const fields = (body.fields ?? []).map((field) => ({
      key: field.key,
      value: new StringValue(field.value),
      enabled: field.enabled
    }))
    return { type: body.type, fields }
  }
  return undefined
}

/** Determine body mode from request body type */
function getBodyMode(request: HTTPRequest | AuthenticationRequest): 'text' | 'form-data' | 'x-www-form-urlencoded' | 'file' {
  if (!request.body) return 'text'
  switch (request.body.type) {
    case 'text': return 'text'
    case 'file': return 'file'
    case 'form-data': return 'form-data'
    case 'x-www-form-urlencoded': return 'x-www-form-urlencoded'
    default: return 'text'
  }
}

/** Get body content for text mode */
function getBodyContent(request: HTTPRequest | AuthenticationRequest): string {
  if (request.body?.type === 'text') {
    return request.body.content
  }
  return ''
}

/** Get body file path for file mode */
function getBodyFilePath(request: HTTPRequest | AuthenticationRequest): string {
  if (request.body?.type === 'file') {
    return request.body.path
  }
  return ''
}

export const HTTPRequestTabView: React.FC<HTTPRequestTabViewProps> = ({
  request,
  conflictFieldDiff,
  conflictVisibleTabIds,
  conflictExtraTabs,
  conflictPanelFields,
  defaultActiveTabId,
  activeRequestTabId,
  onRequestTabChange,
  showCodeSnippets = true,
  conflictMode
}) => {
  const conflictFields = conflictFieldDiff?.fields
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  // `projectUuid` lives on the EnvironmentContext (mirrored from the
  // workbench's `persistenceKey`). Sourcing it from here — rather than
  // `useFileService` — guarantees it's already non-null at the first
  // render: `useFileService` in a child component spins up its own
  // store and seeds asynchronously, which would race the
  // `requestPanelStateStore` lookup in `useState`'s lazy initializer
  // below and silently fall through to the empty-section heuristic
  // on a tab reopen.
  const { selectedEnvId, environments, envColor, envIcon, envPaintColor, projectUuid } = useEnvironmentContext()
  // The fixed bar anchors on the workbench tab, so it only exists there; the
  // conflict / auth modals keep the button inline in the URL row.
  const inWorkbenchTab = useIsInWorkbenchTab()
  const resolveAuthRequest = useAuthRequestResolver()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const { apiDocumentation, route } = useApiDocumentationFromRequest(request)
  // Matched OpenAPI operation for the current request — drives both
  // the Docs tab mount and the per-code tooltip in the Infos tab.
  const matchedOperation = useMemo(() => {
    if (!apiDocumentation || !route) return undefined
    return findOperationForRoute(apiDocumentation, route) ?? undefined
  }, [apiDocumentation, route])
  // Only mount the Docs tab when the request's URL actually maps to an
  // operation in the spec — otherwise the tab would render an empty
  // shell whenever the user is editing a URL that doesn't match
  // anything (which is exactly when the spec viewer would be useless).
  const docsContent = useMemo(() => {
    if (!apiDocumentation || !route || !matchedOperation) return undefined
    return (
      <DocumentationHost
        apiDocumentation={apiDocumentation}
        filters={[route]}
        testId="http-request-documentation-host"
      />
    )
  }, [apiDocumentation, route, matchedOperation])
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [method, setMethod] = useState<string>(request.method)
  const [url, setUrl] = useState<string>(request.url)
  const [body, setBody] = useState<string>(getBodyContent(request))
  const [bodyMode, setBodyMode] = useState<'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'>(getBodyMode(request))
  const [bodyFilePath, setBodyFilePath] = useState<string>(getBodyFilePath(request))
  const [isSending, setIsSending] = useState<boolean>(false)
  const [httpResponse, setHttpResponse] = useState<HTTPResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // SERVER MODE (HTTP mock): whether restorm is hosting this route + how many
  // requests it has served while listening.
  const [isListening, setIsListening] = useState<boolean>(false)
  const [servedCount, setServedCount] = useState<number>(0)
  // Per-request execution options apply only to genuine HTTP requests
  // (an AuthenticationRequest reuses this view but has no timeout /
  // follow-redirects). `httpReq` is the request narrowed to HTTP, or
  // undefined when it's the auth variant.
  const httpReq: HTTPRequest | undefined = isAuthenticationRequest(request) ? undefined : request
  // Timeout is an empty string when the request uses the global default;
  // follow-redirects defaults to on.
  const [timeoutMs, setTimeoutMs] = useState<string>(
    typeof httpReq?.timeout === 'number' ? String(httpReq.timeout) : ''
  )
  const [followRedirects, setFollowRedirects] = useState<boolean>(httpReq?.followRedirects !== false)

  // Lift the SplitView's per-pane collapsed state up into
  // HTTPRequestTabView so it survives the SplitView's remount when
  // `BaseRequestTabView` swaps `<div>` for `<VerticalSashContainer>`
  // on first-response (and vice-versa). Each Pane is rendered with
  // `collapsed={panelCollapsed[paneId]}`, which puts the SplitView
  // in fully-controlled mode (see ECUI `collapsedLogic.ts`) — every
  // toggle round-trips through this state, every remount re-hydrates
  // from it.
  //
  // Initial values: per-request user-level store (survives tab
  // close + file close), falling back to the empty-section heuristic
  // when no entry exists yet. Snapshot via lazy useState initializer
  // so the heuristic only runs once per mount.
  const [panelCollapsed, setPanelCollapsed] = useState<{
    headers: boolean
    pathParams: boolean
    params: boolean
    body: boolean
  }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return computeInitialPanelCollapsed(
      seed,
      {
        headers: request.headers.length === 0,
        pathParams: (request.pathParams?.length ?? 0) === 0,
        params: request.params.length === 0,
        body: false
      },
      conflictPanelFields ?? conflictFieldDiff?.fields
    )
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    // SplitView fires this with the array in pane render order:
    // headers, pathParams, params, body.
    const next = {
      headers: arr[0] ?? false,
      pathParams: arr[1] ?? false,
      params: arr[2] ?? false,
      body: arr[3] ?? false
    }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'headers', next.headers)
      setRequestPanelCollapsed(projectUuid, request.id, 'pathParams', next.pathParams)
      setRequestPanelCollapsed(projectUuid, request.id, 'params', next.params)
      setRequestPanelCollapsed(projectUuid, request.id, 'body', next.body)
    }
  }, [projectUuid, request.id])

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  
  const headersParamsRef = useRef<KeyValueTableHandle | null>(null)
  const queryParamsRef = useRef<KeyValueTableHandle | null>(null)
  const pathParamsRef = useRef<KeyValueTableHandle | null>(null)
  const requestIdRef = useRef<string>(request.id)
  // Bumped on smart-paste apply so the KV tables remount and re-read
  // their `initialRows` from the now-mutated request object.
  const [transportEpoch, setTransportEpoch] = useState(0)
  // Re-sync local state when a quick-config load (or MCP update_request)
  // replaces the transport. useTransportReplaced fires the callback once
  // per event for this request. The KV tables (headers / params /
  // pathParams) remount via transportEpoch so they re-read `initialRows`
  // from the now-mutated request object.
  //
  // Why a ref instead of `request` in the callback: the reactive proxy's
  // reference is stable per request id, so we capture it through a ref to
  // avoid re-registering the subscription on parent re-renders (which would
  // starve the lazy Monaco mount in sibling URL + body editors).
  const transportReplacedRequestRef = useRef(request)
  useEffect(() => { transportReplacedRequestRef.current = request }, [request])
  const handleTransportReplaced = useCallback(() => {
    const current = transportReplacedRequestRef.current
    setMethod(current.method)
    setUrl(current.url)
    setBody(getBodyContent(current))
    setBodyMode(getBodyMode(current))
    setBodyFilePath(getBodyFilePath(current))
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)
  const urlSectionHostRef = useRef<HTMLDivElement | null>(null)
  const sourceIdRef = useRef<string>('')
  sourceIdRef.current ||= crypto.randomUUID()
  const urlVariablesBootstrappedRef = useRef<boolean>(false)

  // Own-echo handling for resolvedUrl + codeSnippets : skipped during an active typing burst
  // to avoid re-rendering Monaco's parent (which would desync value prop vs editor content
  // and cause cursor jumps), then flushed after a short idle delay so the tooltip / snippets
  // catch up with the latest typed state.
  const pendingResolvedUrlRef = useRef<string | null>(null)
  const pendingCodeSnippetsRef = useRef<string | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const SETTLE_DELAY_MS = 400

  // Reset local state when switching to a different request
  const handleRequestReset = useCallback(() => {
    setMethod(request.method)
    setUrl(request.url)
    setBody(getBodyContent(request))
    setBodyMode(getBodyMode(request))
    setBodyFilePath(getBodyFilePath(request))
    setHttpResponse(null)
  }, [request])
  useRequestReset(request, handleRequestReset)
  // Keep requestIdRef in sync for guard checks in other effects
  useEffect(() => { requestIdRef.current = request.id }, [request.id])

  // Convert KeyValue arrays to plain objects for IPC. Shared with
  // the other request tabs so `isExpression` propagation stays
  // consistent.
  const toKeyValueData = useCallback((kvs: KeyValue[]): KeyValueData[] =>
    toKeyValueDataShared(kvs), [])

  // Own-echo handling: during an active typing burst we buffer the latest resolved URL /
  // code snippets in refs (no setState → no re-render). After a short idle delay we apply the
  // latest buffered value so the tooltip / snippets catch up with what the user typed.
  const scheduleSettleFlush = useCallback((): void => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null
      if (pendingResolvedUrlRef.current !== null) {
        const value = pendingResolvedUrlRef.current
        pendingResolvedUrlRef.current = null
        setResolvedUrl(value)
      }
      if (pendingCodeSnippetsRef.current !== null) {
        const value = pendingCodeSnippetsRef.current
        pendingCodeSnippetsRef.current = null
        setBackendCodeSnippets(value)
      }
    }, SETTLE_DELAY_MS)
  }, [])

  // Subscribe to backend URL and code snippets updates. Own-echoes are buffered + flushed
  // after idle (see scheduleSettleFlush) to avoid disturbing Monaco during active typing.
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return

    const unsubUrl = window.restorm?.context.onUrlResolved((result) => {
      if (result.requestId !== requestId) return
      if (result.sourceId === sourceIdRef.current) {
        pendingResolvedUrlRef.current = result.resolvedUrl
        scheduleSettleFlush()
        return
      }
      setResolvedUrl(result.resolvedUrl)
    })

    const unsubSnippets = window.restorm?.context.onCodeSnippetsUpdated((result) => {
      if (result.requestId !== requestId) return
      if (result.sourceId === sourceIdRef.current) {
        pendingCodeSnippetsRef.current = result.markdown
        scheduleSettleFlush()
        return
      }
      setBackendCodeSnippets(result.markdown)
    })

    // Get initial values if they exist
    void window.restorm?.context.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    void window.restorm?.context.getCodeSnippets(requestId).then((result) => {
      if (result) setBackendCodeSnippets(result.markdown)
    })

    return () => {
      unsubUrl?.()
      unsubSnippets?.()
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
    }
  }, [request.id, scheduleSettleFlush])

  // Refs to capture initial values for registration (avoid re-running effect when these change)
  const selectedEnvIdRef = useRef(selectedEnvId)
  const requestRef = useRef(request)
  const environmentsRef = useRef(environments)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { requestRef.current = request }, [request])
  useEffect(() => { environmentsRef.current = environments }, [environments])

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return

    const currentEnvId = selectedEnvIdRef.current ?? environmentsRef.current?.[0]?.id ?? null
    const currentRequest = requestRef.current
    logger.debug('[HTTPRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    void window.restorm?.context.registerRequest(requestId, currentEnvId ?? null, {
      headers: toKeyValueData(currentRequest.headers),
      params: toKeyValueData(currentRequest.params),
      pathParams: currentRequest.pathParams ? toKeyValueData(currentRequest.pathParams) : []
    })
    // Tell main which envs are visible to this request — used by the
    // auth-resolver so a child auth can inherit the calling request's
    // env when it's also valid for the auth route.
    const initialAvailable = environmentsRef.current?.map((e) => e.id) ?? []
    void window.restorm?.context.setAvailableEnvironments(requestId, initialAvailable)

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[HTTPRequestTabView] Unregistering request from ContextService', { requestId })
      void window.restorm?.context.unregisterRequest(requestId)
    }
    // Only re-register when the request ID changes (mount/unmount).
    // Environment changes are handled by the separate setRequestEnvironment effect below.
    // toKeyValueData is a stable useCallback with [] deps, so it never changes.
  }, [request.id, toKeyValueData])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return

    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[HTTPRequestTabView] Environment changed, notifying ContextService', {
        requestId,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm?.context.setRequestEnvironment(requestId, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Push the in-scope env IDs whenever the env tree changes. The
  // auth-resolver consults this set to decide whether to inherit the
  // calling request's env.
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return
    const ids = environments?.map((e) => e.id) ?? []
    void window.restorm?.context.setAvailableEnvironments(requestId, ids)
  }, [environments, request.id])

  // Sync method changes to reactive object
  useEffect(() => {
    if (method !== request.method && requestIdRef.current === request.id) {
      updateReactiveProperty(request, 'method', method)
    }
  }, [method, request])

  // Sync url changes to reactive object
  useEffect(() => {
    if (url !== request.url && requestIdRef.current === request.id) {
      updateReactiveProperty(request, 'url', url)
    }
  }, [url, request])

  // Sync per-request timeout to the reactive object. An empty / invalid
  // entry clears the override (the executor falls back to the global
  // default); a positive integer persists as the per-request value.
  useEffect(() => {
    if (requestIdRef.current !== request.id) return
    if (isAuthenticationRequest(request)) return
    const trimmed = timeoutMs.trim()
    const parsed = trimmed === '' ? undefined : Number(trimmed)
    const next = parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    if (next !== request.timeout) {
      updateReactiveProperty(request, 'timeout', next)
    }
  }, [timeoutMs, request])

  // Sync follow-redirects to the reactive object. Only the explicit
  // "off" value is persisted; on (the default) leaves the field unset.
  useEffect(() => {
    if (requestIdRef.current !== request.id) return
    if (isAuthenticationRequest(request)) return
    const next = followRedirects ? undefined : false
    if (next !== request.followRedirects) {
      updateReactiveProperty(request, 'followRedirects', next)
    }
  }, [followRedirects, request])

  // Sync body changes to reactive object
  useEffect(() => {
    if (requestIdRef.current !== request.id) return
    if (bodyMode === 'text') {
      const currentContent = request.body?.type === 'text' ? request.body.content : ''
      if (body !== currentContent) {
        // An empty text body persists the same shape as "no body at
        // all" — both round-trip to a request without a `body` key.
        // Storing the wrapping object `{type:'text',content:''}` here
        // would diverge from a request imported without a body
        // (`request.body === undefined`), so the dirty-state diff
        // would lock dirty after a type-then-clear cycle even though
        // the in-memory tree matches the on-disk reference.
        const next: HTTPRequestBody | undefined = body === ''
          ? undefined
          : { type: 'text' as const, content: body }
        updateReactiveProperty(request, 'body', next)
      }
    } else if (bodyMode === 'file') {
      const currentPath = request.body?.type === 'file' ? request.body.path : ''
      if (bodyFilePath !== currentPath) {
        const next: HTTPRequestBody | undefined = bodyFilePath === ''
          ? undefined
          : { type: 'file' as const, path: bodyFilePath }
        updateReactiveProperty(request, 'body', next)
      }
    }
  }, [body, bodyMode, bodyFilePath, request])

  // HTTP-mock fields, read once with the HTTP-only cast (an AuthenticationRequest
  // reuses this view and never has them, so they read as undefined). Extracted
  // here so the effect below can depend on plain values, not a cast expression.
  const mockServerFlag = (request as HTTPRequest).server
  const mockStatusValue = (request as HTTPRequest).mockStatus

  // Send full request data to backend for URL resolution and code snippets
  useEffect(() => {
    const requestId = request.id
    if (!requestId || requestIdRef.current !== request.id) return

    // Build body data
    let bodyData: { type: string; content?: string; path?: string; fields?: KeyValueData[] } | undefined
    if (bodyMode === 'text' && body) {
      bodyData = { type: 'text', content: body }
    } else if (bodyMode === 'file' && bodyFilePath) {
      bodyData = { type: 'file', path: bodyFilePath }
    } else if ((bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded') && request.body?.type === bodyMode) {
      bodyData = { type: bodyMode, fields: toKeyValueData(request.body.fields) }
    }

    void window.restorm?.context.updateFullRequestData(requestId, {
      id: requestId,
      // HTTPRequestTabView is reused for both `http` and `auth` tabs
      // (auth requests share the HTTP form layout). Preserve the real
      // discriminator so consumers — search index, code-snippet
      // generator, downstream branches — can tell them apart.
      requestType: request.type === 'auth' ? 'auth' : 'http',
      url,
      method,
      headers: toKeyValueData(request.headers),
      params: toKeyValueData(request.params),
      pathParams: request.pathParams ? toKeyValueData(request.pathParams) : [],
      body: bodyData,
      // HTTP mock server: host flag + served status so the main process can
      // listen + answer with the configured response. `server`/`mockStatus` are
      // HTTP-only — an AuthenticationRequest (which reuses this view) never has
      // them, so they read as undefined.
      ...(mockServerFlag !== undefined ? { server: mockServerFlag } : {}),
      ...(mockStatusValue !== undefined ? { mockStatus: mockStatusValue } : {})
    }, sourceIdRef.current)
  }, [request.id, request.type, url, method, request.headers, request.params, request.pathParams, body, bodyMode, bodyFilePath, request.body, mockServerFlag, mockStatusValue, toKeyValueData])
  
  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  
  // URL field variableId (for receiving its specific available variables)
  const urlVariableId = useMemo(() => `${request.id}:url`, [request.id])
  
  // Available variables for URL field autocompletion (env + all path params)
  const [urlVariables, setUrlVariables] = useState<VariableDefinition[]>([])
  
  // Listen for URL field available variables from backend
  useEffect(() => {
    const varId = urlVariableId
    if (!varId || varId === 'undefined:url') return

    const unsubscribe = window.restorm?.context.onAvailableVariables((result) => {
      if (result.variableId !== varId) return
      // First own-echo bootstraps the variables list (needed for Monaco hover + autocomplete
      // to show resolved values). After that, own-echoes are skipped to avoid mid-typing renders.
      if (result.sourceId === sourceIdRef.current && urlVariablesBootstrappedRef.current) {
        return
      }
      urlVariablesBootstrappedRef.current = true
      const newVars = result.variables
      setUrlVariables(prev => {
        if (prev.length !== newVars.length) return newVars
        const hasChanges = newVars.some((v, i) => {
          const prevItem = prev[i]
          return prevItem && (prevItem.name !== v.name || prevItem.value !== v.value)
        })
        return hasChanges ? newVars : prev
      })
    })

    return () => { unsubscribe?.() }
  }, [urlVariableId])

  // Callbacks for KeyValue changes - notify the reactive object + ContextService.
  //
  // Deliberately NOT mirrored onto the main-side CollectionStore here.
  // `setCollections` is a whole-tree REPLACE, so firing it per row edit
  // republishes the renderer's copy of everything — and anything main owns
  // that the renderer's tree predates (a just-saved quick config, a fresh
  // clone, a git arbitration result) is destroyed by the overwrite. The
  // scenario run reads its rows' live state from ContextService instead; see
  // `overlayLiveKeyValues` in the scenario engine.
  const handleHeadersChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'headers', rows)
    const requestId = request.id
    if (requestId) {
      void window.restorm?.context.updateRequestKeyValues(
        requestId,
        'headers',
        rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
        sourceIdRef.current
      )
    }
  }, [request])

  const handleParamsChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'params', rows)
    const requestId = request.id
    if (requestId) {
      void window.restorm?.context.updateRequestKeyValues(
        requestId,
        'params',
        rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
        sourceIdRef.current
      )
    }
  }, [request])

  const handlePathParamsChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'pathParams', rows)
    const requestId = request.id
    if (requestId) {
      void window.restorm?.context.updateRequestKeyValues(
        requestId,
        'pathParams',
        rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
        sourceIdRef.current
      )
    }
  }, [request])

  // Combo entries: every well-known verb as its registry badge, plus the
  // request's CURRENT method when it isn't one of them (a free-typed verb),
  // so the closed trigger always has an option to render — the custom verb
  // shows on the `http_other` color with its exact typed casing, and a
  // known verb typed in non-standard casing ("Post") shows on its verb
  // color with the typed casing.
  const methodOptions = useMemo<ISelectOptionItem[]>(() => {
    const verbs: string[] = [...KNOWN_HTTP_METHODS]
    if (!verbs.includes(method)) verbs.push(method)
    return verbs.map((verb) => ({
      text: verb,
      label: <RegistryBadge badgeId={httpBadgeIdFor(verb)} text={verb} />
    }))
  }, [method])

  /**
   * Smart-paste: when the user pastes a `curl` command on the URL
   * section, replace the request's transport fields with the parsed
   * values. Mutates the reactive proxy directly (so anyone listening
   * via the event bus sees the new values), refreshes local React
   * state for fields that drive the UI, and bumps `transportEpoch`
   * so the KV tables remount with `initialRows` reflecting the new
   * arrays.
   */
  const applyParsedCurl = useCallback((parsed: ParsedCurl): void => {
    updateReactiveProperty(request, 'method', parsed.method)
    setMethod(parsed.method)
    updateReactiveProperty(request, 'url', parsed.url)
    setUrl(parsed.url)
    updateReactiveProperty(request, 'headers', parsed.headers)
    updateReactiveProperty(request, 'params', parsed.params)
    // cURL has no notion of "path params" — clear them so a stale
    // entry from before the paste doesn't survive the replace.
    updateReactiveProperty(request, 'pathParams', [])
    if (parsed.body) {
      updateReactiveProperty(request, 'body', parsed.body)
      const next = parsed.body
      if (next.type === 'text') {
        setBody(next.content)
        setBodyMode('text')
      } else if (next.type === 'form-data') {
        setBody('')
        setBodyMode('form-data')
      } else if (next.type === 'x-www-form-urlencoded') {
        setBody('')
        setBodyMode('x-www-form-urlencoded')
      }
    } else {
      updateReactiveProperty(request, 'body', undefined)
      setBody('')
      setBodyMode('text')
      setBodyFilePath('')
    }
    setTransportEpoch((n) => n + 1)
    toasterService.push('app', {
      title: 'Replaced from cURL',
      body: 'Request transport fields populated from the pasted curl command.',
      durationMs: 10000
    })
  }, [request])

  const { pendingPaste } = useCurlPaste({
    hostRef: urlSectionHostRef,
    apply: applyParsedCurl
  })

  const handleSend = useCallback((): void => {
    if (isSending) return
    const requestId = request.id
    if (!requestId) {
      logger.error('Cannot send request without ID')
      return
    }
    setIsSending(true)
    setHttpResponse(null)

    // Look the auth request up (if any) so the main-process executor
    // can run its cache-or-fetch + header-inject flow before firing
    // this request. The auth coming out of `rootItems` is a reactive
    // Proxy wrapping an `AuthenticationRequest` class instance with
    // `KeyValue` / `StringValue` / `SecretValue` fields — structured
    // clone (which Electron IPC uses) rejects those. We run
    // `toPlainObject()` to flatten the class graph into persisted
    // form, then a JSON round-trip to strip any stray class instances
    // the graph still references (reactive Proxies carry class-type
    // leaves like `StringValue` for `KeyValue.value` that
    // `serializeValueForPersistence` already knows how to handle on
    // the main side via `fromPlain`).
    const authAttachedId = request.authenticationRequestId
    const attachedAuth = authAttachedId ? resolveAuthRequest(authAttachedId) : null
    const authPlain = attachedAuth
      ? attachedAuth.toPlainObject?.() ?? attachedAuth
      : undefined
    const authRequestPayload = authPlain !== undefined
      ? JSON.parse(JSON.stringify(authPlain)) as unknown
      : undefined

    // Execute via backend. Timeout + follow-redirects are per-request,
    // overridable fields; fall back to the global default / on when the
    // request leaves them unset.
    window.restorm?.http.execute({
      requestId,
      method,
      timeout: typeof httpReq?.timeout === 'number' ? httpReq.timeout : DEFAULT_REQUEST_TIMEOUT_MS,
      followRedirects: httpReq?.followRedirects !== false,
      ...(requestPath ? { requestPath } : {}),
      ...(authRequestPayload ? { authRequest: authRequestPayload } : {})
    })
      .then((result) => {
        if (result.success) {
          // Convert backend result to HTTPResponse format
          const responseHeaders: KeyValue[] = []
          if (result.headers) {
            for (const [key, value] of Object.entries(result.headers)) {
              responseHeaders.push({
                key,
                value: new StringValue(Array.isArray(value) ? value.join(', ') : value)
              })
            }
          }

          const contentTypeHeader = result.headers?.['content-type']
          const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
          const contentLengthHeader = result.headers?.['content-length']
          const contentLengthStr = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader
          const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined

          // Prefer the actually-dispatched headers from the executor
          // (they include auth injections). Fall back to the user-
          // configured list for envelopes where the main side didn't
          // surface them (older server builds, error branches).
          const dispatchedHeaders: KeyValue[] = result.requestHeaders
            ? Object.entries(result.requestHeaders).map(([k, v]) => ({
                key: k,
                value: new StringValue(v)
              } as KeyValue))
            : request.headers

          const response: HTTPResponse = {
            id: `resp_${Date.now()}`,
            type: 'http',
            requestId,
            requestUrl: result.requestUrl ?? '',
            requestMethod: method as HTTPMethod,
            requestHeaders: dispatchedHeaders,
            requestParams: request.params,
            requestPathParams: request.pathParams,
            statusCode: result.statusCode ?? 0,
            statusText: result.statusText ?? '',
            responseHeaders,
            responseBody: result.body ?? '',
            ...(result.bodyIsBase64 ? { bodyIsBase64: true } : {}),
            timings: result.timings,
            ...(request.body && { requestBody: request.body }),
            ...(contentType && { contentType }),
            ...(contentLength !== undefined && !isNaN(contentLength) && { contentLength })
          }
          setHttpResponse(response)
          setHistoryRefreshKey(prev => prev + 1)
          eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
          logger.info('HTTP request completed', {
            url: result.requestUrl,
            status: result.statusCode,
            duration: result.timings.durationMs
          })
        } else {
          // Handle error
          const errorResponse: HTTPResponse = {
            id: `resp_${Date.now()}`,
            type: 'http',
            requestId,
            requestUrl: result.requestUrl ?? url,
            requestMethod: method as HTTPMethod,
            requestHeaders: request.headers,
            requestParams: request.params,
            requestPathParams: request.pathParams,
            statusCode: 0,
            statusText: 'Error',
            responseHeaders: [],
            responseBody: '',
            error: result.error,
            timings: result.timings,
            ...(request.body && { requestBody: request.body })
          }
          setHttpResponse(errorResponse)
          setHistoryRefreshKey(prev => prev + 1)
          eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
          logger.error('HTTP request failed', { error: result.error })
        }
      })
      .catch((err: unknown) => {
        logger.error('HTTP request execution error', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }, [isSending, request, httpReq, method, url, requestPath, resolveAuthRequest])

  const handleCancel = useCallback((): void => {
    const requestId = request.id
    if (!requestId) return
    window.restorm?.http.cancel(requestId)
      .then((cancelled) => {
        if (cancelled) {
          logger.info('HTTP request cancelled', { requestId })
        }
      })
      .catch((err: unknown) => {
        logger.error('Failed to cancel HTTP request', { error: String(err) })
      })
  }, [request.id])

  // ----------------------------------------------------------------------
  // SERVER MODE: restorm acts as a local HTTP mock server. The host is forced
  // to localhost — only the port + path are user-configurable (alongside the
  // existing METHOD selector) — and the Send button becomes a Listen↔Stop
  // toggle. The configured response (status/headers/body) is served verbatim
  // (Handlebars-resolved at serve time) to every matching inbound request.
  // ----------------------------------------------------------------------
  const isServer = mockServerFlag === true
  // The served response (headers/pathParams/params/body) was snapshotted at
  // Listen time — editing it live has no effect until the next start, so the
  // whole config surface locks while the mock server is up.
  const configLocked = isServer && isListening
  const { serverPort, serverPath } = useMemo(() => {
    const stripped = url.replace(/^[a-z]+:\/\//i, '')
    const slash = stripped.indexOf('/')
    const hostPort = slash >= 0 ? stripped.slice(0, slash) : stripped
    const path = slash >= 0 ? stripped.slice(slash + 1) : ''
    const port = hostPort.split(':')[1] ?? ''
    return { serverPort: port, serverPath: path }
  }, [url])
  const composeServerUrl = useCallback((port: string, pathPart: string): string => {
    const cleanPath = pathPart.replace(/^\/+/, '')
    return `localhost:${port}/${cleanPath}`
  }, [])
  const setServerPort = useCallback((p: string): void => {
    setUrl(composeServerUrl(p.replace(/[^0-9]/g, ''), serverPath))
  }, [composeServerUrl, serverPath])
  const setServerPath = useCallback((p: string): void => {
    setUrl(composeServerUrl(serverPort, p))
  }, [composeServerUrl, serverPort])

  // Listen = start hosting the mock route. It stays up (no timeout) until Stop /
  // file close / quit; the promise resolves when the route stops.
  const handleListen = useCallback((): void => {
    const requestId = request.id
    if (!requestId || isListening || conflictMode) return
    setServedCount(0)
    void window.restorm?.http.listen(requestId)
      .then((res) => {
        if (res.error) {
          toasterService.push('app', { title: t('http.server.listenFailed'), body: res.error, durationMs: 10000 })
          logger.error('HTTP mock server failed to listen', { error: res.error })
        }
      })
      .catch((err: unknown) => { logger.error('HTTP mock server listen error', { error: String(err) }) })
  }, [request.id, isListening, conflictMode, t])

  const handleStop = useCallback((): void => {
    void window.restorm?.http.stop(request.id)
  }, [request.id])

  // Track listening state + served count for the hosted mock route. Skipped
  // entirely in conflict mode (see `conflictSafeLiveState.ts`) — a static
  // historical snapshot must never pick up another tab's live mock state.
  useEffect(() => {
    if (!isServer || conflictMode) return undefined
    const requestId = request.id
    let cancelled = false
    void window.restorm?.http.isListening(requestId).then((listening) => {
      if (!cancelled) setIsListening(listening)
    })
    const unsubProgress = window.restorm?.http.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') { setIsListening(true); setServedCount(0) }
      if (status === 'completed' || status === 'cancelled' || status === 'error') setIsListening(false)
    })
    const unsubServed = window.restorm?.http.onServerServed(({ requestId: rid, count }) => {
      if (rid !== requestId) return
      setServedCount(count)
    })
    return () => { cancelled = true; unsubProgress?.(); unsubServed?.() }
  }, [isServer, request.id, conflictMode])

  // Request content (SplitView with Panes). Every Pane provides an
  // explicit `collapsed` from `panelCollapsed` → SplitView runs in
  // controlled mode (see ECUI `collapsedLogic.ts`). `onCollapsedChange`
  // updates HTTPRequestTabView's state, which survives the SplitView
  // remount that happens when the response panel toggles.
  const requestContent = (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {configLocked && <ServerConfigLockedHint data-testid="http-server-locked-hint" />}
      <SplitView
        orientation="vertical"
        style={{ width: '100%', flex: 1, minHeight: 0 }}
        data-testid="http-request-split-view"
        onCollapsedChange={handlePanelCollapsedChange}
      >
        <Pane
          title={t('requestTab.tabs.headers')}
          initialSize={0.2}
          collapsed={panelCollapsed.headers}
          minSize={150}
          data-testid="http-request-headers-pane"
          headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
            <Button
              secondary
              small
              icon="add"
              disabled={configLocked}
              options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
              data-testid="http-request-add-header-button"
              onClick={() => {
                if (collapsed) toggle()
                headersParamsRef.current?.addRow()
              }}
            />
          )}
        >
          <div style={sectionDiffWrapperStyle(!!conflictFields?.['headers'])}>
          <RestormKeyValueTable
            key={`headers-${transportEpoch}`}
            ref={headersParamsRef}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            initialRows={request.headers}
            onRowsChange={handleHeadersChange}
            persistenceId={`http-headers:${request.id}`}
            data-testid="http-request-headers-table"
            disabled={configLocked}
            variableAware
            {...(conflictFieldDiff?.rowDiffs?.['headers'] ? { highlightRowKeys: conflictFieldDiff.rowDiffs['headers'] } : {})}
          />
          </div>
        </Pane>
        <Pane
          title={t('requestTab.tabs.pathParams')}
          initialSize={0.2}
          collapsed={panelCollapsed.pathParams}
          minSize={150}
          data-testid="http-request-path-params-pane"
          headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
            <Button
              small
              secondary
              icon="add"
              disabled={configLocked}
              options={{ ariaLabel: t('requestTab.addParam'), title: t('requestTab.addParam') }}
              data-testid="http-request-add-path-param-button"
              onClick={() => {
                if (collapsed) toggle()
                pathParamsRef.current?.addRow()
              }}
            />
          )}
        >
          <div style={sectionDiffWrapperStyle(!!conflictFields?.['pathParams'])}>
          <RestormKeyValueTable
            key={`pathParams-${transportEpoch}`}
            ref={pathParamsRef}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            initialRows={request.pathParams ?? []}
            onRowsChange={handlePathParamsChange}
            persistenceId={`http-path-params:${request.id}`}
            data-testid="http-request-path-params-table"
            disabled={configLocked}
            variableAware
            {...(conflictFieldDiff?.rowDiffs?.['pathParams'] ? { highlightRowKeys: conflictFieldDiff.rowDiffs['pathParams'] } : {})}
          />
          </div>
        </Pane>
        <Pane
          title={t('requestTab.tabs.params')}
          initialSize={0.2}
          collapsed={panelCollapsed.params}
          minSize={150}
          data-testid="http-request-params-pane"
          headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
            <Button
              small
              secondary
              icon="add"
              disabled={configLocked}
              options={{ ariaLabel: t('requestTab.addParam'), title: t('requestTab.addParam') }}
              data-testid="http-request-add-param-button"
              onClick={() => {
                if (collapsed) toggle()
                queryParamsRef.current?.addRow()
              }}
            />
          )}
        >
          <div style={sectionDiffWrapperStyle(!!conflictFields?.['params'])}>
          <RestormKeyValueTable
            key={`params-${transportEpoch}`}
            ref={queryParamsRef}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            initialRows={request.params}
            onRowsChange={handleParamsChange}
            persistenceId={`http-query-params:${request.id}`}
            data-testid="http-request-query-params-table"
            disabled={configLocked}
            variableAware
            {...(conflictFieldDiff?.rowDiffs?.['params'] ? { highlightRowKeys: conflictFieldDiff.rowDiffs['params'] } : {})}
          />
          </div>
        </Pane>
        <Pane
          title={t('requestTab.tabs.body')}
          initialSize={0.4}
          collapsed={panelCollapsed.body}
          data-testid="http-request-body-pane"
        >
          <div style={sectionDiffWrapperStyle(!!conflictFields?.['body'])}>
          <HTTPRequestBodySection
            bodyMode={bodyMode}
            onBodyModeChange={setBodyMode}
            body={body}
            onBodyChange={setBody}
            bodyFilePath={bodyFilePath}
            onBodyFilePathChange={setBodyFilePath}
            request={request}
            onBodyFieldsChange={(rows): void => { updateReactiveProperty(request, 'body', { type: bodyMode as 'form-data' | 'x-www-form-urlencoded', fields: rows }) }}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            disabled={configLocked}
          />
          </div>
        </Pane>
      </SplitView>
    </div>
  )

  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const { infosContent, responseContent, jsonData } = useMemo(
    () => buildHttpResponseViewData(httpResponse, matchedOperation),
    [httpResponse, matchedOperation]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'http') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: HTTPResponse = {
      id: detail.guid,
      type: 'http',
      requestId: request.id,
      requestUrl: detail.response.requestUrl,
      requestMethod: detail.response.requestMethod as HTTPMethod,
      requestHeaders: toKeyValuesFromHistory(detail.response.requestHeaders),
      requestParams: toKeyValuesFromHistory(detail.response.requestParams),
      requestPathParams: toKeyValuesFromHistory(detail.response.requestPathParams),
      ...(detail.response.requestBody ? { requestBody: buildRequestBodyFromHistory(detail.response.requestBody) } : {}),
      statusCode: detail.response.statusCode,
      statusText: detail.response.statusText,
      responseHeaders: toKeyValuesFromHistory(detail.response.responseHeaders),
      responseBody: detail.response.responseBody,
      ...(detail.response.contentType ? { contentType: detail.response.contentType } : {}),
      ...(detail.response.contentLength !== undefined ? { contentLength: detail.response.contentLength } : {}),
      timings: detail.response.timings,
      ...(detail.response.error ? { error: detail.response.error } : {})
    }
    return buildHttpResponseViewData(historyResponse, matchedOperation)
  }, [request.id, matchedOperation])

  // URL section
  const urlSection = (
    <div ref={urlSectionHostRef} data-testid="http-request-url-section-host">
      {pendingPaste && (
        <CurlPasteCallout
          onConfirm={pendingPaste.confirm}
          onCancel={pendingPaste.cancel}
          data-testid="http-request-curl-paste-callout"
        />
      )}
    <ControlGroup data-testid="http-request-url-section">
      <div style={{ ...methodSelectWrapperStyle, boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!conflictFields?.['method']) }}>
        <SelectBox
          id="http-method-select"
          className=""
          options={methodOptions}
          selected={methodOptions.findIndex((opt) => opt.text === method)}
          onDidSelect={(data: ISelectData) => { setMethod(data.selected) }}
          selectBoxOptions={{ ariaLabel: t('requestTab.methodSelect'), useCustomDrawn: true, editable: true }}
          filterPlaceholder=""
          data-testid="http-request-method-select"
          disabled={configLocked}
        />
      </div>
      {isServer ? (
        // SERVER MODE: localhost-fixed host + port + path. The METHOD selector
        // above doubles as the route's method.
        <>
          <span style={serverHostLabelStyle}>localhost:</span>
          <div style={serverPortWrapperStyle}>
            <InputBox
              value={serverPort}
              onChange={setServerPort}
              options={{ placeholder: '8080' }}
              data-testid="http-server-port-input"
              disabled={isListening}
            />
          </div>
          <span style={serverHostLabelStyle}>/</span>
          <div style={urlInputWrapperStyle}>
            <InputBox
              value={serverPath}
              onChange={setServerPath}
              options={{ placeholder: 'pets' }}
              data-testid="http-server-path-input"
              disabled={isListening}
            />
          </div>
        </>
      ) : (
        <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
          <div
            style={{ ...urlInputWrapperStyle, boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!conflictFields?.['url']) }}
            data-testid="url-container"
            data-url-resolved={resolvedUrl ? 'true' : 'false'}
            data-resolved-url={resolvedUrl || url}
          >
            <RestormVariableInputBox
              value={url}
              onChange={(value: string) => { setUrl(value) }}
              variables={urlVariables}
              helpers={handlebarsHelpers}
              placeholder={t('requestTab.urlPlaceholder')}
              data-testid="http-request-url-input"
            />
          </div>
        </HeaderHoverTooltip>
      )}
      {/* Outside a workbench tab (conflict panel, auth modal) there is nothing
        * for the fixed bar to anchor to, so the button stays inline here. */}
      {!inWorkbenchTab && (isServer ? (
        <BeamWrap active={isListening} size={22} borderWidth={1.5}>
          <Button
            icon={isListening ? 'debug-disconnect' : 'plug'}
            onClick={isListening ? handleStop : handleListen}
            disabled={!!conflictMode}
            {...(isListening ? {} : { emphasis: 1 })}
            options={{
              title: isListening ? t('http.server.stopListening') : t('http.server.startListening'),
              ariaLabel: isListening ? t('http.server.stopListening') : t('http.server.startListening')
            }}
            data-testid="http-server-listen-button"
          />
        </BeamWrap>
      ) : (
        <BeamWrap active={isSending} size={22} borderWidth={1.5}>
          {isSending ? (
            <Button
              icon="close"
              onClick={handleCancel}
              options={{ title: t('requestTab.cancel'), ariaLabel: t('requestTab.cancel') }}
              data-testid="http-request-cancel-button"
            />
          ) : (
            <SendButtonEnvSwitcher>
              <Button
                icon="send"
                onClick={handleSend}
                {...(sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
                options={{ title: t('requestTab.send'), ariaLabel: t('requestTab.send') }}
                data-testid="http-request-send-button"
              />
            </SendButtonEnvSwitcher>
          )}
        </BeamWrap>
      ))}
    </ControlGroup>
    {httpReq && (
      <div style={requestOptionsRowStyle} data-testid="http-request-options-row">
        <Toggle
          checked={followRedirects}
          onChange={(next: boolean): void => { setFollowRedirects(next) }}
          data-testid="http-request-follow-redirects-toggle"
        >
          {t('requestTab.followRedirects', 'Follow redirects')}
        </Toggle>
        <div style={timeoutFieldStyle}>
          <span style={timeoutLabelStyle}>{t('requestTab.timeoutLabel', 'Timeout (ms)')}</span>
          <InputBox
            value={timeoutMs}
            onChange={(value: string): void => { setTimeoutMs(value) }}
            options={{ placeholder: String(DEFAULT_REQUEST_TIMEOUT_MS), type: 'number' }}
            data-testid="http-request-timeout-input"
          />
        </div>
      </div>
    )}
    </div>
  )

  const handleCloseHistoryModal = useCallback(() => {
    setHistoryModalOpen(false)
  }, [])

  // Open this tab's history modal when the status-bar button requests
  // the history for THIS specific request. Other tabs' listeners no-op
  // because their request.id doesn't match the event's payload.
  useEffect(() => {
    const requestId = request.id
    const subscription = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_OPEN,
      (payload) => {
        if (payload.requestId === requestId) setHistoryModalOpen(true)
      }
    )
    return () => { subscription.unsubscribe() }
  }, [request.id])

  const isAuthRequest = isAuthenticationRequest(request)
  const additionalRequestTabs = isAuthRequest
    ? [{
        id: 'configuration',
        label: t('authRequestTab.tabs.configuration', 'Configuration'),
        useScrollableElement: false,
        content: <AuthenticationConfigurationTab request={request} {...(conflictFields ? { fieldDiff: conflictFields } : {})} />
      }]
    : undefined

  // SERVER MODE: the response panel shows the live listening state + served
  // count instead of a client response (a mock SERVER has no single response).
  const serverResponseContent = isServer ? (
    <div
      data-testid="http-server-served-banner"
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}
    >
      <span className={`codicon codicon-${isListening ? 'broadcast' : 'circle-slash'}`} aria-hidden="true" />
      <span>
        {isListening
          ? t('http.server.served', { count: servedCount, defaultValue: 'Listening — {{count}} request(s) served' })
          : t('http.server.notListening', 'Not listening')}
      </span>
    </div>
  ) : undefined

  // Action bar, anchored top-right of the workbench tab. It lives outside the
  // tab + split subtree so the response panel opening cannot displace it —
  // which is exactly the frustration it exists to remove.
  const actionToolbar = !inWorkbenchTab ? undefined : (
    <RequestActionToolbar data-testid="http-request-action-toolbar">
      {isServer ? (
        // Listen↔Stop toggle (Send has no meaning when hosting a mock). Server
        // mode ignores environments, so no env colour and no right-click picker.
        <RoundActionButton
          icon={isListening ? 'debug-disconnect' : 'plug'}
          onClick={isListening ? handleStop : handleListen}
          disabled={!!conflictMode}
          tone={isListening ? 'stop' : 'run'}
          beamActive={isListening}
          ariaLabel={isListening ? t('http.server.stopListening') : t('http.server.startListening')}
          data-testid="http-server-listen-button"
        />
      ) : (
        // ONE instance across both states: flipping props (rather than swapping
        // two components) keeps the beam host mounted, so the beam finishes its
        // lap instead of being cut mid-orbit when the request ends.
        <RoundActionButton
          icon={isSending ? 'close' : 'send'}
          onClick={isSending ? handleCancel : handleSend}
          tone={isSending ? 'stop' : 'run'}
          {...(isSending || !envPaintColor ? {} : { color: envPaintColor })}
          {...(isSending || !envIcon ? {} : { envIcon })}
          envSwitch={!isSending}
          beamActive={isSending}
          ariaLabel={isSending ? t('requestTab.cancel') : t('requestTab.send')}
          data-testid={isSending ? 'http-request-cancel-button' : 'http-request-send-button'}
        />
      )}
    </RequestActionToolbar>
  )

  return (
    <>
      <BaseRequestTabView
        {...(conflictVisibleTabIds ? { visibleRequestTabIds: conflictVisibleTabIds } : {})}
        {...(conflictExtraTabs ? { extraRequestTabs: conflictExtraTabs } : {})}
        requestId={request.id}
        urlSection={urlSection}
        {...(actionToolbar ? { actionToolbar } : {})}
        requestContent={requestContent}
        codeSnippetsContent={codeSnippetsContent}
        {...(docsContent !== undefined ? { docsContent } : {})}
        notes={request.notes}
        onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
        isLoading={isSending}
        showResponse={isServer ? isListening : httpResponse !== null}
        infosContent={isServer ? undefined : infosContent}
        responseContent={isServer ? serverResponseContent : responseContent}
        jsonData={isServer ? undefined : jsonData}
        {...(additionalRequestTabs ? { additionalRequestTabs } : {})}
        showCodeSnippets={showCodeSnippets}
        notesDiffers={!!conflictFields?.['notes']}
        {...(defaultActiveTabId !== undefined ? { defaultActiveTabId } : {})}
        {...(activeRequestTabId !== undefined ? { activeRequestTabId } : {})}
        {...(onRequestTabChange !== undefined ? { onRequestTabChange } : {})}
      />
      <ResponseHistoryModal
        isOpen={historyModalOpen}
        onClose={handleCloseHistoryModal}
        requestId={request.id}
        refreshKey={historyRefreshKey}
        buildResponseView={buildHistoryView}
      />
    </>
  )
}

export default HTTPRequestTabView
