import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRequestReset } from '../../hooks/useRequestReset'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  ControlGroup,
  logger,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { GrpcRequest, GrpcResponse, KeyValue, ResponseHistoryDetail } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { GRPCExecutionResult, KeyValueData } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { ResponseHistoryModal } from '../Modals/ResponseHistoryModal'
import { Badge } from '../common/Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'
import { useRestormStore } from '../../store/restormStore'
import { buildRequestPath } from '../../utils/requestPath'
import { getResponseHistoryList } from '../../services/GraphQLIntegration'
import { updateReactiveProperty, toKeyValuesFromHistory } from './requestTabViewUtils'

export interface GrpcRequestTabViewProps {
  request: GrpcRequest
  historyModalOpen?: boolean
  onCloseHistoryModal?: () => void
  onHistoryAvailabilityChange?: (hasHistory: boolean) => void
}

export const GrpcRequestTabView: React.FC<GrpcRequestTabViewProps> = ({
  request,
  historyModalOpen = false,
  onCloseHistoryModal,
  onHistoryAvailabilityChange
}) => {
  const { t } = useTranslation()
  const { selectedEnvId, environments } = useEnvironmentContext()
  const collections = useRestormStore((state) => state.collections)
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  
  const [url, setUrlState] = useState(request.url)
  const [requestMessage, setRequestMessageState] = useState(request.requestMessage)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<GrpcResponse | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const requestPath = useMemo(() => buildRequestPath(collections, request.id), [collections, request.id])
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  
  const metadataRef = useRef<KeyValueTableHandle | null>(null)

  const handleRequestReset = useCallback(() => {
    setUrlState(request.url)
    setRequestMessageState(request.requestMessage)
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
    logger.debug('[GrpcRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = (kvs: KeyValue[]): KeyValueData[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value.toString(), enabled: kv.enabled }))

    void window.restorm?.context.registerRequest(requestId, currentEnvId, {
      headers: toKeyValueData(currentRequest.metadata)
    })

    // Send full request data for URL and code snippet calculation
    void window.restorm?.context.updateFullRequestData(requestId, {
      url: currentRequest.url,
      method: currentRequest.callType,
      requestType: 'grpc',
      headers: toKeyValueData(currentRequest.metadata),
      body: { type: 'text', content: currentRequest.requestMessage }
    })

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
    const toKeyValueData = (kvs: KeyValue[]): KeyValueData[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value.toString(), enabled: kv.enabled }))

    void window.restorm?.context.updateFullRequestData(request.id, {
      url,
      method: request.callType,
      requestType: 'grpc',
      headers: toKeyValueData(request.metadata),
      body: { type: 'text', content: requestMessage }
    })
  }, [request.id, request.callType, request.metadata, url, requestMessage])

  // Sync state changes to reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setRequestMessage = useCallback((value: string): void => {
    setRequestMessageState(value)
    updateReactiveProperty(request, 'requestMessage', value)
  }, [request])
  
  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])

  // Callback for metadata changes - notify both reactive object and ContextService
  const handleMetadataChange = useCallback((rows: KeyValue[]): void => {
    updateReactiveProperty(request, 'metadata', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers', // Use 'headers' as the group name for consistency
      rows.map(r => ({ id: r.id, key: r.key, value: r.value.toString(), enabled: r.enabled }))
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

  // Request content (SplitView with Message, Metadata)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }} data-testid="grpc-request-content-splitview">
      <Pane title={t('grpc.tabs.message')} initialSize={0.7} minSize={150} data-testid="grpc-message-pane">
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
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
        collapsed={request.metadata.length === 0}
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
        <RestormKeyValueTable
          ref={metadataRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.metadata}
          onRowsChange={handleMetadataChange}
          data-testid="grpc-metadata-table"
        />
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
          <span style={{ color: resp.statusCode === 0 ? 'var(--testing-iconPassed)' : 'var(--editorWarning-foreground)' }}>
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
            <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
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
    () => buildGrpcResponseView(response, { service: request.service, method: request.method, callType: request.callType }),
    [buildGrpcResponseView, response, request.service, request.method, request.callType]
  )

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
  
  // URL section
  const urlSection = (
    <>
      <ControlGroup data-testid="grpc-url-section">
        <Badge type={mapToBadgeType(request.callType)} />
        <div style={{ flex: 1, minWidth: 0 }} title={resolvedUrl || url} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            placeholder={t('grpc.urlPlaceholder')}
            data-testid="grpc-url-input"
          />
        </div>
        <Button
          icon={isSending ? 'close' : 'send'}
          onClick={isSending ? handleCancel : handleSend}
          emphasis={isSending ? 0 : 1}
          options={{
            title: isSending ? t('cancel') : t('grpc.send'),
            ariaLabel: isSending ? t('cancel') : t('grpc.send')
          }}
          data-testid="grpc-send-button"
        />
      </ControlGroup>
      <div style={{ fontSize: 12, color: 'var(--descriptionForeground)' }}>
        {request.service}/{request.method}
      </div>
    </>
  )
  
  const handleCloseHistoryModal = useCallback(() => {
    onCloseHistoryModal?.()
  }, [onCloseHistoryModal])

  useEffect(() => {
    if (!onHistoryAvailabilityChange) return
    const state = { active: true }
    void (async (): Promise<void> => {
      const entries = await getResponseHistoryList(request.id, requestPath ?? undefined)
      if (state.active) {
        onHistoryAvailabilityChange(entries.length > 0)
      }
    })()
    return () => {
      state.active = false
    }
  }, [onHistoryAvailabilityChange, request.id, requestPath, historyRefreshKey])

  return (
    <>
      <BaseRequestTabView
        requestId={request.id}
        urlSection={urlSection}
        requestContent={requestContent}
        codeSnippetsContent={codeSnippetsContent}
        documentation={request.documentation}
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
        requestPath={requestPath ?? undefined}
        refreshKey={historyRefreshKey}
        buildResponseView={buildHistoryView}
      />
    </>
  )
}

export default GrpcRequestTabView
