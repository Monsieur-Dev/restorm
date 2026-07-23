import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
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
  type ISelectData,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { StompRequest, StompResponse, StompMessage, StompSubscription, StompAckMode, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { StompExecutionResult, StompMessageItem } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { updateReactiveProperty } from './requestTabViewUtils'
import { DEFAULT_WS_TIMEOUT_MS } from '../../../../shared/config/constants'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { useIsStompListening } from '../../services/stompListeningStore'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './WebSocketChat.css'
import { cloneForEventBus } from '../../utils/cloneForEventBus'

export interface StompRequestTabViewProps {
  request: StompRequest
}

const STOMP_VERSION_OPTIONS = [{ text: '1.2' }, { text: '1.1' }]
const ACK_MODE_OPTIONS: { value: StompAckMode; labelKey: string; fallback: string }[] = [
  { value: 'auto', labelKey: 'stomp.ackMode.auto', fallback: 'auto' },
  { value: 'client', labelKey: 'stomp.ackMode.client', fallback: 'client' },
  { value: 'client-individual', labelKey: 'stomp.ackMode.clientIndividual', fallback: 'client-individual' }
]

let subscriptionIdSeq = 0
/** A short, human-typeable default subscription id — `sub-0`, `sub-1`, … per
 * tab-view instance (collision-safe enough for a UI default the user can
 * rename; the wire only requires uniqueness per connection). */
function nextSubscriptionId(): string {
  return `sub-${subscriptionIdSeq++}`
}

export const StompRequestTabView: React.FC<StompRequestTabViewProps> = ({
  request
}) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  const { selectedEnvId, environments, envColor, envIcon, envPaintColor } = useEnvironmentContext()
  // The fixed bar anchors on the workbench tab, so it only exists there.
  const inWorkbenchTab = useIsInWorkbenchTab()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [stompVersion, setStompVersionState] = useState(request.stompVersion)
  const [subscriptions, setSubscriptionsState] = useState<StompSubscription[]>(request.subscriptions)
  const [sendDestination, setSendDestinationState] = useState(request.sendDestination)
  const [sendBody, setSendBodyState] = useState(request.sendBody)
  const [response, setResponse] = useState<StompResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [liveMessages, setLiveMessages] = useState<StompMessage[]>([])
  const isListening = useIsStompListening(request.id)

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])

  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  // Bumped on a quick-config load (or MCP update_request) so the KV tables
  // remount and re-read their values from the now-mutated request.
  const [transportEpoch, setTransportEpoch] = useState(0)

  const connectHeadersRef = useRef<KeyValueTableHandle | null>(null)
  const sendHeadersRef = useRef<KeyValueTableHandle | null>(null)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setStompVersionState(request.stompVersion)
    setSubscriptionsState(request.subscriptions)
    setSendDestinationState(request.sendDestination)
    setSendBodyState(request.sendBody)
    setResponse(null)
    setLiveMessages([])
  }, [request])
  useRequestReset(request, handleRequestReset)

  const selectedEnvIdRef = useRef(selectedEnvId)
  const requestRef = useRef(request)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { requestRef.current = request }, [request])

  const handleTransportReplaced = useCallback(() => {
    const current = requestRef.current
    setUrlState(current.url)
    setStompVersionState(current.stompVersion)
    setSubscriptionsState(current.subscriptions)
    setSendDestinationState(current.sendDestination)
    setSendBodyState(current.sendBody)
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  // `connectHeaders` + `sendHeaders` are ALSO merged into the SAME registered
  // `headers` keyValueGroup slot so `collectRequestSecrets` sees both for
  // pre-hydration — see `StompExecutionService.resolveExecution`'s doc comment.
  const combinedHeaders = useCallback((connect: KeyValue[], send: KeyValue[]): KeyValue[] => [...connect, ...send], [])

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current
    logger.debug('[StompRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = toKeyValueDataShared

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(combinedHeaders(currentRequest.connectHeaders, currentRequest.sendHeaders))
    })

    void window.restorm?.context.updateFullRequestData(requestId, cloneForEventBus({
      url: currentRequest.url,
      requestType: 'stomp',
      stompVersion: currentRequest.stompVersion,
      connectHeaders: toKeyValueData(currentRequest.connectHeaders),
      subscriptions: currentRequest.subscriptions,
      sendDestination: currentRequest.sendDestination,
      sendBody: currentRequest.sendBody,
      sendHeaders: toKeyValueData(currentRequest.sendHeaders),
      headers: toKeyValueData(combinedHeaders(currentRequest.connectHeaders, currentRequest.sendHeaders)),
      body: { type: 'text', content: currentRequest.sendBody }
    }), sourceIdRef.current)

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
      logger.debug('[StompRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl?.()
      unsubSnippets?.()
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id, environments, combinedHeaders])

  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Notify ContextService when URL / version / subscriptions / send fields change
  useEffect(() => {
    const toKeyValueData = toKeyValueDataShared
    void window.restorm?.context.updateFullRequestData(request.id, cloneForEventBus({
      url,
      requestType: 'stomp',
      stompVersion,
      connectHeaders: toKeyValueData(request.connectHeaders),
      subscriptions,
      sendDestination,
      sendBody,
      sendHeaders: toKeyValueData(request.sendHeaders),
      headers: toKeyValueData(combinedHeaders(request.connectHeaders, request.sendHeaders)),
      body: { type: 'text', content: sendBody }
    }), sourceIdRef.current)
    // `request` carries the KV-table-owned connectHeaders/sendHeaders (their
    // own onRowsChange handlers push straight to ContextService); the other
    // fields are this view's own locally-tracked state.
  }, [request, url, stompVersion, subscriptions, sendDestination, sendBody, combinedHeaders])

  // Live frame stream for this request.
  useEffect(() => {
    const requestId = request.id
    const unsubMsg = window.restorm?.stomp.onMessage(({ requestId: rid, message: m }) => {
      if (rid !== requestId) return
      setLiveMessages((prev) => [...prev, toStompMessage(m)])
    })
    const unsubProg = window.restorm?.stomp.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') setLiveMessages([])
      if (status === 'completed' || status === 'cancelled' || status === 'error') {
        setHistoryRefreshKey((k) => k + 1)
      }
    })
    return () => { unsubMsg?.(); unsubProg?.() }
  }, [request.id])

  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setStompVersion = useCallback((value: '1.1' | '1.2'): void => {
    setStompVersionState(value)
    updateReactiveProperty(request, 'stompVersion', value)
  }, [request])
  const setSendDestination = useCallback((value: string): void => {
    setSendDestinationState(value)
    updateReactiveProperty(request, 'sendDestination', value)
  }, [request])
  const setSendBody = useCallback((value: string): void => {
    setSendBodyState(value)
    updateReactiveProperty(request, 'sendBody', value)
  }, [request])

  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  // Environment variables for scalar {{...}} fields so their autocomplete
  // offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

  const handleConnectHeadersChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'connectHeaders', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers',
      combinedHeaders(rows, request.sendHeaders).map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
      sourceIdRef.current
    )
  }, [request, combinedHeaders])
  const handleSendHeadersChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'sendHeaders', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers',
      combinedHeaders(request.connectHeaders, rows).map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
      sourceIdRef.current
    )
  }, [request, combinedHeaders])

  const setSubscriptions = useCallback((next: StompSubscription[]): void => {
    setSubscriptionsState(next)
    updateReactiveProperty(request, 'subscriptions', next)
  }, [request])
  const updateSubscription = useCallback((index: number, patch: Partial<StompSubscription>): void => {
    setSubscriptions(subscriptions.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }, [subscriptions, setSubscriptions])
  const addSubscription = useCallback((): void => {
    setSubscriptions([...subscriptions, { id: nextSubscriptionId(), destination: '', ackMode: 'auto' }])
  }, [subscriptions, setSubscriptions])
  const removeSubscription = useCallback((index: number): void => {
    setSubscriptions(subscriptions.filter((_, i) => i !== index))
  }, [subscriptions, setSubscriptions])

  const handleConnect = (): void => {
    if (isListening) return
    setLiveMessages([])
    setResponse(null)
    window.restorm?.stomp.connect({
      requestId: request.id,
      timeout: DEFAULT_WS_TIMEOUT_MS,
      ...(requestPath ? { requestPath } : {})
    })
      .then((res: StompExecutionResult) => {
        const stompResponse: StompResponse = {
          id: `resp_${Date.now()}`,
          type: 'stomp',
          requestId: request.id,
          requestUrl: res.requestUrl ?? '',
          connected: res.connected,
          messages: res.messages.map(toStompMessage),
          error: res.error,
          timings: res.timings
        }
        setResponse(stompResponse)
        setHistoryRefreshKey(prev => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('STOMP connection closed', { url: res.requestUrl, connected: res.connected })
      })
      .catch((err: unknown) => {
        logger.error('STOMP connection failed', { error: String(err) })
      })
  }
  const handleSend = (): void => {
    if (!isListening) return
    void window.restorm?.stomp.send(request.id, sendBody)
  }
  const handleDisconnect = (): void => {
    void window.restorm?.stomp.disconnect(request.id)
  }
  const handleAck = useCallback((message: StompMessage): void => {
    const ackId = message.headers['ack'] ?? message.headers['message-id']
    if (!ackId || !message.subscription) return
    void window.restorm?.stomp.ack(request.id, ackId, message.subscription)
  }, [request.id])
  const handleNack = useCallback((message: StompMessage): void => {
    const ackId = message.headers['ack'] ?? message.headers['message-id']
    if (!ackId || !message.subscription) return
    void window.restorm?.stomp.nack(request.id, ackId, message.subscription)
  }, [request.id])

  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }} data-testid="stomp-request-split-view">
      <Pane title={t('stomp.tabs.connect', 'Connect')} initialSize={0.34} minSize={100} data-testid="stomp-connect-pane">
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12 }}>{t('stomp.version', 'STOMP version')}:</span>
            <div style={{ width: 90 }}>
              <SelectBox
                id={`stomp-version-${request.id}`}
                className=""
                options={STOMP_VERSION_OPTIONS}
                selected={stompVersion === '1.1' ? 1 : 0}
                onDidSelect={(d: ISelectData) => { setStompVersion(d.index === 1 ? '1.1' : '1.2') }}
                data-testid="stomp-version-select"
              />
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <RestormKeyValueTable
              key={`connect-headers-${transportEpoch}`}
              ref={connectHeadersRef}
              variables={emptyVariables}
              helpers={handlebarsHelpers}
              initialRows={request.connectHeaders}
              onRowsChange={handleConnectHeadersChange}
              persistenceId={`stomp-connect-headers:${request.id}`}
              data-testid="stomp-connect-headers-table"
            />
          </div>
        </div>
      </Pane>
      <Pane title={t('stomp.tabs.subscriptions', 'Subscriptions')} initialSize={0.33} minSize={100} data-testid="stomp-subscriptions-pane">
        <ScrollableElement options={{ horizontal: 'hidden' }} style={{ width: '100%', height: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }} data-testid="stomp-subscriptions">
            {subscriptions.map((sub, i) => (
              <div
                key={i}
                data-testid={`stomp-subscription-row-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <div style={{ width: 80 }}>
                  <InputBox
                    value={sub.id}
                    onChange={(v) => { updateSubscription(i, { id: v }) }}
                    options={{ placeholder: 'sub-0', ariaLabel: t('stomp.subscriptionIdLabel', 'Subscription id') }}
                    data-testid={`stomp-subscription-id-${i}`}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <RestormVariableInputBox
                    value={sub.destination}
                    onChange={(v) => { updateSubscription(i, { destination: v }) }}
                    variables={envVariables}
                    helpers={handlebarsHelpers}
                    placeholder="/topic/example"
                    data-testid={`stomp-subscription-destination-${i}`}
                  />
                </div>
                <div style={{ width: 130 }}>
                  <SelectBox
                    id={`stomp-subscription-ackmode-${request.id}-${i}`}
                    className=""
                    options={ACK_MODE_OPTIONS.map((o) => ({ text: o.value, label: t(o.labelKey, o.fallback) }))}
                    selected={Math.max(0, ACK_MODE_OPTIONS.findIndex((o) => o.value === sub.ackMode))}
                    onDidSelect={(d: ISelectData) => {
                      const picked = ACK_MODE_OPTIONS[d.index]
                      if (picked) updateSubscription(i, { ackMode: picked.value })
                    }}
                    data-testid={`stomp-subscription-ackmode-${i}`}
                  />
                </div>
                <Button
                  secondary
                  small
                  icon="trash"
                  onClick={() => { removeSubscription(i) }}
                  options={{ ariaLabel: t('stomp.removeSubscription', 'Remove subscription'), title: t('stomp.removeSubscription', 'Remove subscription') }}
                  data-testid={`stomp-subscription-remove-${i}`}
                />
              </div>
            ))}
            <Button secondary icon="add" onClick={addSubscription} data-testid="stomp-add-subscription">
              {t('stomp.addSubscription', 'Add subscription')}
            </Button>
          </div>
        </ScrollableElement>
      </Pane>
      <Pane title={t('stomp.tabs.send', 'Send')} initialSize={0.33} minSize={120} data-testid="stomp-send-pane">
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12 }}>{t('stomp.sendDestination', 'Destination')}:</span>
            <div style={{ flex: 1 }}>
              <RestormVariableInputBox
                value={sendDestination}
                onChange={setSendDestination}
                variables={envVariables}
                helpers={handlebarsHelpers}
                placeholder="/topic/example"
                data-testid="stomp-send-destination-input"
              />
            </div>
          </div>
          <div style={{ flex: 1, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
            <CodeEditor
              key={`send-body-${transportEpoch}`}
              height="100%"
              language="json"
              value={sendBody}
              onChange={(v) => { setSendBody(v ?? '') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
              data-testid="stomp-send-body-editor"
            />
          </div>
          <div style={{ height: 130 }}>
            <RestormKeyValueTable
              key={`send-headers-${transportEpoch}`}
              ref={sendHeadersRef}
              variables={emptyVariables}
              helpers={handlebarsHelpers}
              initialRows={request.sendHeaders}
              onRowsChange={handleSendHeadersChange}
              persistenceId={`stomp-send-headers:${request.id}`}
              data-testid="stomp-send-headers-table"
            />
          </div>
        </div>
      </Pane>
    </SplitView>
  )

  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const ackModeFor = useCallback((subscriptionId: string | undefined): StompAckMode => {
    return subscriptions.find((s) => s.id === subscriptionId)?.ackMode ?? 'auto'
  }, [subscriptions])

  const renderFrames = useCallback((messages: StompMessage[]): React.ReactNode => {
    if (messages.length === 0) {
      return <div className="ws-chat-empty">{t('stomp.noMessages', 'No frames yet')}</div>
    }
    return (
      <ScrollableElement options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }} style={{ flex: 1, minHeight: 0 }}>
        <div className="ws-chat" data-testid="stomp-frames">
          {messages.map((msg, i) => {
            const isError = msg.command === 'ERROR'
            const ackable = msg.direction === 'received' && msg.command === 'MESSAGE' && ackModeFor(msg.subscription) !== 'auto'
            return (
              <div
                key={i}
                className={`ws-chat-bubble ${msg.direction === 'sent' ? 'sent' : 'received'}`}
                data-testid={`response-stream-frame-${i}`}
                data-direction={msg.direction}
                style={isError ? { borderColor: 'var(--testing-iconFailed)' } : undefined}
              >
                <span className="ws-chat-event">{msg.command}{msg.destination ? ` ${msg.destination}` : ''}</span>
                {msg.body}
                {ackable && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <Button secondary small icon="check" onClick={() => { handleAck(msg) }} options={{ title: t('stomp.ack', 'ACK'), ariaLabel: t('stomp.ack', 'ACK') }} data-testid={`stomp-ack-${i}`} />
                    <Button secondary small icon="close" onClick={() => { handleNack(msg) }} options={{ title: t('stomp.nack', 'NACK'), ariaLabel: t('stomp.nack', 'NACK') }} data-testid={`stomp-nack-${i}`} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollableElement>
    )
  }, [t, ackModeFor, handleAck, handleNack])

  const buildStompResponseView = useCallback((resp: StompResponse | null) => {
    if (!resp) return { infosContent: null, responseContent: null, jsonData: undefined }
    const infosContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: resp.connected ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {resp.connected ? t('stomp.connected', 'Connected') : t('stomp.disconnected', 'Disconnected')}
          </span>
        </div>
        {resp.timings.durationMs > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
            <span>{resp.timings.durationMs}ms</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Frames:</span>
          <span>{resp.messages.length}</span>
        </div>
        {resp.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>{resp.error}</div>
          </div>
        )}
      </div>
    )
    return { infosContent, responseContent: renderFrames(resp.messages), jsonData: undefined }
  }, [t, renderFrames])

  const liveResponse = useMemo<StompResponse | null>(() => {
    if (!isListening && liveMessages.length === 0) return response
    return {
      id: 'live',
      type: 'stomp',
      requestId: request.id,
      requestUrl: resolvedUrl || url,
      connected: isListening || (response?.connected ?? false),
      messages: liveMessages.length > 0 ? liveMessages : (response?.messages ?? []),
      timings: response?.timings ?? { startedAt: '', durationMs: 0 },
      ...(response?.error ? { error: response.error } : {})
    }
  }, [isListening, liveMessages, response, request.id, resolvedUrl, url])

  const { infosContent, responseContent } = useMemo(
    () => buildStompResponseView(liveResponse),
    [buildStompResponseView, liveResponse]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'stomp') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: StompResponse = {
      id: detail.guid,
      type: 'stomp',
      requestId: request.id,
      requestUrl: detail.response.requestUrl,
      connected: detail.response.connected,
      messages: detail.response.messages.map((msg) => ({
        direction: msg.direction,
        command: msg.command,
        subscription: msg.subscription,
        destination: msg.destination,
        headers: Object.fromEntries(msg.headers.map((h) => [h.key, h.value])),
        body: msg.body,
        timestamp: msg.timestamp
      })),
      timings: detail.response.timings,
      ...(detail.response.error ? { error: detail.response.error } : {})
    }
    return buildStompResponseView(historyResponse)
  }, [buildStompResponseView, request.id])

  const connectButton = (
    <BeamWrap active={isListening} size={22} borderWidth={1.5}>
      <Button
        icon={isListening ? 'debug-disconnect' : 'plug'}
        onClick={isListening ? handleDisconnect : handleConnect}
        {...(isListening ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
        options={{
          title: isListening ? t('stomp.disconnect', 'Disconnect') : t('stomp.connect', 'Connect'),
          ariaLabel: isListening ? t('stomp.disconnect', 'Disconnect') : t('stomp.connect', 'Connect')
        }}
        data-testid="stomp-connect-button"
      />
    </BeamWrap>
  )

  const urlSection = (
    <ControlGroup data-testid="stomp-url-section">
      <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
        <div style={{ flex: 1, minWidth: 0 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder="ws://localhost:61614"
            data-testid="stomp-url-input"
          />
        </div>
      </HeaderHoverTooltip>
      {!inWorkbenchTab && (
        <>
          <SendButtonEnvSwitcher>{connectButton}</SendButtonEnvSwitcher>
          <Button
            icon="send"
            onClick={handleSend}
            disabled={!isListening}
            emphasis={1}
            options={{ title: t('requestTab.send'), ariaLabel: t('requestTab.send') }}
            data-testid="stomp-send-button"
          />
        </>
      )}
    </ControlGroup>
  )

  const handleCloseHistoryModal = useCallback(() => { setHistoryModalOpen(false) }, [])

  useEffect(() => {
    const requestId = request.id
    const subscription = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_OPEN,
      (payload) => { if (payload.requestId === requestId) setHistoryModalOpen(true) }
    )
    return () => { subscription.unsubscribe() }
  }, [request.id])

  // Fixed action bar: connect/disconnect as the smaller companion, sending a
  // frame as the primary action — which stays disabled until connected.
  const actionToolbar = !inWorkbenchTab ? undefined : (
    <RequestActionToolbar>
      <RoundActionButton
        icon={isListening ? 'debug-disconnect' : 'plug'}
        onClick={isListening ? handleDisconnect : handleConnect}
        tone={isListening ? 'stop' : 'run'}
        {...(isListening || !envPaintColor ? {} : { color: envPaintColor })}
        {...(isListening || !envIcon ? {} : { envIcon })}
        envSwitch={!isListening}
        beamActive={isListening}
        ariaLabel={isListening ? t('stomp.disconnect', 'Disconnect') : t('stomp.connect', 'Connect')}
        data-testid="stomp-connect-button"
      />
      <RoundActionButton
            size="secondary"
        icon="send"
        onClick={handleSend}
        disabled={!isListening}
        {...(envPaintColor ? { color: envPaintColor } : {})}
        ariaLabel={t('requestTab.send')}
        data-testid="stomp-send-button"
      />
    </RequestActionToolbar>
  )

  return (
    <>
      <BaseRequestTabView
        requestId={request.id}
        urlSection={urlSection}
        {...(actionToolbar ? { actionToolbar } : {})}
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

/** Adapt a `window.restorm.stomp` wire message to the shared `StompMessage`
 * shape (identical fields — kept as a named conversion point in case the two
 * diverge later, mirroring `WebSocketRequestTabView`'s equivalent mapping). */
function toStompMessage(m: StompMessageItem): StompMessage {
  return {
    direction: m.direction,
    command: m.command,
    subscription: m.subscription,
    destination: m.destination,
    headers: m.headers,
    body: m.body,
    timestamp: m.timestamp
  }
}

export default StompRequestTabView
