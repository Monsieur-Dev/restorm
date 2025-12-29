import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import {
  Button,
  SelectBox,
  SplitView,
  Pane,
  RadioGroup,
  InputBox,
  CodeEditor,
  ListView,
  logger,
  type VariableDefinition,
  type ISelectOptionItem,
  type ISelectData,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import { RestormVariableInputBox } from '../RestormVariableInputBox'
import { RestormKeyValueTable, type KeyValueTableHandle } from '../RestormKeyValueTable'
import type { HTTPRequest, HTTPResponse, HTTPMethod, KeyValue } from '../../types/collections'
import type { KeyValueTableRow } from 'electron-core-ui/renderer'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import { BaseRequestTabView } from './BaseRequestTabView'
import { Badge } from '../Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

export interface HTTPRequestTabViewProps {
  request: HTTPRequest
}

/** Determine body mode from request body type */
function getBodyMode(request: HTTPRequest): 'text' | 'form-data' | 'x-www-form-urlencoded' | 'file' {
  if (!request.body) return 'text'
  switch (request.body.type) {
    case 'text': return 'text'
    case 'file': return 'file'
    case 'form-data': return 'form-data'
    case 'x-www-form-urlencoded': return 'x-www-form-urlencoded'
    default: return 'text'
  }
}

/** Get body content for text mode */
function getBodyContent(request: HTTPRequest): string {
  if (request.body?.type === 'text') {
    return request.body.content
  }
  return ''
}

/** Get body file path for file mode */
function getBodyFilePath(request: HTTPRequest): string {
  if (request.body?.type === 'file') {
    return request.body.path
  }
  return ''
}

/** Format duration in a human-readable way */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Format bytes in a human-readable way */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Get status color based on status code */
function getStatusColor(statusCode: number): 'green' | 'red' | 'orange' {
  if (statusCode >= 200 && statusCode < 300) return 'green'
  if (statusCode >= 300 && statusCode < 400) return 'orange'
  return 'red'
}

/** Convert KeyValue array to ListView items */
function keyValuesToListItems(keyValues: KeyValue[], prefix: string): ListViewItemData[] {
  return keyValues.map((kv, index) => ({
    id: `${prefix}-${index}`,
    icon: 'blank',
    title: (
      <span style={{ display: 'flex', gap: 8 }}>
        <span style={{ fontWeight: 600, color: 'var(--symbolIcon-propertyForeground)' }}>{kv.key}</span>
        <span style={{ color: 'var(--descriptionForeground)' }}>{kv.value}</span>
      </span>
    )
  }))
}

export const HTTPRequestTabView: React.FC<HTTPRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { selectedEnvId } = useEnvironmentContext()
  const handlebarsHelpers = useHandlebarsHelpers()
  const previousEnvIdRef = useRef<string | null>(null)
  
  const [method, setMethod] = useState<string>(request.method)
  const [url, setUrl] = useState<string>(request.url)
  const [body, setBody] = useState<string>(getBodyContent(request))
  const [bodyMode, setBodyMode] = useState<'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'>(getBodyMode(request))
  const [bodyFilePath, setBodyFilePath] = useState<string>(getBodyFilePath(request))
  const [isSending, setIsSending] = useState<boolean>(false)
  const [httpResponse, setHttpResponse] = useState<HTTPResponse | null>(null)
  
  // Backend-provided resolved URL and code snippets
  const [resolvedUrl, setResolvedUrl] = useState<string>('')
  const [backendCodeSnippets, setBackendCodeSnippets] = useState<string>('')
  
  const headersParamsRef = useRef<KeyValueTableHandle | null>(null)
  const queryParamsRef = useRef<KeyValueTableHandle | null>(null)
  const pathParamsRef = useRef<KeyValueTableHandle | null>(null)
  const requestIdRef = useRef<string>(request.id)

  // Reset local state when switching to a different request
  useEffect(() => {
    if (requestIdRef.current !== request.id) {
      requestIdRef.current = request.id
      const rafId = requestAnimationFrame(() => {
        setMethod(request.method)
        setUrl(request.url)
        setBody(getBodyContent(request))
        setBodyMode(getBodyMode(request))
        setBodyFilePath(getBodyFilePath(request))
        setHttpResponse(null)
      })
      return (): void => { cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [request])

  // Convert KeyValue arrays to plain objects for IPC
  const toKeyValueData = useCallback((kvs: KeyValue[]): { id?: string; key: string; value: string; enabled?: boolean }[] =>
    kvs.map(kv => {
      const result: { id?: string; key: string; value: string; enabled?: boolean } = { key: kv.key, value: kv.value }
      if (kv.id !== undefined) result.id = kv.id
      if (kv.enabled !== undefined) result.enabled = kv.enabled
      return result
    }), [])

  // Subscribe to backend URL and code snippets updates
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return

    const unsubUrl = window.restorm?.context?.onUrlResolved((result) => {
      if (result.requestId === requestId) {
        setResolvedUrl(result.resolvedUrl)
      }
    })

    const unsubSnippets = window.restorm?.context?.onCodeSnippetsUpdated((result) => {
      if (result.requestId === requestId) {
        setBackendCodeSnippets(result.markdown)
      }
    })

    // Get initial values if they exist
    void window.restorm?.context?.getResolvedUrl(requestId).then((result) => {
      if (result) setResolvedUrl(result.resolvedUrl)
    })
    void window.restorm?.context?.getCodeSnippets(requestId).then((result) => {
      if (result) setBackendCodeSnippets(result.markdown)
    })

    return () => {
      unsubUrl?.()
      unsubSnippets?.()
    }
  }, [request.id])

  // Refs to capture initial values for registration (avoid re-running effect when these change)
  const selectedEnvIdRef = useRef(selectedEnvId)
  const requestRef = useRef(request)
  useEffect(() => { selectedEnvIdRef.current = selectedEnvId }, [selectedEnvId])
  useEffect(() => { requestRef.current = request }, [request])

  // Register request with ContextService on mount, unregister on unmount
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return

    const currentEnvId = selectedEnvIdRef.current
    const currentRequest = requestRef.current
    logger.debug('[HTTPRequestTabView] Registering request with ContextService', { requestId, selectedEnvId: currentEnvId })

    void window.restorm?.context?.registerRequest(requestId, currentEnvId ?? null, {
      headers: toKeyValueData(currentRequest.headers),
      params: toKeyValueData(currentRequest.params),
      pathParams: currentRequest.pathParams ? toKeyValueData(currentRequest.pathParams) : []
    })

    previousEnvIdRef.current = currentEnvId ?? null

    return () => {
      logger.debug('[HTTPRequestTabView] Unregistering request from ContextService', { requestId })
      void window.restorm?.context?.unregisterRequest(requestId)
    }
  }, [request.id, toKeyValueData])

  // Notify ContextService when selected environment changes
  useEffect(() => {
    const requestId = request.id
    if (!requestId) return

    const currentEnvId = selectedEnvId ?? null
    if (previousEnvIdRef.current !== currentEnvId) {
      logger.debug('[HTTPRequestTabView] Environment changed, notifying ContextService', {
        requestId,
        previousEnvId: previousEnvIdRef.current,
        newEnvId: currentEnvId
      })
      void window.restorm?.context?.setRequestEnvironment(requestId, currentEnvId)
      previousEnvIdRef.current = currentEnvId
    }
  }, [selectedEnvId, request.id])

  // Sync method changes to reactive object
  useEffect(() => {
    if (method !== request.method && requestIdRef.current === request.id) {
      updateReactiveProperty(request, 'method', method as HTTPMethod)
    }
  }, [method, request])

  // Sync url changes to reactive object
  useEffect(() => {
    if (url !== request.url && requestIdRef.current === request.id) {
      updateReactiveProperty(request, 'url', url)
    }
  }, [url, request])

  // Sync body changes to reactive object
  useEffect(() => {
    if (requestIdRef.current !== request.id) return
    if (bodyMode === 'text') {
      const currentContent = request.body?.type === 'text' ? request.body.content : ''
      if (body !== currentContent) {
        updateReactiveProperty(request, 'body', { type: 'text', content: body })
      }
    } else if (bodyMode === 'file') {
      const currentPath = request.body?.type === 'file' ? request.body.path : ''
      if (bodyFilePath !== currentPath) {
        updateReactiveProperty(request, 'body', { type: 'file', path: bodyFilePath })
      }
    }
  }, [body, bodyMode, bodyFilePath, request])

  // Send full request data to backend for URL resolution and code snippets
  useEffect(() => {
    const requestId = request.id
    if (!requestId || requestIdRef.current !== request.id) return

    // Build body data
    let bodyData: { type: string; content?: string; path?: string; fields?: { id?: string; key: string; value: string }[] } | undefined
    if (bodyMode === 'text' && body) {
      bodyData = { type: 'text', content: body }
    } else if (bodyMode === 'file' && bodyFilePath) {
      bodyData = { type: 'file', path: bodyFilePath }
    } else if ((bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded') && request.body?.type === bodyMode) {
      bodyData = { type: bodyMode, fields: toKeyValueData(request.body.fields) }
    }

    void window.restorm?.context?.updateFullRequestData(requestId, {
      id: requestId,
      requestType: 'http',
      url,
      method,
      headers: toKeyValueData(request.headers),
      params: toKeyValueData(request.params),
      pathParams: request.pathParams ? toKeyValueData(request.pathParams) : [],
      body: bodyData
    })
  }, [request.id, url, method, request.headers, request.params, request.pathParams, body, bodyMode, bodyFilePath, request.body, toKeyValueData])
  
  // Stable empty array for components that get variables via their own variableId
  const emptyVariables = useMemo<VariableDefinition[]>(() => [], [])
  
  // URL field variableId (for receiving its specific available variables)
  const urlVariableId = useMemo(() => `${request.id}:url`, [request.id])
  
  // Available variables for URL field autocompletion (env + all path params)
  const [urlVariables, setUrlVariables] = useState<VariableDefinition[]>([])
  
  // Listen for URL field available variables from backend
  useEffect(() => {
    const varId = urlVariableId
    if (!varId || varId === 'undefined:url') return
    
    const unsubscribe = window.restorm?.context?.onAvailableVariables((result) => {
      if (result.variableId === varId) {
        setUrlVariables(prev => {
          const newVars = result.variables
          if (prev.length !== newVars.length) return newVars
          const hasChanges = newVars.some((v, i) => {
            const prevItem = prev[i]
            return prevItem && (prevItem.name !== v.name || prevItem.value !== v.value)
          })
          return hasChanges ? newVars : prev
        })
      }
    })
    
    return () => { unsubscribe() }
  }, [urlVariableId])

  // Callbacks for KeyValue changes - notify both reactive object and ContextService
  const handleHeadersChange = useCallback((rows: KeyValueTableRow[]): void => {
    updateReactiveProperty(request, 'headers', rows as KeyValue[])
    const requestId = request.id
    if (requestId) {
      void window.restorm?.context?.updateRequestKeyValues(
        requestId,
        'headers',
        rows.map(r => ({ id: r.id, key: r.key, value: r.value, enabled: r.enabled }))
      )
    }
  }, [request])

  const handleParamsChange = useCallback((rows: KeyValueTableRow[]): void => {
    updateReactiveProperty(request, 'params', rows as KeyValue[])
    const requestId = request.id
    if (requestId) {
      void window.restorm?.context?.updateRequestKeyValues(
        requestId,
        'params',
        rows.map(r => ({ id: r.id, key: r.key, value: r.value, enabled: r.enabled }))
      )
    }
  }, [request])

  const handlePathParamsChange = useCallback((rows: KeyValueTableRow[]): void => {
    updateReactiveProperty(request, 'pathParams', rows as KeyValue[])
    const requestId = request.id
    if (requestId) {
      void window.restorm?.context?.updateRequestKeyValues(
        requestId,
        'pathParams',
        rows.map(r => ({ id: r.id, key: r.key, value: r.value, enabled: r.enabled }))
      )
    }
  }, [request])

  const methodOptions = useMemo<ISelectOptionItem[]>(
    () => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((verb) => ({
      text: verb,
      label: <Badge type={mapToBadgeType(verb)} />
    })),
    []
  )

  const handleSend = useCallback((): void => {
    if (isSending) return
    const requestId = request.id
    if (!requestId) {
      logger.error('Cannot send request without ID')
      return
    }
    setIsSending(true)
    setHttpResponse(null)

    // Execute via backend
    window.restorm?.http?.execute({
      requestId,
      method,
      timeout: 30000
    })
      .then((result) => {
        if (result.success) {
          // Convert backend result to HTTPResponse format
          const responseHeaders: KeyValue[] = []
          if (result.headers) {
            for (const [key, value] of Object.entries(result.headers)) {
              responseHeaders.push({
                key,
                value: Array.isArray(value) ? value.join(', ') : value
              })
            }
          }

          const contentTypeHeader = result.headers?.['content-type']
          const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
          const contentLengthHeader = result.headers?.['content-length']
          const contentLengthStr = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader
          const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined

          const response: HTTPResponse = {
            id: `resp_${Date.now()}`,
            type: 'http',
            requestId,
            requestUrl: result.requestUrl ?? '',
            requestMethod: method as HTTPMethod,
            requestHeaders: request.headers,
            requestParams: request.params,
            requestPathParams: request.pathParams,
            statusCode: result.statusCode ?? 0,
            statusText: result.statusText ?? '',
            responseHeaders,
            responseBody: result.body ?? '',
            timings: result.timings,
            ...(request.body && { requestBody: request.body }),
            ...(contentType && { contentType }),
            ...(contentLength !== undefined && !isNaN(contentLength) && { contentLength })
          }
          setHttpResponse(response)
          logger.info('HTTP request completed', {
            url: result.requestUrl,
            status: result.statusCode,
            duration: result.timings.durationMs
          })
        } else {
          // Handle error
          const errorResponse: HTTPResponse = {
            id: `resp_${Date.now()}`,
            type: 'http',
            requestId,
            requestUrl: result.requestUrl ?? url,
            requestMethod: method as HTTPMethod,
            requestHeaders: request.headers,
            requestParams: request.params,
            requestPathParams: request.pathParams,
            statusCode: 0,
            statusText: 'Error',
            responseHeaders: [],
            responseBody: '',
            error: result.error,
            timings: result.timings,
            ...(request.body && { requestBody: request.body })
          }
          setHttpResponse(errorResponse)
          logger.error('HTTP request failed', { error: result.error })
        }
      })
      .catch((err: unknown) => {
        logger.error('HTTP request execution error', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }, [isSending, request, method, url])

  const handleCancel = useCallback((): void => {
    const requestId = request.id
    if (!requestId) return
    window.restorm?.http?.cancel(requestId)
      .then((cancelled) => {
        if (cancelled) {
          logger.info('HTTP request cancelled', { requestId })
        }
      })
      .catch((err: unknown) => {
        logger.error('Failed to cancel HTTP request', { error: String(err) })
      })
  }, [request.id])

  // Request content (SplitView with Panes)
  const requestContent = (
    <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
      <Pane
        title={t('requestTab.tabs.authorization').toUpperCase()}
        initialSize={0.15}
        collapsed
        minSize={120}
      >
        <div style={{ height: '100%', boxSizing: 'border-box', padding: 8 }}>
          {/* Authorization configuration UI will be added here */}
        </div>
      </Pane>
      <Pane
        title={t('requestTab.tabs.headers')}
        initialSize={0.2}
        collapsed={request.headers.length === 0}
        minSize={150}
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            secondary
            small
            options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
            onClick={() => {
              if (collapsed) toggle()
              headersParamsRef.current?.addRow()
            }}
          >
            <i className="codicon codicon-add" />
          </Button>
        )}
      >
        <RestormKeyValueTable
          ref={headersParamsRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={handleHeadersChange}
        />
      </Pane>
      <Pane
        title={t('requestTab.tabs.pathParams')}
        initialSize={0.2}
        collapsed={(request.pathParams?.length ?? 0) === 0}
        minSize={150}
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            small
            secondary
            options={{ ariaLabel: t('requestTab.addParam'), title: t('requestTab.addParam') }}
            onClick={() => {
              if (collapsed) toggle()
              pathParamsRef.current?.addRow()
            }}
          >
            <i className="codicon codicon-add" />
          </Button>
        )}
      >
        <RestormKeyValueTable
          ref={pathParamsRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.pathParams ?? []}
          onRowsChange={handlePathParamsChange}
        />
      </Pane>
      <Pane
        title={t('requestTab.tabs.params')}
        initialSize={0.2}
        collapsed={request.params.length === 0}
        minSize={150}
        headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
          <Button
            small
            secondary
            options={{ ariaLabel: t('requestTab.addParam'), title: t('requestTab.addParam') }}
            onClick={() => {
              if (collapsed) toggle()
              queryParamsRef.current?.addRow()
            }}
          >
            <i className="codicon codicon-add" />
          </Button>
        )}
      >
        <RestormKeyValueTable
          ref={queryParamsRef}
          variables={emptyVariables}
          helpers={handlebarsHelpers}
          initialRows={request.params}
          onRowsChange={handleParamsChange}
        />
      </Pane>
      <Pane title={t('requestTab.tabs.body')} initialSize={0.4}>
        <div style={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <RadioGroup
            options={{
              items: [
                { text: 'text', isActive: bodyMode === 'text' },
                { text: 'form-data', isActive: bodyMode === 'form-data' },
                { text: 'x-www-form-urlencoded', isActive: bodyMode === 'x-www-form-urlencoded' },
                { text: 'file', isActive: bodyMode === 'file' }
              ]
            }}
            onSelect={(index: number) => {
              const modes: ('text' | 'form-data' | 'x-www-form-urlencoded' | 'file')[] = ['text', 'form-data', 'x-www-form-urlencoded', 'file']
              setBodyMode(modes[index] ?? 'text')
            }}
          />
          <div style={{ flex: 1, minHeight: 0 }}>
            {bodyMode === 'text' && (
              <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }}>
                <CodeEditor
                  height="100%"
                  language="json"
                  value={body}
                  onChange={(value) => { setBody(value ?? '') }}
                  options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true }}
                />
              </div>
            )}
            {(bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded') && (
              <RestormKeyValueTable
                variables={emptyVariables}
                helpers={handlebarsHelpers}
                initialRows={request.body?.type === 'form-data' || request.body?.type === 'x-www-form-urlencoded' ? request.body.fields : []}
                onRowsChange={(rows): void => { updateReactiveProperty(request, 'body', { type: bodyMode, fields: rows as KeyValue[] }) }}
              />
            )}
            {bodyMode === 'file' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flexShrink: 0, fontSize: 12 }}>{t('requestTab.body.fileLabel')}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <InputBox options={{ placeholder: '', type: 'text' }} value={bodyFilePath} onChange={(value: string) => { setBodyFilePath(value) }} />
                </div>
                <Button options={{ ariaLabel: t('requestTab.body.browse'), title: t('requestTab.body.browse') }}>
                  {t('requestTab.body.browse')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Pane>
    </SplitView>
  )

  // Use backend-provided code snippets
  const codeSnippetsContent = backendCodeSnippets || t('requestTab.codeSnippets.loading', 'Loading code snippets...')

  // Build general info items for response
  const generalItems: ListViewItemData[] = useMemo(() => {
    if (!httpResponse) return []
    const items: ListViewItemData[] = [
      { id: 'general-request-url', icon: 'blank', title: <span style={{ display: 'flex', gap: 8 }}><span style={{ fontWeight: 600 }}>Request URL</span><span>{httpResponse.requestUrl}</span></span> },
      { id: 'general-request-method', icon: 'blank', title: <span style={{ display: 'flex', gap: 8 }}><span style={{ fontWeight: 600 }}>Request Method</span><span>{httpResponse.requestMethod}</span></span> },
      { id: 'general-status-code', icon: 'blank', title: <span style={{ display: 'flex', gap: 8 }}><span style={{ fontWeight: 600 }}>Status Code</span><span style={{ color: getStatusColor(httpResponse.statusCode) === 'green' ? 'var(--testing-iconPassed)' : getStatusColor(httpResponse.statusCode) === 'orange' ? 'var(--editorWarning-foreground)' : 'var(--testing-iconFailed)' }}>{httpResponse.statusCode} {httpResponse.statusText}</span></span> },
      { id: 'general-duration', icon: 'blank', title: <span style={{ display: 'flex', gap: 8 }}><span style={{ fontWeight: 600 }}>Duration</span><span>{formatDuration(httpResponse.timings.durationMs)}</span></span> }
    ]
    if (httpResponse.contentType) {
      items.push({ id: 'general-content-type', icon: 'blank', title: <span style={{ display: 'flex', gap: 8 }}><span style={{ fontWeight: 600 }}>Content-Type</span><span>{httpResponse.contentType}</span></span> })
    }
    if (httpResponse.contentLength !== undefined) {
      items.push({ id: 'general-content-length', icon: 'blank', title: <span style={{ display: 'flex', gap: 8 }}><span style={{ fontWeight: 600 }}>Content-Length</span><span>{formatBytes(httpResponse.contentLength)}</span></span> })
    }
    if (httpResponse.error) {
      items.push({ id: 'general-error', icon: 'blank', title: <span style={{ display: 'flex', gap: 8 }}><span style={{ fontWeight: 600 }}>Error</span><span style={{ color: 'var(--testing-iconFailed)' }}>{httpResponse.error}</span></span> })
    }
    return items
  }, [httpResponse])

  const responseHeaderItems = useMemo(() => httpResponse ? keyValuesToListItems(httpResponse.responseHeaders, 'resp-header') : [], [httpResponse])
  const requestHeaderItems = useMemo(() => httpResponse ? keyValuesToListItems(httpResponse.requestHeaders, 'req-header') : [], [httpResponse])

  const headersTreeItems: ListViewItemData[] = useMemo(() => [
    { id: 'group-general', title: 'General', icon: 'info', isExpandable: true, isExpanded: true, children: generalItems },
    { id: 'group-response-headers', title: `Response headers (${responseHeaderItems.length})`, icon: 'call-incoming', isExpandable: true, isExpanded: true, children: responseHeaderItems },
    { id: 'group-request-headers', title: `Request headers (${requestHeaderItems.length})`, icon: 'call-outgoing', isExpandable: true, isExpanded: true, children: requestHeaderItems }
  ], [generalItems, responseHeaderItems, requestHeaderItems])

  // Infos content (detailed info panel)
  const infosContent = httpResponse ? (
    <div style={{ height: '100%', boxSizing: 'border-box' }}>
      <ListView items={headersTreeItems} rootRole="tree" ariaLabel="HTTP request and response headers" />
    </div>
  ) : null

  // Response content (raw body)
  const formattedResponseBody = useMemo(() => {
    if (!httpResponse) return ''
    const responseBody = httpResponse.responseBody
    if (httpResponse.contentType?.includes('application/json')) {
      try {
        const parsed: unknown = JSON.parse(responseBody)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return responseBody
      }
    }
    return responseBody
  }, [httpResponse])

  const responseContent = httpResponse && formattedResponseBody ? (
    <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }}>
      <CodeEditor
        height="100%"
        language="json"
        value={formattedResponseBody}
        options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true, readOnly: true }}
      />
    </div>
  ) : null

  // Parse JSON for JsonCrack
  const jsonData = useMemo(() => {
    if (!httpResponse?.responseBody) return undefined
    if (!httpResponse.contentType?.includes('application/json')) return undefined
    try {
      return JSON.parse(httpResponse.responseBody) as unknown
    } catch {
      return undefined
    }
  }, [httpResponse])

  // URL section
  const urlSection = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 90, flexShrink: 0 }}>
        <SelectBox
          id="http-method-select"
          className=""
          options={methodOptions}
          selected={methodOptions.findIndex((opt) => opt.text === method)}
          onDidSelect={(data: ISelectData) => { setMethod(data.selected) }}
          selectBoxOptions={{ ariaLabel: t('requestTab.methodSelect'), useCustomDrawn: true }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 15 }} title={resolvedUrl || url}>
        <RestormVariableInputBox
          value={url}
          onChange={(value: string) => { setUrl(value) }}
          variables={urlVariables}
          helpers={handlebarsHelpers}
          placeholder={t('requestTab.urlPlaceholder')}
        />
      </div>
      {isSending ? (
        <Button onClick={handleCancel} options={{ title: t('requestTab.cancel'), ariaLabel: t('requestTab.cancel') }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <i className="codicon codicon-close" aria-hidden="true" />
            <span>{t('requestTab.cancel')}</span>
          </span>
        </Button>
      ) : (
        <Button onClick={handleSend} options={{ title: t('requestTab.send'), ariaLabel: t('requestTab.send') }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <i className="codicon codicon-send" aria-hidden="true" />
            <span>{t('requestTab.send')}</span>
          </span>
        </Button>
      )}
    </div>
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
      showResponse={httpResponse !== null}
      infosContent={infosContent}
      responseContent={responseContent}
      jsonData={jsonData}
    />
  )
}

export default HTTPRequestTabView
