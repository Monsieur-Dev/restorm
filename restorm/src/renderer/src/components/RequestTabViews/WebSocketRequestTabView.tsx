import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Handlebars } from '../../utils/handlebarsHelpers'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  VariableInputBox,
  InputBox,
  CodeEditor,
  KeyValueTable,
  SplitView,
  Pane,
  logger,
  type VariableDefinition,
  type KeyValueTableHandle
} from 'electron-core-ui/renderer'
import type { WebSocketRequest, WebSocketResponse, WebSocketMessage } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { useEnvironmentValues } from '../../contexts/useEnvironmentValues'
import {
  resolveEnvironmentVariables,
  type VariableContext
} from '../../services/VariableResolutionService'
import { executeWebSocketRequest, type WebSocketRequestInput } from '../../services/request/WebSocketRequestService'
import { BaseRequestTabView } from './BaseRequestTabView'
import { Badge } from '../Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'
import codeSnippetsTemplate from '../../resources/templates/code-snippets-websocket.hbs?raw'

// Compile the Handlebars template
const compiledTemplate = Handlebars.compile(codeSnippetsTemplate)

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

export interface WebSocketRequestTabViewProps {
  request: WebSocketRequest
}

export const WebSocketRequestTabView: React.FC<WebSocketRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { environments, selectedEnvId } = useEnvironmentContext()
  const { valuesByEnvId } = useEnvironmentValues()
  const handlebarsHelpers = useHandlebarsHelpers()
  
  const [url, setUrlState] = useState(request.url)
  const [event, setEventState] = useState(request.event ?? '')
  const [message, setMessageState] = useState(request.message)
  const [isSending, setIsSending] = useState(false)
  const [response, setResponse] = useState<WebSocketResponse | null>(null)
  
  const headersRef = useRef<KeyValueTableHandle | null>(null)
  const requestIdRef = useRef(request.id)
  
  useEffect(() => {
    if (requestIdRef.current !== request.id) {
      requestIdRef.current = request.id
      const rafId = requestAnimationFrame(() => {
        setUrlState(request.url)
        setEventState(request.event ?? '')
        setMessageState(request.message)
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
  const setEvent = useCallback((value: string): void => {
    setEventState(value)
    updateReactiveProperty(request, 'event', value ? value : undefined)
  }, [request])
  const setMessage = useCallback((value: string): void => {
    setMessageState(value)
    updateReactiveProperty(request, 'message', value)
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
    
    const input: WebSocketRequestInput = {
      request,
      url,
      protocol: request.protocol,
      event: event ? event : undefined,
      message,
      headers: request.headers,
      variableContext: environmentContext
    }
    
    executeWebSocketRequest(input, 5000)
      .then((res) => {
        setResponse(res)
        logger.info('WebSocket request completed', { url: res.requestUrl, connected: res.connected })
      })
      .catch((err: unknown) => {
        logger.error('WebSocket request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }
  
  const formatMessage = (msg: WebSocketMessage): string => {
    const prefix = msg.direction === 'sent' ? '→' : '←'
    const eventStr = msg.event ? `[${msg.event}] ` : ''
    return `${prefix} ${eventStr}${msg.data}`
  }
  
  // Parse host and port from URL
  const hostInfo = useMemo(() => {
    try {
      const urlObj = new URL(url.replace(/^ws/, 'http'))
      return {
        host: urlObj.hostname,
        port: urlObj.port || (url.startsWith('wss') ? '443' : '80')
      }
    } catch {
      return { host: url, port: '80' }
    }
  }, [url])
  
  // Request content (SplitView with Message, Headers)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
      <Pane title={t('websocket.tabs.message')} initialSize={0.7} minSize={150}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(request.protocol === 'socketio' || request.protocol === 'mqtt') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
              <span style={{ fontSize: 12 }}>{request.protocol === 'mqtt' ? t('websocket.topic') : t('websocket.event')}:</span>
              <div style={{ flex: 1 }}>
                <InputBox
                  value={event}
                  onChange={setEvent}
                  options={{ placeholder: request.protocol === 'mqtt' ? 'topic/name' : 'event-name' }}
                />
              </div>
            </div>
          )}
          <div style={{ flex: 1, border: '1px solid var(--panel-border)', borderRadius: 3 }}>
            <CodeEditor
              height="100%"
              language="json"
              value={message}
              onChange={(v) => { setMessage(v ?? '{}') }}
              options={{ minimap: { enabled: false }, wordWrap: 'on', automaticLayout: true }}
            />
          </div>
        </div>
      </Pane>
      <Pane
        title={t('websocket.tabs.headers')}
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
    
    return compiledTemplate({
      url,
      host: hostInfo.host,
      port: hostInfo.port,
      protocol: request.protocol,
      event: event || null,
      topic: event || null,
      message: message || '{}',
      headers: headersData.length > 0 ? headersData : null,
      isNativeWebSocket: request.protocol === 'websocket',
      isSocketIO: request.protocol === 'socketio',
      isMQTT: request.protocol === 'mqtt',
      isPublish: true,
      isSubscribe: true
    })
  }, [url, hostInfo, request.protocol, request.headers, event, message])
  
  // Infos content (detailed info panel)
  const infosContent = response ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Status:</span>
        <span style={{ color: response.connected ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)' }}>
          {response.connected ? t('websocket.connected') : t('websocket.disconnected')}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Duration:</span>
        <span>{response.timings.durationMs}ms</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Protocol:</span>
        <span>{request.protocol}</span>
      </div>
      {request.event && (
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 100 }}>Event:</span>
          <span>{request.event}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, minWidth: 100 }}>Messages:</span>
        <span>{response.messages.length}</span>
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
  
  // Response content - messages list
  const responseContent = response && response.messages.length > 0 ? (
    <div style={{ height: '100%', overflow: 'auto', fontFamily: 'var(--editor-font-family)', fontSize: 12 }}>
      {response.messages.map((msg, i) => (
        <div
          key={i}
          style={{
            padding: '4px 8px',
            marginBottom: 4,
            borderRadius: 3,
            background: msg.direction === 'sent' ? 'var(--editor-selectionBackground)' : 'var(--editor-inactiveSelectionBackground)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}
        >
          {formatMessage(msg)}
        </div>
      ))}
      {response.messages.length === 0 && (
        <div style={{ color: 'var(--descriptionForeground)' }}>
          {t('websocket.noMessages')}
        </div>
      )}
    </div>
  ) : null
  
  // URL section
  const urlSection = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Badge type={mapToBadgeType(request.protocol)} />
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
        <VariableInputBox
          value={url}
          onChange={setUrl}
          variables={envVariables}
          helpers={handlebarsHelpers}
          placeholder={t('websocket.urlPlaceholder')}
        />
      </div>
      <Button onClick={handleSend} options={{ title: t('websocket.connect'), ariaLabel: t('websocket.connect') }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className="codicon codicon-plug" />
          <span>{t('websocket.connect')}</span>
        </span>
      </Button>
    </div>
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

export default WebSocketRequestTabView
