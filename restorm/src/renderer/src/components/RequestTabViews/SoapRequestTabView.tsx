import { toKeyValueData as toKeyValueDataShared } from '../../utils/toKeyValueData'
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  ControlGroup,
  eventBus,
  logger,
  getContrastColor,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { SoapRequest, SoapResponse, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { SOAPExecutionResult } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { updateReactiveProperty, toKeyValuesFromHistory } from './requestTabViewUtils'
import { useApiDocumentationFromRequest } from '../../hooks/useApiDocumentationFromRequest'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { findOperationForRoute } from '../../../../shared/utils/findOperationForRoute'
import { useCurlPaste, type ParsedCurl } from '../../hooks/useCurlPaste'
import { CurlPasteCallout } from '../CurlPasteCallout'
import { SendButtonEnvSwitcher } from './SendButtonEnvSwitcher'
import { toasterService } from 'electron-core-ui/renderer'

export interface SoapRequestTabViewProps {
  request: SoapRequest
  /** See HTTPRequestTabView for the contract — opaque map of paneId
   * (here: 'body' | 'headers') to its persisted collapsed state. */
  initialPanelCollapsed?: Record<string, boolean>
  onPanelCollapsedChange?: (map: Record<string, boolean>) => void
}

export const SoapRequestTabView: React.FC<SoapRequestTabViewProps> = ({
  request,
  initialPanelCollapsed,
  onPanelCollapsedChange
}) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const { t } = useTranslation()
  const { selectedEnvId, environments, envColor } = useEnvironmentContext()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const { apiDocumentation, route } = useApiDocumentationFromRequest(request)
  const previousEnvIdRef = useRef<string | null>(null)
  const sendButtonStyle: React.CSSProperties | undefined = envColor
    ? { backgroundColor: envColor, color: getContrastColor(envColor), borderColor: envColor }
    : undefined

  const [url, setUrlState] = useState(request.url)
  const [body, setBodyState] = useState(request.body)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<SoapResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  // See HTTPRequestTabView for the contract.
  const [panelCollapsed, setPanelCollapsed] = useState<{ body: boolean; headers: boolean }>(() => {
    const seed = initialPanelCollapsed ?? {}
    return {
      body: typeof seed['body'] === 'boolean' ? seed['body'] : false,
      headers: typeof seed['headers'] === 'boolean' ? seed['headers'] : request.headers.length === 0
    }
  })
  const onPanelCollapsedChangeRef = useRef(onPanelCollapsedChange)
  useEffect(() => { onPanelCollapsedChangeRef.current = onPanelCollapsedChange }, [onPanelCollapsedChange])
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = { body: arr[0] ?? false, headers: arr[1] ?? false }
    setPanelCollapsed(next)
    onPanelCollapsedChangeRef.current?.(next)
  }, [])

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  const sourceIdRef = useRef<string>(crypto.randomUUID())

  const headersRef = useRef<KeyValueTableHandle | null>(null)
  const [transportEpoch, setTransportEpoch] = useState(0)
  const urlSectionHostRef = useRef<HTMLDivElement | null>(null)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setBodyState(request.body)
    setResponse(null)
  }, [request])
  useRequestReset(request, handleRequestReset)

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
    logger.debug('[SoapRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = toKeyValueDataShared

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.headers)
    })

    // Send full request data for URL and code snippet calculation
    void window.restorm?.context.updateFullRequestData(requestId, {
      url: currentRequest.url,
      method: 'POST',
      requestType: 'soap',
      headers: toKeyValueData(currentRequest.headers),
      body: { type: 'text', content: currentRequest.body }
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
      logger.debug('[SoapRequestTabView] Unregistering request from ContextService', { requestId })
      unsubUrl?.()
      unsubSnippets?.()
      void window.restorm?.context.unregisterRequest(requestId)
    }
  }, [request.id, environments])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? environments?.[0]?.id ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[SoapRequestTabView] Environment changed, notifying ContextService', {
        requestId: request.id,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, environments, request.id])

  // Notify ContextService when URL or body changes
  useEffect(() => {
    const toKeyValueData = toKeyValueDataShared

    void window.restorm?.context.updateFullRequestData(request.id, {
      url,
      method: 'POST',
      requestType: 'soap',
      headers: toKeyValueData(request.headers),
      body: { type: 'text', content: body }
    }, sourceIdRef.current)
  }, [request.id, request.headers, url, body])

  // Sync state changes to reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setBody = useCallback((value: string): void => {
    setBodyState(value)
    updateReactiveProperty(request, 'body', value)
  }, [request])
  
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
    setIsSending(true)
    setResponse(null)
    
    window.restorm?.soap.execute({
      requestId: request.id,
      ...(requestPath ? { requestPath } : {})
    })
      .then((res: SOAPExecutionResult) => {
        // Convert backend result to SoapResponse format
        const soapResponse: SoapResponse = {
          id: `resp_${Date.now()}`,
          type: 'soap',
          requestId: request.id,
          requestUrl: res.requestUrl ?? '',
          requestSoapAction: request.soapAction,
          requestBody: body,
          requestHeaders: request.headers,
          statusCode: res.statusCode ?? 0,
          responseBody: res.responseBody ?? '',
          responseHeaders: [],
          fault: res.fault,
          timings: res.timings
        }
        setResponse(soapResponse)
        setHistoryRefreshKey(prev => prev + 1)
        eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_RECORDED, { requestId: request.id } as RequestHistoryEventPayload)
        logger.info('SOAP request completed', { url: res.requestUrl, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('SOAP request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }
  
  const handleCancel = (): void => {
    void window.restorm?.soap.cancel(request.id)
  }
  
  // Request content (SplitView with Body, Headers)
  const requestContent = (
    <SplitView
      orientation="vertical"
      style={{ width: '100%', height: '100%' }}
      data-testid="soap-request-split-view"
      onCollapsedChange={handlePanelCollapsedChange}
    >
      <Pane title={t('soap.tabs.body')} initialSize={0.7} minSize={150} collapsed={panelCollapsed.body} data-testid="soap-request-body-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="xml"
            value={body}
            onChange={(v) => { setBody(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            data-testid="soap-request-body-editor"
          />
        </div>
      </Pane>
      <Pane
        title={t('soap.tabs.headers')}
        initialSize={0.3}
        minSize={100}
        collapsed={panelCollapsed.headers}
        data-testid="soap-request-headers-pane"
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
            data-testid="soap-request-add-header-button"
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
          persistenceId={`soap-headers:${request.id}`}
          data-testid="soap-request-headers-table"
        />
      </Pane>
    </SplitView>
  )
  
  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  const buildSoapResponseView = useCallback((
    resp: SoapResponse | null,
    meta?: { service?: string; operation?: string; soapAction?: string }
  ) => {
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
          <span style={{ fontWeight: 600, minWidth: 100 }}>Service:</span>
          <span>{meta?.service ?? '-'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Operation:</span>
          <span>{meta?.operation ?? '-'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>SOAPAction:</span>
          <span>{meta?.soapAction ?? '-'}</span>
        </div>
        {resp.fault && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>SOAP Fault:</span>
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
              <div><strong>Code:</strong> {resp.fault.code}</div>
              <div><strong>Message:</strong> {resp.fault.message}</div>
            </div>
          </div>
        )}
      </div>
    ) : null

    const responseContent = resp?.responseBody ? (
      <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
        <CodeEditor
          height="100%"
          language="xml"
          value={resp.responseBody}
          options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
          data-testid="soap-request-response-editor"
        />
      </div>
    ) : null

    return { infosContent, responseContent, jsonData: undefined }
  }, [])

  const { infosContent, responseContent } = useMemo(
    () => buildSoapResponseView(response, { service: request.service, operation: request.operation, soapAction: request.soapAction }),
    [buildSoapResponseView, response, request.service, request.operation, request.soapAction]
  )

  const buildHistoryView = useCallback((detail: ResponseHistoryDetail) => {
    if (detail.response.type !== 'soap') {
      return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    }
    const historyResponse: SoapResponse = {
      id: detail.guid,
      type: 'soap',
      requestId: request.id,
      requestUrl: detail.response.requestUrl,
      requestSoapAction: detail.response.requestSoapAction,
      requestBody: detail.response.requestBody,
      requestHeaders: toKeyValuesFromHistory(detail.response.requestHeaders),
      statusCode: detail.response.statusCode,
      responseBody: detail.response.responseBody,
      responseHeaders: toKeyValuesFromHistory(detail.response.responseHeaders),
      fault: detail.response.fault,
      timings: detail.response.timings,
      ...(detail.response.error ? { error: detail.response.error } : {})
    }
    return buildSoapResponseView(historyResponse, detail.requestMeta)
  }, [buildSoapResponseView, request.id])
  
  // Smart-paste: SOAP carries its own envelope on `request.body`,
  // but a cURL with raw XML in `-d` is a reasonable migration path.
  // For v1 we only fill URL + headers; the body stays a SOAP envelope.
  const applyParsedCurl = useCallback((parsed: ParsedCurl): void => {
    setUrl(parsed.url)
    updateReactiveProperty(request, 'headers', parsed.headers)
    setTransportEpoch((n) => n + 1)
    toasterService.push('app', {
      title: 'Replaced from cURL',
      body: 'SOAP endpoint URL and headers populated from the pasted curl command.',
      durationMs: 10000
    })
  }, [request, setUrl])

  const { pendingPaste } = useCurlPaste({
    hostRef: urlSectionHostRef,
    apply: applyParsedCurl
  })

  // URL section
  const urlSection = (
    <div
      ref={urlSectionHostRef}
      data-testid="soap-url-section-host"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {pendingPaste && (
        <CurlPasteCallout
          onConfirm={pendingPaste.confirm}
          onCancel={pendingPaste.cancel}
          data-testid="soap-curl-paste-callout"
        />
      )}
      <ControlGroup data-testid="soap-url-section">
        <div style={{ flex: 1, minWidth: 0 }} title={resolvedUrl || url} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            placeholder={t('soap.urlPlaceholder')}
            data-testid="soap-url-input"
          />
        </div>
        <SendButtonEnvSwitcher>
          <Button
            icon={isSending ? 'close' : 'send'}
            onClick={isSending ? handleCancel : handleSend}
            {...(isSending ? { emphasis: 0 } : sendButtonStyle ? { style: sendButtonStyle } : { emphasis: 1 })}
            options={{
              title: isSending ? t('cancel') : t('soap.send'),
              ariaLabel: isSending ? t('cancel') : t('soap.send')
            }}
            data-testid="soap-request-action-button"
          />
        </SendButtonEnvSwitcher>
      </ControlGroup>
      <div style={{ fontSize: 12, color: 'var(--descriptionForeground)' }}>
        {request.service}/{request.operation} • SOAPAction: {request.soapAction}
      </div>
    </div>
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
        isLoading={isSending}
        showResponse={response !== null}
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

export default SoapRequestTabView
