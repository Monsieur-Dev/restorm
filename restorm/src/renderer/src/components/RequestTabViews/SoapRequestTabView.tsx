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
  eventBus,
  logger,
  getContrastColor,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { DocumentEvents, type RequestHistoryEventPayload } from '../../services/DocumentEvents'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { useEnvVariables } from '../../hooks/useEnvVariables'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { SoapRequest, SoapResponse, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { StringValue } from '../../../../shared/types/collections'
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
import { BeamWrap } from '../common/BeamWrap'
import { toasterService } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

export interface SoapRequestTabViewProps {
  request: SoapRequest
}

export const SoapRequestTabView: React.FC<SoapRequestTabViewProps> = ({
  request
}) => {
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
  const [body, setBodyState] = useState(request.body)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<SoapResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  // See HTTPRequestTabView for the contract.
  const [panelCollapsed, setPanelCollapsed] = useState<{ body: boolean; headers: boolean }>(() => {
    const seed = (projectUuid ? getRequestPanelState(projectUuid, request.id) : undefined) ?? {}
    return {
      body: typeof seed['body'] === 'boolean' ? seed['body'] : false,
      headers: typeof seed['headers'] === 'boolean' ? seed['headers'] : request.headers.length === 0
    }
  })
  const handlePanelCollapsedChange = useCallback((arr: boolean[]) => {
    const next = { body: arr[0] ?? false, headers: arr[1] ?? false }
    setPanelCollapsed(next)
    if (projectUuid) {
      setRequestPanelCollapsed(projectUuid, request.id, 'body', next.body)
      setRequestPanelCollapsed(projectUuid, request.id, 'headers', next.headers)
    }
  }, [projectUuid, request.id])

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

  // Re-sync local state when a quick-config load (or MCP update_request)
  // replaces the transport. The state updates re-trigger the
  // updateFullRequestData useEffect below → Handlebars re-resolution.
  const handleTransportReplaced = useCallback(() => {
    const current = requestRef.current
    setUrlState(current.url)
    setBodyState(current.body)
    setTransportEpoch((n) => n + 1)
  }, [])
  useTransportReplaced(request, handleTransportReplaced)

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
          responseHeaders: Object.entries(res.headers ?? {}).flatMap(([key, val]) =>
            Array.isArray(val)
              ? val.map((v, i) => ({ id: `${key}-${i}`, key, value: new StringValue(v), enabled: true, description: '' }))
              : [{ id: key, key, value: new StringValue(val), enabled: true, description: '' }]
          ),
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
            key={`body-${transportEpoch}`}
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
    // Detect malformed XML: the body is present but not parseable as XML.
    // A SOAP response must start with a valid XML declaration or envelope tag.
    const isMalformedXml = Boolean(
      resp?.responseBody &&
      !resp.fault &&
      !resp.responseBody.trimStart().startsWith('<')
    )

    const infosContent = resp ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
          <span
            data-testid="soap-response-status"
            data-status-code={resp.statusCode}
            style={{ color: resp.statusCode >= 200 && resp.statusCode < 300 ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}
          >
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
          <div
            data-testid="soap-response-fault"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}
          >
            <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>SOAP Fault:</span>
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
              <div><strong>Code:</strong> {resp.fault.code}</div>
              <div data-testid="soap-response-fault-message"><strong>Message:</strong> {resp.fault.message}</div>
            </div>
          </div>
        )}
        {isMalformedXml && (
          <div
            data-testid="soap-response-malformed-error"
            style={{ display: 'flex', gap: 4, marginTop: 8, color: 'var(--testing-iconFailed)' }}
          >
            <span style={{ fontWeight: 600 }}>Error:</span>
            <span>{t('soap.malformedXmlError', 'Invalid XML response')}</span>
          </div>
        )}
        {resp.responseHeaders.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Response Headers:</div>
            <div data-testid="soap-response-headers-list" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {resp.responseHeaders.map((h, idx) => (
                <div
                  key={h.id ?? `header-${idx}`}
                  data-header-key={h.key.toLowerCase()}
                  style={{ display: 'flex', gap: 8, fontFamily: 'monospace', fontSize: 11 }}
                >
                  <span style={{ color: 'var(--descriptionForeground)', minWidth: 160 }}>{h.key}</span>
                  <span>{h.value.toString()}</span>
                </div>
              ))}
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
  }, [t])

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
        <HeaderHoverTooltip label={resolvedUrl || url} suppressed={!(resolvedUrl || url)} className="url-container-stretch">
          <div style={{ flex: 1, minWidth: 0 }} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'} data-resolved-url={resolvedUrl || url}>
            <RestormVariableInputBox
              value={url}
              onChange={setUrl}
              variables={envVariables}
              helpers={handlebarsHelpers}
              placeholder={t('soap.urlPlaceholder')}
              data-testid="soap-url-input"
            />
          </div>
        </HeaderHoverTooltip>
        <SendButtonEnvSwitcher>
          <BeamWrap active={isSending} size={22} borderWidth={1.5}>
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
          </BeamWrap>
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
