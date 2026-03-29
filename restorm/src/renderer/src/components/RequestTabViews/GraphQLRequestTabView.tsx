import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  logger,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { GraphQLRequest, GraphQLResponse, KeyValue, ResponseHistoryDetail } from '../../types/collections'
import { StringValue } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { GraphQLExecutionResult, KeyValueData } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { Badge } from '../common/Badge'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { getResponseHistoryList } from '../../services/GraphQLIntegration'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

function toKeyValuesFromHistory(values: { key: string; value: string; enabled?: boolean }[]): KeyValue[] {
  return values.map((kv) => ({
    key: kv.key,
    value: new StringValue(kv.value),
    enabled: kv.enabled
  }))
}

export interface GraphQLRequestTabViewProps {
  request: GraphQLRequest
  historyModalOpen?: boolean
  onCloseHistoryModal?: () => void
  onHistoryAvailabilityChange?: (hasHistory: boolean) => void
}

export const GraphQLRequestTabView: React.FC<GraphQLRequestTabViewProps> = ({
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
  
  const [url, setUrlState] = useState(request.url)
  const [query, setQueryState] = useState(request.query)
  const [variables, setVariablesState] = useState(request.variables ?? '{}')
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<GraphQLResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  
  const headersRef = useRef<KeyValueTableHandle | null>(null)
  const requestIdRef = useRef(request.id)
  
  useEffect(() => {
    if (requestIdRef.current !== request.id) {
      requestIdRef.current = request.id
      const rafId = requestAnimationFrame(() => {
        setUrlState(request.url)
        setQueryState(request.query)
        setVariablesState(request.variables ?? '{}')
        setResponse(null)
      })
      return (): void => { cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [request])

  // Refs to capture initial values for registration (avoid re-running effect when these change)
  const selectedEnvIdRef = useRef(selectedEnvId)
  const requestRef = useRef(request)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { requestRef.current = request }, [request])

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current
    
    // Get restorm context (available in both Electron and web mode via shim)
    const restormContext = window.restorm?.context
    if (!restormContext) {
      return
    }
    
    logger.debug('[GraphQLRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = (kvs: KeyValue[]): KeyValueData[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value.toString(), enabled: kv.enabled }))

    void restormContext.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.headers)
    })

    // Send full request data for URL and code snippet calculation
    void restormContext.updateFullRequestData(requestId, {
      url: currentRequest.url,
      method: 'POST',
      requestType: 'graphql',
      headers: toKeyValueData(currentRequest.headers),
      body: { type: 'text', content: JSON.stringify({ query: currentRequest.query, variables: currentRequest.variables }) }
    })

    // Subscribe to backend events
    const unsubUrl = restormContext.onUrlResolved((result) => {
      if (result.requestId === requestId) {
        setResolvedUrl(result.resolvedUrl)
      }
    })

    const unsubSnippets = restormContext.onCodeSnippetsUpdated((result) => {
      if (result.requestId === requestId) {
        setBackendCodeSnippets(result.markdown)
      }
    })

    // Get initial values if they exist
    void restormContext.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    void restormContext.getCodeSnippets(requestId).then((result) => {
      if (result) setBackendCodeSnippets(result.markdown)
    })

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[GraphQLRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl()
      unsubSnippets()
      void restormContext.unregisterRequest(requestId)
    }
  }, [request.id, environments])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[GraphQLRequestTabView] Environment changed, notifying ContextService', {
        requestId: request.id,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Notify ContextService when URL, query or variables change
  useEffect(() => {
    const toKeyValueData = (kvs: KeyValue[]): KeyValueData[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value.toString(), enabled: kv.enabled }))

    void window.restorm?.context.updateFullRequestData(request.id, {
      url,
      method: 'POST',
      requestType: 'graphql',
      headers: toKeyValueData(request.headers),
      body: { type: 'text', content: JSON.stringify({ query, variables }) }
    })
  }, [request.id, request.headers, url, query, variables])

  // Sync state changes to reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setQuery = useCallback((value: string): void => {
    setQueryState(value)
    updateReactiveProperty(request, 'query', value)
  }, [request])
  const setVariables = useCallback((value: string): void => {
    setVariablesState(value)
    updateReactiveProperty(request, 'variables', value)
  }, [request])
  
  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])

  // Callback for headers changes - notify both reactive object and ContextService
  const handleHeadersChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'headers', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers',
      rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled }))
    )
  }, [request])
  
  const handleSend = (): void => {
    if (isSending) return
    setIsSending(true)
    setResponse(null)
    
    window.restorm?.graphql.execute({
      requestId: request.id,
      ...(requestPath ? { requestPath } : {})
    })
      .then((res: GraphQLExecutionResult) => {
        // Convert backend result to GraphQLResponse format
        const graphqlResponse: GraphQLResponse = {
          id: `resp_${Date.now()}`,
          type: 'graphql',
          requestId: request.id,
          requestUrl: res.requestUrl ?? '',
          requestQuery: query,
          requestVariables: variables,
          requestHeaders: request.headers,
          statusCode: res.statusCode ?? 0,
          data: res.data,
          errors: res.errors,
          responseHeaders: [],
          timings: res.timings
        }
        setResponse(graphqlResponse)
        setHistoryRefreshKey(prev => prev + 1)
        logger.info('GraphQL request completed', { url: res.requestUrl, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('GraphQL request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }
  
  const handleCancel = (): void => {
    void window.restorm?.graphql.cancel(request.id)
  }
  
  // Request content (SplitView with Query, Variables, Headers)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }} data-testid="graphql-request-splitview">
      <Pane title={t('graphql.tabs.query')} initialSize={0.5} minSize={150} data-testid="graphql-query-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="graphql"
            value={query}
            onChange={(v) => { setQuery(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="graphql-query-editor"
          />
        </div>
      </Pane>
      <Pane title={t('graphql.tabs.variables')} initialSize={0.25} minSize={100} data-testid="graphql-variables-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="json"
            value={variables}
            onChange={(v) => { setVariables(v ?? '{}') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="graphql-variables-editor"
          />
        </div>
      </Pane>
      <Pane
        title={t('graphql.tabs.headers')}
        initialSize={0.25}
        minSize={100}
        collapsed={request.headers.length === 0}
        data-testid="graphql-headers-pane"
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary
            small
            icon="add"
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            onClick={() => {
              if (collapsed) toggle()
              headersRef.current?.addRow()
            }}
            data-testid="graphql-add-header-button"
          />
        )}
      >
        <RestormKeyValueTable
          ref={headersRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={handleHeadersChange}
          data-testid="graphql-headers-table"
        />
      </Pane>
    </SplitView>
  )
  
  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const buildGraphqlResponseView = useCallback((resp: GraphQLResponse | null) => {
    const infosContent = resp ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: resp.statusCode >= 200 && resp.statusCode < 300 ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {resp.statusCode}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span>{resp.timings.durationMs}ms</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>URL:</span>
          <span style={{ wordBreak: 'break-all' }}>{resp.requestUrl}</span>
        </div>
        {resp.errors && resp.errors.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Errors:</span>
            {resp.errors.map((err, i) => (
              <div key={i} style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
                {err.message}
              </div>
            ))}
          </div>
        )}
      </div>
    ) : null

    const responseContent = resp && (resp.data ?? resp.errors) ? (
      <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
        <CodeEditor
          height="100%"
          language="json"
          value={JSON.stringify({ data: resp.data, errors: resp.errors }, null, 2)}
          options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
          data-testid="graphql-response-editor"
        />
      </div>
    ) : null

    return { infosContent, responseContent, jsonData: resp ? { data: resp.data, errors: resp.errors } : undefined }
  }, [])

  const { infosContent, responseContent } = useMemo(
    () => buildGraphqlResponseView(response),
    [buildGraphqlResponseView, response]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'graphql') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: GraphQLResponse = {
      id: detail.guid,
      type: 'graphql',
      requestId: request.id,
      requestUrl: detail.response.requestUrl,
      requestQuery: '',
      requestVariables: undefined,
      requestHeaders: toKeyValuesFromHistory(detail.response.requestHeaders),
      statusCode: detail.response.statusCode,
      data: detail.response.data,
      errors: detail.response.errors,
      responseHeaders: toKeyValuesFromHistory(detail.response.responseHeaders),
      timings: detail.response.timings,
      ...(detail.response.error ? { error: detail.response.error } : {})
    }
    return buildGraphqlResponseView(historyResponse)
  }, [buildGraphqlResponseView, request.id])
  
  // URL section
  const urlSection = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Badge type="GQL" />
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }} title={resolvedUrl || url} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'}>
        <RestormVariableInputBox
          value={url}
          onChange={setUrl}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          placeholder={t('graphql.urlPlaceholder')}
          data-testid="graphql-url-input"
        />
      </div>
      <Button 
        icon={isSending ? 'close' : 'send'}
        onClick={isSending ? handleCancel : handleSend} 
        options={{ 
          title: isSending ? t('cancel') : t('graphql.send'), 
          ariaLabel: isSending ? t('cancel') : t('graphql.send') 
        }}
        data-testid="graphql-action-button"
      >
        {isSending ? t('cancel') : t('graphql.send')}
      </Button>
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
        showResponse={response !== null}
        infosContent={infosContent}
        responseContent={responseContent}
        jsonData={response ? { data: response.data, errors: response.errors } : undefined}
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

export default GraphQLRequestTabView
