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
  SplitView,
  Pane,
  ControlGroup,
  Toggle,
  eventBus,
  logger,
  getContrastColor,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { JsonRpcRequest, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { JsonRpcExecutionResult } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { updateReactiveProperty } from './requestTabViewUtils'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { cloneForEventBus } from '../../utils/cloneForEventBus'

const urlInputWrapperStyle: React.CSSProperties = { flex: 2, minWidth: 0 }
const methodInputWrapperStyle: React.CSSProperties = { flex: 1, minWidth: 120 }
const idInputWrapperStyle: React.CSSProperties = { flex: 1, minWidth: 100 }

export interface JsonRpcRequestTabViewProps {
  request: JsonRpcRequest
}

/** One resolved JSON-RPC response, shaped for the response-panel builder —
 * either a successful `result`, an `error`, or a notification acknowledgement. */
interface JsonRpcResponseView {
  requestUrl: string
  statusCode: number
  durationMs: number
  notificationSent?: boolean
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  transportError?: string
}

export const JsonRpcRequestTabView: React.FC<JsonRpcRequestTabViewProps> = ({ request }) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  const { selectedEnvId, environments, envColor, projectUuid, envIcon, envPaintColor } = useEnvironmentContext()
  // The fixed bar anchors on the workbench tab, so it only exists there.
  const inWorkbenchTab = useIsInWorkbenchTab()
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [method, setMethodState] = useState(request.method)
  const [params, setParamsState] = useState(request.params)
  const [rpcId, setRpcIdState] = useState(request.rpcId || '')
  const [notificationMode, setNotificationModeState] = useState(request.notificationMode === true)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<JsonRpcResponseView | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const [panelCollapsed, setPanelCollapsed] = useState<{ params: boolean; headers: boolean }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      params: typeof seed['params'] === 'boolean' ? seed['params'] : false,
      headers: typeof seed['headers'] === 'boolean' ? seed['headers'] : request.headers.length === 0
    }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = { params: arr[0] ?? false, headers: arr[1] ?? false }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'params', next.params)
      setRequestPanelCollapsed(projectUuid, request.id, 'headers', next.headers)
    }
  }, [projectUuid, request.id])

  const sourceIdRef = useRef<string>(crypto.randomUUID())
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const headersRef = useRef<KeyValueTableHandle | null>(null)
  const [transportEpoch, setTransportEpoch] = useState(0)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setMethodState(request.method)
    setParamsState(request.params)
    setRpcIdState(request.rpcId || '')
    setNotificationModeState(request.notificationMode === true)
    setResponse(null)
  }, [request])
  useRequestReset(request, handleRequestReset)

  const requestRef = useRef(request)
  const selectedEnvIdRef = useRef(selectedEnvId)
  useEffect(() => { requestRef.current = request }, [request])
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])

  const handleTransportReplaced = useCallback(() => {
    const current = requestRef.current
    setUrlState(current.url)
    setMethodState(current.method)
    setParamsState(current.params)
    setRpcIdState(current.rpcId || '')
    setNotificationModeState(current.notificationMode === true)
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  // Register request with ContextService on mount, unregister on unmount —
  // mirrors GraphQLRequestTabView / ODataRequestTabView.
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current
    const restormContext = window.restorm?.context
    if (!restormContext) return

    logger.debug('[JsonRpcRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    void restormContext.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueDataShared(currentRequest.headers)
    })
    void restormContext.updateFullRequestData(requestId, cloneForEventBus({
      url: currentRequest.url,
      method: 'POST',
      requestType: 'jsonrpc',
      headers: toKeyValueDataShared(currentRequest.headers),
      jsonRpcMethod: currentRequest.method,
      jsonRpcParams: currentRequest.params,
      jsonRpcId: currentRequest.rpcId || '',
      jsonRpcNotificationMode: currentRequest.notificationMode === true
    }), sourceIdRef.current)

    const unsubUrl = restormContext.onUrlResolved((result) => {
      if (result.requestId === requestId) setResolvedUrl(result.resolvedUrl)
    })
    const unsubSnippets = restormContext.onCodeSnippetsUpdated((result) => {
      if (result.requestId === requestId) setBackendCodeSnippets(result.markdown)
    })
    void restormContext.getResolvedUrl(requestId).then((result) => { if (result) setResolvedUrl(result.resolvedUrl) })
    void restormContext.getCodeSnippets(requestId).then((result) => { if (result) setBackendCodeSnippets(result.markdown) })

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[JsonRpcRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl()
      unsubSnippets()
      void restormContext.unregisterRequest(requestId)
    }
  }, [request.id, environments])

  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Debounced push to ContextService — 250 ms per the protocol playbook's
  // input-debouncing rule, so rapid typing coalesces into a single IPC call.
  const updateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestPayloadRef = useRef<Parameters<NonNullable<typeof window.restorm>['context']['updateFullRequestData']>[1] | null>(null)

  const flushUpdate = useCallback((): void => {
    if (updateDebounceRef.current !== null) {
      clearTimeout(updateDebounceRef.current)
      updateDebounceRef.current = null
    }
    const payload = latestPayloadRef.current
    if (payload) void window.restorm?.context.updateFullRequestData(request.id, cloneForEventBus(payload), sourceIdRef.current)
  }, [request.id])

  useEffect(() => {
    const reqId = request.id
    const source = sourceIdRef.current
    const payload = {
      url,
      method: 'POST' as const,
      requestType: 'jsonrpc' as const,
      headers: toKeyValueDataShared(request.headers),
      jsonRpcMethod: method,
      jsonRpcParams: params,
      jsonRpcId: rpcId,
      jsonRpcNotificationMode: notificationMode
    }
    latestPayloadRef.current = payload
    if (updateDebounceRef.current !== null) clearTimeout(updateDebounceRef.current)
    updateDebounceRef.current = setTimeout(() => {
      updateDebounceRef.current = null
      void window.restorm?.context.updateFullRequestData(reqId, cloneForEventBus(payload), source)
    }, 250)
    return () => {
      if (updateDebounceRef.current !== null) {
        clearTimeout(updateDebounceRef.current)
        updateDebounceRef.current = null
      }
    }
  }, [request.id, request.headers, url, method, params, rpcId, notificationMode])

  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setMethod = useCallback((value: string): void => {
    setMethodState(value)
    updateReactiveProperty(request, 'method', value)
  }, [request])
  const setParams = useCallback((value: string): void => {
    setParamsState(value)
    updateReactiveProperty(request, 'params', value)
  }, [request])
  const setRpcId = useCallback((value: string): void => {
    setRpcIdState(value)
    updateReactiveProperty(request, 'rpcId', value)
  }, [request])
  const setNotificationMode = useCallback((value: boolean): void => {
    setNotificationModeState(value)
    updateReactiveProperty(request, 'notificationMode', value)
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
    flushUpdate()
    setIsSending(true)
    setResponse(null)

    window.restorm?.jsonrpc.execute({ requestId: request.id })
      .then((res: JsonRpcExecutionResult) => {
        setResponse({
          requestUrl: res.requestUrl ?? '',
          statusCode: res.statusCode ?? 0,
          durationMs: res.timings.durationMs,
          ...(res.notificationSent !== undefined ? { notificationSent: res.notificationSent } : {}),
          ...(res.result !== undefined ? { result: res.result } : {}),
          ...(res.error !== undefined ? { error: res.error } : {}),
          ...(res.transportError !== undefined ? { transportError: res.transportError } : {})
        })
        setHistoryRefreshKey(prev => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('JSON-RPC call completed', { url: res.requestUrl, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('JSON-RPC call failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }

  const handleCancel = (): void => {
    void window.restorm?.jsonrpc.cancel(request.id)
  }

  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  // Environment variables for scalar {{...}} fields so their autocomplete
  // offers env vars alongside the helper functions.
  const envVariables = useEnvVariables(request.id)

  const requestContent = (
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="jsonrpc-request-splitview"
      onCollapsedChange={handlePanelCollapsedChange}
    >
      <Pane title={t('jsonrpc.tabs.params', 'Params')} initialSize={0.7} minSize={150} collapsed={panelCollapsed.params} data-testid="jsonrpc-params-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            key={`params-${transportEpoch}`}
            height="100%"
            language="json"
            value={params}
            onChange={(v) => { setParams(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="jsonrpc-params-editor"
          />
        </div>
      </Pane>
      <Pane
        title={t('jsonrpc.tabs.headers', 'Headers')}
        initialSize={0.3}
        minSize={100}
        collapsed={panelCollapsed.headers}
        data-testid="jsonrpc-headers-pane"
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
            data-testid="jsonrpc-add-header-button"
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
          persistenceId={`jsonrpc-headers:${request.id}`}
          data-testid="jsonrpc-headers-table"
        />
      </Pane>
    </SplitView>
  )

  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const buildJsonRpcResponseView = useCallback((resp: JsonRpcResponseView | null) => {
    if (!resp) return { infosContent: undefined, responseContent: undefined, jsonData: undefined }

    const infosContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }} data-testid="jsonrpc-response-infos">
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span
            style={{ color: resp.error || resp.transportError ? 'var(--testing-iconFailed)' : 'var(--testing-iconPassed)' }}
            data-testid="jsonrpc-response-status"
            data-status-code={resp.statusCode}
          >
            {resp.notificationSent ? t('jsonrpc.response.notificationSent', 'Notification sent') : resp.statusCode}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span data-testid="jsonrpc-response-duration">{resp.durationMs}ms</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>URL:</span>
          <span style={{ wordBreak: 'break-all' }}>{resp.requestUrl}</span>
        </div>
        {resp.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }} data-testid="jsonrpc-response-error">
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>
              {t('jsonrpc.response.errorLabel', 'JSON-RPC error {{code}}:', { code: resp.error.code })}
            </span>
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
              {resp.error.message}
            </div>
          </div>
        )}
      </div>
    )

    const bodyValue = resp.notificationSent
      ? ''
      : JSON.stringify(
          resp.transportError
            ? { error: resp.transportError }
            : resp.error !== undefined
              ? { error: resp.error }
              : { result: resp.result },
          null,
          2
        )
    const responseContent = resp.notificationSent ? (
      <div style={{ padding: 12, fontSize: 12 }} data-testid="jsonrpc-response-notification">
        {t('jsonrpc.response.notificationSent', 'Notification sent')}
      </div>
    ) : (
      <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }} data-testid="jsonrpc-response-body">
        <CodeEditor
          height="100%"
          language="json"
          value={bodyValue}
          options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
          data-testid="jsonrpc-response-editor"
        />
      </div>
    )

    return {
      infosContent,
      responseContent,
      jsonData: resp.notificationSent ? undefined : (resp.error !== undefined ? { error: resp.error } : { result: resp.result })
    }
  }, [t])

  const { infosContent, responseContent, jsonData } = useMemo(
    () => buildJsonRpcResponseView(response),
    [buildJsonRpcResponseView, response]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'jsonrpc') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: JsonRpcResponseView = {
      requestUrl: detail.response.requestUrl,
      statusCode: detail.response.statusCode,
      durationMs: detail.response.timings.durationMs,
      ...(detail.response.notificationSent !== undefined ? { notificationSent: detail.response.notificationSent } : {}),
      ...(detail.response.result !== undefined ? { result: detail.response.result } : {}),
      ...(detail.response.rpcError !== undefined ? { error: detail.response.rpcError } : {}),
      ...(detail.response.error !== undefined ? { transportError: detail.response.error } : {})
    }
    return buildJsonRpcResponseView(historyResponse)
  }, [buildJsonRpcResponseView])

  const urlSection = (
    <ControlGroup data-testid="jsonrpc-url-section">
      <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
        <div style={urlInputWrapperStyle} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder={t('jsonrpc.urlPlaceholder', 'JSON-RPC endpoint URL')}
            data-testid="jsonrpc-request-url-input"
          />
        </div>
      </HeaderHoverTooltip>
      <div style={methodInputWrapperStyle}>
        <RestormVariableInputBox
          value={method}
          onChange={setMethod}
          variables={envVariables}
          helpers={handlebarsHelpers}
          placeholder={t('jsonrpc.methodPlaceholder', 'method')}
          data-testid="jsonrpc-request-method-input"
        />
      </div>
      {!notificationMode && (
        <div style={idInputWrapperStyle}>
          <RestormVariableInputBox
            value={rpcId}
            onChange={setRpcId}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder={t('jsonrpc.idPlaceholder', 'id (auto)')}
            data-testid="jsonrpc-request-id-input"
          />
        </div>
      )}
      <HeaderHoverTooltip label={t('jsonrpc.notificationModeTooltip', 'Notification mode — no id, no response awaited')}>
        <Toggle
          checked={notificationMode}
          onChange={setNotificationMode}
          data-testid="jsonrpc-request-notification-toggle"
        />
      </HeaderHoverTooltip>
  {!inWorkbenchTab && (
      <SendButtonEnvSwitcher>
        <BeamWrap active={isSending} size={22} borderWidth={1.5}>
          <Button
            icon={isSending ? 'close' : 'send'}
            onClick={isSending ? handleCancel : handleSend}
            {...(isSending ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
            options={{
              title: isSending ? t('cancel') : t('jsonrpc.send', 'Send'),
              ariaLabel: isSending ? t('cancel') : t('jsonrpc.send', 'Send')
            }}
            data-testid="jsonrpc-action-button"
          />
        </BeamWrap>
      </SendButtonEnvSwitcher>
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
        ariaLabel={isSending ? t('cancel') : t('jsonrpc.send', 'Send')}
        data-testid="jsonrpc-action-button"
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
        jsonData={jsonData}
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

export default JsonRpcRequestTabView
