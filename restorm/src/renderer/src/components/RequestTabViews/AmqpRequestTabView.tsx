import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  InputBox,
  SelectBox,
  Toggle,
  CodeEditor,
  ScrollableElement,
  ControlGroup,
  eventBus,
  logger,
  getContrastColor,
  type ISelectData
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEmitRequestExecution } from '../../services/requestExecutingStore'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import type { AmqpRequest, AmqpMode, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { AmqpExecutionResult, AmqpMessageItem } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { updateReactiveProperty } from './requestTabViewUtils'
import { DEFAULT_AMQP_TIMEOUT_MS } from '../../../../shared/config/constants'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { useIsAmqpListening } from '../../services/amqpListeningStore'
import { BeamWrap } from '../common/BeamWrap'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './WebSocketChat.css'

export interface AmqpRequestTabViewProps {
  request: AmqpRequest
}

const MODE_OPTIONS: { text: string; value: AmqpMode }[] = [
  { text: 'publish', value: 'publish' },
  { text: 'subscribe', value: 'subscribe' },
  { text: 'browse', value: 'browse' }
]

/** A closed / one-shot AMQP response snapshot — either the result of a
 * publish/browse `execute()` call, or the finalized state of a `subscribe`
 * connection once it settles (fetched from history since `connect()` itself
 * is fire-and-forget, unlike WebSocket's connect-until-close promise). */
interface AmqpResponse {
  connected: boolean
  mode: AmqpMode
  messages: AmqpMessageItem[]
  error?: string
  timings: { startedAt: string; durationMs: number }
}

/** Build the `updateFullRequestData` payload from a plain field bag — a
 * module-level pure function (stable identity across renders) so effects
 * calling it only need the raw field values in their dependency array, not
 * the function itself, mirroring `buildMqttFullData` in
 * `WebSocketRequestTabView`. */
function buildAmqpFullData(fields: {
  url: string
  mode: AmqpMode
  vhost?: string | undefined
  exchange?: string | undefined
  routingKey?: string | undefined
  payload?: string | undefined
  queue?: string | undefined
  autoAck?: boolean | undefined
  prefetch?: number | undefined
  browsePeekCount?: number | undefined
  username?: string | undefined
  password?: string | undefined
}): Record<string, unknown> {
  return {
    url: fields.url,
    requestType: 'amqp',
    // AMQP has no HTTP-style headers concept in its UI, but `headers` is a
    // required common field on `FullRequestData` — ContextService.updateFullRequestData
    // reads `data.headers.length` unconditionally, so an omitted field throws.
    headers: [],
    mode: fields.mode,
    ...(fields.vhost ? { vhost: fields.vhost } : {}),
    ...(fields.exchange ? { exchange: fields.exchange } : {}),
    ...(fields.routingKey ? { routingKey: fields.routingKey } : {}),
    payload: fields.payload ?? '',
    ...(fields.queue ? { queue: fields.queue } : {}),
    autoAck: fields.autoAck !== false,
    ...(fields.prefetch !== undefined ? { prefetch: fields.prefetch } : {}),
    ...(fields.browsePeekCount !== undefined ? { browsePeekCount: fields.browsePeekCount } : {}),
    ...(fields.username ? { username: fields.username } : {}),
    ...(fields.password ? { password: fields.password } : {}),
    body: { type: 'text', content: fields.payload ?? '' }
  }
}

/** Row label + control, evenly aligned (mirrors MqttOptionsPanel's `Field`). */
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontSize: 12, width: 100, flexShrink: 0, color: 'var(--foreground-muted)' }}>{label}</span>
    <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
  </div>
)

export const AmqpRequestTabView: React.FC<AmqpRequestTabViewProps> = ({ request }) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  const { selectedEnvId, environments, envColor, projectUuid: _projectUuid } = useEnvironmentContext()
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [vhost, setVhostState] = useState(request.vhost ?? '')
  const [username, setUsernameState] = useState(request.username ?? '')
  const [password, setPasswordState] = useState(request.password ?? '')
  const [mode, setModeState] = useState<AmqpMode>(request.mode)
  const [exchange, setExchangeState] = useState(request.exchange ?? '')
  const [routingKey, setRoutingKeyState] = useState(request.routingKey ?? '')
  const [payload, setPayloadState] = useState(request.payload ?? '')
  const [queue, setQueueState] = useState(request.queue ?? '')
  const [autoAck, setAutoAckState] = useState(request.autoAck !== false)
  const [prefetch, setPrefetchState] = useState(request.prefetch !== undefined ? String(request.prefetch) : '')
  const [browsePeekCount, setBrowsePeekCountState] = useState(request.browsePeekCount !== undefined ? String(request.browsePeekCount) : '')

  const [response, setResponse] = useState<AmqpResponse | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  // Publish/browse activity into the shared request-activity store so the
  // sidebar + tab badges beam during a one-shot execute; the open subscribe
  // connection is covered by the AMQP listening store.
  useEmitRequestExecution(request.id, isExecuting)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // Live frames for the current connection/execution — appended as they
  // arrive so the list updates in real time.
  const [liveMessages, setLiveMessages] = useState<AmqpMessageItem[]>([])
  // Whether this request currently holds an open `subscribe` connection.
  const isListening = useIsAmqpListening(request.id)

  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  // Bumped on a quick-config load (or MCP update_request) so the message
  // editor remounts and re-reads its value from the now-mutated request.
  const [transportEpoch, setTransportEpoch] = useState(0)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setVhostState(request.vhost ?? '')
    setUsernameState(request.username ?? '')
    setPasswordState(request.password ?? '')
    setModeState(request.mode)
    setExchangeState(request.exchange ?? '')
    setRoutingKeyState(request.routingKey ?? '')
    setPayloadState(request.payload ?? '')
    setQueueState(request.queue ?? '')
    setAutoAckState(request.autoAck !== false)
    setPrefetchState(request.prefetch !== undefined ? String(request.prefetch) : '')
    setBrowsePeekCountState(request.browsePeekCount !== undefined ? String(request.browsePeekCount) : '')
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
  // replaces the transport.
  const handleTransportReplaced = useCallback(() => {
    const current = requestRef.current
    setUrlState(current.url)
    setVhostState(current.vhost ?? '')
    setUsernameState(current.username ?? '')
    setPasswordState(current.password ?? '')
    setModeState(current.mode)
    setExchangeState(current.exchange ?? '')
    setRoutingKeyState(current.routingKey ?? '')
    setPayloadState(current.payload ?? '')
    setQueueState(current.queue ?? '')
    setAutoAckState(current.autoAck !== false)
    setPrefetchState(current.prefetch !== undefined ? String(current.prefetch) : '')
    setBrowsePeekCountState(current.browsePeekCount !== undefined ? String(current.browsePeekCount) : '')
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  // Register request with ContextService on mount, unregister on unmount.
  // Reads `requestRef.current` (a ref, so it isn't an exhaustive-deps
  // dependency) — mirrors WebSocketRequestTabView's mount effect, which
  // seeds from the request snapshot rather than the local input state.
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    logger.debug('[AmqpRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {})
    void window.restorm?.context.updateFullRequestData(requestId, buildAmqpFullData(requestRef.current), sourceIdRef.current)

    const unsubUrl = window.restorm?.context.onUrlResolved((result) => {
      if (result.requestId === requestId) setResolvedUrl(result.resolvedUrl)
    })
    const unsubSnippets = window.restorm?.context.onCodeSnippetsUpdated((result) => {
      if (result.requestId === requestId) setBackendCodeSnippets(result.markdown)
    })

    void window.restorm?.context.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    void window.restorm?.context.getCodeSnippets(requestId).then((result) => {
      if (result) setBackendCodeSnippets(result.markdown)
    })

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[AmqpRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl?.()
      unsubSnippets?.()
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id, environments])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Push the latest field values on every change (each field's own input is
  // already debounced by the underlying VariableInputBox / InputBox).
  // `buildAmqpFullData` is a module-level pure function (stable identity),
  // so it isn't an exhaustive-deps dependency — only the raw values it reads
  // (listed below) are.
  useEffect(() => {
    const prefetchNum = prefetch !== '' ? Number.parseInt(prefetch, 10) : undefined
    const browsePeekCountNum = browsePeekCount !== '' ? Number.parseInt(browsePeekCount, 10) : undefined
    void window.restorm?.context.updateFullRequestData(request.id, buildAmqpFullData({
      url,
      mode,
      vhost,
      exchange,
      routingKey,
      payload,
      queue,
      autoAck,
      prefetch: prefetchNum !== undefined && Number.isFinite(prefetchNum) ? prefetchNum : undefined,
      browsePeekCount: browsePeekCountNum !== undefined && Number.isFinite(browsePeekCountNum) ? browsePeekCountNum : undefined,
      username,
      password
    }), sourceIdRef.current)
  }, [request.id, url, mode, vhost, exchange, routingKey, payload, queue, autoAck, prefetch, browsePeekCount, username, password])

  // Live frame + lifecycle stream for this request.
  useEffect(() => {
    const requestId = request.id
    const unsubMsg = window.restorm?.amqp.onMessage(({ requestId: rid, message }) => {
      if (rid !== requestId) return
      setLiveMessages((prev) => [...prev, message])
    })
    const unsubProg = window.restorm?.amqp.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') { setLiveMessages([]); setResponse(null) }
      if (status === 'completed' || status === 'cancelled' || status === 'error') {
        setHistoryRefreshKey((k) => k + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId } as RequestHistoryEventPayload)
        // `connect()` is fire-and-forget (unlike WebSocket's connect-until-close
        // promise) — the finalized error/duration only exists in the just-
        // persisted history entry, so pull it once the connection settles.
        void window.restorm?.responsesHistory.list(requestId).then((entries) => {
          const top = entries[0]
          if (!top) return
          return window.restorm?.responsesHistory.get(top.guid)
        }).then((detail) => {
          if (detail?.response.type === 'amqp') {
            setResponse({
              connected: detail.response.connected,
              mode: detail.response.mode,
              messages: detail.response.messages,
              ...(detail.response.error ? { error: detail.response.error } : {}),
              timings: detail.response.timings
            })
          }
        })
      }
    })
    return () => { unsubMsg?.(); unsubProg?.() }
  }, [request.id])

  const setUrl = useCallback((value: string): void => { setUrlState(value); updateReactiveProperty(request, 'url', value) }, [request])
  const setVhost = useCallback((value: string): void => { setVhostState(value); updateReactiveProperty(request, 'vhost', value ? value : undefined) }, [request])
  const setUsername = useCallback((value: string): void => { setUsernameState(value); updateReactiveProperty(request, 'username', value ? value : undefined) }, [request])
  const setPassword = useCallback((value: string): void => { setPasswordState(value); updateReactiveProperty(request, 'password', value ? value : undefined) }, [request])
  const setMode = useCallback((value: AmqpMode): void => { setModeState(value); updateReactiveProperty(request, 'mode', value) }, [request])
  const setExchange = useCallback((value: string): void => { setExchangeState(value); updateReactiveProperty(request, 'exchange', value ? value : undefined) }, [request])
  const setRoutingKey = useCallback((value: string): void => { setRoutingKeyState(value); updateReactiveProperty(request, 'routingKey', value ? value : undefined) }, [request])
  const setPayload = useCallback((value: string): void => { setPayloadState(value); updateReactiveProperty(request, 'payload', value) }, [request])
  const setQueue = useCallback((value: string): void => { setQueueState(value); updateReactiveProperty(request, 'queue', value ? value : undefined) }, [request])
  const setAutoAck = useCallback((value: boolean): void => { setAutoAckState(value); updateReactiveProperty(request, 'autoAck', value) }, [request])
  const setPrefetch = useCallback((value: string): void => {
    setPrefetchState(value)
    const n = Number.parseInt(value, 10)
    updateReactiveProperty(request, 'prefetch', value !== '' && Number.isFinite(n) ? n : undefined)
  }, [request])
  const setBrowsePeekCount = useCallback((value: string): void => {
    setBrowsePeekCountState(value)
    const n = Number.parseInt(value, 10)
    updateReactiveProperty(request, 'browsePeekCount', value !== '' && Number.isFinite(n) ? n : undefined)
  }, [request])

  // Environment variables for scalar {{...}} fields so their autocomplete
  // offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

  // Publish / browse: one-shot `execute()`. Subscribe uses Connect below.
  const handleExecute = useCallback((): void => {
    setLiveMessages([])
    setResponse(null)
    setIsExecuting(true)
    window.restorm?.amqp.execute({ requestId: request.id, timeout: DEFAULT_AMQP_TIMEOUT_MS })
      .finally(() => { setIsExecuting(false) })
      .then((res: AmqpExecutionResult) => {
        setResponse({
          connected: res.connected,
          mode: res.mode,
          messages: res.messages,
          ...(res.error ? { error: res.error } : {}),
          timings: res.timings
        })
        setLiveMessages(res.messages)
        setHistoryRefreshKey((k) => k + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
      })
      .catch((err: unknown) => {
        logger.error('AMQP execution failed', { error: String(err) })
      })
  }, [request.id])

  const handleConnect = useCallback((): void => {
    if (isListening) return
    setLiveMessages([])
    setResponse(null)
    void window.restorm?.amqp.connect({ requestId: request.id, timeout: DEFAULT_AMQP_TIMEOUT_MS })
  }, [isListening, request.id])

  const handleDisconnect = useCallback((): void => {
    void window.restorm?.amqp.disconnect(request.id)
  }, [request.id])

  const handleSendOnConnection = useCallback((): void => {
    if (!isListening) return
    void window.restorm?.amqp.send(request.id, payload)
  }, [isListening, request.id, payload])

  // Frame list (publish/subscribe/browse all share this rendering; a `peek`
  // frame gets a distinct indicator since the queue is left untouched).
  const renderFrames = useCallback((messages: AmqpMessageItem[]): React.ReactNode => {
    if (messages.length === 0) {
      return <div className="ws-chat-empty">{t('amqp.noMessages')}</div>
    }
    return (
      <ScrollableElement
        options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
        style={{ flex: 1, minHeight: 0 }}
      >
        <div className="ws-chat" data-testid="amqp-frame-list">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`ws-chat-bubble ${msg.direction === 'sent' ? 'sent' : 'received'}`}
              data-testid={`response-stream-frame-${i}`}
              data-direction={msg.direction}
            >
              <span className="ws-chat-event">
                <span className={`codicon codicon-arrow-${msg.direction === 'sent' ? 'up' : 'down'}`} aria-hidden="true" style={{ marginRight: 4 }} />
                {msg.exchange !== undefined && <span style={{ marginRight: 8 }}>exchange: {msg.exchange || '(default)'}</span>}
                {msg.routingKey !== undefined && <span style={{ marginRight: 8 }}>routingKey: {msg.routingKey}</span>}
                {msg.deliveryTag !== undefined && <span style={{ marginRight: 8 }}>deliveryTag: {msg.deliveryTag}</span>}
                {msg.peek === true && <span data-testid="amqp-frame-peek">{t('amqp.peeked')}</span>}
              </span>
              {msg.data}
            </div>
          ))}
        </div>
      </ScrollableElement>
    )
  }, [t])

  const infosContent = useMemo(() => {
    const connected = isListening || response?.connected === true
    const error = response?.error
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: connected ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {connected ? t('amqp.connected') : t('amqp.disconnected')}
          </span>
        </div>
        {response && response.timings.durationMs > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
            <span>{response.timings.durationMs}ms</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Mode:</span>
          <span>{mode}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>{t('amqp.messages')}:</span>
          <span>{liveMessages.length}</span>
        </div>
        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>{error}</div>
          </div>
        )}
      </div>
    )
  }, [isListening, response, mode, liveMessages.length, t])

  const responseContent = useMemo(() => renderFrames(liveMessages), [renderFrames, liveMessages])

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'amqp') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse = detail.response
    return {
      infosContent: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
            <span style={{ color: historyResponse.connected ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
              {historyResponse.connected ? t('amqp.connected') : t('amqp.disconnected')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Mode:</span>
            <span>{historyResponse.mode}</span>
          </div>
          {historyResponse.error && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
              <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>{historyResponse.error}</div>
            </div>
          )}
        </div>
      ),
      responseContent: renderFrames(historyResponse.messages),
      jsonData: undefined
    }
  }, [renderFrames, t])

  const modePane = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      {(mode === 'subscribe' || mode === 'browse') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 4, border: '1px solid var(--panel-border)', borderRadius: 3 }} data-testid="amqp-subscribe-browse-options">
          <Field label={t('amqp.queue')}>
            <RestormVariableInputBox key={`queue-${transportEpoch}`} value={queue} onChange={setQueue} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('amqp.queuePlaceholder')} data-testid="amqp-queue-input" />
          </Field>
          {mode === 'subscribe' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <Toggle checked={autoAck} onChange={setAutoAck} aria-label={t('amqp.autoAck')} data-testid="amqp-autoack-toggle" />
                {t('amqp.autoAck')}
              </label>
              <Field label={t('amqp.prefetch')}>
                <InputBox value={prefetch} onChange={setPrefetch} options={{ placeholder: '0' }} data-testid="amqp-prefetch-input" />
              </Field>
            </>
          )}
          {mode === 'browse' && (
            <Field label={t('amqp.browsePeekCount')}>
              <InputBox value={browsePeekCount} onChange={setBrowsePeekCount} options={{ placeholder: '50' }} data-testid="amqp-browse-peek-count-input" />
            </Field>
          )}
        </div>
      )}
      {mode !== 'browse' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label={t('amqp.exchange')}>
                <RestormVariableInputBox key={`exchange-${transportEpoch}`} value={exchange} onChange={setExchange} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('amqp.exchangePlaceholder')} data-testid="amqp-exchange-input" />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label={t('amqp.routingKey')}>
                <RestormVariableInputBox key={`routingkey-${transportEpoch}`} value={routingKey} onChange={setRoutingKey} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('amqp.routingKeyPlaceholder')} data-testid="amqp-routing-key-input" />
              </Field>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
            <CodeEditor
              key={`payload-${transportEpoch}`}
              height="100%"
              language="json"
              value={payload}
              onChange={(v) => { setPayload(v ?? '') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
              data-testid="amqp-payload-editor"
            />
          </div>
        </div>
      )}
    </div>
  )

  const requestContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 4, border: '1px solid var(--panel-border)', borderRadius: 3 }} data-testid="amqp-connection-options">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label={t('amqp.vhost')}>
              <RestormVariableInputBox key={`vhost-${transportEpoch}`} value={vhost} onChange={setVhost} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('amqp.vhostPlaceholder')} data-testid="amqp-vhost-input" />
            </Field>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label={t('amqp.username')}>
              <RestormVariableInputBox key={`username-${transportEpoch}`} value={username} onChange={setUsername} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('amqp.username')} data-testid="amqp-username-input" />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label={t('amqp.password')}>
              <RestormVariableInputBox key={`password-${transportEpoch}`} value={password} onChange={setPassword} variables={envVariables} helpers={handlebarsHelpers} placeholder={t('amqp.password')} data-testid="amqp-password-input" />
            </Field>
          </div>
        </div>
      </div>
      {modePane}
    </div>
  )

  const connectButton = (
    <BeamWrap active={isListening} size={22} borderWidth={1.5}>
      <Button
        icon={isListening ? 'debug-disconnect' : 'plug'}
        onClick={isListening ? handleDisconnect : handleConnect}
        {...(isListening ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
        options={{
          title: isListening ? t('amqp.disconnect') : t('amqp.connect'),
          ariaLabel: isListening ? t('amqp.disconnect') : t('amqp.connect')
        }}
        data-testid="amqp-connect-button"
      />
    </BeamWrap>
  )

  const urlSection = (
    <ControlGroup data-testid="amqp-url-section">
      <div style={{ width: 110, minWidth: 90 }} data-testid="amqp-mode-select">
        <SelectBox
          id={`amqp-mode-${request.id}`}
          className=""
          options={MODE_OPTIONS.map((o) => ({ text: t(`amqp.mode${o.text[0]?.toUpperCase()}${o.text.slice(1)}`) }))}
          selected={MODE_OPTIONS.findIndex((o) => o.value === mode)}
          onDidSelect={(d: ISelectData): void => {
            const next = MODE_OPTIONS[d.index]
            if (next) setMode(next.value)
          }}
          data-testid="amqp-mode-select-box"
        />
      </div>
      <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
        <div style={{ flex: 1, minWidth: 0 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder={t('amqp.urlPlaceholder')}
            data-testid="amqp-request-url-input"
          />
        </div>
      </HeaderHoverTooltip>
      {mode === 'publish' && (
        <SendButtonEnvSwitcher>
          <BeamWrap active={isExecuting} size={22} borderWidth={1.5}>
            <Button
              icon="send"
              onClick={handleExecute}
              emphasis={1}
              {...(sendButtonStyle ? { style: sendButtonStyle } : {})}
              options={{ title: t('amqp.send'), ariaLabel: t('amqp.send') }}
              data-testid="amqp-send-button"
            />
          </BeamWrap>
        </SendButtonEnvSwitcher>
      )}
      {mode === 'browse' && (
        <SendButtonEnvSwitcher>
          <BeamWrap active={isExecuting} size={22} borderWidth={1.5}>
            <Button
              icon="search"
              onClick={handleExecute}
              emphasis={1}
              {...(sendButtonStyle ? { style: sendButtonStyle } : {})}
              options={{ title: t('amqp.browseButton'), ariaLabel: t('amqp.browseButton') }}
              data-testid="amqp-browse-button"
            />
          </BeamWrap>
        </SendButtonEnvSwitcher>
      )}
      {mode === 'subscribe' && (
        <>
          <SendButtonEnvSwitcher>{connectButton}</SendButtonEnvSwitcher>
          <Button
            icon="send"
            onClick={handleSendOnConnection}
            disabled={!isListening}
            emphasis={1}
            options={{ title: t('amqp.send'), ariaLabel: t('amqp.send') }}
            data-testid="amqp-send-button"
          />
        </>
      )}
    </ControlGroup>
  )

  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const handleCloseHistoryModal = useCallback(() => { setHistoryModalOpen(false) }, [])

  useEffect(() => {
    const requestId = request.id
    const subscription = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_OPEN,
      (payload) => { if (payload.requestId === requestId) setHistoryModalOpen(true) }
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
        notes={request.notes}
        onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
        isLoading={false}
        showResponse={isListening || liveMessages.length > 0 || response !== null}
        infosContent={infosContent}
        responseContent={responseContent}
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

export default AmqpRequestTabView
