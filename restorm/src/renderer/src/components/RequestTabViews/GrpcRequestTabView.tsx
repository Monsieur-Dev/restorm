import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  logger,
  type VariableDefinition,
  type KeyValueTableRow
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { GrpcRequest, GrpcResponse, KeyValue } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { VariableContext } from '../RestormKeyValueTable'
import type { GRPCExecutionResult } from '../../types/global.d'
import { BaseRequestTabView } from './BaseRequestTabView'
import { Badge } from '../common/Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

export interface GrpcRequestTabViewProps {
  request: GrpcRequest
}

export const GrpcRequestTabView: React.FC<GrpcRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { selectedEnvId } = useEnvironmentContext()
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  
  const [url, setUrlState] = useState(request.url)
  const [requestMessage, setRequestMessageState] = useState(request.requestMessage)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<GrpcResponse | null>(null)
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  
  const metadataRef = useRef<KeyValueTableHandle | null>(null)
  const requestIdRef = useRef(request.id)
  
  useEffect(() => {
    if (requestIdRef.current !== request.id) {
      requestIdRef.current = request.id
      const rafId = requestAnimationFrame(() => {
        setUrlState(request.url)
        setRequestMessageState(request.requestMessage)
        setResponse(null)
      })
      return (): void => { cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [request])

  // Refs to capture initial values for registration (avoid re-running effect when these change)
  const selectedEnvIdRef = useRef(selectedEnvId)
  const requestRef = useRef(request)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { requestRef.current = request }, [request])

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    const currentEnvId = selectedEnvIdRef.current
    const currentRequest = requestRef.current
    logger.debug('[GrpcRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    const toKeyValueData = (kvs: KeyValue[]): { id?: string; key: string; value: string; enabled?: boolean }[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value, enabled: kv.enabled }))

    void window.restorm?.context.registerRequest(requestId, currentEnvId ?? null, {
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
  }, [request.id])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const currentEnvId = selectedEnvId ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[GrpcRequestTabView] Environment changed, notifying ContextService', {
        requestId: request.id,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm?.context.setRequestEnvironment(request.id, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, request.id])

  // Notify ContextService when URL or request message changes
  useEffect(() => {
    const toKeyValueData = (kvs: KeyValue[]): { id?: string; key: string; value: string; enabled?: boolean }[] =>
      kvs.map(kv => ({ id: kv.id, key: kv.key, value: kv.value, enabled: kv.enabled }))

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
  
  // Variable resolution done in backend
  const _environmentContext: VariableContext = {}
  
  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])

  // Callback for metadata changes - notify both reactive object and ContextService
  const handleMetadataChange = useCallback((rows: KeyValueTableRow[]): void => {
    updateReactiveProperty(request, 'metadata', rows)
    void window.restorm?.context.updateRequestKeyValues(
      request.id,
      'headers', // Use 'headers' as the group name for consistency
      rows.map(r => ({ id: r.id, key: r.key, value: r.value, enabled: r.enabled }))
    )
  }, [request])

  const handleSend = (): void => {
    if (isSending) return
    setIsSending(true)
    setResponse(null)
    
    window.restorm?.grpc.execute({ requestId: request.id })
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
  
  // Parse host and port from URL (kept for potential future use)
  const _hostInfo = useMemo(() => {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `http://${url}`)
      return {
        host: urlObj.host,
        port: urlObj.port || '443'
      }
    } catch {
      return { host: url, port: '443' }
    }
  }, [url])
  
  // Request content (SplitView with Message, Metadata)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
      <Pane title={t('grpc.tabs.message')} initialSize={0.7} minSize={150}>
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="json"
            value={requestMessage}
            onChange={(v) => { setRequestMessage(v ?? '{}') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
          />
        </div>
      </Pane>
      <Pane
        title={t('grpc.tabs.metadata')}
        initialSize={0.3}
        minSize={100}
        collapsed={request.metadata.length === 0}
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary
            small
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            onClick={() => {
              if (collapsed) toggle()
              metadataRef.current?.addRow()
            }}
          >
            <i className="codicon codicon-add" />
          </Button>
        )}
      >
        <RestormKeyValueTable
          ref={metadataRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.metadata}
          onRowsChange={handleMetadataChange}
        />
      </Pane>
    </SplitView>
  )
  
  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')
  
  // Infos content (detailed info panel)
  const infosContent = response ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
        <span style={{ color: response.statusCode === 0 ? 'var(--testing-iconPassed)' : 'var(--editorWarning-foreground)' }}>
          {response.statusCode} ({response.statusCode === 0 ? 'OK' : 'Error'})
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
        <span>{response.timings.durationMs}ms</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Service:</span>
        <span>{request.service}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Method:</span>
        <span>{request.method}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Call Type:</span>
        <span>{request.callType}</span>
      </div>
      {response.error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>Error:</span>
          <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
            {response.error}
          </div>
        </div>
      )}
    </div>
  ) : null
  
  // Response content (raw JSON)
  const responseContent = response?.responseMessage ? (
    <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
      <CodeEditor
        height="100%"
        language="json"
        value={response.responseMessage}
        options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
      />
    </div>
  ) : null
  
  // Parse response for JsonCrack
  const jsonData = useMemo(() => {
    if (!response?.responseMessage) return undefined
    try {
      return JSON.parse(response.responseMessage) as unknown
    } catch {
      return undefined
    }
  }, [response?.responseMessage])
  
  // URL section
  const urlSection = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge type={mapToBadgeType(request.callType)} />
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }} title={resolvedUrl || url} data-testid="url-container" data-url-resolved={resolvedUrl ? 'true' : 'false'}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={emptyVariables}
            helpers={handlebarsHelpers}
            placeholder={t('grpc.urlPlaceholder')}
          />
        </div>
        <Button 
          onClick={isSending ? handleCancel : handleSend} 
          options={{ 
            title: isSending ? t('cancel') : t('grpc.send'), 
            ariaLabel: isSending ? t('cancel') : t('grpc.send') 
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <i className={isSending ? 'codicon codicon-close' : 'codicon codicon-send'} />
            <span>{isSending ? t('cancel') : t('grpc.send')}</span>
          </span>
        </Button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--descriptionForeground)' }}>
        {request.service}/{request.method}
      </div>
    </>
  )
  
  return (
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
  )
}

export default GrpcRequestTabView
