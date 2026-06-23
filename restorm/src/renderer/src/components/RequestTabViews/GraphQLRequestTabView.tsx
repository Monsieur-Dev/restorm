import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  InputBox,
  SplitView,
  Pane,
  ControlGroup,
  SelectBox,
  eventBus,
  logger,
  getContrastColor,
  type ISelectData,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { GraphQLRequest, GraphQLResponse, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { GraphQLExecutionResult } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { updateReactiveProperty, toKeyValuesFromHistory } from './requestTabViewUtils'
import { useApiDocumentationFromRequest } from '../../hooks/useApiDocumentationFromRequest'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { findOperationForRoute } from '../../../../shared/utils/findOperationForRoute'
import { parseGraphQLOperationNames } from '../../../../shared/utils/graphqlOperations'
import { useCurlPaste, type ParsedCurl } from '../../hooks/useCurlPaste'
import { CurlPasteCallout } from '../CurlPasteCallout'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { BeamWrap } from '../common/BeamWrap'
import { toasterService } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

const urlInputWrapperStyle: React.CSSProperties = { flex: 1, minWidth: 0 }
const serverHostLabelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '0 4px', whiteSpace: 'nowrap', opacity: 0.8 }
const serverPortWrapperStyle: React.CSSProperties = { width: 80, flexShrink: 0 }

export interface GraphQLRequestTabViewProps {
  request: GraphQLRequest
}

/**
 * Serialise the GraphQL POST body. `operationName` is only emitted when
 * set (multi-operation documents) so single-operation requests keep the
 * minimal `{query, variables}` shape.
 */
function buildGraphqlBody(query: string, variables: string | undefined, operationName: string | undefined): string {
  return JSON.stringify({
    query,
    variables,
    ...(operationName ? { operationName } : {})
  })
}

export const GraphQLRequestTabView: React.FC<GraphQLRequestTabViewProps> = ({
  request
}) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  // `projectUuid` comes from the EnvironmentContext (mirrored from the
  // workbench's `persistenceKey`) — not `useFileService`. See
  // HTTPRequestTabView for the rationale: useState's lazy initializer
  // below needs a synchronous, already-hydrated value to read the
  // per-request panel-state store from.
  const { selectedEnvId, environments, envColor, projectUuid } = useEnvironmentContext()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const { apiDocumentation, route } = useApiDocumentationFromRequest(request)
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [query, setQueryState] = useState(request.query)
  const [variables, setVariablesState] = useState(request.variables ?? '{}')
  const [operationName, setOperationNameState] = useState<string | undefined>(request.operationName)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<GraphQLResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  // Server mode: restorm HOSTS a GraphQL mock instead of sending as a client.
  const isServer = request.server === true
  const [schema, setSchemaState] = useState(request.schema ?? '')
  const [mockResolvers, setMockResolversState] = useState(request.mockResolvers ?? '')
  const [isListening, setIsListening] = useState(false)
  const [servedCount, setServedCount] = useState(0)

  // See HTTPRequestTabView for the pattern. GraphQL has only a
  // collapsible headers pane today (query + variables don't collapse),
  // but we still round-trip the full map so future Pane additions
  // need no extra plumbing.
  const [panelCollapsed, setPanelCollapsed] = useState<{
    query: boolean
    variables: boolean
    headers: boolean
  }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      query: typeof seed['query'] === 'boolean' ? seed['query'] : false,
      variables: typeof seed['variables'] === 'boolean' ? seed['variables'] : false,
      headers: typeof seed['headers'] === 'boolean' ? seed['headers'] : request.headers.length === 0
    }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = {
      query: arr[0] ?? false,
      variables: arr[1] ?? false,
      headers: arr[2] ?? false
    }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'query', next.query)
      setRequestPanelCollapsed(projectUuid, request.id, 'variables', next.variables)
      setRequestPanelCollapsed(projectUuid, request.id, 'headers', next.headers)
    }
  }, [projectUuid, request.id])

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())
  
  const headersRef = useRef<KeyValueTableHandle | null>(null)
  // Bumped on smart-paste apply so the headers KV table remounts.
  const [transportEpoch, setTransportEpoch] = useState(0)
  const urlSectionHostRef = useRef<HTMLDivElement | null>(null)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setQueryState(request.query)
    setVariablesState(request.variables ?? '{}')
    setSchemaState(request.schema ?? '')
    setMockResolversState(request.mockResolvers ?? '')
    setOperationNameState(request.operationName)
    setResponse(null)
  }, [request])
  useRequestReset(request, handleRequestReset)

  // Refs to capture initial values for registration (avoid re-running effect when these change)
  const selectedEnvIdRef = useRef(selectedEnvId)
  const requestRef = useRef(request)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { requestRef.current = request }, [request])

  // Re-sync local state when a quick-config load (or MCP update_request)
  // replaces the transport. useTransportReplaced fires the callback once
  // per event for this request; the state updates then re-trigger the
  // updateFullRequestData useEffect below → Handlebars re-resolution.
  const handleTransportReplaced = useCallback(() => {
    const current = requestRef.current
    setUrlState(current.url)
    setQueryState(current.query)
    setVariablesState(current.variables ?? '{}')
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

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

    const toKeyValueData = toKeyValueDataShared

    void restormContext.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.headers)
    })

    // Send full request data for URL and code snippet calculation
    void restormContext.updateFullRequestData(requestId, {
      url: currentRequest.url,
      method: 'POST',
      requestType: 'graphql',
      headers: toKeyValueData(currentRequest.headers),
      body: { type: 'text', content: buildGraphqlBody(currentRequest.query, currentRequest.variables, currentRequest.operationName) }
    }, sourceIdRef.current)

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

  // Notify ContextService when URL, query or variables change — debounced so
  // rapid keystrokes in the Monaco editors coalesce into a single IPC call
  // (mirrors the ECUI InputBox 300 ms debounce model and the playbook rule
  // requiring that rapid typing emits at most a couple of document-update
  // events, verified by the e2e debounce scenario). In server mode also push
  // the SDL + canned resolvers so the main-process mock can read them off
  // `fullData`.
  //
  // The latest payload is mirrored into a ref so an action that reads
  // `fullData` (Send / Listen) can flush it synchronously and bypass the
  // 300 ms lag — otherwise the main process would execute / host a stale
  // (pre-keystroke) query or schema.
  const updateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestPayloadRef = useRef<Parameters<NonNullable<typeof window.restorm>['context']['updateFullRequestData']>[1] | null>(null)

  const flushUpdate = useCallback((): void => {
    if (updateDebounceRef.current !== null) {
      clearTimeout(updateDebounceRef.current)
      updateDebounceRef.current = null
    }
    const payload = latestPayloadRef.current
    if (payload) {
      void window.restorm?.context.updateFullRequestData(request.id, payload, sourceIdRef.current)
    }
  }, [request.id])

  useEffect(() => {
    const toKeyValueData = toKeyValueDataShared
    const reqId = request.id
    const source = sourceIdRef.current
    const payload = {
      url,
      method: 'POST' as const,
      requestType: 'graphql' as const,
      headers: toKeyValueData(request.headers),
      body: { type: 'text' as const, content: buildGraphqlBody(query, variables, operationName) },
      ...(isServer ? { server: true, schema, mockResolvers } : {})
    }
    latestPayloadRef.current = payload

    if (updateDebounceRef.current !== null) {
      clearTimeout(updateDebounceRef.current)
    }
    updateDebounceRef.current = setTimeout(() => {
      updateDebounceRef.current = null
      void window.restorm?.context.updateFullRequestData(reqId, payload, source)
    }, 300)

    return () => {
      if (updateDebounceRef.current !== null) {
        clearTimeout(updateDebounceRef.current)
        updateDebounceRef.current = null
      }
    }
  }, [request.id, request.headers, url, query, variables, operationName, isServer, schema, mockResolvers])

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
  const setSchema = useCallback((value: string): void => {
    setSchemaState(value)
    updateReactiveProperty(request, 'schema', value)
  }, [request])
  const setMockResolvers = useCallback((value: string): void => {
    setMockResolversState(value)
    updateReactiveProperty(request, 'mockResolvers', value)
  }, [request])

  // Server mode: split `localhost:<port>/<path>` into editable port + path, and
  // recompose on edit (host is fixed to localhost).
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
  }, [composeServerUrl, serverPath, setUrl])
  const setServerPath = useCallback((p: string): void => {
    setUrl(composeServerUrl(serverPort, p))
  }, [composeServerUrl, serverPort, setUrl])

  const handleListen = useCallback((): void => {
    const requestId = request.id
    if (!requestId || isListening) return
    // Flush the debounced schema / resolver push so the main-process mock
    // hosts the current SDL — not the pre-debounce (possibly empty) one.
    flushUpdate()
    setServedCount(0)
    void window.restorm?.graphql.listen(requestId)
      .then((res) => {
        if (res.error) {
          toasterService.push('app', { title: t('graphql.server.listenFailed'), body: res.error, durationMs: 10000 })
          logger.error('GraphQL mock server failed to listen', { error: res.error })
        }
      })
      .catch((err: unknown) => { logger.error('GraphQL mock server listen error', { error: String(err) }) })
  }, [request.id, isListening, t, flushUpdate])

  const handleStop = useCallback((): void => {
    void window.restorm?.graphql.stop(request.id)
  }, [request.id])

  // Track listening state + served count in server mode.
  useEffect(() => {
    if (!isServer) return undefined
    const requestId = request.id
    let cancelled = false
    void window.restorm?.graphql.isListening(requestId).then((listening) => {
      if (!cancelled) setIsListening(listening)
    })
    const unsubProgress = window.restorm?.graphql.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') { setIsListening(true); setServedCount(0) }
      if (status === 'completed' || status === 'cancelled' || status === 'error') setIsListening(false)
    })
    const unsubServed = window.restorm?.graphql.onServerServed(({ requestId: rid, count }) => {
      if (rid !== requestId) return
      setServedCount(count)
    })
    return () => { cancelled = true; unsubProgress?.(); unsubServed?.() }
  }, [isServer, request.id])

  const setOperationName = useCallback((value: string | undefined): void => {
    setOperationNameState(value)
    updateReactiveProperty(request, 'operationName', value)
  }, [request])

  // Named operations declared in the current query document. When the
  // document declares more than one, GraphQL-over-HTTP requires an
  // explicit `operationName`, so we surface a selector.
  const operationNames = useMemo(() => parseGraphQLOperationNames(query), [query])

  // Keep the selected operation valid as the document changes: clear it
  // when the document drops back to a single (or zero) operation, and
  // default to the first operation when several exist but none is chosen
  // (or the previously-chosen one no longer exists). The setState calls
  // are deferred behind an awaited microtask so they don't fire
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    const cancelRef = { current: false }
    // The function wrapper hides the read behind a type boundary so
    // ESLint's control-flow narrowing doesn't treat the guard as a
    // constant `false` no-op (same trick as EnvironmentContext).
    const isCancelled = (): boolean => cancelRef.current
    void (async () => {
      await Promise.resolve()
      if (isCancelled()) return
      if (operationNames.length <= 1) {
        if (operationName !== undefined) setOperationName(undefined)
        return
      }
      if (!operationName || !operationNames.includes(operationName)) {
        setOperationName(operationNames[0])
      }
    })()
    return () => { cancelRef.current = true }
  }, [operationNames, operationName, setOperationName])

  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])

  // Callback for headers changes - notify both reactive object and ContextService
  const handleHeadersChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'headers', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers',
      rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
      sourceIdRef.current
    )
  }, [request])
  
  const handleSend = (): void => {
    if (isSending) return
    // Flush the debounced query / variables push so the main process executes
    // the current operation, not the pre-debounce one (a Send fired within
    // 300 ms of a keystroke would otherwise POST a stale query).
    flushUpdate()
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
          timings: res.timings,
          // Propagate transport / network / cancellation error so the response
          // panel can surface it (e.g. 'Request cancelled', ECONNREFUSED).
          ...(res.error ? { error: res.error } : {})
        }
        setResponse(graphqlResponse)
        setHistoryRefreshKey(prev => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
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
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="graphql-request-splitview"
      onCollapsedChange={handlePanelCollapsedChange}
    >
      <Pane title={t('graphql.tabs.query')} initialSize={0.5} minSize={150} collapsed={panelCollapsed.query} data-testid="graphql-query-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            key={`query-${transportEpoch}`}
            height="100%"
            language="graphql"
            value={query}
            onChange={(v) => { setQuery(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="graphql-query-editor"
          />
        </div>
      </Pane>
      <Pane title={t('graphql.tabs.variables')} initialSize={0.25} minSize={100} collapsed={panelCollapsed.variables} data-testid="graphql-variables-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            key={`variables-${transportEpoch}`}
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
        collapsed={panelCollapsed.headers}
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
          key={`headers-${transportEpoch}`}
          ref={headersRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={handleHeadersChange}
          persistenceId={`graphql-headers:${request.id}`}
          data-testid="graphql-headers-table"
        />
      </Pane>
    </SplitView>
  )

  // Server-mode request content: SDL schema + canned resolvers the mock serves
  // (the "Send" panels — query / variables — have no meaning when hosting).
  const serverRequestContent = (
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="graphql-server-splitview"
    >
      <Pane title={t('graphql.server.schema')} initialSize={0.6} minSize={150} data-testid="graphql-server-schema-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="graphql"
            value={schema}
            onChange={(v) => { setSchema(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="graphql-server-schema-editor"
          />
        </div>
      </Pane>
      <Pane title={t('graphql.server.resolvers')} initialSize={0.4} minSize={100} data-testid="graphql-server-resolvers-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="json"
            value={mockResolvers}
            onChange={(v) => { setMockResolvers(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="graphql-server-resolvers-editor"
          />
        </div>
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

    // Surface any response payload: successful data, GraphQL errors[], or a
    // transport-level error string (network failure, cancellation).
    const responseJson = resp
      ? JSON.stringify(
          resp.error
            ? { error: resp.error }
            : { data: resp.data, errors: resp.errors },
          null,
          2
        )
      : null
    const responseContent = resp && (resp.data ?? resp.errors ?? resp.error) ? (
      <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
        <CodeEditor
          height="100%"
          language="json"
          value={responseJson ?? ''}
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
  
  // Smart-paste: GraphQL has its own `query` / `variables` so the
  // parsed cURL only contributes URL + headers. Body / params live
  // in the GraphQL operation, not the HTTP transport, so they're
  // intentionally dropped.
  const applyParsedCurl = useCallback((parsed: ParsedCurl): void => {
    setUrl(parsed.url)
    updateReactiveProperty(request, 'headers', parsed.headers)
    setTransportEpoch((n) => n + 1)
    toasterService.push('app', {
      title: 'Replaced from cURL',
      body: 'GraphQL endpoint URL and headers populated from the pasted curl command.',
      durationMs: 10000
    })
  }, [request, setUrl])

  const { pendingPaste } = useCurlPaste({
    hostRef: urlSectionHostRef,
    apply: applyParsedCurl
  })

  // URL section
  const urlSection = (
    <div ref={urlSectionHostRef} data-testid="graphql-url-section-host">
      {pendingPaste && (
        <CurlPasteCallout
          onConfirm={pendingPaste.confirm}
          onCancel={pendingPaste.cancel}
          data-testid="graphql-curl-paste-callout"
        />
      )}
    <ControlGroup data-testid="graphql-url-section">
      {isServer ? (
        // SERVER MODE: localhost-fixed host + port + endpoint path.
        <>
          <span style={serverHostLabelStyle}>localhost:</span>
          <div style={serverPortWrapperStyle}>
            <InputBox
              value={serverPort}
              onChange={setServerPort}
              options={{ placeholder: '4000' }}
              data-testid="graphql-server-port-input"
            />
          </div>
          <span style={serverHostLabelStyle}>/</span>
          <div style={urlInputWrapperStyle}>
            <InputBox
              value={serverPath}
              onChange={setServerPath}
              options={{ placeholder: 'graphql' }}
              data-testid="graphql-server-path-input"
            />
          </div>
          <BeamWrap active={isListening} size={22} borderWidth={1.5}>
            <Button
              icon={isListening ? 'debug-disconnect' : 'plug'}
              onClick={isListening ? handleStop : handleListen}
              {...(isListening ? {} : { emphasis: 1 })}
              options={{
                title: isListening ? t('graphql.server.stopListening') : t('graphql.server.startListening'),
                ariaLabel: isListening ? t('graphql.server.stopListening') : t('graphql.server.startListening')
              }}
              data-testid="graphql-server-listen-button"
            />
          </BeamWrap>
        </>
      ) : (
        <>
          <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
            <div style={{ flex: 1, minWidth: 0 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
              <RestormVariableInputBox
                value={url}
                onChange={setUrl}
                variables={emptyVariables}
                helpers={handlebarsHelpers}
                placeholder={t('graphql.urlPlaceholder')}
                data-testid="graphql-url-input"
              />
            </div>
          </HeaderHoverTooltip>
          {operationNames.length > 1 && (
            <div style={{ minWidth: 180 }} data-testid="graphql-operation-name-host">
              <SelectBox
                id={`graphql-operation-name-${request.id}`}
                className=""
                options={operationNames.map((name) => ({ text: name }))}
                selected={Math.max(0, operationNames.indexOf(operationName ?? operationNames[0] ?? ''))}
                onDidSelect={(d: ISelectData) => {
                  const picked = operationNames[d.index]
                  if (picked) setOperationName(picked)
                }}
                selectBoxOptions={{ ariaLabel: t('graphql.operationName') }}
                data-testid="graphql-operation-name-select"
              />
            </div>
          )}
          <SendButtonEnvSwitcher>
            <BeamWrap active={isSending} size={22} borderWidth={1.5}>
              <Button
                icon={isSending ? 'close' : 'send'}
                onClick={isSending ? handleCancel : handleSend}
                {...(isSending ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
                options={{
                  title: isSending ? t('cancel') : t('graphql.send'),
                  ariaLabel: isSending ? t('cancel') : t('graphql.send')
                }}
                data-testid="graphql-action-button"
              />
            </BeamWrap>
          </SendButtonEnvSwitcher>
        </>
      )}
    </ControlGroup>
    </div>
  )

  // Server-mode listening status banner (mirrors the HTTP mock's "served N").
  const serverResponseContent = isServer ? (
    <div
      data-testid="graphql-server-served-banner"
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}
    >
      <span className={`codicon codicon-${isListening ? 'broadcast' : 'circle-slash'}`} aria-hidden="true" />
      <span>
        {isListening
          ? t('graphql.server.served', { count: servedCount, defaultValue: 'Listening — {{count}} operation(s) served' })
          : t('graphql.server.notListening', 'Not listening')}
      </span>
    </div>
  ) : undefined
  
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
        requestContent={isServer ? serverRequestContent : requestContent}
        codeSnippetsContent={codeSnippetsContent}
        {...(apiDocumentation && route && findOperationForRoute(apiDocumentation, route) ? { docsContent: <DocumentationHost apiDocumentation={apiDocumentation} filters={[route]} /> } : {})}
        notes={request.notes}
        onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
        isLoading={isSending}
        showResponse={isServer ? isListening : response !== null}
        infosContent={isServer ? undefined : infosContent}
        responseContent={isServer ? serverResponseContent : responseContent}
        jsonData={isServer ? undefined : (response ? { data: response.data, errors: response.errors } : undefined)}
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

export default GraphQLRequestTabView
