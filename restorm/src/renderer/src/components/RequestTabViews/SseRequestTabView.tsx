import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  ScrollableElement,
  ControlGroup,
  eventBus,
  logger,
  getContrastColor,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { SseRequest, SseFrame, SseResponse, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { updateReactiveProperty } from './requestTabViewUtils'
import { useApiDocumentationFromRequest } from '../../hooks/useApiDocumentationFromRequest'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { findOperationForRoute } from '../../../../shared/utils/findOperationForRoute'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { useIsSseListening } from '../../services/sseListeningStore'
import { BeamWrap } from '../common/BeamWrap'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import './WebSocketChat.css'

/** Cap on how many frames render by default — a chatty stream (thousands of
 * heartbeats/frames over a long-lived connection) must not force React to
 * reconcile an unbounded DOM list. The full frame array is still kept (and
 * stored to history) — this only bounds what's PAINTED until the user opts
 * in via "Show all". */
const SSE_FRAME_DISPLAY_CAP = 500

export interface SseRequestTabViewProps {
  request: SseRequest
}

export const SseRequestTabView: React.FC<SseRequestTabViewProps> = ({ request }) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  const { selectedEnvId, environments, envColor } = useEnvironmentContext()
  const handlebarsHelpers = useHandlebarsHelpers()
  const { apiDocumentation, route } = useApiDocumentationFromRequest(request)
  const previousEnvIdRef = useRef<string | null>(null)
  const connectButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [response, setResponse] = useState<SseResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // Live frames for the current connection (appended as they arrive), so the
  // list updates in real time instead of only after the connection closes.
  const [liveFrames, setLiveFrames] = useState<SseFrame[]>([])
  // Whether this request currently holds an open connection (drives the
  // Connect↔Disconnect toggle and the listening beam).
  const isListening = useIsSseListening(request.id)
  // Which frame rows are expanded to their full data (by index into the
  // currently-displayed frame list).
  const [expandedFrames, setExpandedFrames] = useState<Set<number>>(new Set())
  // Opt-in past the SSE_FRAME_DISPLAY_CAP truncation (reset on every new
  // connect / history load, so a fresh run starts capped again).
  const [showAllFrames, setShowAllFrames] = useState(false)

  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  // Bumped on a quick-config load (or MCP update_request) so the headers KV
  // table remounts and re-reads its values from the now-mutated request.
  const [transportEpoch, setTransportEpoch] = useState(0)

  const headersRef = useRef<KeyValueTableHandle | null>(null)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setResponse(null)
    setLiveFrames([])
    setExpandedFrames(new Set())
    setShowAllFrames(false)
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
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current
    logger.debug('[SseRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = toKeyValueDataShared

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.headers)
    })

    void window.restorm?.context.updateFullRequestData(requestId, {
      url: currentRequest.url,
      requestType: 'sse',
      ...(currentRequest.lastEventId ? { lastEventId: currentRequest.lastEventId } : {}),
      headers: toKeyValueData(currentRequest.headers)
    }, sourceIdRef.current)

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

    void window.restorm?.context.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    void window.restorm?.context.getCodeSnippets(requestId).then((result) => {
      if (result) setBackendCodeSnippets(result.markdown)
    })

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[SseRequestTabView] Unregistering request from ContextService', { requestId })
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

  // Notify ContextService when the URL changes
  useEffect(() => {
    const toKeyValueData = toKeyValueDataShared
    void window.restorm?.context.updateFullRequestData(request.id, {
      url,
      requestType: 'sse',
      ...(request.lastEventId ? { lastEventId: request.lastEventId } : {}),
      headers: toKeyValueData(request.headers)
    }, sourceIdRef.current)
  }, [request, url])

  // Live frame + connection stream for this request: append frames as they
  // arrive (list updates in real time) and refresh history when it closes.
  useEffect(() => {
    const requestId = request.id
    const unsubMsg = window.restorm?.sse.onMessage(({ requestId: rid, message }) => {
      if (rid !== requestId) return
      setLiveFrames((prev) => [...prev, message])
    })
    const unsubProg = window.restorm?.sse.onProgress(({ requestId: rid, status }) => {
      if (rid !== requestId) return
      if (status === 'started') { setLiveFrames([]); setExpandedFrames(new Set()); setShowAllFrames(false) }
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

  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  // Environment variables for scalar {{...}} fields so their autocomplete
  // offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

  const handleHeadersChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'headers', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers',
      rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
      sourceIdRef.current
    )
  }, [request])

  // Connect = open the streaming GET and listen. It stays open (no timeout)
  // until the user disconnects; the promise resolves once the run is over
  // (disconnect, exhausted reconnect budget, or an unrecoverable error).
  const handleConnect = (): void => {
    if (isListening) return
    setLiveFrames([])
    setExpandedFrames(new Set())
    setShowAllFrames(false)
    setResponse(null)

    window.restorm?.sse.connect({ requestId: request.id })
      .then((res) => {
        const sseResponse: SseResponse = {
          id: `resp_${Date.now()}`,
          type: 'sse',
          requestId: request.id,
          requestUrl: res.requestUrl ?? '',
          connected: res.connected,
          frames: res.frames,
          error: res.error,
          timings: res.timings
        }
        setResponse(sseResponse)
        setHistoryRefreshKey(prev => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('SSE connection closed', { url: res.requestUrl, connected: res.connected })
      })
      .catch((err: unknown) => {
        logger.error('SSE connection failed', { error: String(err) })
      })
  }

  const handleDisconnect = (): void => {
    void window.restorm?.sse.disconnect(request.id)
  }

  const toggleFrameExpanded = useCallback((index: number): void => {
    setExpandedFrames((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  // Request content: headers only — SSE is receive-only, so there is no
  // message/body editor (unlike WebSocket's Message + Headers split).
  const requestContent = (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px 4px' }}>
        <span style={{ fontSize: 12 }}>{t('sse.headers')}</span>
        <div style={{ flex: 1 }} />
        <Button
          secondary
          small
          icon="add"
          options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
          onClick={() => { headersRef.current?.addRow() }}
          data-testid="sse-add-header-button"
        />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <RestormKeyValueTable
          key={`headers-${transportEpoch}`}
          ref={headersRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={handleHeadersChange}
          persistenceId={`sse-headers:${request.id}`}
          data-testid="sse-headers-table"
        />
      </div>
    </div>
  )

  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  // Streaming frames list: each SSE event is one row (timestamp, event type,
  // data preview) with a click-to-expand for the full payload. Mirrors the
  // WebSocket chat list's shell (same ScrollableElement + empty-state), but
  // the row shape is table-like rather than chat bubbles — there is no
  // sent/received distinction to render (SSE is receive-only).
  const renderFrameList = useCallback((frames: SseFrame[]): React.ReactNode => {
    if (frames.length === 0) {
      return <div className="ws-chat-empty">{t('sse.noFrames')}</div>
    }
    // Truncate to the most recent SSE_FRAME_DISPLAY_CAP frames by default —
    // the full array is still held (and stored to history); this only
    // bounds what's painted. Indices below are relative to the DISPLAYED
    // slice, matching `expandedFrames`'s own by-displayed-index contract.
    const truncated = !showAllFrames && frames.length > SSE_FRAME_DISPLAY_CAP
    const displayedFrames = truncated ? frames.slice(-SSE_FRAME_DISPLAY_CAP) : frames
    return (
      <ScrollableElement
        options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
        style={{ flex: 1, minHeight: 0 }}
      >
        <div className="ws-chat" data-testid="sse-frame-list">
          {truncated && (
            <div className="ws-chat-empty" style={{ padding: '4px 8px' }}>
              {t('sse.framesTruncated', { shown: displayedFrames.length, total: frames.length })}
              {' '}
              <Button
                secondary
                onClick={() => { setShowAllFrames(true) }}
                data-testid="sse-show-all-frames-button"
              >
                {t('sse.showAllFrames')}
              </Button>
            </div>
          )}
          {displayedFrames.map((frame, i) => {
            const expanded = expandedFrames.has(i)
            const preview = frame.data.length > 160 ? `${frame.data.slice(0, 160)}…` : frame.data
            return (
              <div
                key={i}
                className="ws-chat-bubble received"
                data-testid={`response-stream-frame-${i}`}
                onClick={() => { toggleFrameExpanded(i) }}
                style={{ cursor: 'pointer' }}
              >
                <span style={{ color: 'var(--foreground-muted)', fontSize: 11, marginRight: 8 }}>
                  {new Date(frame.timestamp).toLocaleTimeString()}
                </span>
                <span className="ws-chat-event">{frame.event}</span>
                <span data-testid={`response-stream-frame-data-${i}`}>
                  {expanded ? <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{frame.data}</pre> : preview}
                </span>
              </div>
            )
          })}
        </div>
      </ScrollableElement>
    )
  }, [t, expandedFrames, toggleFrameExpanded, showAllFrames])

  const buildSseResponseView = useCallback((resp: SseResponse | null) => {
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
          <span style={{ fontWeight: 600, minWidth: 100 }}>Frames:</span>
          <span>{resp.frames.length}</span>
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
    return { infosContent, responseContent: renderFrameList(resp.frames), jsonData: undefined }
  }, [t, renderFrameList])

  // Live view: prefer the streaming frames; fall back to the resolved response.
  const liveResponse = useMemo<SseResponse | null>(() => {
    if (!isListening && liveFrames.length === 0) return response
    return {
      id: 'live',
      type: 'sse',
      requestId: request.id,
      requestUrl: resolvedUrl || url,
      connected: isListening || (response?.connected ?? false),
      frames: liveFrames.length > 0 ? liveFrames : (response?.frames ?? []),
      timings: response?.timings ?? { startedAt: '', durationMs: 0 },
      ...(response?.error ? { error: response.error } : {})
    }
  }, [isListening, liveFrames, response, request.id, resolvedUrl, url])

  const { infosContent, responseContent } = useMemo(
    () => buildSseResponseView(liveResponse),
    [buildSseResponseView, liveResponse]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'sse') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: SseResponse = {
      id: detail.guid,
      type: 'sse',
      requestId: request.id,
      requestUrl: detail.response.requestUrl,
      connected: detail.response.connected,
      frames: detail.response.frames.map((frame) => ({
        event: frame.event,
        data: frame.data,
        id: frame.id,
        timestamp: frame.timestamp
      })),
      timings: detail.response.timings,
      ...(detail.response.error ? { error: detail.response.error } : {})
    }
    return buildSseResponseView(historyResponse)
  }, [buildSseResponseView, request.id])

  // Connect/disconnect toggle — no server mode for SSE (receive-only client).
  const connectButton = (
    <BeamWrap active={isListening} size={22} borderWidth={1.5}>
      <Button
        icon={isListening ? 'debug-disconnect' : 'plug'}
        onClick={isListening ? handleDisconnect : handleConnect}
        {...(isListening ? { emphasis: 0 } : connectButtonStyle ? { style: connectButtonStyle } : { emphasis: 1 })}
        options={{
          title: isListening ? t('websocket.disconnect') : t('websocket.connect'),
          ariaLabel: isListening ? t('websocket.disconnect') : t('websocket.connect')
        }}
        data-testid="sse-connect-button"
      />
    </BeamWrap>
  )

  const urlSection = (
    <ControlGroup data-testid="sse-url-section">
      <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
        <div style={{ flex: 1, minWidth: 0 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder={t('sse.urlPlaceholder')}
            data-testid="sse-request-url-input"
          />
        </div>
      </HeaderHoverTooltip>
      <SendButtonEnvSwitcher>{connectButton}</SendButtonEnvSwitcher>
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
        {...(apiDocumentation && route && findOperationForRoute(apiDocumentation, route) ? { docsContent: <DocumentationHost apiDocumentation={apiDocumentation} filters={[route]} /> } : {})}
        notes={request.notes}
        onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
        isLoading={false}
        showResponse={isListening || liveFrames.length > 0 || response !== null}
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

export default SseRequestTabView
