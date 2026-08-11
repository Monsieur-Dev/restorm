import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  ControlGroup,
  SelectBox,
  eventBus,
  logger,
  getContrastColor,
  toasterService,
  useDebouncedCallback,
  useDebouncedValue,
  fieldDiffStyle,
  type ISelectData,
  type VariableDefinition,
  type Tab
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { GrpcRequest, GrpcResponse, GrpcCallType, GrpcTransport, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { GRPCExecutionResult } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { updateReactiveProperty, toKeyValuesFromHistory } from './requestTabViewUtils'
import { useApiDocumentationFromRequest } from '../../hooks/useApiDocumentationFromRequest'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { findOperationForRoute } from '../../../../shared/utils/findOperationForRoute'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { useIsGrpcListening } from '../../services/grpcListeningStore'
import { conflictSafeBoolean } from '../../services/conflictSafeLiveState'
import type { EntityFieldDiff } from '../../services/conflictFieldDiff'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { ResolvedUrlPreview } from '../common/ResolvedUrlPreview'
import { GrpcServerTabView } from './GrpcServerTabView'
import './WebSocketChat.css'

/** One streamed gRPC frame surfaced in the live chat view. */
interface GrpcFrameItem {
  direction: 'sent' | 'received'
  data: string
  timestamp: string
}

/** Call types that exchange a stream of frames (drive the Connect/Send/Disconnect UI). */
const STREAMING_CALL_TYPES: ReadonlySet<GrpcCallType> = new Set<GrpcCallType>(['server-stream', 'client-stream', 'bidirectional-stream'])
/** Call types where the client pushes request messages (the Send button shows). */
const CLIENT_WRITE_CALL_TYPES: ReadonlySet<GrpcCallType> = new Set<GrpcCallType>(['client-stream', 'bidirectional-stream'])

export interface GrpcRequestTabViewProps {
  request: GrpcRequest
  /** Conflict-resolution field-diff (AC#4) — `computeEntityFieldDiff`'s
   * result. Red-borders the URL input when `url` differs; coarse-borders
   * the message editor + metadata table when `requestConfig` differs.
   * Only ever set by `ConflictEntityPanel`; ignored in server mode (no
   * field-diff wiring there, matching the HTTP/OData server-mode
   * precedent). */
  conflictFieldDiff?: EntityFieldDiff
  /** Conflict resolution: restrict the request-side tab strip to these
   * ids (forwarded verbatim to `BaseRequestTabView`). */
  conflictVisibleTabIds?: string[]
  /** Conflict resolution: extra tabs appended to the strip (the contested
   * tag list), forwarded verbatim to `BaseRequestTabView`. */
  conflictExtraTabs?: Tab[]
  /** Preselects the tab holding the conflicting field (AC#5). */
  defaultActiveTabId?: string
  /** Fully-controlled request-side tab pair, forwarded verbatim to
   * `BaseRequestTabView`. The conflict panels use it to mirror the tab
   * selection across the three columns — any column's strip drives it
   * (`ReadOnlyOverlay` lets tab clicks through as navigation). */
  activeRequestTabId?: string
  onRequestTabChange?: (tabId: string) => void
  /** Hides the (non-editable, generated) Code Snippets tab (AC#5). */
  showCodeSnippets?: boolean
  /** Blanket conflict-mode safety rule (AC#2/#5, see
   * `conflictSafeLiveState.ts`): forces `isListening` to `false` and skips
   * the live message/progress stream subscription — a conflict panel is a
   * static historical snapshot, never a live call. */
  conflictMode?: boolean
}

export const GrpcRequestTabView: React.FC<GrpcRequestTabViewProps> = (props) => {
  // SERVER MODE: restorm HOSTS a local gRPC mock server (a wholly different
  // surface from the client request — Start/Stop + per-method mock editor), so
  // it renders its own component rather than threading branches through here.
  if (props.request.server === true) {
    return <GrpcServerTabView request={props.request} {...(props.conflictMode !== undefined ? { conflictMode: props.conflictMode } : {})} />
  }
  return <GrpcClientTabView {...props} />
}

/**
 * The transport a request tab drives.
 *
 * `GrpcRequest.transport` is required on the model, but this component reads a
 * request that crossed IPC as a PLAIN object — no class, so no field default
 * ran. Normalising here is boundary validation of untrusted input, the same job
 * `GrpcRequest.fromPlain` does on the main side; it is NOT a compatibility
 * shim for older documents.
 */
function normaliseTransport(value: GrpcTransport | undefined): GrpcTransport {
  return value ?? 'grpc'
}

const GrpcClientTabView: React.FC<GrpcRequestTabViewProps> = ({
  request,
  conflictFieldDiff,
  conflictVisibleTabIds,
  conflictExtraTabs,
  defaultActiveTabId,
  activeRequestTabId,
  onRequestTabChange,
  showCodeSnippets = true,
  conflictMode
}) => {
  const conflictFields = conflictFieldDiff?.fields
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  // See HTTPRequestTabView — `projectUuid` from the env context is
  // synchronously available, unlike `useFileService` which races the
  // `useState` lazy initializer.
  const { selectedEnvId, environments, envColor, projectUuid, envIcon, envPaintColor } = useEnvironmentContext()
  // The fixed bar anchors on the workbench tab, so it only exists there.
  const inWorkbenchTab = useIsInWorkbenchTab()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const { apiDocumentation, route } = useApiDocumentationFromRequest(request)
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [requestMessage, setRequestMessageState] = useState(request.requestMessage)
  const [callType, setCallTypeState] = useState<GrpcCallType>(request.callType)
  // Named `grpcTransport` (not `transport`) to avoid colliding with this file's
  // unrelated "transport-replaced" quick-config-reload vocabulary below.
  const [grpcTransport, setGrpcTransportState] = useState<GrpcTransport>(normaliseTransport(request.transport))
  const debouncedGrpcTransport = useDebouncedValue(grpcTransport, 250)
  const [isSending, setIsSending] = useState(false)
  const [isRefreshingReflection, setIsRefreshingReflection] = useState(false)
  const [response, setResponse] = useState<GrpcResponse | null>(null)
  const [liveMessages, setLiveMessages] = useState<GrpcFrameItem[]>([])
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const isStreaming = STREAMING_CALL_TYPES.has(callType)
  const showSendButton = CLIENT_WRITE_CALL_TYPES.has(callType)
  // The connection-listening beam (a streaming call is open) — drives the
  // Connect↔Disconnect toggle + the Send button's enabled state.
  const isListening = conflictSafeBoolean(useIsGrpcListening(request.id), conflictMode)

  // See HTTPRequestTabView for the contract.
  const [panelCollapsed, setPanelCollapsed] = useState<{ message: boolean; metadata: boolean }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      message: typeof seed['message'] === 'boolean' ? seed['message'] : false,
      metadata: typeof seed['metadata'] === 'boolean' ? seed['metadata'] : request.metadata.length === 0
    }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = { message: arr[0] ?? false, metadata: arr[1] ?? false }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'message', next.message)
      setRequestPanelCollapsed(projectUuid, request.id, 'metadata', next.metadata)
    }
  }, [projectUuid, request.id])

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  // Bumped on a quick-config load (or MCP update_request) so the metadata
  // KV table remounts and re-reads its `initialRows` from the now-mutated
  // request — the ECUI KeyValueTable seeds its rows from props once at mount.
  const [transportEpoch, setTransportEpoch] = useState(0)

  const metadataRef = useRef<KeyValueTableHandle | null>(null)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setRequestMessageState(request.requestMessage)
    setCallTypeState(request.callType)
    setGrpcTransportState(normaliseTransport(request.transport))
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
    setRequestMessageState(current.requestMessage)
    setCallTypeState(current.callType)
    setGrpcTransportState(normaliseTransport(current.transport))
    // Remount the metadata table so it re-reads the restored rows.
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current
    logger.debug('[GrpcRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = toKeyValueDataShared

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.metadata)
    })

    // Send full request data for URL + code snippets AND for execution: the
    // gRPC execution service reads service / method / call type / message from
    // fullData to build the dynamic client.
    void window.restorm?.context.updateFullRequestData(requestId, {
      url: currentRequest.url,
      method: currentRequest.callType,
      requestType: 'grpc',
      service: currentRequest.service,
      grpcMethod: currentRequest.method,
      callType: currentRequest.callType,
      transport: normaliseTransport(currentRequest.transport),
      requestMessage: currentRequest.requestMessage,
      // The execution service resolves the dynamic client from the request's own
      // proto (a reflected descriptor set, inline content, or a `.proto` path,
      // in that precedence order); omitting all three falls back to the bundled
      // grpcbin proto, so a custom-proto request fails with "service not found".
      protoDescriptorSet: currentRequest.protoDescriptorSet,
      protoContent: currentRequest.protoContent,
      protoPath: currentRequest.protoPath,
      headers: toKeyValueData(currentRequest.metadata),
      body: { type: 'text', content: currentRequest.requestMessage }
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
      logger.debug('[GrpcRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl?.()
      unsubSnippets?.()
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id, environments])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[GrpcRequestTabView] Environment changed, notifying ContextService', {
        requestId: request.id,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Notify ContextService when URL or request message changes
  useEffect(() => {
    const toKeyValueData = toKeyValueDataShared

    void window.restorm?.context.updateFullRequestData(request.id, {
      url,
      method: callType,
      requestType: 'grpc',
      service: request.service,
      grpcMethod: request.method,
      callType,
      // Debounced (≤250ms) so cycling the transport SelectBox doesn't flood
      // ContextService with a resolve/re-render per click.
      transport: debouncedGrpcTransport,
      requestMessage,
      // Keep the proto on every refresh — this effect re-runs on URL/message
      // edits (and on a "Refresh from reflection" descriptor-set update) and
      // would otherwise clobber the proto set on mount, leaving the execution
      // service to fall back to the bundled grpcbin proto.
      protoDescriptorSet: request.protoDescriptorSet,
      protoContent: request.protoContent,
      protoPath: request.protoPath,
      headers: toKeyValueData(request.metadata),
      body: { type: 'text', content: requestMessage }
    }, sourceIdRef.current)
  }, [request.id, request.service, request.method, callType, request.metadata, url, requestMessage, request.protoDescriptorSet, request.protoContent, request.protoPath, debouncedGrpcTransport])

  // Persist the settled (debounced) transport pick into the reactive request
  // object — mirrors the other `setXxx` writers but gated by the same
  // debounce window so a rapid multi-click settles into a single write.
  useEffect(() => {
    updateReactiveProperty(request, 'transport', debouncedGrpcTransport)
  }, [request, debouncedGrpcTransport])

  // Sync state changes to reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setRequestMessage = useCallback((value: string): void => {
    setRequestMessageState(value)
    updateReactiveProperty(request, 'requestMessage', value)
  }, [request])
  const setCallType = useCallback((value: GrpcCallType): void => {
    setCallTypeState(value)
    updateReactiveProperty(request, 'callType', value)
  }, [request])
  // Immediate local state (SelectBox reflects the pick right away); the
  // reactive-object write + downstream ContextService push are debounced via
  // `debouncedGrpcTransport` above.
  const setGrpcTransport = useCallback((value: GrpcTransport): void => {
    setGrpcTransportState(value)
  }, [])

  // Stream lifecycle + frames: subscribe to the gRPC progress + message streams
  // so a live streaming call (server / client / bidi) shows its frames as they
  // arrive, mirroring the WebSocket chat. Unary calls don't use these. Skipped
  // entirely in conflict mode (see `conflictSafeLiveState.ts`) — a static
  // historical snapshot must never pick up another tab's live frames.
  useEffect(() => {
    if (conflictMode) return undefined
    const requestId = request.id
    const unsubMsg = window.restorm?.grpc.onMessage((data) => {
      const { requestId: rid, message: m } = data as { requestId: string; message: GrpcFrameItem }
      if (rid !== requestId) return
      setLiveMessages((prev) => [...prev, { direction: m.direction, data: m.data, timestamp: m.timestamp }])
    })
    const unsubProg = window.restorm?.grpc.onProgress((data) => {
      const { requestId: rid, status } = data as { requestId: string; status: string }
      if (rid !== requestId) return
      if (status === 'started') setLiveMessages([])
      if (status === 'completed' || status === 'cancelled' || status === 'error') {
        setHistoryRefreshKey((k) => k + 1)
      }
    })
    return () => { unsubMsg?.(); unsubProg?.() }
  }, [request.id, conflictMode])
  
  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  // Environment variables for scalar {{...}} fields so their autocomplete
  // offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

  // Callback for metadata changes - notify both reactive object and ContextService
  const handleMetadataChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'metadata', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers', // Use 'headers' as the group name for consistency
      rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled })),
      sourceIdRef.current
    )
  }, [request])

  const handleSend = (): void => {
    if (isSending) return
    setIsSending(true)
    setResponse(null)
    
    window.restorm?.grpc.execute({
      requestId: request.id,
      ...(requestPath ? { requestPath } : {})
    })
      .then((res: GRPCExecutionResult) => {
        // Convert backend result to GrpcResponse format
        const grpcResponse: GrpcResponse = {
          id: `resp_${Date.now()}`,
          type: 'grpc',
          requestId: request.id,
          requestUrl: res.requestUrl ?? '',
          requestMethod: res.requestMethod ?? `${request.service}/${request.method}`,
          requestMessage,
          requestMetadata: request.metadata,
          statusCode: res.statusCode ?? 12,
          statusMessage: res.statusMessage ?? '',
          responseMessage: res.responseMessage ?? '',
          responseMetadata: [],
          error: res.error,
          timings: res.timings
        }
        setResponse(grpcResponse)
        setHistoryRefreshKey(prev => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('gRPC request completed', { method: res.requestMethod, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('gRPC request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }
  
  const handleCancel = (): void => {
    void window.restorm?.grpc.cancel(request.id)
  }

  // Streaming controls (server / client / bidi). Connect opens a long-lived call;
  // Send writes a request message (client / bidi); Disconnect half-closes it.
  const handleConnect = (): void => {
    if (conflictMode) return
    setLiveMessages([])
    void window.restorm?.grpc.connect({
      requestId: request.id,
      ...(requestPath ? { requestPath } : {})
    })
  }
  const handleDisconnect = (): void => {
    void window.restorm?.grpc.disconnect(request.id)
  }
  const handleStreamSend = (): void => {
    void window.restorm?.grpc.send(request.id, requestMessage)
  }

  // "Refresh from reflection": re-query the live server (offline caching —
  // AC keeps the request runnable from the last-fetched bundle otherwise)
  // and stamp the fresh descriptor set onto the request, mirroring how a
  // reflection import first populated `protoDescriptorSet`. Debounced +
  // gated on `isRefreshingReflection` so rapid clicks can't overlap.
  const handleRefreshFromReflection = useDebouncedCallback((): void => {
    if (isRefreshingReflection) return
    setIsRefreshingReflection(true)
    void window.restorm?.grpc.reflectQuery({ address: resolvedUrl || url })
      .then((result) => {
        if (!result.success || !result.protoDescriptorSet) {
          toasterService.push('app', {
            title: t('grpc.reflection.refreshFailed', 'gRPC reflection refresh failed'),
            body: result.unsupported
              ? t('grpc.reflection.unsupported', 'This server does not support gRPC reflection — import a .proto file instead.')
              : (result.error ?? t('grpc.reflection.unknownError', 'Unknown error')),
            durationMs: 10000
          })
          return
        }
        updateReactiveProperty(request, 'protoDescriptorSet', result.protoDescriptorSet)
      })
      .finally(() => { setIsRefreshingReflection(false) })
  }, 250)

  // Request content (SplitView with Message, Metadata)
  const requestContent = (
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="grpc-request-content-splitview"
      onCollapsedChange={handlePanelCollapsedChange}
    >
      <Pane title={t('grpc.tabs.message')} initialSize={0.7} minSize={150} collapsed={panelCollapsed.message} data-testid="grpc-message-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, ...fieldDiffStyle(!!conflictFields?.['requestConfig']) }}>
          <CodeEditor
            key={`message-${transportEpoch}`}
            height="100%"
            language="json"
            value={requestMessage}
            onChange={(v) => { setRequestMessage(v ?? '{}') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="grpc-request-message-editor"
          />
        </div>
      </Pane>
      <Pane
        title={t('grpc.tabs.metadata')}
        initialSize={0.3}
        minSize={100}
        collapsed={panelCollapsed.metadata}
        data-testid="grpc-metadata-pane"
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary
            small
            icon="add"
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            onClick={() => {
              if (collapsed) toggle()
              metadataRef.current?.addRow()
            }}
            data-testid="grpc-metadata-add-button"
          />
        )}
      >
        <div style={{ height: '100%', boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!conflictFields?.['requestConfig']) }}>
          <RestormKeyValueTable
            key={`metadata-${transportEpoch}`}
            ref={metadataRef}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            initialRows={request.metadata}
            onRowsChange={handleMetadataChange}
            persistenceId={`grpc-metadata:${request.id}`}
            data-testid="grpc-metadata-table"
            variableAware
          />
        </div>
      </Pane>
    </SplitView>
  )
  
  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const buildGrpcResponseView = useCallback((
    resp: GrpcResponse | null,
    meta?: { service?: string; method?: string; callType?: string }
  ) => {
    const infosContent = resp ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span
            data-testid="grpc-response-status"
            data-status-code={resp.statusCode}
            data-status-message={resp.statusMessage}
            style={{ color: resp.statusCode === 0 ? 'var(--testing-iconPassed)' : 'var(--editorWarning-foreground)' }}
          >
            {resp.statusCode} ({resp.statusCode === 0 ? 'OK' : 'Error'})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span>{resp.timings.durationMs}ms</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Service:</span>
          <span>{meta?.service ?? '-'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Method:</span>
          <span>{meta?.method ?? '-'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Call Type:</span>
          <span>{meta?.callType ?? '-'}</span>
        </div>
        {resp.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
            <div
              data-testid="grpc-response-error"
              style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}
            >
              {resp.error}
            </div>
          </div>
        )}
      </div>
    ) : null

    const responseContent = resp?.responseMessage ? (
      <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
        <CodeEditor
          height="100%"
          language="json"
          value={resp.responseMessage}
          options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
          data-testid="grpc-response-message-editor"
        />
      </div>
    ) : null

    const jsonData = (() => {
      if (!resp?.responseMessage) return undefined
      try {
        return JSON.parse(resp.responseMessage) as unknown
      } catch {
        return undefined
      }
    })()

    return { infosContent, responseContent, jsonData }
  }, [])

  const { infosContent, responseContent, jsonData } = useMemo(
    () => buildGrpcResponseView(response, { service: request.service, method: request.method, callType }),
    [buildGrpcResponseView, response, request.service, request.method, callType]
  )

  // Streaming frame view (server / client / bidi): each exchanged frame as a
  // direction-tagged bubble, reusing the WebSocket chat styling.
  const streamingChat = useMemo((): React.ReactNode => {
    if (liveMessages.length === 0) {
      return <div className="ws-chat-empty">{t('grpc.noFrames', 'No frames yet.')}</div>
    }
    return (
      <div className="ws-chat" data-testid="grpc-chat">
        {liveMessages.map((item, i) => (
          <div
            key={i}
            className={`ws-chat-bubble ${item.direction === 'sent' ? 'sent' : 'received'}`}
            data-testid="grpc-chat-bubble"
            data-direction={item.direction}
          >
            {item.data}
          </div>
        ))}
      </div>
    )
  }, [liveMessages, t])

  const effectiveResponseContent = isStreaming ? streamingChat : responseContent
  const effectiveInfosContent = isStreaming ? undefined : infosContent
  const effectiveJsonData = isStreaming ? undefined : jsonData
  const effectiveShowResponse = isStreaming ? (isListening || liveMessages.length > 0) : response !== null

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'grpc') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: GrpcResponse = {
      id: detail.guid,
      type: 'grpc',
      requestId: request.id,
      requestUrl: detail.response.requestUrl,
      requestMethod: detail.response.requestMethod,
      requestMessage: detail.response.requestMessage,
      requestMetadata: toKeyValuesFromHistory(detail.response.requestMetadata),
      statusCode: detail.response.statusCode,
      statusMessage: detail.response.statusMessage,
      responseMessage: detail.response.responseMessage,
      responseMetadata: toKeyValuesFromHistory(detail.response.responseMetadata),
      timings: detail.response.timings,
      ...(detail.response.error ? { error: detail.response.error } : {})
    }
    return buildGrpcResponseView(historyResponse, detail.requestMeta)
  }, [buildGrpcResponseView, request.id])
  
  // Call-type options for the selector (order = unary → server → client → bidi).
  // Memoised on `t` so it isn't rebuilt (+ handed a fresh array to SelectBox)
  // on every render during an active stream.
  const callTypeOptions = useMemo<{ value: GrpcCallType; label: string }[]>(() => [
    { value: 'unary', label: t('grpc.callType.unary', 'Unary') },
    { value: 'server-stream', label: t('grpc.callType.serverStream', 'Server streaming') },
    { value: 'client-stream', label: t('grpc.callType.clientStream', 'Client streaming') },
    { value: 'bidirectional-stream', label: t('grpc.callType.bidi', 'Bidirectional streaming') }
  ], [t])
  const callTypeIndex = Math.max(0, callTypeOptions.findIndex((o) => o.value === callType))

  // Wire-transport options for the toggle (order = native gRPC → gRPC-Web → Connect).
  const grpcTransportOptions = useMemo<{ value: GrpcTransport; label: string }[]>(() => [
    { value: 'grpc', label: t('grpc.transport.grpc', 'gRPC') },
    { value: 'grpc-web', label: t('grpc.transport.grpcWeb', 'gRPC-Web') },
    { value: 'connect', label: t('grpc.transport.connect', 'Connect') }
  ], [t])
  const grpcTransportIndex = Math.max(0, grpcTransportOptions.findIndex((o) => o.value === grpcTransport))
  // gRPC-Web and Connect both frame calls over plain HTTP/1.1 here, which the
  // spec (gRPC-Web) or this implementation (Connect, pending HTTP/2 duplex)
  // can't carry client/bidi streaming over — the Connect button is disabled
  // with an explanatory tooltip rather than silently failing on click.
  const duplexBlockedByTransport = grpcTransport !== 'grpc' && (callType === 'client-stream' || callType === 'bidirectional-stream')

  // URL section
  const urlSection = (
    <>
      <ControlGroup data-testid="grpc-url-section">
          <div
            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid transparent', ...fieldDiffStyle(!!conflictFields?.['url']) }}
            data-testid="url-container"
          >
            <RestormVariableInputBox
              value={url}
              onChange={setUrl}
              variables={envVariables}
              helpers={handlebarsHelpers}
              placeholder={t('grpc.urlPlaceholder')}
              data-testid="grpc-url-input"
            />
          </div>
        <div style={{ minWidth: 150 }}>
          <SelectBox
            id={`grpc-transport-${request.id}`}
            className=""
            options={grpcTransportOptions.map((o) => ({ text: o.value, label: o.label }))}
            selected={grpcTransportIndex}
            onDidSelect={(d: ISelectData) => {
              const picked = grpcTransportOptions[d.index]
              if (picked) setGrpcTransport(picked.value)
            }}
            data-testid="grpc-transport-select"
          />
        </div>
        <div style={{ minWidth: 150 }}>
          <SelectBox
            id={`grpc-call-type-${request.id}`}
            className=""
            options={callTypeOptions.map((o) => ({ text: o.value, label: o.label }))}
            selected={callTypeIndex}
            onDidSelect={(d: ISelectData) => {
              const picked = callTypeOptions[d.index]
              if (picked) setCallType(picked.value)
            }}
            data-testid="grpc-call-type-select"
          />
        </div>
        {!inWorkbenchTab && (
        <SendButtonEnvSwitcher>
          {isStreaming ? (
            <div style={{ display: 'flex', gap: 4 }}>
              <BeamWrap active={isListening} size={22} borderWidth={1.5}>
                <HeaderHoverTooltip
                  label={t('grpc.transport.streamingUnsupported', "This transport doesn't support client- or bidirectional-streaming over HTTP/1.1. Switch to the native gRPC transport instead.")}
                  suppressed={!duplexBlockedByTransport}
                  data-testid="grpc-connect-transport-tooltip"
                >
                  <Button
                    icon={isListening ? 'debug-disconnect' : 'plug'}
                    disabled={duplexBlockedByTransport || !!conflictMode}
                    onClick={isListening ? handleDisconnect : handleConnect}
                    {...(isListening ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
                    options={{
                      title: isListening ? t('grpc.disconnect', 'Disconnect') : t('grpc.connect', 'Connect'),
                      ariaLabel: isListening ? t('grpc.disconnect', 'Disconnect') : t('grpc.connect', 'Connect')
                    }}
                    data-testid="grpc-connect-button"
                  />
                </HeaderHoverTooltip>
              </BeamWrap>
              {/* Send appears only for client / bidi streaming (server-streaming has no
                  client writes) — and is enabled only while the call is open. */}
              {showSendButton && (
                <Button
                  icon="arrow-up"
                  disabled={!isListening}
                  onClick={handleStreamSend}
                  options={{ title: t('grpc.send'), ariaLabel: t('grpc.send') }}
                  data-testid="grpc-stream-send-button"
                />
              )}
            </div>
          ) : (
            <BeamWrap active={isSending} size={22} borderWidth={1.5}>
              <Button
                icon={isSending ? 'close' : 'send'}
                onClick={isSending ? handleCancel : handleSend}
                {...(isSending ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
                options={{
                  title: isSending ? t('cancel') : t('grpc.send'),
                  ariaLabel: isSending ? t('cancel') : t('grpc.send')
                }}
                data-testid="grpc-send-button"
              />
            </BeamWrap>
          )}
        </SendButtonEnvSwitcher>
        )}
      </ControlGroup>
      <ResolvedUrlPreview value={resolvedUrl} />
      <div style={{ fontSize: 12, color: 'var(--descriptionForeground)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{request.service}/{request.method}</span>
        <HeaderHoverTooltip label={t('grpc.reflection.refresh', 'Refresh from reflection')}>
          <Button
            small
            icon="sync"
            disabled={isRefreshingReflection}
            onClick={handleRefreshFromReflection}
            options={{ ariaLabel: t('grpc.reflection.refresh', 'Refresh from reflection') }}
            data-testid="grpc-reflection-refresh-button"
          />
        </HeaderHoverTooltip>
      </div>
    </>
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

  // Fixed action bar. Streaming calls are the connection family: connect /
  // disconnect, plus a stream-send that only client- and bidi-streaming expose
  // and that stays disabled until the call is open. Unary calls get one disc.
  const actionToolbar = !inWorkbenchTab ? undefined : (
    <RequestActionToolbar>
      {isStreaming ? (
        <>
          <RoundActionButton
            icon={isListening ? 'debug-disconnect' : 'plug'}
            onClick={isListening ? handleDisconnect : handleConnect}
            disabled={duplexBlockedByTransport || !!conflictMode}
            tone={isListening ? 'stop' : 'run'}
            {...(isListening || !envPaintColor ? {} : { color: envPaintColor })}
            {...(isListening || !envIcon ? {} : { envIcon })}
            envSwitch={!isListening}
            beamActive={isListening}
            ariaLabel={isListening ? t('grpc.disconnect', 'Disconnect') : t('grpc.connect', 'Connect')}
            data-testid="grpc-connect-button"
          />
          {showSendButton && (
            <RoundActionButton
            size="secondary"
              icon="arrow-up"
              onClick={handleStreamSend}
              disabled={!isListening}
              {...(envPaintColor ? { color: envPaintColor } : {})}
              ariaLabel={t('grpc.send')}
              data-testid="grpc-stream-send-button"
            />
          )}
        </>
      ) : (
        <RoundActionButton
          icon={isSending ? 'close' : 'send'}
          onClick={isSending ? handleCancel : handleSend}
          tone={isSending ? 'stop' : 'run'}
          {...(isSending || !envPaintColor ? {} : { color: envPaintColor })}
          {...(isSending || !envIcon ? {} : { envIcon })}
          envSwitch={!isSending}
          beamActive={isSending}
          ariaLabel={isSending ? t('cancel') : t('grpc.send')}
          data-testid="grpc-send-button"
        />
      )}
    </RequestActionToolbar>
  )

  return (
    <>
      <BaseRequestTabView
        {...(conflictVisibleTabIds ? { visibleRequestTabIds: conflictVisibleTabIds } : {})}
        {...(conflictExtraTabs ? { extraRequestTabs: conflictExtraTabs } : {})}
        requestId={request.id}
        urlSection={urlSection}
        {...(actionToolbar ? { actionToolbar } : {})}
        requestContent={requestContent}
        codeSnippetsContent={codeSnippetsContent}
        {...(apiDocumentation && route && findOperationForRoute(apiDocumentation, route) ? { docsContent: <DocumentationHost apiDocumentation={apiDocumentation} filters={[route]} /> } : {})}
        notes={request.notes}
        onNotesChange={(md): void => { updateReactiveProperty(request, 'notes', md) }}
        isLoading={isSending || (isStreaming && isListening)}
        showResponse={effectiveShowResponse}
        infosContent={effectiveInfosContent}
        responseContent={effectiveResponseContent}
        jsonData={effectiveJsonData}
        showCodeSnippets={showCodeSnippets}
        notesDiffers={!!conflictFields?.['notes']}
        {...(defaultActiveTabId !== undefined ? { defaultActiveTabId } : {})}
        {...(activeRequestTabId !== undefined ? { activeRequestTabId } : {})}
        {...(onRequestTabChange !== undefined ? { onRequestTabChange } : {})}
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
