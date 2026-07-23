import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTransportReplaced } from '../../hooks/useTransportReplaced'
import { getRequestPanelState, setRequestPanelCollapsed } from '../../services/requestPanelStateStore'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  SplitView,
  Pane,
  ControlGroup,
  ScrollableElement,
  eventBus,
  logger,
  getContrastColor,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { JsonRpcBatchRequest, JsonRpcBatchCallSpec, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { JsonRpcBatchExecutionResult, JsonRpcBatchChildResult } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { updateReactiveProperty } from './requestTabViewUtils'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { BeamWrap } from '../common/BeamWrap'
import { RoundActionButton } from '../common/RoundActionButton'
import { RequestActionToolbar } from './RequestActionToolbar'
import { useIsInWorkbenchTab } from '../../contexts/workbenchTabHost'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { JsonRpcBatchEditor } from './JsonRpcBatchEditor'
import { cloneForEventBus } from '../../utils/cloneForEventBus'

const urlInputWrapperStyle: React.CSSProperties = { flex: 1, minWidth: 0 }

export interface JsonRpcBatchRequestTabViewProps {
  request: JsonRpcBatchRequest
}

export const JsonRpcBatchRequestTabView: React.FC<JsonRpcBatchRequestTabViewProps> = ({ request }) => {
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
  const [children, setChildrenState] = useState<JsonRpcBatchCallSpec[]>(request.children)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<JsonRpcBatchExecutionResult | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const [panelCollapsed, setPanelCollapsed] = useState<{ calls: boolean; headers: boolean }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      calls: typeof seed['calls'] === 'boolean' ? seed['calls'] : false,
      headers: typeof seed['headers'] === 'boolean' ? seed['headers'] : request.headers.length === 0
    }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = { calls: arr[0] ?? false, headers: arr[1] ?? false }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'calls', next.calls)
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
    setChildrenState(request.children)
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
    setChildrenState(current.children)
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current ?? environments?.[0]?.id ?? null
    const currentRequest = requestRef.current
    const restormContext = window.restorm?.context
    if (!restormContext) return

    logger.debug('[JsonRpcBatchRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    void restormContext.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueDataShared(currentRequest.headers)
    })
    void restormContext.updateFullRequestData(requestId, cloneForEventBus({
      url: currentRequest.url,
      method: 'POST',
      requestType: 'jsonrpcBatch',
      headers: toKeyValueDataShared(currentRequest.headers),
      jsonRpcChildren: currentRequest.children
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
      logger.debug('[JsonRpcBatchRequestTabView] Unregistering request from ContextService', { requestId })
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

  // Debounced push to ContextService — 250 ms, per the protocol playbook's
  // input-debouncing rule.
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
      requestType: 'jsonrpcBatch' as const,
      headers: toKeyValueDataShared(request.headers),
      jsonRpcChildren: children
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
  }, [request.id, request.headers, url, children])

  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setChildren = useCallback((next: JsonRpcBatchCallSpec[]): void => {
    setChildrenState(next)
    updateReactiveProperty(request, 'children', next)
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

    window.restorm?.jsonrpc.executeBatch({ requestId: request.id })
      .then((res: JsonRpcBatchExecutionResult) => {
        setResponse(res)
        setHistoryRefreshKey(prev => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('JSON-RPC batch completed', { url: res.requestUrl, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('JSON-RPC batch failed', { error: String(err) })
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
      data-testid="jsonrpc-batch-request-splitview"
      onCollapsedChange={handlePanelCollapsedChange}
    >
      <Pane title={t('jsonrpcBatch.tabs.calls', 'Calls')} initialSize={0.7} minSize={150} collapsed={panelCollapsed.calls} data-testid="jsonrpc-batch-calls-pane">
        <ScrollableElement options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }} style={{ height: '100%' }}>
          <JsonRpcBatchEditor key={`children-${transportEpoch}`} value={children} onChange={setChildren} />
        </ScrollableElement>
      </Pane>
      <Pane
        title={t('jsonrpc.tabs.headers', 'Headers')}
        initialSize={0.3}
        minSize={100}
        collapsed={panelCollapsed.headers}
        data-testid="jsonrpc-batch-headers-pane"
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
            data-testid="jsonrpc-batch-add-header-button"
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
          persistenceId={`jsonrpc-batch-headers:${request.id}`}
          data-testid="jsonrpc-batch-headers-table"
        />
      </Pane>
    </SplitView>
  )

  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const renderChildResult = useCallback((child: JsonRpcBatchChildResult, index: number): React.ReactNode => (
    <div
      key={child.childId}
      style={{ padding: 8, border: '1px solid var(--panel-border)', borderRadius: 4, marginBottom: 8 }}
      data-testid={`response-batch-child-${index}`}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{child.rpcId}</div>
      {child.unmatched ? (
        <div style={{ fontSize: 12, color: 'var(--testing-iconFailed)' }}>
          {t('jsonrpcBatch.response.unmatched', 'No matching response entry.')}
        </div>
      ) : child.error !== undefined ? (
        <div style={{ fontSize: 12, color: 'var(--testing-iconFailed)' }}>
          {t('jsonrpc.response.errorLabel', 'JSON-RPC error {{code}}:', { code: child.error.code })} {child.error.message}
        </div>
      ) : (
        <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(child.result, null, 2)}</pre>
      )}
    </div>
  ), [t])

  const buildBatchResponseView = useCallback((resp: JsonRpcBatchExecutionResult | null) => {
    if (!resp) return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    const infosContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }} data-testid="jsonrpc-batch-response-infos">
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span data-testid="jsonrpc-batch-response-status" data-status-code={resp.statusCode}>{resp.statusCode}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
          <span data-testid="jsonrpc-batch-response-duration">{resp.timings.durationMs}ms</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>URL:</span>
          <span style={{ wordBreak: 'break-all' }}>{resp.requestUrl}</span>
        </div>
      </div>
    )
    const responseContent = (
      <ScrollableElement options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }} style={{ height: '100%' }}>
        <div style={{ padding: 8 }} data-testid="jsonrpc-batch-response-children">
          {resp.children.map((child, index) => renderChildResult(child, index))}
        </div>
      </ScrollableElement>
    )
    return { infosContent, responseContent, jsonData: { children: resp.children } }
  }, [renderChildResult])

  const { infosContent, responseContent, jsonData } = useMemo(
    () => buildBatchResponseView(response),
    [buildBatchResponseView, response]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'jsonrpcBatch') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: JsonRpcBatchExecutionResult = {
      requestId: request.id,
      success: detail.success,
      statusCode: detail.response.statusCode,
      timings: detail.response.timings,
      requestUrl: detail.response.requestUrl,
      children: detail.response.children,
      ...(detail.response.error !== undefined ? { transportError: detail.response.error } : {})
    }
    return buildBatchResponseView(historyResponse)
  }, [buildBatchResponseView, request.id])

  const urlSection = (
    <ControlGroup data-testid="jsonrpc-batch-url-section">
      <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
        <div style={urlInputWrapperStyle} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder={t('jsonrpc.urlPlaceholder', 'JSON-RPC endpoint URL')}
            data-testid="jsonrpc-batch-request-url-input"
          />
        </div>
      </HeaderHoverTooltip>
  {!inWorkbenchTab && (
      <SendButtonEnvSwitcher>
        <BeamWrap active={isSending} size={22} borderWidth={1.5}>
          <Button
            icon={isSending ? 'close' : 'send'}
            onClick={isSending ? handleCancel : handleSend}
            {...(isSending ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
            options={{
              title: isSending ? t('cancel') : t('jsonrpcBatch.send', 'Send batch'),
              ariaLabel: isSending ? t('cancel') : t('jsonrpcBatch.send', 'Send batch')
            }}
            data-testid="jsonrpc-batch-action-button"
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
        ariaLabel={isSending ? t('cancel') : t('jsonrpcBatch.send', 'Send batch')}
        data-testid="jsonrpc-batch-action-button"
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

export default JsonRpcBatchRequestTabView
