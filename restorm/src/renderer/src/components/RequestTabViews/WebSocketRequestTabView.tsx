import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  InputBox,
  CodeEditor,
  SplitView,
  Pane,
  logger,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { WebSocketRequest, WebSocketResponse, WebSocketMessage, KeyValue, ResponseHistoryDetail } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { VariableContext } from '../RestormKeyValueTable'
import type { WebSocketExecutionResult, WebSocketMessageItem } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryTab } from './ResponseHistoryTab'
import { Badge } from '../common/Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

export interface WebSocketRequestTabViewProps {
  request: WebSocketRequest
}

export const WebSocketRequestTabView: React.FC<WebSocketRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { selectedEnvId, environments } = useEnvironmentContext()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  
  const [url, setUrlState] = useState(request.url)
  const [event, setEventState] = useState(request.event ?? '')
  const [message, setMessageState] = useState(request.message)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<WebSocketResponse | null>(null)
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
        setEventState(request.event ?? '')
        setMessageState(request.message)
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
    logger.debug('[WebSocketRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = (kvs: KeyValue[]): { id?: string; key: string; value: string; enabled?: boolean }[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value.toString(), enabled: kv.enabled }))

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.headers)
    })

    // Send full request data for URL and code snippet calculation
    void window.restorm?.context.updateFullRequestData(requestId, {
      url: currentRequest.url,
      method: currentRequest.protocol,
      requestType: 'websocket',
      headers: toKeyValueData(currentRequest.headers),
      body: { type: 'text', content: currentRequest.message }
    })

    // Subscribe to backend events
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

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[WebSocketRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl?.()
      unsubSnippets?.()
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id, environments])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[WebSocketRequestTabView] Environment changed, notifying ContextService', {
        requestId: request.id,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Notify ContextService when URL, event or message changes
  useEffect(() => {
    const toKeyValueData = (kvs: KeyValue[]): { id?: string; key: string; value: string; enabled?: boolean }[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value.toString(), enabled: kv.enabled }))

    void window.restorm?.context.updateFullRequestData(request.id, {
      url,
      method: request.protocol,
      requestType: 'websocket',
      headers: toKeyValueData(request.headers),
      body: { type: 'text', content: message }
    })
  }, [request.id, request.protocol, request.headers, url, message])

  // Sync state changes to reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setEvent = useCallback((value: string): void => {
    setEventState(value)
    updateReactiveProperty(request, 'event', value ? value : undefined)
  }, [request])
  const setMessage = useCallback((value: string): void => {
    setMessageState(value)
    updateReactiveProperty(request, 'message', value)
  }, [request])
  
  // Variable resolution done in backend
  const _environmentContext: VariableContext = {}
  
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
    
    window.restorm?.websocket.connect({
      requestId: request.id,
      timeout: 5000,
      ...(requestPath ? { requestPath } : {})
    })
      .then((res: WebSocketExecutionResult) => {
        // Convert backend result to WebSocketResponse format
        const wsResponse: WebSocketResponse = {
          id: `resp_${Date.now()}`,
          type: 'websocket',
          requestId: request.id,
          requestUrl: res.requestUrl ?? '',
          protocol: request.protocol,
          connected: res.connected,
          messages: res.messages.map((m: WebSocketMessageItem) => ({
            direction: m.direction,
            data: m.data,
            event: m.event,
            timestamp: m.timestamp
          })),
          error: res.error,
          timings: res.timings
        }
        setResponse(wsResponse)
        setHistoryRefreshKey(prev => prev + 1)
        logger.info('WebSocket request completed', { url: res.requestUrl, connected: res.connected })
      })
      .catch((err: unknown) => {
        logger.error('WebSocket request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }
  
  const handleDisconnect = (): void => {
    void window.restorm?.websocket.disconnect(request.id)
  }
  
  const formatMessage = (msg: WebSocketMessage): string => {
    const prefix = msg.direction === 'sent' ? '→' : '←'
    const eventStr = msg.event ? `[${msg.event}] ` : ''
    return `${prefix} ${eventStr}${msg.data}`
  }
  
  // Parse host and port from URL (kept for potential future use)
  const _hostInfo = useMemo(() => {
    try {
      const urlObj = new URL(url.replace(/^ws/, 'http'))
      return {
        host: urlObj.hostname,
        port: urlObj.port || (url.startsWith('wss') ? '443' : '80')
      }
    } catch {
      return { host: url, port: '80' }
    }
  }, [url])
  
  // Request content (SplitView with Message, Headers)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
      <Pane title={t('websocket.tabs.message')} initialSize={0.7} minSize={150}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(request.protocol === 'socketio' || request.protocol === 'mqtt') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
              <span style={{ fontSize: 12 }}>{request.protocol === 'mqtt' ? t('websocket.topic') : t('websocket.event')}:</span>
              <div style={{ flex: 1 }}>
                <InputBox
                  value={event}
                  onChange={setEvent}
                  options={{ placeholder: request.protocol === 'mqtt' ? 'topic/name' : 'event-name' }}
                />
              </div>
            </div>
          )}
          <div style={{ flex: 1, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
            <CodeEditor
              height="100%"
              language="json"
              value={message}
              onChange={(v) => { setMessage(v ?? '{}') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            />
          </div>
        </div>
      </Pane>
      <Pane
        title={t('websocket.tabs.headers')}
        initialSize={0.3}
        minSize={100}
        collapsed={request.headers.length === 0}
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
          />
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

  const buildWebSocketResponseView = useCallback((
    resp: WebSocketResponse | null,
    meta?: { protocol?: string; event?: string }
  ) => {
    const infosContent = resp ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: resp.connected ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {resp.connected ? t('websocket.connected') : t('websocket.disconnected')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span>{resp.timings.durationMs}ms</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Protocol:</span>
          <span>{meta?.protocol ?? '-'}</span>
        </div>
        {meta?.event && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Event:</span>
            <span>{meta.event}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Messages:</span>
          <span>{resp.messages.length}</span>
        </div>
        {resp.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
              {resp.error}
            </div>
          </div>
        )}
      </div>
    ) : null

    const responseContent = resp && resp.messages.length > 0 ? (
      <div style={{ height: '100%', overflow: 'auto', fontFamily: 'var(--editor-font-family)', fontSize: 12 }}>
        {resp.messages.map((msg, i) => (
          <div
            key={i}
            style={{
              padding: '4px 8px',
              marginBottom: 4,
              borderRadius: 3,
              background: msg.direction === 'sent' ? 'var(--editor-selectionBackground)' : 'var(--editor-inactiveSelectionBackground)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}
          >
            {formatMessage(msg)}
          </div>
        ))}
        {resp.messages.length === 0 && (
          <div style={{ color: 'var(--descriptionForeground)' }}>
            {t('websocket.noMessages')}
          </div>
        )}
      </div>
    ) : null

    return { infosContent, responseContent, jsonData: undefined }
  }, [t])

  const { infosContent, responseContent } = useMemo(
    () => buildWebSocketResponseView(response, { protocol: request.protocol, event: request.event }),
    [buildWebSocketResponseView, response, request.protocol, request.event]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'websocket') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: WebSocketResponse = {
      id: detail.guid,
      type: 'websocket',
      requestId: detail.requestId,
      requestUrl: detail.response.requestUrl,
      protocol: detail.response.protocol as WebSocketResponse['protocol'],
      connected: detail.response.connected,
      messages: detail.response.messages.map((msg) => ({
        direction: msg.direction,
        event: msg.event,
        data: msg.data,
        timestamp: msg.timestamp
      })),
      timings: detail.response.timings,
      ...(detail.response.error ? { error: detail.response.error } : {})
    }
    return buildWebSocketResponseView(historyResponse, detail.requestMeta)
  }, [buildWebSocketResponseView])
  
  // URL section
  const urlSection = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Badge type={mapToBadgeType(request.protocol)} />
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }} title={resolvedUrl || url} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'}>
        <RestormVariableInputBox
          value={url}
          onChange={setUrl}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          placeholder={t('websocket.urlPlaceholder')}
        />
      </div>
      <Button 
        icon={isSending ? 'debug-disconnect' : 'plug'}
        onClick={isSending ? handleDisconnect : handleSend} 
        options={{ 
          title: isSending ? t('websocket.disconnect') : t('websocket.connect'), 
          ariaLabel: isSending ? t('websocket.disconnect') : t('websocket.connect') 
        }}
      >
        {isSending ? t('websocket.disconnect') : t('websocket.connect')}
      </Button>
    </div>
  )
  
  return (
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
      historyContent={<ResponseHistoryTab requestId={request.id} refreshKey={historyRefreshKey} buildResponseView={buildHistoryView} />}
    />
  )
}

export default WebSocketRequestTabView
