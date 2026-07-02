import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  InputBox,
  SelectBox,
  CodeEditor,
  SplitView,
  Pane,
  ScrollableElement,
  ControlGroup,
  eventBus,
  logger,
  getContrastColor,
  fieldDiffStyle,
  type ISelectData,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { MqttOptionsPanel } from './MqttOptionsPanel'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { WebSocketRequest, WebSocketResponse, WebSocketMessage, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { WebSocketExecutionResult, WebSocketMessageItem } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { updateReactiveProperty } from './requestTabViewUtils'
import { useApiDocumentationFromRequest } from '../../hooks/useApiDocumentationFromRequest'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { findOperationForRoute } from '../../../../shared/utils/findOperationForRoute'
import { DEFAULT_WS_TIMEOUT_MS } from '../../../../shared/config/constants'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { useIsWebsocketListening } from '../../services/websocketListeningStore'
import { conflictSafeBoolean } from '../../services/conflictSafeLiveState'
import type { EntityFieldDiff } from '../../services/conflictFieldDiff'
import { BeamWrap } from '../common/BeamWrap'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './WebSocketChat.css'

export interface WebSocketRequestTabViewProps {
  request: WebSocketRequest
  /** Conflict-resolution field-diff (AC#4) — `computeEntityFieldDiff`'s
   * result. Red-borders the URL input when `url` differs; coarse-borders
   * the message/options area when `requestConfig` differs. Only ever set
   * by `ConflictEntityPanel`. */
  conflictFieldDiff?: EntityFieldDiff
  /** Preselects the tab holding the conflicting field (AC#5). */
  defaultActiveTabId?: string
  /** Hides the (non-editable, generated) Code Snippets tab (AC#5). */
  showCodeSnippets?: boolean
  /** Blanket conflict-mode safety rule (AC#2/#5, see
   * `conflictSafeLiveState.ts`): forces `isListening` to `false` and skips
   * the live message/progress/server-clients stream subscription — a
   * conflict panel is a static historical snapshot, never a live
   * connection. */
  conflictMode?: boolean
}

/** The MQTT-specific slice of `fullData` (only for `protocol === 'mqtt'`).
 * Returns an empty object for other protocols so the spread is a no-op. */
function buildMqttFullData(req: WebSocketRequest): Record<string, unknown> {
  if (req.protocol !== 'mqtt') return {}
  const out: Record<string, unknown> = {}
  if (req.qos !== undefined) out['qos'] = req.qos
  if (req.retain !== undefined) out['retain'] = req.retain
  if (req.clientId !== undefined) out['clientId'] = req.clientId
  if (req.username !== undefined) out['username'] = req.username
  if (req.password !== undefined) out['password'] = req.password
  if (req.keepalive !== undefined) out['keepalive'] = req.keepalive
  if (req.mqttSubscribe !== undefined) out['mqttSubscribe'] = req.mqttSubscribe
  if (req.lwtTopic !== undefined) out['lwtTopic'] = req.lwtTopic
  if (req.lwtPayload !== undefined) out['lwtPayload'] = req.lwtPayload
  if (req.lwtQos !== undefined) out['lwtQos'] = req.lwtQos
  if (req.lwtRetain !== undefined) out['lwtRetain'] = req.lwtRetain
  return out
}

export const WebSocketRequestTabView: React.FC<WebSocketRequestTabViewProps> = ({
  request,
  conflictFieldDiff,
  defaultActiveTabId,
  showCodeSnippets = true,
  conflictMode
}) => {
  const conflictFields = conflictFieldDiff?.fields
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  // See HTTPRequestTabView — `projectUuid` from the env context is
  // synchronously available, unlike `useFileService` which races the
  // `useState` lazy initializer.
  const { selectedEnvId, environments, envColor, projectUuid } = useEnvironmentContext()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const { apiDocumentation, route } = useApiDocumentationFromRequest(request)
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [event, setEventState] = useState(request.event ?? '')
  const [message, setMessageState] = useState(request.message)
  const [response, setResponse] = useState<WebSocketResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // Live frames for the current connection (appended as they arrive), so the
  // chat updates in real time instead of only after the connection closes.
  const [liveMessages, setLiveMessages] = useState<WebSocketMessage[]>([])
  // Server mode: live count of clients connected to the hosted server (driven by
  // the main-process `websocket:server-clients` broadcast on each connect/close).
  const [serverClientCount, setServerClientCount] = useState(0)
  // Whether this request currently holds an open connection (drives the
  // Connect↔Disconnect toggle, the Send button, and the listening beam).
  const isListening = conflictSafeBoolean(useIsWebsocketListening(request.id), conflictMode)

  // See HTTPRequestTabView for the contract.
  const [panelCollapsed, setPanelCollapsed] = useState<{ message: boolean; headers: boolean }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      message: typeof seed['message'] === 'boolean' ? seed['message'] : false,
      headers: typeof seed['headers'] === 'boolean' ? seed['headers'] : request.headers.length === 0
    }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = { message: arr[0] ?? false, headers: arr[1] ?? false }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'message', next.message)
      setRequestPanelCollapsed(projectUuid, request.id, 'headers', next.headers)
    }
  }, [projectUuid, request.id])

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  // Bumped on a quick-config load (or MCP update_request) so the headers KV
  // table and the MQTT options panel remount and re-read their values from the
  // now-mutated request (both seed local state from props once at mount).
  const [transportEpoch, setTransportEpoch] = useState(0)

  const headersRef = useRef<KeyValueTableHandle | null>(null)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setEventState(request.event ?? '')
    setMessageState(request.message)
    setResponse(null)
    setLiveMessages([])
  }, [request])
  useRequestReset(request, handleRequestReset)

  // Refs to capture initial values for registration (avoid re-running effect when these change)
  const selectedEnvIdRef = useRef(selectedEnvId)
  const requestRef = useRef(request)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { requestRef.current = request }, [request])

  // Re-sync local state when a quick-config load (or MCP update_request)
  // replaces the transport. The state updates re-trigger the
  // updateFullRequestData useEffect below → Handlebars re-resolution.
  const handleTransportReplaced = useCallback(() => {
    const current = requestRef.current
    setUrlState(current.url)
    setEventState(current.event ?? '')
    setMessageState(current.message)
    // Remount the headers table + MQTT options panel so they re-read the
    // restored values.
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current
    logger.debug('[WebSocketRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = toKeyValueDataShared

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.headers)
    })

    // Send full request data for URL and code snippet calculation
    void window.restorm?.context.updateFullRequestData(requestId, {
      url: currentRequest.url,
      method: currentRequest.protocol,
      protocol: currentRequest.protocol,
      event: currentRequest.event,
      message: currentRequest.message,
      requestType: 'websocket',
      ...(currentRequest.server === true ? { server: true } : {}),
      ...buildMqttFullData(currentRequest),
      headers: toKeyValueData(currentRequest.headers),
      body: { type: 'text', content: currentRequest.message }
    }, sourceIdRef.current)

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
    const toKeyValueData = toKeyValueDataShared

    void window.restorm?.context.updateFullRequestData(request.id, {
      url,
      method: request.protocol,
      protocol: request.protocol,
      event,
      message,
      requestType: 'websocket',
      ...(request.server === true ? { server: true } : {}),
      ...buildMqttFullData(request),
      headers: toKeyValueData(request.headers),
      body: { type: 'text', content: message }
    }, sourceIdRef.current)
    // `request` (whole object) is in deps because buildMqttFullData reads many of
    // its fields; url/event/message are the separately-tracked local input state.
  }, [request, url, event, message])

  // Live message + connection stream for this request: append frames as they
  // arrive (chat updates in real time) and refresh history when it closes.
  // Skipped entirely in conflict mode (see `conflictSafeLiveState.ts`) — a
  // static historical snapshot must never pick up another tab's live frames.
  useEffect(() => {
    if (conflictMode) return undefined
    const requestId = request.id
    const unsubMsg = window.restorm?.websocket.onMessage(({ requestId: rid, message: m }) => {
      if (rid !== requestId) return
      setLiveMessages((prev) => [...prev, { direction: m.direction, data: m.data, event: m.event, timestamp: m.timestamp }])
    })
    const unsubProg = window.restorm?.websocket.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') { setLiveMessages([]); setServerClientCount(0) }
      if (status === 'completed' || status === 'cancelled' || status === 'error') {
        setHistoryRefreshKey((k) => k + 1)
        setServerClientCount(0)
      }
    })
    // Server mode: live count of clients connected to the hosted server.
    const unsubClients = window.restorm?.websocket.onServerClients(({ requestId: rid, count }) => {
      if (rid !== requestId) return
      setServerClientCount(count)
    })
    return () => { unsubMsg?.(); unsubProg?.(); unsubClients?.() }
  }, [request.id, conflictMode])

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
  
  // SERVER MODE: restorm hosts a socket.io server. The host is forced to
  // localhost — only the port + route (namespace) are user-configurable — and
  // there's no environment / auth / docs. The Connect↔Disconnect toggle becomes
  // Start↔Stop listening; the Send button broadcasts to connected clients.
  const isServer = request.server === true
  const { serverPort, serverRoute } = useMemo(() => {
    const stripped = url.replace(/^[a-z]+:\/\//i, '')
    const slash = stripped.indexOf('/')
    const hostPort = slash >= 0 ? stripped.slice(0, slash) : stripped
    const route = slash >= 0 ? stripped.slice(slash + 1) : ''
    const port = hostPort.split(':')[1] ?? ''
    return { serverPort: port, serverRoute: route }
  }, [url])
  const composeServerUrl = useCallback((port: string, routePart: string): string => {
    const cleanRoute = routePart.replace(/^\/+/, '')
    return `localhost:${port}${cleanRoute ? `/${cleanRoute}` : ''}`
  }, [])
  const setServerPort = useCallback((p: string): void => {
    setUrl(composeServerUrl(p.replace(/[^0-9]/g, ''), serverRoute))
  }, [composeServerUrl, serverRoute, setUrl])
  const setServerRoute = useCallback((r: string): void => {
    setUrl(composeServerUrl(serverPort, r))
  }, [composeServerUrl, serverPort, setUrl])

  // MQTT broker mode: the URL keeps its scheme (`mqtt://` raw TCP vs `ws://`
  // MQTT-over-WebSocket — the main process picks the transport from it) + a
  // localhost port. The topic FILTER (the "route") lives on `event`, not the URL.
  const isMqttServer = isServer && request.protocol === 'mqtt'
  const mqttScheme = useMemo(() => (/^wss?:\/\//i.test(url) ? 'ws://' : 'mqtt://'), [url])
  const composeMqttBrokerUrl = useCallback((scheme: string, port: string): string => `${scheme}localhost:${port}`, [])
  const setMqttScheme = useCallback((s: string): void => {
    setUrl(composeMqttBrokerUrl(s, serverPort))
  }, [composeMqttBrokerUrl, serverPort, setUrl])
  const setMqttServerPort = useCallback((p: string): void => {
    setUrl(composeMqttBrokerUrl(mqttScheme, p.replace(/[^0-9]/g, '')))
  }, [composeMqttBrokerUrl, mqttScheme, setUrl])

  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  // Environment variables for scalar {{...}} fields so their autocomplete
  // offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

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

  // Connect = open the connection and listen. It stays open (no timeout) until
  // the user disconnects; the promise resolves on close. Emitting is a separate
  // action (the Send button).
  const handleConnect = (): void => {
    if (isListening) return
    setLiveMessages([])
    setResponse(null)

    window.restorm?.websocket.connect({
      requestId: request.id,
      timeout: DEFAULT_WS_TIMEOUT_MS,
      ...(requestPath ? { requestPath } : {})
    })
      .then((res: WebSocketExecutionResult) => {
        // Resolves when the connection closes (user disconnect or server drop).
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
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('WebSocket connection closed', { url: res.requestUrl, connected: res.connected })
      })
      .catch((err: unknown) => {
        logger.error('WebSocket connection failed', { error: String(err) })
      })
  }

  // Send = emit the current message/event on the open connection.
  const handleSend = (): void => {
    if (!isListening) return
    void window.restorm?.websocket.send(request.id, message, event ? event : undefined)
  }

  const handleDisconnect = (): void => {
    void window.restorm?.websocket.disconnect(request.id)
  }

  // Request content (SplitView with Message, Headers)
  const requestContent = (
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="websocket-request-split-view"
      onCollapsedChange={handlePanelCollapsedChange}
    >
      <Pane title={t('websocket.tabs.message')} initialSize={0.7} minSize={150} collapsed={panelCollapsed.message} data-testid="websocket-message-pane">
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(request.protocol === 'socketio' || request.protocol === 'mqtt') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
              <span style={{ fontSize: 12 }}>{request.protocol === 'mqtt' ? t('websocket.topic') : t('websocket.event')}:</span>
              <div style={{ flex: 1 }}>
                <RestormVariableInputBox
                  key={`event-${transportEpoch}`}
                  value={event}
                  onChange={setEvent}
                  variables={envVariables}
                  helpers={handlebarsHelpers}
                  placeholder={request.protocol === 'mqtt' ? (isMqttServer ? 'restorm/demo/#' : 'topic/name') : 'event-name'}
                  data-testid="websocket-event-input"
                />
              </div>
            </div>
          )}
          {request.protocol === 'mqtt' && (
            <MqttOptionsPanel key={`mqtt-${transportEpoch}`} request={request} variables={envVariables} helpers={handlebarsHelpers} server={isServer} />
          )}
          <div style={{ flex: 1, border: '1px solid var(--panel-border)', borderRadius: 3, ...fieldDiffStyle(!!conflictFields?.['requestConfig']) }}>
            <CodeEditor
              key={`message-${transportEpoch}`}
              height="100%"
              language="json"
              value={message}
              onChange={(v) => { setMessage(v ?? '{}') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
              data-testid="websocket-message-editor"
            />
          </div>
        </div>
      </Pane>
      <Pane
        title={t('websocket.tabs.headers')}
        initialSize={0.3}
        minSize={100}
        collapsed={panelCollapsed.headers}
        data-testid="websocket-headers-pane"
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
            data-testid="websocket-add-header-button"
          />
        )}
      >
        <div style={{ height: '100%', boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!conflictFields?.['requestConfig']) }}>
          <RestormKeyValueTable
            key={`headers-${transportEpoch}`}
            ref={headersRef}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            initialRows={request.headers}
            onRowsChange={handleHeadersChange}
            persistenceId={`websocket-headers:${request.id}`}
            data-testid="websocket-headers-table"
          />
        </div>
      </Pane>
    </SplitView>
  )
  
  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  // Chat-style transcript: received bubbles hug the left, sent bubbles the
  // right. A delivery confirmation is not shown as its own bubble — it folds
  // into a check badge on the originating sent bubble. Two confirmation shapes:
  // - Socket.IO: an explicit acknowledgement frame (`<event> (ack)`).
  // - MQTT: a published message that round-trips back through the broker (the
  //   request is subscribed to a topic it also publishes to), arriving as a
  //   received frame with the SAME topic + payload as a prior sent bubble. That
  //   is the correct pub/sub delivery, so mark the sent bubble delivered rather
  //   than duplicating it as a fresh inbound bubble.
  const renderChat = useCallback((messages: WebSocketMessage[], protocol?: string): React.ReactNode => {
    interface ChatItem { direction: 'sent' | 'received'; data: string; event: string | undefined; acknowledged: boolean }
    const items: ChatItem[] = []
    const isMqtt = protocol === 'mqtt'
    for (const msg of messages) {
      const ackMatch = msg.direction === 'received' && msg.event ? /^(.*) \(ack\)$/.exec(msg.event) : null
      if (ackMatch) {
        const baseEvent = ackMatch[1]
        for (let j = items.length - 1; j >= 0; j--) {
          const candidate = items[j]
          if (candidate?.direction === 'sent' && !candidate.acknowledged && (candidate.event ?? '') === baseEvent) {
            candidate.acknowledged = true
            break
          }
        }
        continue
      }
      // MQTT round-trip: a received frame matching a still-unconfirmed sent
      // bubble (same payload — and same topic when the sent frame recorded one)
      // is that publish coming back via the subscription. Fold it into a
      // delivery check instead of a duplicate inbound bubble. The payload is the
      // round-trip identity; a sent bubble that didn't record its topic still
      // matches (publishes always go to the request's own topic).
      if (isMqtt && msg.direction === 'received') {
        const match = items.find(
          (c) =>
            c.direction === 'sent' &&
            !c.acknowledged &&
            c.data === msg.data &&
            (!c.event || c.event === msg.event)
        )
        if (match) { match.acknowledged = true; continue }
      }
      items.push({ direction: msg.direction, data: msg.data, event: msg.event, acknowledged: false })
    }
    if (items.length === 0) {
      return <div className="ws-chat-empty">{t('websocket.noMessages')}</div>
    }
    return (
      <ScrollableElement
        options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
        style={{ flex: 1, minHeight: 0 }}
      >
        <div className="ws-chat" data-testid="websocket-chat">
        {items.map((item, i) => (
          <div
            key={i}
            className={`ws-chat-bubble ${item.direction === 'sent' ? 'sent' : 'received'}`}
            data-testid="ws-chat-bubble"
            data-direction={item.direction}
          >
            {item.direction === 'sent' && item.acknowledged && (
              <HeaderHoverTooltip label={t('websocket.acknowledged')} placement="above" className="ws-chat-ack-check">
                <span className="codicon codicon-pass-filled" aria-label={t('websocket.acknowledged')} data-testid="ws-chat-ack-check" />
              </HeaderHoverTooltip>
            )}
            {item.event && <span className="ws-chat-event">{item.event}</span>}
            {item.data}
          </div>
        ))}
        </div>
      </ScrollableElement>
    )
  }, [t])

  const buildWebSocketResponseView = useCallback((
    resp: WebSocketResponse | null,
    meta?: { protocol?: string | undefined; event?: string | undefined }
  ) => {
    if (!resp) return { infosContent: null, responseContent: null, jsonData: undefined }
    const infosContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: resp.connected ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {resp.connected ? t('websocket.connected') : t('websocket.disconnected')}
          </span>
        </div>
        {resp.timings.durationMs > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
            <span>{resp.timings.durationMs}ms</span>
          </div>
        )}
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
    )

    return { infosContent, responseContent: renderChat(resp.messages, meta?.protocol), jsonData: undefined }
  }, [t, renderChat])

  // Live view: prefer the streaming frames; fall back to the resolved response.
  const liveResponse = useMemo<WebSocketResponse | null>(() => {
    if (!isListening && liveMessages.length === 0) return response
    return {
      id: 'live',
      type: 'websocket',
      requestId: request.id,
      requestUrl: resolvedUrl || url,
      protocol: request.protocol,
      connected: isListening || (response?.connected ?? false),
      messages: liveMessages.length > 0 ? liveMessages : (response?.messages ?? []),
      timings: response?.timings ?? { startedAt: '', durationMs: 0 },
      ...(response?.error ? { error: response.error } : {})
    }
  }, [isListening, liveMessages, response, request.id, request.protocol, resolvedUrl, url])

  const { infosContent, responseContent } = useMemo(
    () => buildWebSocketResponseView(liveResponse, { protocol: request.protocol, event: request.event }),
    [buildWebSocketResponseView, liveResponse, request.protocol, request.event]
  )

  // Server mode: a live "N clients connected" banner at the top of the Response
  // tab, above the message stream. Hidden when not hosting.
  const serverResponseContent = useMemo<React.ReactNode>(() => {
    if (!isServer) return responseContent
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div
          data-testid="websocket-server-client-count"
          style={{ padding: '4px 8px', fontSize: 12, color: 'var(--foreground-muted)', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span className={`codicon codicon-${isListening ? 'broadcast' : 'circle-slash'}`} aria-hidden="true" />
          {isListening
            ? t('websocket.clientsConnected', { count: serverClientCount, defaultValue: '{{count}} client(s) connected' })
            : t('websocket.notListening', 'Not listening')}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{responseContent}</div>
      </div>
    )
  }, [isServer, isListening, serverClientCount, responseContent, t])

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'websocket') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: WebSocketResponse = {
      id: detail.guid,
      type: 'websocket',
      requestId: request.id,
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
  }, [buildWebSocketResponseView, request.id])
  
  // Connect/listen toggle. In server mode the toggle is Start↔Stop listening
  // and is NOT wrapped in the env switcher (server mode ignores environments).
  const connectButton = (
    <BeamWrap active={isListening} size={22} borderWidth={1.5}>
      <Button
        icon={isListening ? 'debug-disconnect' : 'plug'}
        onClick={isListening ? handleDisconnect : handleConnect}
        {...(isListening ? { emphasis: 0 } : (!isServer && sendButtonStyle) ? { style: sendButtonStyle } : { emphasis: 1 })}
        options={{
          title: isServer
            ? (isListening ? t('websocket.stopListening') : t('websocket.startListening'))
            : (isListening ? t('websocket.disconnect') : t('websocket.connect')),
          ariaLabel: isServer
            ? (isListening ? t('websocket.stopListening') : t('websocket.startListening'))
            : (isListening ? t('websocket.disconnect') : t('websocket.connect'))
        }}
        data-testid="websocket-connect-button"
      />
    </BeamWrap>
  )

  // URL section. Server mode forces host=localhost and exposes only port + route
  // (no free URL, no environment variables); client mode keeps the full URL input.
  const urlSection = (
    <ControlGroup data-testid="websocket-url-section">
      {isMqttServer ? (
        <>
          <HeaderHoverTooltip label={t('server.configLockedWhileRunning', 'Config locked while the server is running')} suppressed={!isListening}>
            <div style={{ width: 96, minWidth: 80 }} data-testid="mqtt-broker-scheme">
              <SelectBox
                id={`mqtt-broker-scheme-${request.id}`}
                className=""
                options={[{ text: 'mqtt://' }, { text: 'ws://' }]}
                selected={mqttScheme === 'ws://' ? 1 : 0}
                onDidSelect={(d: ISelectData): void => { setMqttScheme(d.index === 1 ? 'ws://' : 'mqtt://') }}
                data-testid="mqtt-broker-scheme-select"
                disabled={isListening}
              />
            </div>
          </HeaderHoverTooltip>
          <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }} data-testid="mqtt-broker-host">localhost:</span>
          <HeaderHoverTooltip label={t('server.configLockedWhileRunning', 'Config locked while the server is running')} suppressed={!isListening}>
            <div style={{ width: 90, minWidth: 60 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'}>
              <InputBox
                value={serverPort}
                onChange={setMqttServerPort}
                options={{ placeholder: '1883' }}
                data-testid="websocket-server-port-input"
                disabled={isListening}
              />
            </div>
          </HeaderHoverTooltip>
          {connectButton}
        </>
      ) : isServer ? (
        <>
          <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--foreground-muted)', whiteSpace: 'nowrap' }} data-testid="websocket-server-host">localhost:</span>
          <HeaderHoverTooltip label={t('server.configLockedWhileRunning', 'Config locked while the server is running')} suppressed={!isListening} className="url-container-stretch">
            <div style={{ width: 90, minWidth: 60 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'}>
              <InputBox
                value={serverPort}
                onChange={setServerPort}
                options={{ placeholder: '3001' }}
                data-testid="websocket-server-port-input"
                disabled={isListening}
              />
            </div>
          </HeaderHoverTooltip>
          <span style={{ display: 'flex', alignItems: 'center', padding: '0 2px', color: 'var(--foreground-muted)' }}>/</span>
          <HeaderHoverTooltip label={t('server.configLockedWhileRunning', 'Config locked while the server is running')} suppressed={!isListening} className="url-container-stretch">
            <div style={{ flex: 1, minWidth: 0 }}>
              <InputBox
                value={serverRoute}
                onChange={setServerRoute}
                options={{ placeholder: t('websocket.routePlaceholder') }}
                data-testid="websocket-server-route-input"
                disabled={isListening}
              />
            </div>
          </HeaderHoverTooltip>
          {connectButton}
        </>
      ) : (
        <>
          <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
            <div
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!conflictFields?.['url']) }}
              data-testid="url-container"
              data-url-resolved={resolvedUrl ? 'true' : 'false'}
              data-resolved-url={resolvedUrl || url}
            >
              <RestormVariableInputBox
                value={url}
                onChange={setUrl}
                variables={envVariables}
                helpers={handlebarsHelpers}
                placeholder={t('websocket.urlPlaceholder')}
                data-testid="websocket-url-input"
              />
            </div>
          </HeaderHoverTooltip>
          <SendButtonEnvSwitcher>{connectButton}</SendButtonEnvSwitcher>
        </>
      )}
      {/* Every WebSocket-family protocol (websocket / socketio / mqtt) has a Send
          button: it sends a frame, emits an event, or publishes to a topic. */}
      <Button
        icon="send"
        onClick={handleSend}
        disabled={!isListening}
        emphasis={1}
        options={{ title: t('requestTab.send'), ariaLabel: t('requestTab.send') }}
        data-testid="websocket-send-button"
      />
    </ControlGroup>
  )
  
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
        codeSnippetsContent={codeSnippetsContent}
        {...(!isServer && apiDocumentation && route && findOperationForRoute(apiDocumentation, route) ? { docsContent: <DocumentationHost apiDocumentation={apiDocumentation} filters={[route]} /> } : {})}
        notes={request.notes}
        onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
        isLoading={false}
        showResponse={isListening || liveMessages.length > 0 || response !== null}
        infosContent={infosContent}
        responseContent={serverResponseContent}
        showCodeSnippets={showCodeSnippets}
        notesDiffers={!!conflictFields?.['notes']}
        {...(defaultActiveTabId !== undefined ? { defaultActiveTabId } : {})}
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

export default WebSocketRequestTabView
