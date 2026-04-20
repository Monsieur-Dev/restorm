/**
 * ODataRequestTabView — Phase 1 (UI + engine wiring).
 *
 * Renders the URL, version selector and the v4 subset of system query
 * options ($filter / $select / $top / $skip / $count) that Phase 1
 * commits. The URL preview is computed live from the serializer so
 * the user can see the canonical OData URL as they type.
 *
 * Send dispatches through the `odata:execute` IPC bridge, which
 * reuses `httpExecutionService` under the hood — the URL resolver
 * has already appended the system options, so the dispatcher sees a
 * plain HTTP GET. Response history records the result as an `http`
 * entry in Phase 1b; the dedicated OData response chrome
 * (`@odata.nextLink` pagination, `@odata.count` hint, navigation
 * links) lands alongside Phase 2.
 *
 * Still deferred: `$expand` / `$orderby` / `$search` / `$format` /
 * `$apply` builders (Phase 2), v2 / v3 engine differences (Phase 3),
 * actions / functions (Phase 4), and `$batch` (Phase 5).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTranslation } from 'react-i18next'
import {
  Button,
  InputBox,
  JsonViewer,
  SelectBox,
  Toggle,
  logger,
  type ISelectOptionItem,
  type ISelectData
} from 'electron-core-ui/renderer'
import type { ODataRequest, ODataVersion, ODataOperationKind, KeyValue } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { KeyValueData } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { updateReactiveProperty } from './requestTabViewUtils'
import {
  serializeODataQueryOptions,
  buildODataUrl,
  keyValuesToPairs
} from '../../../../shared/utils/odataQuery'
import { normalizeODataResponse, type NormalizedODataPayload } from '../../../../shared/utils/odataResponse'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../../../shared/config/constants'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'

const urlRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }
const urlInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0 }
const sendButtonWrapperStyle: CSSProperties = { flexShrink: 0 }
const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  height: '100%',
  boxSizing: 'border-box',
  overflow: 'auto'
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
const responseStatusStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  padding: '6px 12px',
  fontSize: 12,
  color: 'var(--descriptionForeground)'
}

const ODATA_VERSION_BY_INDEX: ODataVersion[] = ['v4', 'v3', 'v2']
const ODATA_OPERATION_KIND_BY_INDEX: ODataOperationKind[] = ['entity-set', 'function', 'action']

/**
 * Shows `@odata.count` and `@odata.nextLink` next to the response
 * body so users don't have to hunt through the JSON tree. v2/v3
 * responses surface the same annotations after normalization.
 */
const ODataAnnotationBar: React.FC<{ normalized: NormalizedODataPayload }> = ({ normalized }) => {
  if (normalized.count === undefined && !normalized.nextLink) return null
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        padding: '4px 12px',
        fontSize: 12,
        color: 'var(--descriptionForeground)',
        flexWrap: 'wrap'
      }}
      data-testid="odata-response-annotations"
    >
      {normalized.count !== undefined ? (
        <span data-testid="odata-response-count">@odata.count: {normalized.count}</span>
      ) : null}
      {normalized.nextLink ? (
        <span data-testid="odata-response-nextlink" style={{ wordBreak: 'break-all' }}>
          @odata.nextLink: {normalized.nextLink}
        </span>
      ) : null}
    </div>
  )
}

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
    { text: t('odataRequestTab.operationKind.action', 'Action (POST with JSON body)') }
  ], [t])

  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<ODataResponseViewData | null>(null)

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
        error: 'OData IPC bridge unavailable (restorm context missing)'
      })
      return
    }

    const method = request.operationKind === 'action' ? 'POST' : 'GET'
    const body = request.operationKind === 'action' && request.actionBody
      ? request.actionBody
      : undefined
    api.execute({
      requestId,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      method,
      ...(body !== undefined ? { body } : {}),
      ...(requestPath ? { requestPath } : {})
    })
      .then((result) => {
        setResponse({
          statusCode: result.statusCode ?? 0,
          statusText: result.statusText ?? '',
          requestUrl: result.requestUrl ?? '',
          durationMs: result.timings.durationMs,
          body: result.body ?? '',
          ...(result.error !== undefined && { error: result.error })
        })
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
          error: err instanceof Error ? err.message : String(err)
        })
      })
      .finally(() => { setIsSending(false) })
  }, [isSending, request.id, request.operationKind, request.actionBody, requestPath])

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
          <textarea
            id="odata-request-action-body"
            value={request.actionBody ?? ''}
            onChange={(e) => { setActionBody(e.target.value) }}
            placeholder='{"OwnerId": 2}'
            style={{
              fontFamily: 'var(--font-family-mono)',
              fontSize: 12,
              padding: 8,
              minHeight: 80,
              background: 'var(--input-background)',
              color: 'var(--input-foreground)',
              border: '1px solid var(--input-border)',
              borderRadius: 4,
              resize: 'vertical'
            }}
            data-testid="odata-request-action-body"
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
      </div>

      <div style={numericRowStyle}>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-top">$top</label>
          <InputBox
            value={request.queryOptions.top ?? ''}
            onChange={setTop}
            options={{ placeholder: t('odataRequestTab.topPlaceholder', '50') }}
            data-testid="odata-request-top"
          />
        </div>
        <div style={{ ...rowStyle, ...numericItemStyle }}>
          <label style={labelStyle} htmlFor="odata-skip">$skip</label>
          <InputBox
            value={request.queryOptions.skip ?? ''}
            onChange={setSkip}
            options={{ placeholder: t('odataRequestTab.skipPlaceholder', '0') }}
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
        <label style={labelStyle} htmlFor="odata-expand">$expand</label>
        <InputBox
          value={request.queryOptions.expand ?? ''}
          onChange={setExpand}
          options={{ placeholder: t('odataRequestTab.expandPlaceholder', 'Category,Tags($select=Name;$top=5)') }}
          data-testid="odata-request-expand"
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="odata-orderby">$orderby</label>
        <InputBox
          value={request.queryOptions.orderby ?? ''}
          onChange={setOrderby}
          options={{ placeholder: t('odataRequestTab.orderbyPlaceholder', 'Name asc, Id desc') }}
          data-testid="odata-request-orderby"
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
  )

  const responseContent = response ? (
    <div data-testid="odata-response">
      <div style={responseStatusStyle}>
        {response.error ? (
          <span>{t('odataRequestTab.responseError', 'Error')}: {response.error}</span>
        ) : (
          <>
            <span>{response.statusCode} {response.statusText}</span>
            <span>{response.durationMs} ms</span>
            {response.requestUrl ? <span style={{ opacity: 0.7 }}>{response.requestUrl}</span> : null}
          </>
        )}
      </div>
      {(() => {
        const parsed = tryParseJson(response.body)
        if (parsed !== null && typeof parsed === 'object') {
          const normalized = normalizeODataResponse(parsed, request.odataVersion)
          return (
            <>
              {normalized ? <ODataAnnotationBar normalized={normalized} /> : null}
              <JsonViewer
                json={normalized ? JSON.stringify(normalized.body, null, 2) : response.body}
                data-testid="odata-response-json"
              />
            </>
          )
        }
        return (
          <pre style={{ ...previewValueStyle, whiteSpace: 'pre-wrap' }} data-testid="odata-response-raw">
            {response.body}
          </pre>
        )
      })()}
    </div>
  ) : undefined

  return (
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
    />
  )
}
