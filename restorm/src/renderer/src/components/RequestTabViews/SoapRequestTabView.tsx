import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Handlebars } from '../../utils/handlebarsHelpers'
import {
  Button,
  VariableInputBox,
  CodeEditor,
  KeyValueTable,
  SplitView,
  Pane,
  logger,
  type VariableDefinition,
  type KeyValueTableHandle
} from 'electron-core-ui/renderer'
import type { SoapRequest, SoapResponse } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { useEnvironmentValues } from '../../contexts/useEnvironmentValues'
import {
  resolveEnvironmentVariables,
  type VariableContext
} from '../../services/VariableResolutionService'
import { executeSoapRequest, type SoapRequestInput } from '../../services/request/SoapRequestService'
import { BaseRequestTabView } from './BaseRequestTabView'
import { Badge } from '../Badge'
import codeSnippetsTemplate from '../../resources/templates/code-snippets-soap.hbs?raw'

// Compile the Handlebars template
const compiledTemplate = Handlebars.compile(codeSnippetsTemplate)

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

export interface SoapRequestTabViewProps {
  request: SoapRequest
}

export const SoapRequestTabView: React.FC<SoapRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { environments, selectedEnvId } = useEnvironmentContext()
  const { valuesByEnvId } = useEnvironmentValues()
  
  const [url, setUrlState] = useState(request.url)
  const [body, setBodyState] = useState(request.body)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<SoapResponse | null>(null)
  
  const headersRef = useRef<KeyValueTableHandle | null>(null)
  const requestIdRef = useRef(request.id)
  
  useEffect(() => {
    if (requestIdRef.current !== request.id) {
      requestIdRef.current = request.id
      const rafId = requestAnimationFrame(() => {
        setUrlState(request.url)
        setBodyState(request.body)
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
  const setBody = useCallback((value: string): void => {
    setBodyState(value)
    updateReactiveProperty(request, 'body', value)
  }, [request])
  
  const runtimeContext = useMemo<VariableContext | undefined>(
    () => (selectedEnvId ? valuesByEnvId[selectedEnvId] : undefined),
    [valuesByEnvId, selectedEnvId]
  )
  
  const environmentContext = useMemo<VariableContext>(
    () => runtimeContext ?? resolveEnvironmentVariables(environments ?? [], selectedEnvId),
    [runtimeContext, environments, selectedEnvId]
  )
  
  const envVariables = useMemo<VariableDefinition[]>(
    () => Object.entries(environmentContext).map(([name, value]) => ({ name, value, description: '' })),
    [environmentContext]
  )
  
  const handleSend = (): void => {
    if (isSending) return
    setIsSending(true)
    setResponse(null)
    
    const input: SoapRequestInput = {
      request,
      url,
      soapAction: request.soapAction,
      body,
      headers: request.headers,
      variableContext: environmentContext
    }
    
    executeSoapRequest(input)
      .then((res) => {
        setResponse(res)
        logger.info('SOAP request completed', { url: res.requestUrl, status: res.statusCode })
      })
      .catch((err: unknown) => {
        logger.error('SOAP request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }
  
  // Request content (SplitView with Body, Headers)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
      <Pane title={t('soap.tabs.body')} initialSize={0.7} minSize={150}>
        <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
          <CodeEditor
            height="100%"
            language="xml"
            value={body}
            onChange={(v) => { setBody(v ?? '') }}
            options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
          />
        </div>
      </Pane>
      <Pane
        title={t('soap.tabs.headers')}
        initialSize={0.3}
        minSize={100}
        collapsed={request.headers.length === 0}
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary
            small
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            onClick={() => {
              if (collapsed) toggle()
              headersRef.current?.addRow()
            }}
          >
            <i className="codicon codicon-add" />
          </Button>
        )}
      >
        <KeyValueTable
          ref={headersRef}
          variables={envVariables}
          initialRows={request.headers}
          visibilityMode="base-only"
          onRowsChange={(rows): void => { updateReactiveProperty(request, 'headers', rows) }}
        />
      </Pane>
    </SplitView>
  )
  
  // Generate code snippets
  const codeSnippetsContent = useMemo(() => {
    const headersData = request.headers.filter(h => h.key).map(h => ({ key: h.key, value: h.value }))
    const escapedBody = body.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    const operationSnake = request.operation.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
    
    return compiledTemplate({
      url,
      wsdlUrl: url.endsWith('?wsdl') ? url : `${url}?wsdl`,
      service: request.service,
      operation: request.operation,
      operation_snake: operationSnake,
      soapAction: request.soapAction,
      namespace: 'http://tempuri.org/',
      body,
      escapedBody,
      headers: headersData.length > 0 ? headersData : null
    })
  }, [url, request.service, request.operation, request.soapAction, request.headers, body])
  
  // Infos content (detailed info panel)
  const infosContent = response ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
        <span style={{ color: response.statusCode >= 200 && response.statusCode < 300 ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
          {response.statusCode}
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
        <span style={{ fontWeight: 600, minWidth: 100 }}>Operation:</span>
        <span>{request.operation}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>SOAPAction:</span>
        <span>{request.soapAction}</span>
      </div>
      {response.fault && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--testing-iconFailed)' }}>SOAP Fault:</span>
          <div style={{ padding: 4, background: 'var(--inputValidation-errorBackground)', borderRadius: 3 }}>
            <div><strong>Code:</strong> {response.fault.code}</div>
            <div><strong>Message:</strong> {response.fault.message}</div>
          </div>
        </div>
      )}
    </div>
  ) : null
  
  // Response content (raw XML)
  const responseContent = response?.responseBody ? (
    <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3 }}>
      <CodeEditor
        height="100%"
        language="xml"
        value={response.responseBody}
        options={{ readOnly: true, minimap: { enabled: false }, automaticLayout: true }}
      />
    </div>
  ) : null
  
  // URL section
  const urlSection = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge type="SOAP" />
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
          <VariableInputBox
            value={url}
            onChange={setUrl}
            variables={envVariables}
            placeholder={t('soap.urlPlaceholder')}
          />
        </div>
        <Button onClick={handleSend} options={{ title: t('soap.send'), ariaLabel: t('soap.send') }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <i className="codicon codicon-send" />
            <span>{t('soap.send')}</span>
          </span>
        </Button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--descriptionForeground)' }}>
        {request.service}/{request.operation} • SOAPAction: {request.soapAction}
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
    />
  )
}

export default SoapRequestTabView
