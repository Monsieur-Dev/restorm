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
 * Response tab, and feeds the parsed value into the JsonCrack tab.
 *
 * History is recorded via `ResponseHistoryService` as a dedicated
 * `'odata'` entry; the same builder drives live rendering and
 * replay so the chrome stays consistent.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTranslation } from 'react-i18next'
import {
  Button,
  CodeEditor,
  InputBox,
  ListView,
  ScrollableElement,
  SelectBox,
  Toggle,
  eventBus,
  logger,
  type ISelectOptionItem,
  type ISelectData,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import type { ODataRequest, ODataVersion, ODataOperationKind, ODataBatchSubRequestSpec, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { ODataBatchEditor } from './ODataBatchEditor'
import { ODataOrderbyEditor } from './ODataOrderbyEditor'
import { ODataExpandEditor } from './ODataExpandEditor'
import { ODataPropertyChips } from './ODataPropertyChips'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { KeyValueData } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { updateReactiveProperty } from './requestTabViewUtils'
import {
  serializeODataQueryOptions,
  buildODataUrl,
  keyValuesToPairs
} from '../../../../shared/utils/odataQuery'
import { normalizeODataResponse } from '../../../../shared/utils/odataResponse'
import { extractNavigationLinks } from '../../../../shared/utils/odataNavigationLinks'
import {
  serializeODataBatch,
  type ODataBatchSubRequest
} from '../../../../shared/utils/odataBatch'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../../../shared/config/constants'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'

const urlRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const urlInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
const sendButtonWrapperStyle: CSSProperties = { flexShrink: 0 }
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

const ODATA_VERSION_BY_INDEX: ODataVersion[] = ['v4', 'v3', 'v2']
const ODATA_OPERATION_KIND_BY_INDEX: ODataOperationKind[] = ['entity-set', 'function', 'action', 'batch']

function toKeyValueData(kvs: readonly KeyValue[]): KeyValueData[] {
  return kvs.map((kv) => ({
    id: kv.id,
    key: kv.key,
    value: kv.value.toString(),
    enabled: kv.enabled
  }))
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
}

export interface ODataRequestTabViewProps {
  request: ODataRequest
}

export const ODataRequestTabView: React.FC<ODataRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { selectedEnvId, environments } = useEnvironmentContext()
  const collections = useRestormStore((state) => state.collections)

  const odataVersionOptions = useMemo<ISelectOptionItem[]>(() => [
    { text: 'v4' },
    { text: t('odataRequestTab.version.v3NotYet', 'v3 (execution not yet supported)') },
    { text: t('odataRequestTab.version.v2NotYet', 'v2 (execution not yet supported)') }
  ], [t])

  const operationKindOptions = useMemo<ISelectOptionItem[]>(() => [
    { text: t('odataRequestTab.operationKind.entitySet', 'Entity set (GET)') },
    { text: t('odataRequestTab.operationKind.function', 'Function (GET with inlined parameters)') },
    { text: t('odataRequestTab.operationKind.action', 'Action (POST with JSON body)') },
    { text: t('odataRequestTab.operationKind.batch', 'Batch ($batch — multipart/mixed)') }
  ], [t])

  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<ODataResponseViewData | null>(null)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  const sourceIdRef = useRef<string>(crypto.randomUUID())
  const selectedEnvIdRef = useRef(selectedEnvId)
  const environmentsRef = useRef(environments)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { environmentsRef.current = environments }, [environments])

  const handleReset = useCallback(() => {
    setResponse(null)
  }, [])
  useRequestReset(request, handleReset)

  // `updateReactiveProperty` mutates the proxied `request` object
  // directly — consistent with the pattern used in HTTPRequestTabView.
  const setUrl = useCallback((next: string) => {
    updateReactiveProperty(request, 'url', next)
  }, [request])

  const setVersion = useCallback((next: string) => {
    updateReactiveProperty(request, 'odataVersion', next as ODataVersion)
  }, [request])

  const setOperationKind = useCallback((next: ODataOperationKind) => {
    updateReactiveProperty(request, 'operationKind', next)
  }, [request])

  const setActionBody = useCallback((next: string) => {
    updateReactiveProperty(request, 'actionBody', next)
  }, [request])

  const setBatchSubRequests = useCallback((next: ODataBatchSubRequestSpec[]) => {
    updateReactiveProperty(request, 'batchSubRequests', next)
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
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, select: Array.from(current) })
  }, [request])

  const appendOrderbyProperty = useCallback((name: string) => {
    const existing = request.queryOptions.orderby?.trim() ?? ''
    const next = existing ? `${existing},${name} asc` : `${name} asc`
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, orderby: next })
  }, [request])

  const appendExpandProperty = useCallback((name: string) => {
    const existing = request.queryOptions.expand?.trim() ?? ''
    const next = existing ? `${existing},${name}` : name
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, expand: next })
  }, [request])

  const setFilter = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, filter: next })
  }, [request])

  const setSelect = useCallback((next: string) => {
    const list = next.split(',').map((s) => s.trim()).filter((s) => s !== '')
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, select: list })
  }, [request])

  const setTop = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, top: next })
  }, [request])

  const setSkip = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, skip: next })
  }, [request])

  const setCount = useCallback((next: boolean) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, count: next })
  }, [request])

  const setExpand = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, expand: next })
  }, [request])

  const setOrderby = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, orderby: next })
  }, [request])

  const setSearch = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, search: next })
  }, [request])

  const setFormat = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, format: next })
  }, [request])

  const setApply = useCallback((next: string) => {
    updateReactiveProperty(request, 'queryOptions', { ...request.queryOptions, apply: next })
  }, [request])

  const selectJoined = (request.queryOptions.select ?? []).join(', ')

  // Live URL preview composed from the current (unresolved) values.
  // Handlebars templates stay literal in the preview — resolution
  // happens in the main process at send time.
  const urlPreview = useMemo(() => {
    const systemPairs = serializeODataQueryOptions(request.queryOptions, request.odataVersion)
    const extraPairs = keyValuesToPairs(request.params)
    return buildODataUrl(request.url, systemPairs, extraPairs)
  }, [request.url, request.odataVersion, request.queryOptions, request.params])

  // Register request with ContextService on mount, unregister on unmount.
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return
    const currentEnvId = selectedEnvIdRef.current ?? environmentsRef.current?.[0]?.id ?? null

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(request.headers),
      params: toKeyValueData(request.params)
    })

    return () => {
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id, request.headers, request.params])

  // Keep ContextService in sync with env selection.
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    void window.restorm?.context.setRequestEnvironment(requestId, currentEnvId)
  }, [selectedEnvId, environments, request.id])

  // Push the latest OData request shape to ContextService so
  // URLResolver can compose the resolved URL (with $filter / $select
  // / $top / $skip / $count appended). Keeps refiring when any of the
  // captured fields changes.
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return
    void window.restorm?.context.updateFullRequestData(requestId, {
      id: requestId,
      requestType: 'odata',
      url: request.url,
      headers: toKeyValueData(request.headers),
      params: toKeyValueData(request.params),
      odataVersion: request.odataVersion,
      odataOperationKind: request.operationKind,
      odataQueryOptions: { ...request.queryOptions }
    } as unknown as Parameters<typeof window.restorm.context.updateFullRequestData>[1], sourceIdRef.current)
  }, [
    request.id,
    request.url,
    request.headers,
    request.params,
    request.odataVersion,
    request.operationKind,
    request.queryOptions
  ])

  const handleSend = useCallback((): void => {
    if (isSending) return
    const requestId = request.id
    if (!requestId) {
      logger.error('Cannot send OData request without ID')
      return
    }
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
          ...(spec.atomicityGroup ? { atomicityGroup: spec.atomicityGroup } : {})
        }
      })
      const serialized = serializeODataBatch(subRequests)
      method = 'POST'
      body = serialized.body
      contentTypeOverride = serialized.contentType
    }
    const dispatchedMethod = method
    api.execute({
      requestId,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      method,
      ...(body !== undefined ? { body } : {}),
      ...(contentTypeOverride !== undefined ? { bodyContentType: contentTypeOverride } : {}),
      ...(requestPath ? { requestPath } : {})
    })
      .then((result) => {
        setResponse({
          statusCode: result.statusCode ?? 0,
          statusText: result.statusText ?? '',
          requestUrl: result.requestUrl ?? '',
          durationMs: result.timings.durationMs,
          body: result.body ?? '',
          method: dispatchedMethod,
          ...(result.headers !== undefined && { headers: result.headers }),
          ...(result.error !== undefined && { error: result.error })
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
  }, [isSending, request.id, request.operationKind, request.actionBody, request.batchSubRequests, requestPath])

  const urlSection = (
    <div style={urlRowStyle} data-testid="odata-request-url-section">
      <div style={urlInputWrapperStyle}>
        <InputBox
          value={request.url}
          onChange={setUrl}
          options={{ placeholder: t('odataRequestTab.urlPlaceholder', 'https://service/odata/EntitySet') }}
          data-testid="odata-request-url"
        />
      </div>
      <div style={sendButtonWrapperStyle}>
        <Button
          disabled={isSending}
          icon="play"
          onClick={handleSend}
          options={{
            ariaLabel: t('odataRequestTab.send', 'Send'),
            title: t('odataRequestTab.send', 'Send')
          }}
          data-testid="odata-request-send"
        >
          {t('odataRequestTab.send', 'Send')}
        </Button>
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
          />
        </div>
      ) : null}

      {request.operationKind === 'function' ? (
        <div style={{ ...rowStyle, padding: '4px 0' }}>
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
        <InputBox
          value={request.queryOptions.filter ?? ''}
          onChange={setFilter}
          options={{ placeholder: t('odataRequestTab.filterPlaceholder', "Name eq 'Alice' and Age gt 21") }}
          data-testid="odata-request-filter"
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-select">$select</label>
        <InputBox
          value={selectJoined}
          onChange={setSelect}
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
            value={request.queryOptions.top ?? ''}
            onChange={setTop}
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
            value={request.queryOptions.skip ?? ''}
            onChange={setSkip}
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
            isChecked={request.queryOptions.count === true}
            onChange={setCount}
            data-testid="odata-request-count"
          />
        </div>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>$expand</label>
        <ODataExpandEditor
          value={request.queryOptions.expand}
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
          value={request.queryOptions.orderby}
          onChange={setOrderby}
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
            value={request.queryOptions.search ?? ''}
            onChange={setSearch}
            options={{ placeholder: t('odataRequestTab.searchPlaceholder', 'puppy') }}
            data-testid="odata-request-search"
          />
        </div>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-format">$format</label>
          <InputBox
            value={request.queryOptions.format ?? ''}
            onChange={setFormat}
            options={{ placeholder: t('odataRequestTab.formatPlaceholder', 'json') }}
            data-testid="odata-request-format"
          />
        </div>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-apply">$apply</label>
        <InputBox
          value={request.queryOptions.apply ?? ''}
          onChange={setApply}
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
    updateReactiveProperty(request, 'url', nextUrl)
    updateReactiveProperty(request, 'queryOptions', {})
  }, [request])

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
      const result = await api.execute({
        requestId: request.id,
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
        method: 'GET',
        urlOverride: nextLink
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
  }, [response, request.id, request.odataVersion])

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

    const renderedContent: React.ReactNode = input.body ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        {showLoadMore ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Button
              icon="arrow-circle-down"
              onClick={() => { void handleLoadNextPage() }}
              options={{
                ariaLabel: t('odataRequestTab.loadNextPage', 'Load next page'),
                title: t('odataRequestTab.loadNextPage', 'Load next page')
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
  }, [t, handleNavigateToLink, handleLoadNextPage])

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
      ...(response.error !== undefined ? { error: response.error } : {})
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
        urlSection={urlSection}
        requestContent={requestContent}
        codeSnippetsContent={t(
          'odataRequestTab.codeSnippetsPlaceholder',
          '// Code snippet generation will ship alongside OData execution.'
        )}
        documentation={request.documentation}
        notes={request.notes}
        onNotesChange={(notes: string) => { updateReactiveProperty(request, 'notes', notes) }}
        isLoading={isSending}
        showResponse={response !== null}
        {...(responseContent !== undefined ? { responseContent } : {})}
        {...(infosContent !== undefined ? { infosContent } : {})}
        {...(jsonData !== undefined ? { jsonData } : {})}
      />
      <ResponseHistoryModal
        isOpen={historyModalOpen}
        onClose={handleCloseHistoryModal}
        requestId={request.id}
        {...(requestPath ? { requestPath } : {})}
        refreshKey={historyRefreshKey}
        buildResponseView={buildHistoryView}
      />
    </>
  )
}
