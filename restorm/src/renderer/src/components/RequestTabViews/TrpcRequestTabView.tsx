import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import { useAuthRequestResolver } from '../../contexts/authRequestResolverContext'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../../../shared/config/constants'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  ControlGroup,
  SelectBox,
  Toggle,
  eventBus,
  logger,
  getContrastColor,
  type ISelectData,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import type { TrpcRequest, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { TrpcExecutionResult } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { updateReactiveProperty } from './requestTabViewUtils'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

const urlInputWrapperStyle: React.CSSProperties = { flex: 1, minWidth: 0 }
const procedureInputWrapperStyle: React.CSSProperties = { width: 220, flexShrink: 0 }
const kindSelectWrapperStyle: React.CSSProperties = { minWidth: 130 }

export interface TrpcRequestTabViewProps {
  request: TrpcRequest
}

/** Locally-owned view of a tRPC response — mirrors `ODataResponseViewData`
 * (no shared `Response` model exists for HTTP-shaped protocols outside
 * GraphQL). `data` is the unwrapped `result.data` payload; `rawEnvelope` is
 * the full `[{ result: { data } }]` wire body, kept for the "Show raw
 * envelope" toggle. */
interface TrpcResponseViewData {
  statusCode: number
  statusText: string
  requestUrl: string
  durationMs: number
  data?: unknown
  rawEnvelope?: string | undefined
  headers?: Record<string, string | string[]> | undefined
  error?: string
}

export const TrpcRequestTabView: React.FC<TrpcRequestTabViewProps> = ({
  request
}) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  const { selectedEnvId, environments, envColor, projectUuid, envIcon, envPaintColor } = useEnvironmentContext()
  // The fixed bar anchors on the workbench tab, so it only exists there.
  const inWorkbenchTab = useIsInWorkbenchTab()
  const handlebarsHelpers = useHandlebarsHelpers()
  const resolveAuthRequest = useAuthRequestResolver()
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [procedure, setProcedureState] = useState(request.procedure)
  const [input, setInputState] = useState(request.input ?? '')
  const [kind, setKindState] = useState<'query' | 'mutation'>(request.kind)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<TrpcResponseViewData | null>(null)
  const [showRawEnvelope, setShowRawEnvelope] = useState(false)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const [panelCollapsed, setPanelCollapsed] = useState<{
    input: boolean
    headers: boolean
  }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      input: typeof seed['input'] === 'boolean' ? seed['input'] : false,
      headers: typeof seed['headers'] === 'boolean' ? seed['headers'] : request.headers.length === 0
    }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = {
      input: arr[0] ?? false,
      headers: arr[1] ?? false
    }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'input', next.input)
      setRequestPanelCollapsed(projectUuid, request.id, 'headers', next.headers)
    }
  }, [projectUuid, request.id])

  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  const headersRef = useRef<KeyValueTableHandle | null>(null)
  // Bumped on a transport replacement (quick-config Load / MCP update_request)
  // so the headers KV table + input editor remount.
  const [transportEpoch, setTransportEpoch] = useState(0)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setProcedureState(request.procedure)
    setInputState(request.input ?? '')
    setKindState(request.kind)
    setResponse(null)
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
    setProcedureState(current.procedure)
    setInputState(current.input ?? '')
    setKindState(current.kind)
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current

    const restormContext = window.restorm?.context
    if (!restormContext) {
      return
    }

    logger.debug('[TrpcRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = toKeyValueDataShared

    void restormContext.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.headers)
    })

    // Send full request data for URL and code snippet calculation. `url`
    // carries the BASE server url; URLResolver appends `/<procedure>`
    // (+`?input=` for a query) as a final step.
    void restormContext.updateFullRequestData(requestId, {
      url: currentRequest.url,
      requestType: 'trpc',
      headers: toKeyValueData(currentRequest.headers),
      trpcProcedure: currentRequest.procedure,
      trpcInput: currentRequest.input,
      trpcKind: currentRequest.kind
    }, sourceIdRef.current)

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

    void restormContext.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    void restormContext.getCodeSnippets(requestId).then((result) => {
      if (result) setBackendCodeSnippets(result.markdown)
    })

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[TrpcRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl()
      unsubSnippets()
      void restormContext.unregisterRequest(requestId)
    }
  }, [request.id, environments])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[TrpcRequestTabView] Environment changed, notifying ContextService', {
        requestId: request.id,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Notify ContextService when url/procedure/input/kind change — debounced
  // so rapid keystrokes coalesce into a single IPC call (250 ms per the
  // protocol playbook's debounce rule).
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
      requestType: 'trpc' as const,
      headers: toKeyValueData(request.headers),
      trpcProcedure: procedure,
      trpcInput: input,
      trpcKind: kind
    }
    latestPayloadRef.current = payload

    if (updateDebounceRef.current !== null) {
      clearTimeout(updateDebounceRef.current)
    }
    updateDebounceRef.current = setTimeout(() => {
      updateDebounceRef.current = null
      void window.restorm?.context.updateFullRequestData(reqId, payload, source)
    }, 250)

    return () => {
      if (updateDebounceRef.current !== null) {
        clearTimeout(updateDebounceRef.current)
        updateDebounceRef.current = null
      }
    }
  }, [request.id, request.headers, url, procedure, input, kind])

  // Sync state changes to the reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setProcedure = useCallback((value: string): void => {
    setProcedureState(value)
    updateReactiveProperty(request, 'procedure', value)
  }, [request])
  const setInput = useCallback((value: string): void => {
    setInputState(value)
    updateReactiveProperty(request, 'input', value)
  }, [request])
  const setKind = useCallback((value: 'query' | 'mutation'): void => {
    setKindState(value)
    updateReactiveProperty(request, 'kind', value)
  }, [request])

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
    // Flush the debounced procedure/input/kind push so the main process
    // executes the current values, not the pre-debounce ones.
    flushUpdate()
    setIsSending(true)
    setResponse(null)

    const authAttachedId = request.authenticationRequestId
    const attachedAuth = authAttachedId ? resolveAuthRequest(authAttachedId) : null
    const authPlain = attachedAuth
      ? attachedAuth.toPlainObject?.() ?? attachedAuth
      : undefined
    // JSON round-trip flattens any residual class instances / reactive Proxy
    // wrappers — structured clone over IPC rejects those directly.
    const authRequestPayload = authPlain !== undefined
      ? JSON.parse(JSON.stringify(authPlain)) as unknown
      : undefined

    window.restorm?.trpc.execute({
      requestId: request.id,
      timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      ...(authRequestPayload ? { authRequest: authRequestPayload } : {})
    })
      .then((res: TrpcExecutionResult) => {
        setResponse({
          statusCode: res.statusCode ?? 0,
          statusText: res.statusText ?? '',
          requestUrl: res.requestUrl ?? '',
          durationMs: res.timings.durationMs,
          data: res.data,
          rawEnvelope: res.rawBody,
          headers: res.headers,
          ...(res.error ? { error: res.error } : {})
        })
        setHistoryRefreshKey(prev => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('tRPC request completed', { url: res.requestUrl, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('tRPC request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }

  const handleCancel = (): void => {
    void window.restorm?.trpc.cancel(request.id)
  }

  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const buildTrpcResponseView = useCallback((resp: TrpcResponseViewData | null, rawToggle: boolean) => {
    const infosContent = resp ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span style={{ color: resp.statusCode >= 200 && resp.statusCode < 300 ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
            {resp.statusCode} {resp.statusText}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span>{resp.durationMs}ms</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>URL:</span>
          <span style={{ wordBreak: 'break-all' }}>{resp.requestUrl}</span>
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

    const bodyToShow = resp
      ? (rawToggle ? (resp.rawEnvelope ?? '') : JSON.stringify(resp.error ? { error: resp.error } : resp.data ?? null, null, 2))
      : null
    const responseContent = resp && (resp.data !== undefined || resp.rawEnvelope || resp.error) ? (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <Toggle checked={rawToggle} onChange={setShowRawEnvelope} data-testid="trpc-response-raw-envelope-toggle" />
            {t('trpc.showRawEnvelope')}
          </label>
        </div>
        <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="json"
            value={bodyToShow ?? ''}
            options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
            data-testid="trpc-response-editor"
          />
        </div>
      </div>
    ) : null

    return { infosContent, responseContent, jsonData: resp ? (resp.error ? { error: resp.error } : resp.data) : undefined }
  }, [t])

  const { infosContent, responseContent } = useMemo(
    () => buildTrpcResponseView(response, showRawEnvelope),
    [buildTrpcResponseView, response, showRawEnvelope]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'trpc') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: TrpcResponseViewData = {
      statusCode: detail.response.statusCode,
      statusText: detail.response.statusText,
      requestUrl: detail.response.requestUrl,
      durationMs: detail.response.timings.durationMs,
      data: detail.response.data,
      rawEnvelope: detail.response.rawEnvelope,
      headers: undefined,
      ...(detail.response.error ? { error: detail.response.error } : {})
    }
    return buildTrpcResponseView(historyResponse, false)
  }, [buildTrpcResponseView])

  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])

  // Environment variables for scalar {{...}} fields (URL, procedure, ...) so
  // their autocomplete offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

  // Request content: SplitView with Input (JSON, Monaco) + Headers
  const requestContent = (
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="trpc-request-splitview"
      onCollapsedChange={handlePanelCollapsedChange}
    >
      <Pane title={t('trpc.tabs.body')} initialSize={0.7} minSize={150} collapsed={panelCollapsed.input} data-testid="trpc-input-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            key={`input-${transportEpoch}`}
            height="100%"
            language="json"
            value={input}
            onChange={(v) => { setInput(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="trpc-request-input-editor"
          />
        </div>
      </Pane>
      <Pane
        title={t('trpc.tabs.headers')}
        initialSize={0.3}
        minSize={100}
        collapsed={panelCollapsed.headers}
        data-testid="trpc-headers-pane"
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
            data-testid="trpc-add-header-button"
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
          persistenceId={`trpc-headers:${request.id}`}
          data-testid="trpc-headers-table"
        />
      </Pane>
    </SplitView>
  )

  const kindOptions = useMemo(() => [
    { text: t('trpc.kindQuery') },
    { text: t('trpc.kindMutation') }
  ], [t])

  // URL section: base URL + procedure path + kind selector + send/cancel
  const urlSection = (
    <ControlGroup data-testid="trpc-url-section">
      <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
        <div style={urlInputWrapperStyle} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder={t('trpc.urlPlaceholder')}
            data-testid="trpc-url-input"
          />
        </div>
      </HeaderHoverTooltip>
      <div style={procedureInputWrapperStyle}>
        <RestormVariableInputBox
          value={procedure}
          onChange={setProcedure}
          variables={envVariables}
          helpers={handlebarsHelpers}
          placeholder={t('trpc.procedurePlaceholder')}
          data-testid="trpc-request-procedure-input"
        />
      </div>
      <div style={kindSelectWrapperStyle} data-testid="trpc-kind-select-host">
        <SelectBox
          id={`trpc-kind-${request.id}`}
          className=""
          options={kindOptions}
          selected={kind === 'mutation' ? 1 : 0}
          onDidSelect={(d: ISelectData) => {
            setKind(d.index === 1 ? 'mutation' : 'query')
          }}
          selectBoxOptions={{ ariaLabel: t('trpc.kindSelectLabel') }}
          data-testid="trpc-kind-select"
        />
      </div>
  {!inWorkbenchTab && (
      <SendButtonEnvSwitcher>
        <BeamWrap active={isSending} size={22} borderWidth={1.5}>
          <Button
            icon={isSending ? 'close' : 'send'}
            onClick={isSending ? handleCancel : handleSend}
            {...(isSending ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
            options={{
              title: isSending ? t('cancel') : t('trpc.send'),
              ariaLabel: isSending ? t('cancel') : t('trpc.send')
            }}
            data-testid="trpc-action-button"
          />
        </BeamWrap>
      </SendButtonEnvSwitcher>
  )}
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

  // Fixed action bar, anchored top-right of the workbench tab: opening the
  // response panel must never move the button out from under the pointer.
  const actionToolbar = !inWorkbenchTab ? undefined : (
    <RequestActionToolbar>
      <RoundActionButton
        icon={isSending ? 'close' : 'send'}
        onClick={isSending ? handleCancel : handleSend}
        tone={isSending ? 'stop' : 'run'}
        {...(isSending || !envPaintColor ? {} : { color: envPaintColor })}
        {...(isSending || !envIcon ? {} : { envIcon })}
        envSwitch={!isSending}
        beamActive={isSending}
        ariaLabel={isSending ? t('cancel') : t('trpc.send')}
        data-testid="trpc-action-button"
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
        isLoading={isSending}
        showResponse={response !== null}
        infosContent={infosContent}
        responseContent={responseContent}
        jsonData={response ? (response.error ? { error: response.error } : response.data) : undefined}
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

export default TrpcRequestTabView
