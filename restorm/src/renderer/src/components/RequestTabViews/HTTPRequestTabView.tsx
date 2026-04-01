import React, { type CSSProperties, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  SelectBox,
  SplitView,
  Pane,
  logger,
  type VariableDefinition,
  type ISelectOptionItem,
  type ISelectData
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { HTTPRequest, HTTPResponse, HTTPMethod, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { StringValue } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { KeyValueData } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { Badge } from '../common/Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../../../shared/config/constants'
import { getResponseHistoryList } from '../../services/GraphQLIntegration'
import { normalizeValueType } from '../../utils/normalizeValueType'
import { buildHttpResponseViewData } from './HTTPResponsePanel'
import { HTTPRequestBodySection } from './HTTPRequestBodySection'
import { updateReactiveProperty, toKeyValuesFromHistory } from './requestTabViewUtils'

const authPaneContentStyle: CSSProperties = { height: '100%', boxSizing: 'border-box', padding: 8 }
const urlRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const methodSelectWrapperStyle: CSSProperties = { width: 90, flexShrink: 0 }
const urlInputWrapperStyle: CSSProperties = { flex: 1, minWidth: 0, paddingLeft: 15 }

export interface HTTPRequestTabViewProps {
  request: HTTPRequest
  historyModalOpen?: boolean
  onCloseHistoryModal?: () => void
  onHistoryAvailabilityChange?: (hasHistory: boolean) => void
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
function getBodyMode(request: HTTPRequest): 'text' | 'form-data' | 'x-www-form-urlencoded' | 'file' {
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
function getBodyContent(request: HTTPRequest): string {
  if (request.body?.type === 'text') {
    return request.body.content
  }
  return ''
}

/** Get body file path for file mode */
function getBodyFilePath(request: HTTPRequest): string {
  if (request.body?.type === 'file') {
    return request.body.path
  }
  return ''
}

export const HTTPRequestTabView: React.FC<HTTPRequestTabViewProps> = ({
  request,
  historyModalOpen = false,
  onCloseHistoryModal,
  onHistoryAvailabilityChange
}) => {
  const { t } = useTranslation()
  const { selectedEnvId, environments } = useEnvironmentContext()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  
  const [method, setMethod] = useState<string>(request.method)
  const [url, setUrl] = useState<string>(request.url)
  const [body, setBody] = useState<string>(getBodyContent(request))
  const [bodyMode, setBodyMode] = useState<'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'>(getBodyMode(request))
  const [bodyFilePath, setBodyFilePath] = useState<string>(getBodyFilePath(request))
  const [isSending, setIsSending] = useState<boolean>(false)
  const [httpResponse, setHttpResponse] = useState<HTTPResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  
  const headersParamsRef = useRef<KeyValueTableHandle | null>(null)
  const queryParamsRef = useRef<KeyValueTableHandle | null>(null)
  const pathParamsRef = useRef<KeyValueTableHandle | null>(null)
  const requestIdRef = useRef<string>(request.id)

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

  // Convert KeyValue arrays to plain objects for IPC
  const toKeyValueData = useCallback((kvs: KeyValue[]): KeyValueData[] =>
    kvs.map(kv => {
      const result: KeyValueData = { key: kv.key, value: normalizeValueType(kv.value as unknown).toString() }
      if (kv.id !== undefined) result.id = kv.id
      if (kv.enabled !== undefined) result.enabled = kv.enabled
      return result
    }), [])

  // Subscribe to backend URL and code snippets updates
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return

    const unsubUrl = window.restorm?.context.onUrlResolved((result) => {
      if (result.requestId === requestId) {
        setResolvedUrl(result.resolvedUrl)
      }
    })

    const unsubSnippets = window.restorm?.context.onCodeSnippetsUpdated((result) => {
      if (result.requestId === requestId) {
        setBackendCodeSnippets(result.markdown)
      }
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
    }
  }, [request.id])

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

  // Sync method changes to reactive object
  useEffect(() => {
    if (method !== request.method && requestIdRef.current === request.id) {
      updateReactiveProperty(request, 'method', method as HTTPMethod)
    }
  }, [method, request])

  // Sync url changes to reactive object
  useEffect(() => {
    if (url !== request.url && requestIdRef.current === request.id) {
      updateReactiveProperty(request, 'url', url)
    }
  }, [url, request])

  // Sync body changes to reactive object
  useEffect(() => {
    if (requestIdRef.current !== request.id) return
    if (bodyMode === 'text') {
      const currentContent = request.body?.type === 'text' ? request.body.content : ''
      if (body !== currentContent) {
        updateReactiveProperty(request, 'body', { type: 'text', content: body })
      }
    } else if (bodyMode === 'file') {
      const currentPath = request.body?.type === 'file' ? request.body.path : ''
      if (bodyFilePath !== currentPath) {
        updateReactiveProperty(request, 'body', { type: 'file', path: bodyFilePath })
      }
    }
  }, [body, bodyMode, bodyFilePath, request])

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
      requestType: 'http',
      url,
      method,
      headers: toKeyValueData(request.headers),
      params: toKeyValueData(request.params),
      pathParams: request.pathParams ? toKeyValueData(request.pathParams) : [],
      body: bodyData
    })
  }, [request.id, url, method, request.headers, request.params, request.pathParams, body, bodyMode, bodyFilePath, request.body, toKeyValueData])
  
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
      if (result.variableId === varId) {
        setUrlVariables(prev => {
          const newVars = result.variables
          if (prev.length !== newVars.length) return newVars
          const hasChanges = newVars.some((v, i) => {
            const prevItem = prev[i]
            return prevItem && (prevItem.name !== v.name || prevItem.value !== v.value)
          })
          return hasChanges ? newVars : prev
        })
      }
    })
    
    return () => { unsubscribe?.() }
  }, [urlVariableId])

  // Callbacks for KeyValue changes - notify both reactive object and ContextService
  const handleHeadersChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'headers', rows)
    const requestId = request.id
    if (requestId) {
      void window.restorm?.context.updateRequestKeyValues(
        requestId,
        'headers',
        rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled }))
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
        rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled }))
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
        rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled }))
      )
    }
  }, [request])

  const methodOptions = useMemo<ISelectOptionItem[]>(
    () => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((verb) => ({
      text: verb,
      label: <Badge type={mapToBadgeType(verb)} />
    })),
    []
  )

  const handleSend = useCallback((): void => {
    if (isSending) return
    const requestId = request.id
    if (!requestId) {
      logger.error('Cannot send request without ID')
      return
    }
    setIsSending(true)
    setHttpResponse(null)

    // Execute via backend
    window.restorm?.http.execute({
      requestId,
      method,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      ...(requestPath ? { requestPath } : {})
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

          const response: HTTPResponse = {
            id: `resp_${Date.now()}`,
            type: 'http',
            requestId,
            requestUrl: result.requestUrl ?? '',
            requestMethod: method as HTTPMethod,
            requestHeaders: request.headers,
            requestParams: request.params,
            requestPathParams: request.pathParams,
            statusCode: result.statusCode ?? 0,
            statusText: result.statusText ?? '',
            responseHeaders,
            responseBody: result.body ?? '',
            timings: result.timings,
            ...(request.body && { requestBody: request.body }),
            ...(contentType && { contentType }),
            ...(contentLength !== undefined && !isNaN(contentLength) && { contentLength })
          }
          setHttpResponse(response)
          setHistoryRefreshKey(prev => prev + 1)
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
          logger.error('HTTP request failed', { error: result.error })
        }
      })
      .catch((err: unknown) => {
        logger.error('HTTP request execution error', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }, [isSending, request, method, url, requestPath])

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

  // Request content (SplitView with Panes)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }} data-testid="http-request-split-view">
      <Pane
        title={t('requestTab.tabs.authorization').toUpperCase()}
        initialSize={0.15}
        collapsed
        minSize={120}
        data-testid="http-request-authorization-pane"
      >
        <div style={authPaneContentStyle}>
          {/* Authorization configuration UI will be added here */}
        </div>
      </Pane>
      <Pane
        title={t('requestTab.tabs.headers')}
        initialSize={0.2}
        collapsed={request.headers.length === 0}
        minSize={150}
        data-testid="http-request-headers-pane"
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary
            small
            icon="add"
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            data-testid="http-request-add-header-button"
            onClick={() => {
              if (collapsed) toggle()
              headersParamsRef.current?.addRow()
            }}
          />
        )}
      >
        <RestormKeyValueTable
          ref={headersParamsRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={handleHeadersChange}
          data-testid="http-request-headers-table"
        />
      </Pane>
      <Pane
        title={t('requestTab.tabs.pathParams')}
        initialSize={0.2}
        collapsed={(request.pathParams?.length ?? 0) === 0}
        minSize={150}
        data-testid="http-request-path-params-pane"
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            small
            secondary
            icon="add"
            options={{ ariaLabel: t('requestTab.addParam'), title: t('requestTab.addParam') }}
            data-testid="http-request-add-path-param-button"
            onClick={() => {
              if (collapsed) toggle()
              pathParamsRef.current?.addRow()
            }}
          />
        )}
      >
        <RestormKeyValueTable
          ref={pathParamsRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.pathParams ?? []}
          onRowsChange={handlePathParamsChange}
          data-testid="http-request-path-params-table"
        />
      </Pane>
      <Pane
        title={t('requestTab.tabs.params')}
        initialSize={0.2}
        collapsed={request.params.length === 0}
        minSize={150}
        data-testid="http-request-params-pane"
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            small
            secondary
            icon="add"
            options={{ ariaLabel: t('requestTab.addParam'), title: t('requestTab.addParam') }}
            data-testid="http-request-add-param-button"
            onClick={() => {
              if (collapsed) toggle()
              queryParamsRef.current?.addRow()
            }}
          />
        )}
      >
        <RestormKeyValueTable
          ref={queryParamsRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.params}
          onRowsChange={handleParamsChange}
          data-testid="http-request-query-params-table"
        />
      </Pane>
      <Pane title={t('requestTab.tabs.body')} initialSize={0.4} data-testid="http-request-body-pane">
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
        />
      </Pane>
    </SplitView>
  )

  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const { infosContent, responseContent, jsonData } = useMemo(
    () => buildHttpResponseViewData(httpResponse),
    [httpResponse]
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
    return buildHttpResponseViewData(historyResponse)
  }, [request.id])

  // URL section
  const urlSection = (
    <div style={urlRowStyle}>
      <div style={methodSelectWrapperStyle}>
        <SelectBox
          id="http-method-select"
          className=""
          options={methodOptions}
          selected={methodOptions.findIndex((opt) => opt.text === method)}
          onDidSelect={(data: ISelectData) => { setMethod(data.selected) }}
          selectBoxOptions={{ ariaLabel: t('requestTab.methodSelect'), useCustomDrawn: true }}
          data-testid="http-request-method-select"
        />
      </div>
      <div style={urlInputWrapperStyle} title={resolvedUrl || url} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'}>
        <RestormVariableInputBox
          value={url}
          onChange={(value: string) => { setUrl(value) }}
          variables={urlVariables}
          helpers={handlebarsHelpers}
          placeholder={t('requestTab.urlPlaceholder')}
          data-testid="http-request-url-input"
        />
      </div>
      {isSending ? (
        <Button 
          icon="close"
          onClick={handleCancel} 
          options={{ title: t('requestTab.cancel'), ariaLabel: t('requestTab.cancel') }}
          data-testid="http-request-cancel-button"
        >
          {t('requestTab.cancel')}
        </Button>
      ) : (
        <Button 
          icon="send"
          onClick={handleSend} 
          options={{ title: t('requestTab.send'), ariaLabel: t('requestTab.send') }}
          data-testid="http-request-send-button"
        >
          {t('requestTab.send')}
        </Button>
      )}
    </div>
  )

  const handleCloseHistoryModal = useCallback(() => {
    onCloseHistoryModal?.()
  }, [onCloseHistoryModal])

  useEffect(() => {
    if (!onHistoryAvailabilityChange) return
    const state = { active: true }
    void (async (): Promise<void> => {
      const entries = await getResponseHistoryList(request.id, requestPath ?? undefined)
      if (state.active) {
        onHistoryAvailabilityChange(entries.length > 0)
      }
    })()
    return () => {
      state.active = false
    }
  }, [onHistoryAvailabilityChange, request.id, requestPath, historyRefreshKey])

  return (
    <>
      <BaseRequestTabView
        requestId={request.id}
        urlSection={urlSection}
        requestContent={requestContent}
        codeSnippetsContent={codeSnippetsContent}
        documentation={request.documentation}
        notes={request.notes}
        onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
        isLoading={isSending}
        showResponse={httpResponse !== null}
        infosContent={infosContent}
        responseContent={responseContent}
        jsonData={jsonData}
      />
      <ResponseHistoryModal
        isOpen={historyModalOpen}
        onClose={handleCloseHistoryModal}
        requestId={request.id}
        requestPath={requestPath ?? undefined}
        refreshKey={historyRefreshKey}
        buildResponseView={buildHistoryView}
      />
    </>
  )
}

export default HTTPRequestTabView
