import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Handlebars } from '../../utils/handlebarsHelpers'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  CodeEditor,
  SplitView,
  Pane,
  logger,
  type VariableDefinition
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { GrpcRequest, GrpcResponse } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { VariableContext } from '../RestormKeyValueTable'
import { executeGrpcRequest, type GrpcRequestInput } from '../../services/request/GrpcRequestService'
import { BaseRequestTabView } from './BaseRequestTabView'
import { Badge } from '../Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'
import codeSnippetsTemplate from '../../resources/templates/code-snippets-grpc.hbs?raw'

// Compile the Handlebars template
const compiledTemplate = Handlebars.compile(codeSnippetsTemplate)

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

export interface GrpcRequestTabViewProps {
  request: GrpcRequest
}

export const GrpcRequestTabView: React.FC<GrpcRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { environments: _environments, selectedEnvId: _selectedEnvId } = useEnvironmentContext()
  void _environments // TODO: will be used when variable resolution is implemented in backend
  void _selectedEnvId
  const handlebarsHelpers = useHandlebarsHelpers()
  
  const [url, setUrlState] = useState(request.url)
  const [requestMessage, setRequestMessageState] = useState(request.requestMessage)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<GrpcResponse | null>(null)
  
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

  // Sync state changes to reactive request object
  const setUrl = useCallback((value: string): void => {
    setUrlState(value)
    updateReactiveProperty(request, 'url', value)
  }, [request])
  const setRequestMessage = useCallback((value: string): void => {
    setRequestMessageState(value)
    updateReactiveProperty(request, 'requestMessage', value)
  }, [request])
  
  // TODO: Variable resolution will be implemented in backend
  const environmentContext: VariableContext = {}
  const envVariables: VariableDefinition[] = []
  
  const handleSend = (): void => {
    if (isSending) return
    setIsSending(true)
    setResponse(null)
    
    const input: GrpcRequestInput = {
      request,
      url,
      service: request.service,
      method: request.method,
      requestMessage,
      metadata: request.metadata,
      variableContext: environmentContext
    }
    
    executeGrpcRequest(input)
      .then((res) => {
        setResponse(res)
        logger.info('gRPC request completed', { method: res.requestMethod, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('gRPC request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }
  
  // Parse host and port from URL
  const hostInfo = useMemo(() => {
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
          variables={envVariables}
          helpers={handlebarsHelpers}
          initialRows={request.metadata}
          onRowsChange={(rows): void => { updateReactiveProperty(request, 'metadata', rows) }}
        />
      </Pane>
    </SplitView>
  )
  
  // Generate code snippets
  const codeSnippetsContent = useMemo(() => {
    const metadataData = request.metadata.filter(m => m.key).map(m => ({ key: m.key, value: m.value }))
    const serviceParts = request.service.split('.')
    const serviceName = serviceParts[serviceParts.length - 1] ?? request.service
    const packageName = serviceParts.slice(0, -1).join('.') || 'package'
    
    return compiledTemplate({
      url,
      host: hostInfo.host,
      port: hostInfo.port,
      service: request.service,
      serviceName,
      method: request.method,
      methodName: request.method.charAt(0).toLowerCase() + request.method.slice(1),
      method_snake: request.method.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''),
      callType: request.callType,
      requestMessage: requestMessage || '{}',
      requestType: 'Request',
      metadata: metadataData.length > 0 ? metadataData : null,
      package: packageName,
      Package: packageName.charAt(0).toUpperCase() + packageName.slice(1),
      Namespace: packageName.replace(/\./g, '::'),
      protoFile: 'service.proto',
      plaintext: !url.startsWith('https'),
      isUnary: request.callType === 'unary',
      isServerStream: request.callType === 'server-stream',
      isClientStream: request.callType === 'client-stream',
      isBidirectional: request.callType === 'bidirectional-stream'
    })
  }, [url, hostInfo, request.service, request.method, request.callType, request.metadata, requestMessage])
  
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
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
          <RestormVariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            helpers={handlebarsHelpers}
            placeholder={t('grpc.urlPlaceholder')}
          />
        </div>
        <Button onClick={handleSend} options={{ title: t('grpc.send'), ariaLabel: t('grpc.send') }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <i className="codicon codicon-send" />
            <span>{t('grpc.send')}</span>
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
