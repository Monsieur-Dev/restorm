/**
 * ODataRequestTabView — v4 query + action/function/batch support.
 *
 * Renders the URL, version selector, operation-kind picker, and the
 * full v4 system query option set ($filter / $select / $top / $skip
 * / $count / $expand / $orderby / $search / $format / $apply). The
 * live URL preview is composed from the serializer so the canonical
 * OData URL is visible while the user edits each option.
 *
 * Send dispatches through the `odata:execute` IPC bridge, which
 * reuses `httpExecutionService` under the hood. URLResolver appends
 * the resolved system options to the base URL, so the dispatcher
 * sees a plain HTTP call. Actions invoke POST with a caller-supplied
 * JSON body; `$batch` assembles a multipart/mixed envelope from the
 * sub-request array before dispatch.
 *
 * Response chrome surfaces `@odata.count` / `@odata.nextLink` in the
 * Infos tab (alongside status, duration, headers, and operation
 * kind), renders the JSON body in a full-height Monaco editor on the
 * Response tab, and feeds the parsed value into the Graph tab.
 *
 * History is recorded via `ResponseHistoryService` as a dedicated
 * `'odata'` entry; the same builder drives live rendering and
 * replay so the chrome stays consistent.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useTranslation } from 'react-i18next'
import {
  Button,
  CodeEditor,
  InputBox,
  ListView,
  Pane,
  ScrollableElement,
  SelectBox,
  SplitView,
  Toggle,
  eventBus,
  logger,
  type ISelectOptionItem,
  type ISelectData,
  type ListViewItemData,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import type { ODataRequest, ODataQueryOptions, ODataVersion, ODataOperationKind, ODataBatchFormat, ODataBatchSubRequestSpec, ODataOperationParameterSpec, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { ODataBatchEditor } from './ODataBatchEditor'
import { ODataFilterEditor } from './ODataFilterEditor'
import { ODataOrderbyEditor } from './ODataOrderbyEditor'
import { ODataExpandEditor } from './ODataExpandEditor'
import { ODataPropertyChips } from './ODataPropertyChips'
import { ODataOperationParameterEditor } from './ODataOperationParameterEditor'
import {
  buildActionBodyObject,
  buildFunctionInlinedArgs
} from '../../../../shared/utils/odataOperationParams'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { useAuthRequestResolver } from '../../contexts/authRequestResolverContext'
import type { KeyValueData } from '../../types/global.d'
import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { updateReactiveProperty } from './requestTabViewUtils'
import { useCurlPaste, type ParsedCurl } from '../../hooks/useCurlPaste'
import { CurlPasteCallout } from '../CurlPasteCallout'
import { toasterService } from 'electron-core-ui/renderer'
import {
  serializeODataQueryOptions,
  buildODataUrl,
  keyValuesToPairs
} from '../../../../shared/utils/odataQuery'
import { normalizeODataResponse, detectODataVersionMismatch } from '../../../../shared/utils/odataResponse'
import { extractNavigationLinks } from '../../../../shared/utils/odataNavigationLinks'
import {
  serializeODataBatch,
  serializeODataJsonBatch,
  extractBoundary,
  parseODataBatchResponse,
  parseODataJsonBatchResponse,
  type ODataBatchSubRequest,
  type ODataBatchSubResponse
} from '../../../../shared/utils/odataBatch'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../../../shared/config/constants'
import { useRestormStore } from '../../store/restormStore'
import { useApiDocumentationFromRequest } from '../../hooks/useApiDocumentationFromRequest'
import { buildRequestPath } from '../../utils/requestPath'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { BeamWrap } from '../common/BeamWrap'

const urlRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const urlInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
const sendButtonWrapperStyle: CSSProperties = { flexShrink: 0 }
const serverPortWrapperStyle: CSSProperties = { width: 80, flexShrink: 0 }
const formOuterStyle: CSSProperties = {
  height: '100%',
  width: '100%'
}
const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  boxSizing: 'border-box'
}
const rowStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const labelStyle: CSSProperties = { fontSize: 12, color: 'var(--descriptionForeground)' }
const numericRowStyle: CSSProperties = { display: 'flex', gap: 16, alignItems: 'flex-start' }
const numericItemStyle: CSSProperties = { flex: 1, minWidth: 120 }
const previewRowStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }
const previewValueStyle: CSSProperties = {
  fontFamily: 'var(--font-family-mono)',
  fontSize: 12,
  padding: '6px 8px',
  background: 'var(--input-background)',
  border: '1px solid var(--input-border)',
  borderRadius: 4,
  wordBreak: 'break-all',
  userSelect: 'text'
}
const fullHeightBoxStyle: CSSProperties = { height: '100%', boxSizing: 'border-box' }
const editorContainerStyle: CSSProperties = {
  height: '100%',
  border: '1px solid var(--panel-border)',
  borderRadius: 3,
  boxSizing: 'border-box'
}
const kvRowStyle: CSSProperties = { display: 'flex', gap: 8 }
const kvKeyStyle: CSSProperties = { fontWeight: 600, color: 'var(--symbolIcon-propertyForeground)' }
const kvValueStyle: CSSProperties = { color: 'var(--descriptionForeground)' }
const infoLabelStyle: CSSProperties = { fontWeight: 600 }
const errorTextStyle: CSSProperties = { color: 'var(--testing-iconFailed)' }

function getStatusColor(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return 'var(--testing-iconPassed)'
  if (statusCode >= 300 && statusCode < 400) return 'var(--editorWarning-foreground)'
  return 'var(--testing-iconFailed)'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function headersToListItems(headers: Record<string, string | string[]> | undefined, prefix: string): ListViewItemData[] {
  if (!headers) return []
  return Object.entries(headers).map(([key, value], index) => ({
    id: `${prefix}-${index}`,
    icon: 'blank',
    title: (
      <span style={kvRowStyle}>
        <span style={kvKeyStyle}>{key}</span>
        <span style={kvValueStyle}>{Array.isArray(value) ? value.join(', ') : value}</span>
      </span>
    )
  }))
}

const ODATA_VERSION_BY_INDEX: ODataVersion[] = ['v4', 'v4.01', 'v3', 'v2']
const ODATA_OPERATION_KIND_BY_INDEX: ODataOperationKind[] = ['entity-set', 'function', 'action', 'batch']

function toKeyValueData(kvs: readonly KeyValue[]): KeyValueData[] {
  return toKeyValueDataShared(kvs)
}

function tryParseJson(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

interface ODataResponseViewData {
  statusCode: number
  statusText: string
  requestUrl: string
  durationMs: number
  body: string
  headers?: Record<string, string | string[]>
  method: string
  error?: string
  /** Per-child sub-responses when operationKind === 'batch' and
   * the response was a parseable multipart/mixed or JSON batch. */
  batchSubResponses?: ODataBatchSubResponse[]
  /** Warnings produced by the batch serializer (e.g. GET in
   * a change-set when allowGetInChangeSet is false). */
  batchWarnings?: string[]
  /** @odata.deltaLink captured from the response for delta tracking. */
  odataDeltaLink?: string
}

export interface ODataRequestTabViewProps {
  request: ODataRequest
}

export const ODataRequestTabView: React.FC<ODataRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { selectedEnvId, environments, projectUuid } = useEnvironmentContext()
  const collections = useRestormStore((state) => state.collections)
  const resolveAuthRequest = useAuthRequestResolver()

  // Structured documentation of the owning env folder (entity types +
  // properties + enum values), used to drive $filter / $orderby
  // metadata-aware autocomplete. Undefined for a hand-authored request
  // with no imported spec → autocomplete degrades to no suggestions.
  const { apiDocumentation } = useApiDocumentationFromRequest(request)

  const odataVersionOptions = useMemo<ISelectOptionItem[]>(() => [
    { text: 'v4' },
    { text: 'v4.01' },
    { text: t('odataRequestTab.versionV3NotYet', 'v3 (execution not yet supported)') },
    { text: t('odataRequestTab.versionV2NotYet', 'v2 (execution not yet supported)') }
  ], [t])

  const operationKindOptions = useMemo<ISelectOptionItem[]>(() => [
    { text: t('odataRequestTab.operationKindEntitySet', 'Entity set (GET)') },
    { text: t('odataRequestTab.operationKindFunction', 'Function (GET with inlined parameters)') },
    { text: t('odataRequestTab.operationKindAction', 'Action (POST with JSON body)') },
    { text: t('odataRequestTab.operationKindBatch', 'Batch ($batch — multipart/mixed)') }
  ], [t])

  const [isSending, setIsSending] = useState(false)
  // Server mode: whether restorm is currently hosting this request's OData mock
  // service, and how many requests it has served (for the "served N" banner).
  const [isListening, setIsListening] = useState<boolean>(false)
  const [servedCount, setServedCount] = useState<number>(0)
  // Server mode: per-pane collapsed state for the $metadata / served-data
  // SplitView, lifted up so it survives the SplitView remount when the response
  // panel toggles (mirrors HTTPRequestTabView's panelCollapsed plumbing).
  const [serverPanelCollapsed, setServerPanelCollapsed] = useState<{ metadata: boolean; data: boolean }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      metadata: typeof seed['odataMetadata'] === 'boolean' ? seed['odataMetadata'] : false,
      data: typeof seed['odataData'] === 'boolean' ? seed['odataData'] : false
    }
  })
  const handleServerPanelCollapsedChange = useCallback((arr: boolean[]): void => {
    const next = { metadata: arr[0] ?? false, data: arr[1] ?? false }
    setServerPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'odataMetadata', next.metadata)
      setRequestPanelCollapsed(projectUuid, request.id, 'odataData', next.data)
    }
  }, [projectUuid, request.id])
  const [response, setResponse] = useState<ODataResponseViewData | null>(null)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [urlVariables, setUrlVariables] = useState<VariableDefinition[]>([])

  // Locally-owned input state for every query option. The InputBox /
  // editor binds to this React state (not the proxy), so a keystroke
  // produces a real re-render. Each setter mirrors the new value into
  // the reactive proxy on the same tick so downstream listeners
  // (save-unit registry, URL preview, etc.) see the change. Mirrors
  // the `url` / `method` / `body` pattern used by `HTTPRequestTabView`.
  const [filterText, setFilterText] = useState<string>(request.queryOptions.filter ?? '')
  const [selectText, setSelectText] = useState<string>((request.queryOptions.select ?? []).join(', '))
  const [topText, setTopText] = useState<string>(request.queryOptions.top ?? '')
  const [skipText, setSkipText] = useState<string>(request.queryOptions.skip ?? '')
  const [expandText, setExpandText] = useState<string>(request.queryOptions.expand ?? '')
  const [orderbyText, setOrderbyText] = useState<string>(request.queryOptions.orderby ?? '')
  const [searchText, setSearchText] = useState<string>(request.queryOptions.search ?? '')
  const [formatText, setFormatText] = useState<string>(request.queryOptions.format ?? '')
  const [applyText, setApplyText] = useState<string>(request.queryOptions.apply ?? '')

  const handlebarsHelpers = useHandlebarsHelpers()
  const urlVariablesBootstrappedRef = useRef<boolean>(false)

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  const sourceIdRef = useRef<string>(crypto.randomUUID())
  const selectedEnvIdRef = useRef(selectedEnvId)
  const environmentsRef = useRef(environments)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { environmentsRef.current = environments }, [environments])

  const handleReset = useCallback(() => {
    setResponse(null)
    setFilterText(request.queryOptions.filter ?? '')
    setSelectText((request.queryOptions.select ?? []).join(', '))
    setTopText(request.queryOptions.top ?? '')
    setSkipText(request.queryOptions.skip ?? '')
    setExpandText(request.queryOptions.expand ?? '')
    setOrderbyText(request.queryOptions.orderby ?? '')
    setSearchText(request.queryOptions.search ?? '')
    setFormatText(request.queryOptions.format ?? '')
    setApplyText(request.queryOptions.apply ?? '')
  }, [request])
  useRequestReset(request, handleReset)

  // Per-field debounced proxy write. Each setter updates the local
  // `XText` state synchronously (so the InputBox stays visually
  // responsive per keystroke) and schedules the heavy proxy mutation
  // to fire once the typing burst settles. Without this, every
  // keystroke in a metadata-heavy OData request paid the full reactive
  // cascade (REQUEST_UPDATED → URL preview recompute + save-unit IPC
  // + checksum tracking + ContextService IPC), pushing per-keystroke
  // render cost into the 100s of ms.
  //
  // Each slot keeps its own timer. Switching fields flushes any
  // pending write for another slot synchronously first, so the proxy
  // always observes writes in the order they were typed.
  //
  // Note: the earlier proxy→local `useEffect` mirror fought with
  // in-flight debounced writes (proxy lags local → effect reset
  // local back to the stale proxy value → char drops). The trade-off
  // is that programmatic external mutations of `queryOptions` on the
  // same request id (crash-recovery drafts, undo/redo) won't re-sync
  // into the visible inputs until the user switches tabs and back,
  // which is `useRequestReset`'s contract. Live typing wins.
  const PROXY_WRITE_DEBOUNCE_MS = 250
  const proxyWriteTimersRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; flush: () => void }>>(new Map())
  // After a debounced proxy write fires, nothing in React-land observes
  // the mutation — `request` is a reactive proxy, not a state value.
  // The `useEffect` below that pushes `request.queryOptions` to
  // ContextService (so the main-side URLResolver can compose
  // `?$filter=…&$select=…`) only re-evaluates when the parent
  // re-renders. Without an explicit nudge, a "type into $select →
  // immediately click Send" flow ships the pre-debounce snapshot:
  // ContextService still sees the OLD queryOptions when the executor
  // reads `getResolvedUrl`, and the wire request misses the latest
  // typed query option. Bumping a dummy state inside the timer
  // callback forces a re-render after every proxy commit, which lets
  // the dependent effect publish the fresh snapshot.
  const [, forceProxyRender] = useState(0)
  const scheduleProxyWrite = useCallback((slot: string, flush: () => void) => {
    const timers = proxyWriteTimersRef.current
    for (const [key, entry] of timers) {
      if (key !== slot) {
        clearTimeout(entry.timer)
        timers.delete(key)
        entry.flush()
      }
    }
    const existing = timers.get(slot)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      timers.delete(slot)
      flush()
      forceProxyRender((n) => n + 1)
    }, PROXY_WRITE_DEBOUNCE_MS)
    timers.set(slot, { timer, flush })
  }, [])
  const flushAllPendingProxyWrites = useCallback(() => {
    const timers = proxyWriteTimersRef.current
    if (timers.size === 0) return
    for (const [, entry] of timers) {
      clearTimeout(entry.timer)
      entry.flush()
    }
    timers.clear()
    forceProxyRender((n) => n + 1)
  }, [])
  useEffect(() => {
    // Flush any pending writes on unmount AND when `request.id` flips
    // (tab switch to a different OData request while the 250 ms
    // debounce is still in flight). Each scheduled flush closure
    // captures the `request` prop that was current when the setter
    // fired; firing them before the new request takes over keeps the
    // typed state landing on the right document.
    return flushAllPendingProxyWrites
  }, [request.id, flushAllPendingProxyWrites])

  // `updateReactiveProperty` mutates the proxied `request` object
  // directly — consistent with the pattern used in HTTPRequestTabView.
  const setUrl = useCallback((next: string) => {
    updateReactiveProperty(request, 'url', next)
  }, [request])

  const setVersion = useCallback((next: string) => {
    updateReactiveProperty(request, 'odataVersion', next as ODataVersion)
    // `odataVersion` gates v4.01-specific UI (force-absolute-batch-URLs toggle,
    // delta-follow button). The proxy write alone doesn't re-render this
    // component, so force a render here, same as setOperationKind.
    forceProxyRender((n) => n + 1)
  }, [request])

  const setOperationKind = useCallback((next: ODataOperationKind) => {
    updateReactiveProperty(request, 'operationKind', next)
    // `operationKind` gates which editor section renders (entity-set
    // query options vs action body vs batch editor vs function params).
    // The proxy write alone doesn't re-render this component — only the
    // debounced query-field flush calls `forceProxyRender` — so force a
    // render here, otherwise the panel keeps showing the old section.
    forceProxyRender((n) => n + 1)
  }, [request])

  const setActionBody = useCallback((next: string) => {
    updateReactiveProperty(request, 'actionBody', next)
  }, [request])

  const setBatchSubRequests = useCallback((next: ODataBatchSubRequestSpec[]) => {
    updateReactiveProperty(request, 'batchSubRequests', next)
    // The batch editor renders one card per sub-request; the proxy write
    // alone doesn't re-render, so adding/removing/reordering a card would
    // be invisible without forcing a render here.
    forceProxyRender((n) => n + 1)
  }, [request])

  const setBatchFormat = useCallback((next: ODataBatchFormat) => {
    updateReactiveProperty(request, 'batchFormat', next)
    // Keep the format SelectBox (controlled by `request.batchFormat`) in
    // sync — the proxy write alone doesn't re-render this component.
    forceProxyRender((n) => n + 1)
  }, [request])

  const setAllowGetInChangeSet = useCallback((next: boolean) => {
    updateReactiveProperty(request, 'allowGetInChangeSet', next)
    forceProxyRender((n) => n + 1)
  }, [request])

  const setForceAbsoluteBatchUrls = useCallback((next: boolean) => {
    updateReactiveProperty(request, 'forceAbsoluteBatchUrls', next)
    forceProxyRender((n) => n + 1)
  }, [request])

  const setOperationParameters = useCallback((next: ODataOperationParameterSpec[]) => {
    updateReactiveProperty(request, 'operationParameters', next)
  }, [request])

  // Action: regenerate `actionBody` JSON from the typed parameter
  // form so the user sees what the server will receive. Values
  // missing from the form are dropped so the server defaults apply.
  const applyActionParameters = useCallback(() => {
    const body = buildActionBodyObject(request.operationParameters ?? [])
    updateReactiveProperty(request, 'actionBody', JSON.stringify(body, null, 2))
  }, [request])

  // Function: rewrite the last `(...)` segment of the URL with the
  // inlined args built from the typed form. Anything before the
  // opening paren (service root, bound-entity prefix) is preserved
  // verbatim — the user's own `{{baseUrl}}/…/Function` is safe.
  const applyFunctionParameters = useCallback(() => {
    const currentUrl = request.url
    const inlined = buildFunctionInlinedArgs(request.operationParameters ?? [])
    const openIdx = currentUrl.lastIndexOf('(')
    const closeIdx = currentUrl.lastIndexOf(')')
    const hasExistingArgs = openIdx >= 0 && closeIdx > openIdx
    const base = hasExistingArgs ? currentUrl.slice(0, openIdx) : currentUrl
    updateReactiveProperty(request, 'url', `${base}${inlined}`)
  }, [request])

  // Metadata-driven chip pickers: appending a property to $select,
  // $orderby, or $expand is a one-click convenience. Each picker
  // respects the current clause shape: $select is a name list,
  // $orderby is a `prop dir` clause (picked names default to `asc`),
  // $expand is a property name (no nested options yet — the user can
  // open the row and tune from there).
  const appendSelectProperty = useCallback((name: string) => {
    const current = new Set(request.queryOptions.select ?? [])
    current.add(name)
    const nextList = Array.from(current)
    setSelectText(nextList.join(', '))
    scheduleProxyWrite('select', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, select: nextList })
    })
  }, [request, scheduleProxyWrite])

  const appendOrderbyProperty = useCallback((name: string) => {
    const existing = request.queryOptions.orderby?.trim() ?? ''
    const next = existing ? `${existing},${name} asc` : `${name} asc`
    setOrderbyText(next)
    scheduleProxyWrite('orderby', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, orderby: next })
    })
  }, [request, scheduleProxyWrite])

  const appendExpandProperty = useCallback((name: string) => {
    const existing = request.queryOptions.expand?.trim() ?? ''
    const next = existing ? `${existing},${name}` : name
    setExpandText(next)
    scheduleProxyWrite('expand', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, expand: next })
    })
  }, [request, scheduleProxyWrite])

  const setFilter = useCallback((next: string) => {
    setFilterText(next)
    scheduleProxyWrite('filter', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, filter: next })
    })
  }, [request, scheduleProxyWrite])

  const setSelect = useCallback((next: string) => {
    setSelectText(next)
    scheduleProxyWrite('select', () => {
      const list = next.split(',').map((s) => s.trim()).filter((s) => s !== '')
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, select: list })
    })
  }, [request, scheduleProxyWrite])

  const setTop = useCallback((next: string) => {
    setTopText(next)
    scheduleProxyWrite('top', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, top: next })
    })
  }, [request, scheduleProxyWrite])

  const setSkip = useCallback((next: string) => {
    setSkipText(next)
    scheduleProxyWrite('skip', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, skip: next })
    })
  }, [request, scheduleProxyWrite])

  // `$count` is a toggle — flush any pending text-field writes first
  // so the boolean mutation layers on top of the latest typed state.
  const setCount = useCallback((next: boolean) => {
    flushAllPendingProxyWrites()
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, count: next })
  }, [request, flushAllPendingProxyWrites])

  const setExpand = useCallback((next: string) => {
    setExpandText(next)
    scheduleProxyWrite('expand', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, expand: next })
    })
  }, [request, scheduleProxyWrite])

  const setOrderby = useCallback((next: string) => {
    setOrderbyText(next)
    scheduleProxyWrite('orderby', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, orderby: next })
    })
  }, [request, scheduleProxyWrite])

  const setSearch = useCallback((next: string) => {
    setSearchText(next)
    scheduleProxyWrite('search', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, search: next })
    })
  }, [request, scheduleProxyWrite])

  const setFormat = useCallback((next: string) => {
    setFormatText(next)
    scheduleProxyWrite('format', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, format: next })
    })
  }, [request, scheduleProxyWrite])

  const setApply = useCallback((next: string) => {
    setApplyText(next)
    scheduleProxyWrite('apply', () => {
      updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, apply: next })
    })
  }, [request, scheduleProxyWrite])

  // Live URL preview composed from the CURRENTLY-TYPED local state so
  // it tracks every keystroke without waiting for the proxy write to
  // settle (see `scheduleProxyWrite`). Handlebars templates stay
  // literal — resolution happens in the main process at send time.
  const urlPreview = useMemo(() => {
    const liveOptions: ODataQueryOptions = {
      ...request.queryOptions,
      ...(filterText !== '' && { filter: filterText }),
      ...(selectText !== '' && { select: selectText.split(',').map((s) => s.trim()).filter((s) => s !== '') }),
      ...(topText !== '' && { top: topText }),
      ...(skipText !== '' && { skip: skipText }),
      ...(expandText !== '' && { expand: expandText }),
      ...(orderbyText !== '' && { orderby: orderbyText }),
      ...(searchText !== '' && { search: searchText }),
      ...(formatText !== '' && { format: formatText }),
      ...(applyText !== '' && { apply: applyText })
    }
    const systemPairs = serializeODataQueryOptions(liveOptions, request.odataVersion)
    const extraPairs = keyValuesToPairs(request.params)
    return buildODataUrl(request.url, systemPairs, extraPairs)
  }, [
    request.url,
    request.odataVersion,
    request.queryOptions,
    request.params,
    filterText,
    selectText,
    topText,
    skipText,
    expandText,
    orderbyText,
    searchText,
    formatText,
    applyText
  ])

  // Register request with ContextService on mount, unregister on
  // unmount. `headers` and `params` feed through refs so the effect
  // only depends on `request.id`; using them as direct deps caused the
  // unregister/register cycle to fire on every keystroke in a
  // metadata-heavy OData request (the proxy mutation on `queryOptions`
  // re-rendered the parent, which in turn fed fresh header/param refs
  // to the effect). That dragged each render from ~8 ms to 200 ms+
  // and eventually wedged the UI. Header/param edits still reach
  // ContextService through the `updateFullRequestData` effect below,
  // which *does* depend on them — this one just owns the
  // lifecycle-scoped registration.
  const registerHeadersRef = useRef(request.headers)
  const registerParamsRef = useRef(request.params)
  useEffect(() => { registerHeadersRef.current = request.headers }, [request.headers])
  useEffect(() => { registerParamsRef.current = request.params }, [request.params])
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return
    const currentEnvId = selectedEnvIdRef.current ?? environmentsRef.current?.[0]?.id ?? null

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(registerHeadersRef.current),
      params: toKeyValueData(registerParamsRef.current)
    })

    return () => {
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id])

  // Keep ContextService in sync with env selection.
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    void window.restorm?.context.setRequestEnvironment(requestId, currentEnvId)
  }, [selectedEnvId, environments, request.id])

  // Subscribe to ContextService's URL-field available-variables
  // broadcast so the URL input can offer handlebars autocomplete +
  // hover resolution. Mirrors the HTTP tab's wiring.
  const urlVariableId = useMemo(() => `${request.id}:url`, [request.id])
  useEffect(() => {
    const varId = urlVariableId
    if (!varId || varId === 'undefined:url') return
    const unsubscribe = window.restorm?.context.onAvailableVariables((result) => {
      if (result.variableId !== varId) return
      if (result.sourceId === sourceIdRef.current && urlVariablesBootstrappedRef.current) return
      urlVariablesBootstrappedRef.current = true
      const next = result.variables
      setUrlVariables((prev) => {
        if (prev.length !== next.length) return next
        const changed = next.some((v, i) => {
          const p = prev[i]
          return p && (p.name !== v.name || p.value !== v.value)
        })
        return changed ? next : prev
      })
    })
    return () => { unsubscribe?.() }
  }, [urlVariableId])

  // Push the latest OData request shape to ContextService so
  // URLResolver can compose the resolved URL (with $filter / $select
  // / $top / $skip / $count appended).
  //
  // Called from two places:
  //   1) The reactive `useEffect` below — fires whenever React
  //      observes a change in one of the dependencies (typing into
  //      a field, switching tab, env change).
  //   2) Directly inside `handleSend` immediately after
  //      `flushAllPendingProxyWrites` — the debounced proxy writes
  //      mutate the reactive object without scheduling a React
  //      re-render, so a "type → click Send" sequence would
  //      otherwise ship the pre-debounce queryOptions snapshot. The
  //      explicit pre-Send call closes that race deterministically.
  const pushFullRequestDataToContextService = useCallback((): Promise<void> | undefined => {
    const requestId = request.id
    if (!requestId) return undefined
    return window.restorm?.context.updateFullRequestData(requestId, {
      id: requestId,
      requestType: 'odata',
      url: request.url,
      headers: toKeyValueData(request.headers),
      params: toKeyValueData(request.params),
      odataVersion: request.odataVersion,
      odataOperationKind: request.operationKind,
      odataQueryOptions: { ...request.queryOptions },
      // Server mode: the mock service reads the CSDL + served data from fullData.
      ...(request.server !== undefined && { server: request.server }),
      ...(request.mockMetadata !== undefined && { mockMetadata: request.mockMetadata }),
      ...(request.mockData !== undefined && { mockData: request.mockData })
    }, sourceIdRef.current)
  }, [request])

  useEffect(() => {
    void pushFullRequestDataToContextService()
  }, [
    request.id,
    request.url,
    request.headers,
    request.params,
    request.odataVersion,
    request.operationKind,
    request.queryOptions,
    request.server,
    request.mockMetadata,
    request.mockData,
    pushFullRequestDataToContextService
  ])

  const handleSend = useCallback((): void => {
    if (isSending) return
    const requestId = request.id
    if (!requestId) {
      logger.error('Cannot send OData request without ID')
      return
    }
    // Flush any debounced typing writes so the outgoing request sees
    // the latest-typed values (we debounce per-field to keep typing
    // responsive; Send must not ship the pre-debounce proxy snapshot).
    flushAllPendingProxyWrites()
    // The flush mutates the reactive proxy but doesn't reschedule
    // React renders, so the `useEffect` that propagates queryOptions
    // to ContextService wouldn't have a chance to run before the
    // executor reads `getResolvedUrl`. Push directly here so the
    // wire request always sees the freshly-typed query options.
    void pushFullRequestDataToContextService()
    setIsSending(true)
    setResponse(null)

    const api = window.restorm?.odata
    if (!api) {
      setIsSending(false)
      setResponse({
        statusCode: 0,
        statusText: '',
        requestUrl: '',
        durationMs: 0,
        body: '',
        method: 'GET',
        error: 'OData IPC bridge unavailable (restorm context missing)'
      })
      return
    }

    let method = 'GET'
    let body: string | undefined
    let contentTypeOverride: string | undefined
    let pendingBatchWarnings: string[] = []
    if (request.operationKind === 'action') {
      method = 'POST'
      body = request.actionBody ?? undefined
    } else if (request.operationKind === 'batch') {
      // The structured `batchSubRequests` array drives serialization
      // directly — no JSON parse required. We flatten the editor's
      // header list into a Record, coalesce the (flat + change-set)
      // sequence into the multipart/mixed envelope, and let the
      // engine see a plain POST.
      const specs = request.batchSubRequests ?? []
      if (specs.length === 0) {
        setIsSending(false)
        setResponse({
          statusCode: 0,
          statusText: '',
          requestUrl: '',
          durationMs: 0,
          body: '',
          method,
          error: 'Batch has no sub-requests — add at least one before sending.'
        })
        return
      }
      const subRequests: ODataBatchSubRequest[] = specs.map((spec) => {
        const headers: Record<string, string> = {}
        for (const kv of spec.headers ?? []) {
          if (kv.key) headers[kv.key] = kv.value
        }
        return {
          method: spec.method,
          url: spec.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          ...(spec.body !== undefined ? { body: spec.body } : {}),
          ...(spec.atomicityGroup ? { atomicityGroup: spec.atomicityGroup } : {}),
          ...(spec.forceIncludeInChangeSet ? { forceIncludeInChangeSet: true } : {})
        }
      })
      const isBatchJson = request.batchFormat === 'json'
      // v4.01 emits relative batch URIs unless the user opted out.
      const isV401 = request.odataVersion === 'v4.01'
      // Service root for relative URL conversion: strip the `/$batch` suffix
      // (and any query string). If the URL doesn't contain `/$batch` we still
      // strip the last path segment as a best-effort guess — the caller can
      // override with forceAbsoluteBatchUrls if the heuristic is wrong.
      const batchServiceRoot = isV401 && !request.forceAbsoluteBatchUrls
        ? (request.url.includes('/$batch')
          ? request.url.replace(/\/\$batch.*$/, '')
          : request.url.replace(/\/[^/]*$/, ''))
        : undefined
      if (isBatchJson) {
        const serialized = serializeODataJsonBatch(subRequests, {
          ...(batchServiceRoot !== undefined ? { serviceRoot: batchServiceRoot } : {}),
          ...(request.forceAbsoluteBatchUrls ? { forceAbsoluteUrls: true } : {})
        })
        method = 'POST'
        body = serialized.body
        contentTypeOverride = serialized.contentType
      } else {
        const serialized = serializeODataBatch(subRequests, undefined, {
          allowGetInChangeSet: request.allowGetInChangeSet ?? false,
          ...(batchServiceRoot !== undefined ? { serviceRoot: batchServiceRoot } : {}),
          ...(request.forceAbsoluteBatchUrls ? { forceAbsoluteUrls: true } : {})
        })
        method = 'POST'
        body = serialized.body
        contentTypeOverride = serialized.contentType
        // Surface serializer warnings in the response panel even before
        // the batch completes — they are informational, not blocking.
        if (serialized.warnings.length > 0) {
          pendingBatchWarnings = serialized.warnings
        }
      }
    }
    const dispatchedMethod = method
    const capturedBatchWarnings = pendingBatchWarnings
    const capturedBatchFormat = request.operationKind === 'batch' ? (request.batchFormat ?? 'multipart') : null
    const capturedOperationKind = request.operationKind
    const authAttachedId = request.authenticationRequestId
    const attachedAuth = authAttachedId ? resolveAuthRequest(authAttachedId) : null
    const authPlain = attachedAuth
      ? attachedAuth.toPlainObject?.() ?? attachedAuth
      : undefined
    // JSON round-trip flattens any residual class instances
    // (`StringValue`, `SecretValue`, reactive Proxy wrappers) —
    // structured clone over IPC rejects those directly.
    const authRequestPayload = authPlain !== undefined
      ? JSON.parse(JSON.stringify(authPlain)) as unknown
      : undefined
    api.execute({
      requestId,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      method,
      ...(body !== undefined ? { body } : {}),
      ...(contentTypeOverride !== undefined ? { bodyContentType: contentTypeOverride } : {}),
      ...(requestPath ? { requestPath } : {}),
      ...(authRequestPayload ? { authRequest: authRequestPayload } : {})
    })
      .then((result) => {
        // For batch requests, parse the multipart/mixed (or JSON batch)
        // response body into per-child sub-responses so the UI can render
        // each one individually and highlight 4xx/5xx change-set errors.
        let batchSubResponses: ODataBatchSubResponse[] | undefined
        if (capturedOperationKind === 'batch') {
          const body = result.body ?? ''
          if (capturedBatchFormat === 'json') {
            const parsed = parseODataJsonBatchResponse(body)
            if (parsed.length > 0) batchSubResponses = parsed
          } else {
            const ct = result.headers?.['content-type']
            const ctStr = Array.isArray(ct) ? ct[0] : ct
            const boundary = extractBoundary(ctStr)
            if (boundary) {
              const parsed = parseODataBatchResponse(body, boundary)
              if (parsed.length > 0) batchSubResponses = parsed
            }
          }
        }
        const sendParsed = tryParseJson(result.body ?? '')
        const sendNormalized = sendParsed !== null && typeof sendParsed === 'object'
          ? normalizeODataResponse(sendParsed, request.odataVersion)
          : null
        setResponse({
          statusCode: result.statusCode ?? 0,
          statusText: result.statusText ?? '',
          requestUrl: result.requestUrl ?? '',
          durationMs: result.timings.durationMs,
          body: result.body ?? '',
          method: dispatchedMethod,
          ...(result.headers !== undefined && { headers: result.headers }),
          ...(result.error !== undefined && { error: result.error }),
          ...(batchSubResponses !== undefined && { batchSubResponses }),
          ...(capturedBatchWarnings.length > 0 && { batchWarnings: capturedBatchWarnings }),
          ...(sendNormalized?.deltaLink !== undefined && { odataDeltaLink: sendNormalized.deltaLink })
        })
        setHistoryRefreshKey((prev) => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId } as RequestHistoryEventPayload)
        logger.info('OData request completed', {
          url: result.requestUrl,
          status: result.statusCode,
          duration: result.timings.durationMs
        })
      })
      .catch((err: unknown) => {
        setResponse({
          statusCode: 0,
          statusText: '',
          requestUrl: '',
          durationMs: 0,
          body: '',
          method: dispatchedMethod,
          error: err instanceof Error ? err.message : String(err)
        })
        setHistoryRefreshKey((prev) => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId } as RequestHistoryEventPayload)
      })
      .finally(() => { setIsSending(false) })
  }, [isSending, request, requestPath, resolveAuthRequest, flushAllPendingProxyWrites, pushFullRequestDataToContextService])

  const urlSectionHostRef = useRef<HTMLDivElement | null>(null)
  // Smart-paste: OData has its own query options pipeline keyed off the
  // URL, so we only fill the URL from a pasted cURL. Headers / body
  // would conflict with OData's protocol-specific shape.
  const applyParsedCurl = useCallback((parsed: ParsedCurl): void => {
    setUrl(parsed.url)
    toasterService.push('app', {
      title: 'Replaced from cURL',
      body: 'OData endpoint URL populated from the pasted curl command.',
      durationMs: 10000
    })
  }, [setUrl])
  const { pendingPaste } = useCurlPaste({
    hostRef: urlSectionHostRef,
    apply: applyParsedCurl
  })

  // ── Server mode (restorm HOSTS a local OData v4 mock service) ────────
  const isServer = (request).server === true
  const { serverPort, serverRoot } = useMemo(() => {
    const stripped = request.url.replace(/^[a-z]+:\/\//i, '')
    const slash = stripped.indexOf('/')
    const hostPort = slash >= 0 ? stripped.slice(0, slash) : stripped
    const root = slash >= 0 ? stripped.slice(slash + 1) : ''
    return { serverPort: hostPort.split(':')[1] ?? '', serverRoot: root }
  }, [request.url])
  const composeServerUrl = useCallback((port: string, rootPart: string): string => {
    return `localhost:${port}/${rootPart.replace(/^\/+/, '')}`
  }, [])
  const setServerPort = useCallback((p: string): void => {
    setUrl(composeServerUrl(p.replace(/[^0-9]/g, ''), serverRoot))
  }, [composeServerUrl, serverRoot, setUrl])
  const setServerRoot = useCallback((p: string): void => {
    setUrl(composeServerUrl(serverPort, p))
  }, [composeServerUrl, serverPort, setUrl])
  const setMockMetadata = useCallback((next?: string): void => {
    updateReactiveProperty(request, 'mockMetadata', next ?? '')
  }, [request])
  const setMockData = useCallback((next?: string): void => {
    // Persist the served-data JSON as-typed; a parse error surfaces only when the
    // mock is started (the server answers 400), so editing stays unblocked.
    try {
      updateReactiveProperty(request, 'mockData', JSON.parse(next ?? '{}') as Record<string, Record<string, unknown>[]>)
    } catch {
      updateReactiveProperty(request, 'mockData', (next ?? '') as unknown as Record<string, Record<string, unknown>[]>)
    }
  }, [request])
  const mockDataText = useMemo(
    () => JSON.stringify((request).mockData ?? {}, null, 2),
    [request]
  )

  // Listen = start hosting the mock service. It stays up (no timeout) until Stop /
  // file close / quit; the promise resolves when the routes stop.
  const handleListen = useCallback((): void => {
    const requestId = request.id
    if (!requestId || isListening) return
    setServedCount(0)
    void window.restorm?.odata.listen(requestId)
      .then((res) => {
        if (res.error) {
          toasterService.push('app', { title: t('odata.server.listenFailed', 'OData mock server failed to start'), body: res.error, durationMs: 10000 })
          logger.error('OData mock server failed to listen', { error: res.error })
        }
      })
      .catch((err: unknown) => { logger.error('OData mock server listen error', { error: String(err) }) })
  }, [request.id, isListening, t])

  const handleStop = useCallback((): void => {
    void window.restorm?.odata.stop(request.id)
  }, [request.id])

  // Track listening state + served count for the hosted mock service.
  useEffect(() => {
    if (!isServer) return undefined
    const requestId = request.id
    let cancelled = false
    void window.restorm?.odata.isListening(requestId).then((listening) => {
      if (!cancelled) setIsListening(listening)
    })
    const unsubProgress = window.restorm?.odata.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') { setIsListening(true); setServedCount(0) }
      if (status === 'completed' || status === 'cancelled' || status === 'error') setIsListening(false)
    })
    const unsubServed = window.restorm?.odata.onServerServed(({ requestId: rid, count }) => {
      if (rid !== requestId) return
      setServedCount(count)
    })
    return () => { cancelled = true; unsubProgress?.(); unsubServed?.() }
  }, [isServer, request.id])

  const serverUrlSection = (
    <div data-testid="odata-request-url-section-host">
      <div style={urlRowStyle} data-testid="odata-server-url-section">
        <span style={labelStyle}>localhost:</span>
        <div style={serverPortWrapperStyle}>
          <InputBox
            value={serverPort}
            onChange={setServerPort}
            options={{ placeholder: '8081' }}
            data-testid="odata-server-port"
          />
        </div>
        <span style={labelStyle}>/</span>
        <div style={urlInputWrapperStyle}>
          <InputBox
            value={serverRoot}
            onChange={setServerRoot}
            options={{ placeholder: 'odata' }}
            data-testid="odata-server-root"
          />
        </div>
        <div style={sendButtonWrapperStyle}>
          <BeamWrap active={isListening} size={22} borderWidth={1.5}>
            <Button
              icon={isListening ? 'debug-disconnect' : 'plug'}
              onClick={isListening ? handleStop : handleListen}
              {...(isListening ? {} : { emphasis: 1 })}
              options={{
                title: isListening ? t('odata.server.stopListening', 'Stop listening') : t('odata.server.startListening', 'Start listening'),
                ariaLabel: isListening ? t('odata.server.stopListening', 'Stop listening') : t('odata.server.startListening', 'Start listening')
              }}
              data-testid="odata-server-listen"
            />
          </BeamWrap>
        </div>
      </div>
    </div>
  )

  const serverRequestContent = (
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="odata-server-split-view"
      onCollapsedChange={handleServerPanelCollapsedChange}
    >
      <Pane
        title={t('odata.server.metadataLabel', '$metadata (CSDL)')}
        initialSize={0.5}
        collapsed={serverPanelCollapsed.metadata}
        minSize={120}
        data-testid="odata-server-metadata-pane"
      >
        <CodeEditor
          value={(request).mockMetadata ?? ''}
          language="xml"
          onChange={setMockMetadata}
          height="100%"
          options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
          data-testid="odata-server-metadata"
        />
      </Pane>
      <Pane
        title={t('odata.server.dataLabel', 'Served entity data (by entity set)')}
        initialSize={0.5}
        collapsed={serverPanelCollapsed.data}
        minSize={120}
        data-testid="odata-server-data-pane"
      >
        <CodeEditor
          value={mockDataText}
          language="json"
          onChange={setMockData}
          height="100%"
          options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
          data-testid="odata-server-data"
        />
      </Pane>
    </SplitView>
  )

  const serverResponseContent = (
    <div
      data-testid="odata-server-served-banner"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, color: 'var(--descriptionForeground)' }}
    >
      <span className={`codicon codicon-${isListening ? 'broadcast' : 'circle-slash'}`} aria-hidden="true" />
      <span>
        {isListening
          ? t('odata.server.served', { count: servedCount, defaultValue: 'Listening — {{count}} request(s) served' })
          : t('odata.server.notListening', 'Not listening')}
      </span>
    </div>
  )

  const urlSection = (
    <div ref={urlSectionHostRef} data-testid="odata-request-url-section-host">
      {pendingPaste && (
        <CurlPasteCallout
          onConfirm={pendingPaste.confirm}
          onCancel={pendingPaste.cancel}
          data-testid="odata-curl-paste-callout"
        />
      )}
    <div style={urlRowStyle} data-testid="odata-request-url-section">
      <div style={urlInputWrapperStyle}>
        <RestormVariableInputBox
          value={request.url}
          onChange={setUrl}
          variables={urlVariables}
          helpers={handlebarsHelpers}
          placeholder={t('odataRequestTab.urlPlaceholder', 'https://service/odata/EntitySet')}
          data-testid="odata-request-url"
        />
      </div>
      <div style={sendButtonWrapperStyle}>
        <SendButtonEnvSwitcher>
          <BeamWrap active={isSending} size={22} borderWidth={1.5}>
            <Button
              disabled={isSending}
              icon="play"
              onClick={handleSend}
              options={{
                ariaLabel: t('odataRequestTab.send', 'Send')
              }}
              data-testid="odata-request-send"
            >
              {t('odataRequestTab.send', 'Send')}
            </Button>
          </BeamWrap>
        </SendButtonEnvSwitcher>
      </div>
    </div>
    </div>
  )

  const requestContent = (
    <ScrollableElement
      style={formOuterStyle}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
    >
    <div style={formStyle} data-testid="odata-request-form">
      <div style={numericRowStyle}>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-request-version">
            {t('odataRequestTab.version', 'OData version')}
          </label>
          <SelectBox
            id="odata-request-version"
            className="odata-request-version"
            options={odataVersionOptions}
            selected={Math.max(0, ODATA_VERSION_BY_INDEX.indexOf(request.odataVersion))}
            onDidSelect={(data: ISelectData) => {
              const next = ODATA_VERSION_BY_INDEX[data.index]
              if (next) setVersion(next)
            }}
            data-testid="odata-request-version"
          />
        </div>
        <div style={{ ...rowStyle, ...numericItemStyle, flex: 2 }}>
          <label style={labelStyle} htmlFor="odata-request-operation-kind">
            {t('odataRequestTab.operationKind', 'Operation kind')}
          </label>
          <SelectBox
            id="odata-request-operation-kind"
            className="odata-request-operation-kind"
            options={operationKindOptions}
            selected={Math.max(0, ODATA_OPERATION_KIND_BY_INDEX.indexOf(request.operationKind))}
            onDidSelect={(data: ISelectData) => {
              const next = ODATA_OPERATION_KIND_BY_INDEX[data.index]
              if (next) setOperationKind(next)
            }}
            data-testid="odata-request-operation-kind"
          />
        </div>
      </div>

      {request.operationKind === 'action' ? (
        <div style={rowStyle}>
          {request.operationParameters && request.operationParameters.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>
                {t('odataRequestTab.actionParameters', 'Action parameters (from metadata)')}
              </label>
              <ODataOperationParameterEditor
                value={request.operationParameters}
                onChange={setOperationParameters}
                onApply={applyActionParameters}
                applyLabel={t('odataRequestTab.paramsApplyToBody', 'Apply to body')}
                testIdPrefix="odata-action-param"
              />
            </div>
          ) : null}
          <label style={labelStyle} htmlFor="odata-request-action-body">
            {t('odataRequestTab.actionBody', 'Action body (JSON)')}
          </label>
          <div style={{ height: 180, border: '1px solid var(--input-border)', borderRadius: 4, boxSizing: 'border-box' }}>
            <CodeEditor
              height="100%"
              language="json"
              value={request.actionBody ?? ''}
              onChange={(next) => { setActionBody(next ?? '') }}
              options={{
                minimap: { enabled: false },
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true
              }}
              data-testid="odata-request-action-body"
            />
          </div>
        </div>
      ) : null}

      {request.operationKind === 'batch' ? (
        <div style={rowStyle}>
          <label style={labelStyle}>
            {t('odataRequestTab.batchBody', 'Batch sub-requests')}
          </label>
          <ODataBatchEditor
            value={request.batchSubRequests ?? []}
            onChange={setBatchSubRequests}
            format={request.batchFormat ?? 'multipart'}
            onFormatChange={setBatchFormat}
            allowGetInChangeSet={request.allowGetInChangeSet ?? false}
            onAllowGetInChangeSetChange={setAllowGetInChangeSet}
            forceAbsoluteBatchUrls={request.forceAbsoluteBatchUrls ?? false}
            onForceAbsoluteBatchUrlsChange={setForceAbsoluteBatchUrls}
            isV401={request.odataVersion === 'v4.01'}
          />
        </div>
      ) : null}

      {request.operationKind === 'function' ? (
        <div style={{ ...rowStyle, padding: '4px 0', flexDirection: 'column', alignItems: 'stretch' }}>
          {request.operationParameters && request.operationParameters.length > 0 ? (
            <>
              <label style={labelStyle}>
                {t('odataRequestTab.functionParameters', 'Function parameters (from metadata)')}
              </label>
              <ODataOperationParameterEditor
                value={request.operationParameters}
                onChange={setOperationParameters}
                onApply={applyFunctionParameters}
                applyLabel={t('odataRequestTab.paramsApplyToUrl', 'Apply to URL')}
                testIdPrefix="odata-function-param"
              />
            </>
          ) : null}
          <span style={{ ...labelStyle, fontStyle: 'italic' }}>
            {t(
              'odataRequestTab.functionHint',
              'Inline function parameters directly in the URL, e.g. /GetAvailablePets(category=\'Dogs\'). Use {{env.var}} for env-driven values.'
            )}
          </span>
        </div>
      ) : null}

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-filter">$filter</label>
        <ODataFilterEditor
          value={filterText}
          onChange={setFilter}
          apiDocumentation={apiDocumentation}
          entityTypeRef={request.entityTypeRef}
          placeholder={t('odataRequestTab.filterPlaceholder', "Name eq 'Alice' and Age gt 21")}
          data-testid="odata-request-filter"
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-select">$select</label>
        <InputBox
          value={selectText}
          onChange={setSelect}
          changeDebounceMs={0}
          options={{ placeholder: t('odataRequestTab.selectPlaceholder', 'Id, Name, Email (comma-separated)') }}
          data-testid="odata-request-select"
        />
        <ODataPropertyChips
          properties={request.entitySetProperties ?? []}
          onPick={appendSelectProperty}
          testIdPrefix="odata-select-chip"
        />
      </div>

      <div style={numericRowStyle}>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-top">$top</label>
          <InputBox
            value={topText}
            onChange={setTop}
            changeDebounceMs={0}
            options={{
              type: 'number',
              min: 0,
              step: 1,
              placeholder: t('odataRequestTab.topPlaceholder', '50')
            }}
            data-testid="odata-request-top"
          />
        </div>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-skip">$skip</label>
          <InputBox
            value={skipText}
            onChange={setSkip}
            changeDebounceMs={0}
            options={{
              type: 'number',
              min: 0,
              step: 1,
              placeholder: t('odataRequestTab.skipPlaceholder', '0')
            }}
            data-testid="odata-request-skip"
          />
        </div>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle}>$count</label>
          <Toggle
            checked={request.queryOptions.count === true}
            onChange={setCount}
            data-testid="odata-request-count"
          />
        </div>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>$expand</label>
        <ODataExpandEditor
          value={expandText}
          onChange={setExpand}
        />
        <ODataPropertyChips
          properties={request.navigationProperties ?? []}
          onPick={appendExpandProperty}
          label={t('odataRequestTab.navigationPropertiesHint', 'Navigation properties:')}
          testIdPrefix="odata-expand-chip"
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>$orderby</label>
        <ODataOrderbyEditor
          value={orderbyText}
          onChange={setOrderby}
          propertySuggestions={request.entitySetProperties ?? []}
        />
        <ODataPropertyChips
          properties={request.entitySetProperties ?? []}
          onPick={appendOrderbyProperty}
          testIdPrefix="odata-orderby-chip"
        />
      </div>

      <div style={numericRowStyle}>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-search">$search</label>
          <InputBox
            value={searchText}
            onChange={setSearch}
            changeDebounceMs={0}
              options={{ placeholder: t('odataRequestTab.searchPlaceholder', 'puppy') }}
            data-testid="odata-request-search"
          />
        </div>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-format">$format</label>
          <InputBox
            value={formatText}
            onChange={setFormat}
            changeDebounceMs={0}
              options={{ placeholder: t('odataRequestTab.formatPlaceholder', 'json') }}
            data-testid="odata-request-format"
          />
        </div>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-apply">$apply</label>
        <InputBox
          value={applyText}
          onChange={setApply}
          changeDebounceMs={0}
          options={{ placeholder: t('odataRequestTab.applyPlaceholder', 'groupby((Status),aggregate($count as Total))') }}
          data-testid="odata-request-apply"
        />
      </div>

      <div style={previewRowStyle} data-testid="odata-request-url-preview">
        <span style={labelStyle}>{t('odataRequestTab.urlPreview', 'URL preview (pre-resolution)')}</span>
        <div style={previewValueStyle}>{urlPreview}</div>
      </div>
    </div>
    </ScrollableElement>
  )

  const handleNavigateToLink = useCallback((nextUrl: string) => {
    // Clicking a nav link loads its URL as the new request URL. The
    // URL typically already carries any query options the server
    // assembled for us, so we also clear the builder's $options
    // state — otherwise URLResolver would append them again and
    // produce a bogus composite URL. We stop short of auto-sending
    // so the user sees the change before the network call.
    flushAllPendingProxyWrites()
    updateReactiveProperty(request, 'url', nextUrl)
    updateReactiveProperty(request, 'queryOptions', {})
    setFilterText('')
    setSelectText('')
    setTopText('')
    setSkipText('')
    setExpandText('')
    setOrderbyText('')
    setSearchText('')
    setFormatText('')
    setApplyText('')
  }, [request, flushAllPendingProxyWrites])

  // One-click pagination: fetch `@odata.nextLink` verbatim via the
  // OData IPC bridge (with `urlOverride` so URLResolver stays out of
  // the way) and merge the new `value[]` into the response body. The
  // new `@odata.nextLink` replaces the old so the button keeps working
  // until the server stops sending one.
  const handleLoadNextPage = useCallback(async (): Promise<void> => {
    if (!response) return
    const parsed = tryParseJson(response.body)
    const normalized = parsed !== null && typeof parsed === 'object'
      ? normalizeODataResponse(parsed, request.odataVersion)
      : null
    const nextLink = normalized?.nextLink
    if (!nextLink) return
    const api = window.restorm?.odata
    if (!api) return
    setIsSending(true)
    try {
      const nextLinkAuthId = request.authenticationRequestId
      const nextLinkAuth = nextLinkAuthId ? resolveAuthRequest(nextLinkAuthId) : null
      const nextLinkPlain = nextLinkAuth
        ? nextLinkAuth.toPlainObject?.() ?? nextLinkAuth
        : undefined
      const nextLinkAuthPayload = nextLinkPlain !== undefined
        ? JSON.parse(JSON.stringify(nextLinkPlain)) as unknown
        : undefined
      const result = await api.execute({
        requestId: request.id,
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
        method: 'GET',
        urlOverride: nextLink,
        ...(nextLinkAuthPayload ? { authRequest: nextLinkAuthPayload } : {})
      })
      const nextParsed = tryParseJson(result.body ?? '')
      const nextNormalized = nextParsed !== null && typeof nextParsed === 'object'
        ? normalizeODataResponse(nextParsed, request.odataVersion)
        : null
      const normalizedBody = normalized.body
      const nextNormalizedBody = nextNormalized?.body
      if (
        nextNormalizedBody &&
        Array.isArray(normalizedBody['value']) && Array.isArray(nextNormalizedBody['value'])
      ) {
        // Merge: copy all prior fields, overwrite `value` with the
        // concatenated arrays, drop the stale `@odata.nextLink`
        // (since the new page either supplies its own, which we add
        // below, or is the final page and should carry no nextLink).
        const { ['@odata.nextLink']: _stale, ...rest } = normalizedBody
        const priorValue = normalizedBody['value'] as unknown[]
        const nextValue = nextNormalizedBody['value'] as unknown[]
        const merged: Record<string, unknown> = {
          ...rest,
          value: [...priorValue, ...nextValue],
          ...(nextNormalized.nextLink ? { '@odata.nextLink': nextNormalized.nextLink } : {}),
          ...(nextNormalized.count !== undefined ? { '@odata.count': nextNormalized.count } : {})
        }
        setResponse({
          ...response,
          statusCode: result.statusCode ?? response.statusCode,
          statusText: result.statusText ?? response.statusText,
          requestUrl: result.requestUrl ?? response.requestUrl,
          durationMs: result.timings.durationMs,
          body: JSON.stringify(merged, null, 2),
          ...(result.headers !== undefined && { headers: result.headers })
        })
      } else if (result.body) {
        setResponse({
          ...response,
          statusCode: result.statusCode ?? response.statusCode,
          statusText: result.statusText ?? response.statusText,
          requestUrl: result.requestUrl ?? response.requestUrl,
          durationMs: result.timings.durationMs,
          body: result.body,
          ...(result.headers !== undefined && { headers: result.headers })
        })
      }
      setHistoryRefreshKey((prev) => prev + 1)
      eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
    } catch (err) {
      logger.error('OData load-next-page failed', { error: String(err) })
    } finally {
      setIsSending(false)
    }
  }, [response, request, resolveAuthRequest])

  /**
   * Follow the `@odata.deltaLink` to fetch the next delta set.
   * Unlike pagination which APPENDS the new `value[]`, delta REPLACES:
   * the response contains the complete current change-set (added /
   * updated entities, plus `@removed` tombstones). The response body
   * is overwritten entirely with the fresh delta payload, and
   * `@odata.deltaLink` is updated (or cleared when the server doesn't
   * emit one on the delta response).
   */
  const handleLoadDelta = useCallback(async (): Promise<void> => {
    if (!response) return
    const deltaLink = response.odataDeltaLink
    if (!deltaLink) return
    const api = window.restorm?.odata
    if (!api) return
    setIsSending(true)
    try {
      const authId = request.authenticationRequestId
      const auth = authId ? resolveAuthRequest(authId) : null
      const authPlain = auth ? auth.toPlainObject?.() ?? auth : undefined
      const authPayload = authPlain !== undefined
        ? JSON.parse(JSON.stringify(authPlain)) as unknown
        : undefined
      const result = await api.execute({
        requestId: request.id,
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
        method: 'GET',
        urlOverride: deltaLink,
        ...(authPayload ? { authRequest: authPayload } : {})
      })
      // Delta REPLACES — set the new body directly, capture the new
      // deltaLink (or clear it when the server omits it).
      const deltaParsed = tryParseJson(result.body ?? '')
      const deltaNormalized = deltaParsed !== null && typeof deltaParsed === 'object'
        ? normalizeODataResponse(deltaParsed, request.odataVersion)
        : null
      // Strip the old deltaLink from the spread so we don't carry over a stale link
      // when the new delta response doesn't emit one.
      const { odataDeltaLink: _oldDelta, ...responseWithoutDelta } = response
      setResponse({
        ...responseWithoutDelta,
        statusCode: result.statusCode ?? response.statusCode,
        statusText: result.statusText ?? response.statusText,
        requestUrl: result.requestUrl ?? response.requestUrl,
        durationMs: result.timings.durationMs,
        body: result.body ?? response.body,
        ...(result.headers !== undefined && { headers: result.headers }),
        ...(deltaNormalized?.deltaLink !== undefined ? { odataDeltaLink: deltaNormalized.deltaLink } : {})
      })
      setHistoryRefreshKey((prev) => prev + 1)
      eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
    } catch (err) {
      logger.error('OData load-delta failed', { error: String(err) })
    } finally {
      setIsSending(false)
    }
  }, [response, request, resolveAuthRequest])

  const buildResponseView = useCallback((input: {
    statusCode: number
    statusText: string
    durationMs: number
    method: string
    requestUrl: string
    body: string
    headers?: Record<string, string | string[]> | undefined
    headersFromHistory?: { key: string; value: string }[]
    requestHeadersFromHistory?: { key: string; value: string }[]
    odataVersion: ODataVersion
    operationKind?: ODataOperationKind
    odataCount?: number | undefined
    odataNextLink?: string | undefined
    contentType?: string | undefined
    contentLength?: number | undefined
    error?: string | undefined
    disableNavigate?: boolean
    /** Parsed per-child responses from a `$batch` call. When present
     * the response panel renders one card per child instead of the
     * raw batch body. */
    batchSubResponses?: ODataBatchSubResponse[]
    /** Serializer warnings (e.g. GET in a change-set). */
    batchWarnings?: string[]
    /** @odata.deltaLink from the response, for delta-follow button. */
    odataDeltaLink?: string | undefined
  }): {
    responseContent: React.ReactNode
    infosContent: React.ReactNode
    jsonData: unknown
  } => {
    const parsed = tryParseJson(input.body)
    const normalized = parsed !== null && typeof parsed === 'object'
      ? normalizeODataResponse(parsed, input.odataVersion)
      : null

    const formattedBody = normalized
      ? JSON.stringify(normalized.body, null, 2)
      : parsed !== null && typeof parsed === 'object'
        ? JSON.stringify(parsed, null, 2)
        : input.body

    const nextLinkForPagination = input.odataNextLink ?? normalized?.nextLink
    const showLoadMore = !input.disableNavigate && typeof nextLinkForPagination === 'string' && nextLinkForPagination.length > 0
    const deltaLinkForGet = input.odataDeltaLink ?? normalized?.deltaLink
    const showGetDelta = !input.disableNavigate && typeof deltaLinkForGet === 'string' && deltaLinkForGet.length > 0

    // Delta classification: count @removed tombstones vs changed entries.
    // A tombstone has `@removed` at the top level; everything else in
    // `value[]` is an added or updated entity (we can't distinguish
    // added vs updated without the prior state, so both are labelled "changed").
    const deltaEntries = Array.isArray(normalized?.value) ? normalized.value as unknown[] : []
    const deltaRemovedCount = deltaEntries.filter(
      (e) => e !== null && typeof e === 'object' && '@removed' in (e as Record<string, unknown>)
    ).length
    const deltaChangedCount = deltaEntries.length - deltaRemovedCount
    const hasDeltaEntries = deltaEntries.length > 0 && deltaLinkForGet !== undefined

    // Surface a non-blocking warning when the response envelope shape
    // contradicts the version this request is tagged with (e.g. a v4
    // request that got a v2 `{ d: … }` body) — the response is still
    // normalised + rendered, the banner just flags the discrepancy.
    const mismatchVersion = detectODataVersionMismatch(parsed, input.odataVersion)

    // For `$batch` responses, render a batch-specific panel when there
    // are serializer warnings (e.g. GET in a change-set) and/or parsed
    // per-child sub-responses. 4xx/5xx children are highlighted.
    const hasBatchWarnings = (input.batchWarnings?.length ?? 0) > 0
    const hasBatchSubResponses = (input.batchSubResponses?.length ?? 0) > 0
    if (hasBatchWarnings || hasBatchSubResponses) {
      const batchSubResponses = input.batchSubResponses ?? []
      const batchContent: React.ReactNode = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }} data-testid="odata-batch-response-panel">
          {(input.batchWarnings ?? []).map((warning, wi) => (
            <div
              key={wi}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid var(--inputValidation-warningBorder)',
                background: 'var(--inputValidation-warningBackground)',
                color: 'var(--inputValidation-warningForeground, var(--foreground))',
                fontSize: 12
              }}
              data-testid={`odata-batch-serializer-warning-${wi}`}
            >
              {warning}
            </div>
          ))}
          {hasBatchSubResponses ? (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {batchSubResponses.map((sub, si) => {
                const isError = sub.status >= 400
                return (
                  <div
                    key={si}
                    style={{
                      marginBottom: 8,
                      border: `1px solid ${isError ? 'var(--inputValidation-errorBorder)' : 'var(--panel-border)'}`,
                      borderRadius: 4,
                      overflow: 'hidden'
                    }}
                    data-testid={`odata-batch-sub-response-${si}`}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '4px 8px',
                        background: isError ? 'var(--inputValidation-errorBackground)' : 'var(--sideBar-background)',
                        fontSize: 12,
                        fontFamily: 'var(--editor-font-family, monospace)'
                      }}
                    >
                      <span
                        style={{ color: getStatusColor(sub.status), fontWeight: 600 }}
                        data-testid={`odata-batch-sub-status-${si}`}
                      >
                        {sub.status !== 0 ? sub.status : '—'}
                        {sub.statusText ? ` ${sub.statusText}` : ''}
                      </span>
                    </div>
                    {sub.body ? (
                      <div style={{ height: 120, borderTop: '1px solid var(--panel-border)' }}>
                        <CodeEditor
                          height="100%"
                          language="json"
                          value={(() => {
                            try { return JSON.stringify(JSON.parse(sub.body), null, 2) } catch { return sub.body }
                          })()}
                          options={{
                            minimap: { enabled: false },
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            readOnly: true
                          }}
                          data-testid={`odata-batch-sub-body-${si}`}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      )
      return {
        responseContent: batchContent,
        infosContent: (() => {
          // Build a minimal infos panel for the batch-level response.
          const generalItems: ListViewItemData[] = []
          if (input.requestUrl) {
            generalItems.push({ id: 'g-url', icon: 'blank', title: <span style={kvRowStyle}><span style={infoLabelStyle}>Request URL</span><span>{input.requestUrl}</span></span> })
          }
          generalItems.push({ id: 'g-method', icon: 'blank', title: <span style={kvRowStyle}><span style={infoLabelStyle}>Request Method</span><span>{input.method}</span></span> })
          generalItems.push({ id: 'g-status', icon: 'blank', title: <span style={kvRowStyle}><span style={infoLabelStyle}>Status Code</span><span style={{ color: getStatusColor(input.statusCode) }}>{input.statusCode} {input.statusText}</span></span> })
          generalItems.push({ id: 'g-dur', icon: 'blank', title: <span style={kvRowStyle}><span style={infoLabelStyle}>Duration</span><span>{formatDuration(input.durationMs)}</span></span> })
          generalItems.push({ id: 'g-children', icon: 'blank', title: <span style={kvRowStyle}><span style={infoLabelStyle}>Sub-responses</span><span>{batchSubResponses.length}</span></span> })
          const responseHeaderItems: ListViewItemData[] = input.headers
            ? headersToListItems(input.headers, 'resp-header')
            : (input.headersFromHistory ?? []).map((kv, index) => ({
              id: `resp-header-${index}`,
              icon: 'blank' as const,
              title: <span style={kvRowStyle}><span style={kvKeyStyle}>{kv.key}</span><span style={kvValueStyle}>{kv.value}</span></span>
            }))
          const treeItems: ListViewItemData[] = [
            { id: 'group-general', title: 'General', icon: 'info', isExpandable: true, isExpanded: true, children: generalItems },
            { id: 'group-response-headers', title: `Response headers (${responseHeaderItems.length})`, icon: 'call-incoming', isExpandable: true, isExpanded: true, children: responseHeaderItems }
          ]
          return (
            <div style={fullHeightBoxStyle}>
              <ListView items={treeItems} rootRole="tree" ariaLabel="OData batch response info" data-testid="odata-batch-response-headers-list" />
            </div>
          )
        })(),
        jsonData: null
      }
    }

    const renderedContent: React.ReactNode = input.body ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        {mismatchVersion ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid var(--inputValidation-warningBorder)',
              background: 'var(--inputValidation-warningBackground)',
              color: 'var(--inputValidation-warningForeground, var(--foreground))',
              fontSize: 12
            }}
            data-testid="odata-response-version-warning"
          >
            {t(
              'odataRequestTab.versionMismatchWarning',
              'This request is tagged {{requestVersion}} but the response looks like {{responseVersion}}. Switch the request version to match the server.',
              { requestVersion: input.odataVersion, responseVersion: mismatchVersion }
            )}
          </div>
        ) : null}
        {showLoadMore ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Button
              icon="arrow-circle-down"
              onClick={() => { void handleLoadNextPage() }}
              options={{
                ariaLabel: t('odataRequestTab.loadNextPage', 'Load next page')
              }}
              data-testid="odata-response-load-next-page"
            >
              {t('odataRequestTab.loadNextPage', 'Load next page')}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--descriptionForeground)' }}>
              {t('odataRequestTab.paginatedHint', '@odata.nextLink available — click to append the next page to this response.')}
            </span>
          </div>
        ) : null}
        {showGetDelta ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <Button
              icon="arrow-circle-down"
              onClick={() => { void handleLoadDelta() }}
              options={{
                ariaLabel: t('odataRequestTab.getDelta', 'Get delta')
              }}
              data-testid="odata-response-get-delta"
            >
              {t('odataRequestTab.getDelta', 'Get delta')}
            </Button>
            <span style={{ fontSize: 12, color: 'var(--descriptionForeground)' }}>
              {t('odataRequestTab.deltaHint', '@odata.deltaLink available — click to replace this response with the latest change-set.')}
            </span>
            {hasDeltaEntries ? (
              <span style={{ display: 'flex', gap: 6, fontSize: 12, flexShrink: 0 }} data-testid="odata-delta-summary">
                {deltaChangedCount > 0 ? (
                  <span style={{ color: 'var(--testing-iconPassed)', fontWeight: 600 }}>
                    {t('odataRequestTab.deltaChanged', '{{count}} changed', { count: deltaChangedCount })}
                  </span>
                ) : null}
                {deltaRemovedCount > 0 ? (
                  <span style={{ color: 'var(--testing-iconFailed)', fontWeight: 600 }}>
                    {t('odataRequestTab.deltaRemoved', '{{count}} removed', { count: deltaRemovedCount })}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
        <div style={{ ...editorContainerStyle, flex: 1, minHeight: 0 }}>
          <CodeEditor
            height="100%"
            language="json"
            value={formattedBody}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              readOnly: true
            }}
            data-testid="odata-response-body-editor"
          />
        </div>
      </div>
    ) : (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--descriptionForeground)'
      }}>
        {input.error ?? t('odataRequestTab.responseEmpty', 'No response body')}
      </div>
    )

    const count = input.odataCount ?? normalized?.count
    const nextLink = input.odataNextLink ?? normalized?.nextLink
    const deltaLink = input.odataDeltaLink ?? normalized?.deltaLink

    const generalItems: ListViewItemData[] = []
    if (input.requestUrl) {
      generalItems.push({
        id: 'general-request-url',
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={infoLabelStyle}>Request URL</span>
            <span>{input.requestUrl}</span>
          </span>
        )
      })
    }
    generalItems.push({
      id: 'general-request-method',
      icon: 'blank',
      title: (
        <span style={kvRowStyle}>
          <span style={infoLabelStyle}>Request Method</span>
          <span>{input.method}</span>
        </span>
      )
    })
    generalItems.push({
      id: 'general-status-code',
      icon: 'blank',
      title: (
        <span style={kvRowStyle}>
          <span style={infoLabelStyle}>Status Code</span>
          <span style={{ color: getStatusColor(input.statusCode) }}>
            {input.statusCode} {input.statusText}
          </span>
        </span>
      )
    })
    generalItems.push({
      id: 'general-duration',
      icon: 'blank',
      title: (
        <span style={kvRowStyle}>
          <span style={infoLabelStyle}>Duration</span>
          <span>{formatDuration(input.durationMs)}</span>
        </span>
      )
    })
    generalItems.push({
      id: 'general-odata-version',
      icon: 'blank',
      title: (
        <span style={kvRowStyle}>
          <span style={infoLabelStyle}>OData version</span>
          <span>{input.odataVersion}</span>
        </span>
      )
    })
    if (input.operationKind) {
      generalItems.push({
        id: 'general-odata-operation',
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={infoLabelStyle}>Operation kind</span>
            <span>{input.operationKind}</span>
          </span>
        )
      })
    }
    const resolvedContentType = input.contentType ?? (() => {
      const raw = input.headers?.['content-type']
      return Array.isArray(raw) ? raw[0] : raw
    })()
    const resolvedContentLength = input.contentLength ?? (() => {
      const raw = input.headers?.['content-length']
      const str = Array.isArray(raw) ? raw[0] : raw
      const parsed = str ? parseInt(str, 10) : NaN
      return Number.isNaN(parsed) ? undefined : parsed
    })()
    if (resolvedContentType) {
      generalItems.push({
        id: 'general-content-type',
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={infoLabelStyle}>Content-Type</span>
            <span>{resolvedContentType}</span>
          </span>
        )
      })
    }
    if (resolvedContentLength !== undefined) {
      generalItems.push({
        id: 'general-content-length',
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={infoLabelStyle}>Content-Length</span>
            <span>{resolvedContentLength < 1024 ? `${resolvedContentLength} B` : resolvedContentLength < 1024 * 1024 ? `${(resolvedContentLength / 1024).toFixed(2)} KB` : `${(resolvedContentLength / (1024 * 1024)).toFixed(2)} MB`}</span>
          </span>
        )
      })
    }
    if (count !== undefined) {
      generalItems.push({
        id: 'general-odata-count',
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={infoLabelStyle}>@odata.count</span>
            <span>{count}</span>
          </span>
        )
      })
    }
    if (nextLink) {
      generalItems.push({
        id: 'general-odata-nextlink',
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={infoLabelStyle}>@odata.nextLink</span>
            <span style={{ wordBreak: 'break-all' }}>{nextLink}</span>
          </span>
        )
      })
    }
    if (deltaLink) {
      generalItems.push({
        id: 'general-odata-deltalink',
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={infoLabelStyle}>@odata.deltaLink</span>
            <span style={{ wordBreak: 'break-all' }}>{deltaLink}</span>
          </span>
        )
      })
    }
    if (input.error) {
      generalItems.push({
        id: 'general-error',
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={infoLabelStyle}>Error</span>
            <span style={errorTextStyle}>{input.error}</span>
          </span>
        )
      })
    }

    const responseHeaderItems: ListViewItemData[] = input.headers
      ? headersToListItems(input.headers, 'resp-header')
      : (input.headersFromHistory ?? []).map((kv, index) => ({
        id: `resp-header-${index}`,
        icon: 'blank',
        title: (
          <span style={kvRowStyle}>
            <span style={kvKeyStyle}>{kv.key}</span>
            <span style={kvValueStyle}>{kv.value}</span>
          </span>
        )
      }))

    const requestHeaderItems: ListViewItemData[] = (input.requestHeadersFromHistory ?? []).map((kv, index) => ({
      id: `req-header-${index}`,
      icon: 'blank',
      title: (
        <span style={kvRowStyle}>
          <span style={kvKeyStyle}>{kv.key}</span>
          <span style={kvValueStyle}>{kv.value}</span>
        </span>
      )
    }))

    // Extract OData annotation URLs from the response body so the
    // user can jump to @odata.id / @odata.editLink / nextLink / any
    // navigation-link on an expanded entity without hunting through
    // the raw JSON.
    const navigationLinks = normalized ? extractNavigationLinks(normalized.body) : []
    const navLinkItems: ListViewItemData[] = navigationLinks.map((link, index) => ({
      id: `nav-link-${index}`,
      icon: 'link',
      title: (
        <span style={kvRowStyle}>
          <span style={kvKeyStyle}>{link.path ? `${link.path} / ${link.key}` : link.key}</span>
          {input.disableNavigate ? (
            <span style={{ ...kvValueStyle, wordBreak: 'break-all' }}>{link.url}</span>
          ) : (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                handleNavigateToLink(link.url)
              }}
              style={{
                color: 'var(--textLink-foreground)',
                cursor: 'pointer',
                wordBreak: 'break-all',
                textDecoration: 'underline'
              }}
              data-testid={`odata-nav-link-${index}`}
            >
              {link.url}
            </a>
          )}
        </span>
      )
    }))

    const headersTreeItems: ListViewItemData[] = [
      { id: 'group-general', title: 'General', icon: 'info', isExpandable: true, isExpanded: true, children: generalItems },
      ...(navLinkItems.length > 0 ? [{
        id: 'group-nav-links',
        title: `Navigation links (${navLinkItems.length})`,
        icon: 'link',
        isExpandable: true,
        isExpanded: true,
        children: navLinkItems
      }] : []),
      { id: 'group-response-headers', title: `Response headers (${responseHeaderItems.length})`, icon: 'call-incoming', isExpandable: true, isExpanded: true, children: responseHeaderItems },
      { id: 'group-request-headers', title: `Request headers (${requestHeaderItems.length})`, icon: 'call-outgoing', isExpandable: true, isExpanded: true, children: requestHeaderItems }
    ]

    const renderedInfos: React.ReactNode = (
      <div style={fullHeightBoxStyle}>
        <ListView
          items={headersTreeItems}
          rootRole="tree"
          ariaLabel="OData request and response info"
          data-testid="odata-response-headers-list"
        />
      </div>
    )

    const json = normalized ? normalized.body : parsed
    return {
      responseContent: renderedContent,
      infosContent: renderedInfos,
      jsonData: json
    }
  }, [t, handleNavigateToLink, handleLoadNextPage, handleLoadDelta])

  const { responseContent, infosContent, jsonData } = useMemo(() => {
    if (!response) {
      return {
        responseContent: undefined as React.ReactNode | undefined,
        infosContent: undefined as React.ReactNode | undefined,
        jsonData: undefined as unknown
      }
    }
    return buildResponseView({
      statusCode: response.statusCode,
      statusText: response.statusText,
      durationMs: response.durationMs,
      method: response.method,
      requestUrl: response.requestUrl,
      body: response.body,
      headers: response.headers,
      odataVersion: request.odataVersion,
      operationKind: request.operationKind,
      ...(response.error !== undefined ? { error: response.error } : {}),
      ...(response.batchSubResponses !== undefined ? { batchSubResponses: response.batchSubResponses } : {}),
      ...(response.batchWarnings !== undefined ? { batchWarnings: response.batchWarnings } : {}),
      ...(response.odataDeltaLink !== undefined ? { odataDeltaLink: response.odataDeltaLink } : {})
    })
  }, [response, request.odataVersion, request.operationKind, buildResponseView])

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail): {
    infosContent?: React.ReactNode | undefined
    responseContent?: React.ReactNode | undefined
    jsonData?: unknown
  } => {
    if (detail.response.type === 'odata') {
      const r = detail.response
      const view = buildResponseView({
        statusCode: r.statusCode,
        statusText: r.statusText,
        durationMs: r.timings.durationMs,
        method: r.requestMethod,
        requestUrl: r.requestUrl,
        body: r.responseBody,
        headersFromHistory: r.responseHeaders,
        requestHeadersFromHistory: r.requestHeaders,
        odataVersion: r.odataVersion,
        operationKind: r.operationKind,
        disableNavigate: true,
        ...(r.odataCount !== undefined ? { odataCount: r.odataCount } : {}),
        ...(r.odataNextLink !== undefined ? { odataNextLink: r.odataNextLink } : {}),
        ...(r.odataDeltaLink !== undefined ? { odataDeltaLink: r.odataDeltaLink } : {}),
        ...(r.contentType !== undefined ? { contentType: r.contentType } : {}),
        ...(r.contentLength !== undefined ? { contentLength: r.contentLength } : {}),
        ...(r.error !== undefined ? { error: r.error } : {})
      })
      return {
        responseContent: view.responseContent,
        infosContent: view.infosContent,
        jsonData: view.jsonData
      }
    }
    // Legacy: OData executions recorded before the dedicated `odata`
    // history type landed are stored as `'http'`. Render them in the
    // same chrome so users can still browse pre-existing entries.
    if (detail.response.type === 'http') {
      const r = detail.response
      const view = buildResponseView({
        statusCode: r.statusCode,
        statusText: r.statusText,
        durationMs: r.timings.durationMs,
        method: r.requestMethod,
        requestUrl: r.requestUrl,
        body: r.responseBody,
        headersFromHistory: r.responseHeaders,
        requestHeadersFromHistory: r.requestHeaders,
        odataVersion: request.odataVersion,
        operationKind: request.operationKind,
        disableNavigate: true,
        ...(r.contentType !== undefined ? { contentType: r.contentType } : {}),
        ...(r.contentLength !== undefined ? { contentLength: r.contentLength } : {}),
        ...(r.error !== undefined ? { error: r.error } : {})
      })
      return {
        responseContent: view.responseContent,
        infosContent: view.infosContent,
        jsonData: view.jsonData
      }
    }
    return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
  }, [buildResponseView, request.odataVersion, request.operationKind])

  const handleCloseHistoryModal = useCallback(() => {
    setHistoryModalOpen(false)
  }, [])

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

  return (
    <>
      <BaseRequestTabView
        requestId={request.id}
        urlSection={isServer ? serverUrlSection : urlSection}
        requestContent={isServer ? serverRequestContent : requestContent}
        codeSnippetsContent={t(
          'odataRequestTab.codeSnippetsPlaceholder',
          '// Code snippet generation will ship alongside OData execution.'
        )}
        notes={request.notes}
        onNotesChange={(notes: string) => { updateReactiveProperty(request, 'notes', notes) }}
        isLoading={isSending}
        showResponse={isServer ? isListening : response !== null}
        {...(isServer ? { responseContent: serverResponseContent } : responseContent !== undefined ? { responseContent } : {})}
        {...(isServer ? {} : infosContent !== undefined ? { infosContent } : {})}
        {...(isServer ? {} : jsonData !== undefined ? { jsonData } : {})}
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
