import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  logger,
  type VariableDefinition,
  type KeyValueTableRow
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { GraphQLRequest, GraphQLResponse, KeyValue } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { VariableContext } from '../RestormKeyValueTable'
import type { GraphQLExecutionResult } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { Badge } from '../Badge'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

export interface GraphQLRequestTabViewProps {
  request: GraphQLRequest
}

export const GraphQLRequestTabView: React.FC<GraphQLRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { selectedEnvId } = useEnvironmentContext()
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  
  const [url, setUrlState] = useState(request.url)
  const [query, setQueryState] = useState(request.query)
  const [variables, setVariablesState] = useState(request.variables ?? '{}')
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<GraphQLResponse | null>(null)
  
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

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    logger.debug('[GraphQLRequestTabView] Registering request with ContextService', { requestId, selectedEnvId })

    const toKeyValueData = (kvs: KeyValue[]): { id?: string; key: string; value: string }[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value }))

    void window.restorm.context.registerRequest(requestId, selectedEnvId ?? null, {
      headers: toKeyValueData(request.headers)
    })

    // Send full request data for URL and code snippet calculation
    void window.restorm.context.updateFullRequestData(requestId, {
      url: request.url,
      method: 'POST',
      requestType: 'graphql',
      headers: toKeyValueData(request.headers),
      body: JSON.stringify({ query: request.query, variables: request.variables })
    })

    // Subscribe to backend events
    const unsubUrl = window.restorm.context.onUrlResolved((result) => {
      if (result.requestId === requestId) {
        setResolvedUrl(result.resolvedUrl)
      }
    })

    const unsubSnippets = window.restorm.context.onCodeSnippetsUpdated((result) => {
      if (result.requestId === requestId) {
        setBackendCodeSnippets(result.markdown)
      }
    })

    // Get initial values if they exist
    void window.restorm.context.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    void window.restorm.context.getCodeSnippets(requestId).then((result) => {
      if (result) setBackendCodeSnippets(result.markdown)
    })

    previousEnvIdRef.current = selectedEnvId ?? null

    return () => {
      logger.debug('[GraphQLRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl()
      unsubSnippets()
      void window.restorm.context.unregisterRequest(requestId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only run on mount/unmount and when request.id changes
  }, [request.id])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[GraphQLRequestTabView] Environment changed, notifying ContextService', {
        requestId: request.id,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, request.id])

  // Notify ContextService when URL, query or variables change
  useEffect(() => {
    const toKeyValueData = (kvs: KeyValue[]): { id?: string; key: string; value: string }[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value }))

    void window.restorm.context.updateFullRequestData(request.id, {
      url,
      method: 'POST',
      requestType: 'graphql',
      headers: toKeyValueData(request.headers),
      body: JSON.stringify({ query, variables })
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
  
  // Variable resolution done in backend
  const environmentContext: VariableContext = {}
  
  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])

  // Callback for headers changes - notify both reactive object and ContextService
  const handleHeadersChange = useCallback((rows: KeyValueTableRow[]): void => {
    updateReactiveProperty(request, 'headers', rows)
    void window.restorm.context.updateRequestKeyValues(
      request.id,
      'headers',
      rows.map(r => ({ id: r.id, key: r.key, value: r.value }))
    )
  }, [request])
  
  const handleSend = (): void => {
    if (isSending) return
    setIsSending(true)
    setResponse(null)
    
    window.restorm.graphql.execute({ requestId: request.id })
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
    void window.restorm.graphql.cancel(request.id)
  }
  
  // Request content (SplitView with Query, Variables, Headers)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
      <Pane title={t('graphql.tabs.query')} initialSize={0.5} minSize={150}>
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="graphql"
            value={query}
            onChange={(v) => { setQuery(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
          />
        </div>
      </Pane>
      <Pane title={t('graphql.tabs.variables')} initialSize={0.25} minSize={100}>
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="json"
            value={variables}
            onChange={(v) => { setVariables(v ?? '{}') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
          />
        </div>
      </Pane>
      <Pane
        title={t('graphql.tabs.headers')}
        initialSize={0.25}
        minSize={100}
        collapsed={request.headers.length === 0}
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary
            small
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            onClick={() => {
              if (collapsed) toggle()
              headersRef.current?.addRow()
            }}
          >
            <i className="codicon codicon-add" />
          </Button>
        )}
      >
        <RestormKeyValueTable
          ref={headersRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={handleHeadersChange}
        />
      </Pane>
    </SplitView>
  )
  
  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')
  
  // Infos content (detailed info panel)
  const infosContent = response ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
        <span style={{ color: response.statusCode >= 200 && response.statusCode < 300 ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
          {response.statusCode}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
        <span>{response.timings.durationMs}ms</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>URL:</span>
        <span style={{ wordBreak: 'break-all' }}>{response.requestUrl}</span>
      </div>
      {response.errors && response.errors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Errors:</span>
          {response.errors.map((err, i) => (
            <div key={i} style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
              {err.message}
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null
  
  // Response content (raw JSON)
  const responseContent = response && (response.data ?? response.errors) ? (
    <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
      <CodeEditor
        height="100%"
        language="json"
        value={JSON.stringify({ data: response.data, errors: response.errors }, null, 2)}
        options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
      />
    </div>
  ) : null
  
  // URL section
  const urlSection = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Badge type="GQL" />
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }} title={resolvedUrl || url}>
        <RestormVariableInputBox
          value={url}
          onChange={setUrl}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          placeholder={t('graphql.urlPlaceholder')}
        />
      </div>
      <Button 
        onClick={isSending ? handleCancel : handleSend} 
        options={{ 
          title: isSending ? t('cancel') : t('graphql.send'), 
          ariaLabel: isSending ? t('cancel') : t('graphql.send') 
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className={isSending ? 'codicon codicon-close' : 'codicon codicon-send'} />
          <span>{isSending ? t('cancel') : t('graphql.send')}</span>
        </span>
      </Button>
    </div>
  )
  
  return (
    <BaseRequestTabView
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
  )
}

export default GraphQLRequestTabView
