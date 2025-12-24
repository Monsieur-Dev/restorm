import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Handlebars } from '../../utils/handlebarsHelpers'
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
import codeSnippetsTemplate from '../../resources/templates/code-snippets-httprequests.hbs?raw'
import type { HTTPRequest, HTTPResponse, HTTPMethod, KeyValue } from '../../types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'
import type { VariableContext } from '../RestormKeyValueTable'
import { executeHTTPRequest, resolveRequestURL, type HTTPRequestInput } from '../../services/request/HTTPRequestService'
import { BaseRequestTabView } from './BaseRequestTabView'
import { Badge } from '../Badge'
import { mapToBadgeType } from '../../utils/badgeUtils'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  Object.assign(obj, { [key]: value })
}

// Compile the code snippets Handlebars template
const compiledTemplate = Handlebars.compile(codeSnippetsTemplate)

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
  const { environments: _environments, selectedEnvId: _selectedEnvId } = useEnvironmentContext()
  void _environments // TODO: will be used when variable resolution is implemented in backend
  void _selectedEnvId
  const handlebarsHelpers = useHandlebarsHelpers()
  
  const [method, setMethod] = useState<string>(request.method)
  const [url, setUrl] = useState<string>(request.url)
  const [body, setBody] = useState<string>(getBodyContent(request))
  const [bodyMode, setBodyMode] = useState<'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'>(getBodyMode(request))
  const [bodyFilePath, setBodyFilePath] = useState<string>(getBodyFilePath(request))
  const [isSending, setIsSending] = useState<boolean>(false)
  const [httpResponse, setHttpResponse] = useState<HTTPResponse | null>(null)
  
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

  // TODO: Variable resolution will be implemented in backend
  const environmentContext = useMemo<VariableContext>(() => ({}), [])
  const envVariables = useMemo<VariableDefinition[]>(() => [], [])

  const resolvedUrlResult = useMemo(
    () => resolveRequestURL({
      urlTemplate: url,
      pathParams: request.pathParams ?? [],
      queryParams: request.params,
      environmentContext
    }),
    [url, request.pathParams, request.params, environmentContext]
  )

  const resolvedUrl = resolvedUrlResult.url

  const methodOptions = useMemo<ISelectOptionItem[]>(
    () => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((verb) => ({
      text: verb,
      label: <Badge type={mapToBadgeType(verb)} />
    })),
    []
  )

  const handleSend = useCallback((): void => {
    if (isSending) return
    setIsSending(true)
    setHttpResponse(null)

    const requestInput: HTTPRequestInput = {
      request,
      method: method as HTTPMethod,
      url,
      headers: request.headers,
      params: request.params,
      pathParams: request.pathParams ?? [],
      bodyContent: body,
      bodyMode,
      formFields: (bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded')
        ? (request.body?.type === 'form-data' || request.body?.type === 'x-www-form-urlencoded' ? request.body.fields : [])
        : [],
      filePath: bodyFilePath,
      variableContext: environmentContext
    }

    executeHTTPRequest(requestInput)
      .then((response) => {
        setHttpResponse(response)
        logger.info('HTTP request completed', {
          url: response.requestUrl,
          status: response.statusCode,
          duration: response.timings.durationMs
        })
      })
      .catch((err: unknown) => {
        logger.error('HTTP request failed', { error: String(err) })
      })
      .finally(() => {
        setIsSending(false)
      })
  }, [isSending, request, method, url, body, bodyMode, bodyFilePath, environmentContext])

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
          variables={envVariables}
          helpers={handlebarsHelpers}
          initialRows={request.headers}
          onRowsChange={(rows): void => { updateReactiveProperty(request, 'headers', rows) }}
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
          variables={envVariables}
          helpers={handlebarsHelpers}
          initialRows={request.pathParams ?? []}
          onRowsChange={(rows): void => { updateReactiveProperty(request, 'pathParams', rows) }}
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
          variables={envVariables}
          helpers={handlebarsHelpers}
          initialRows={request.params}
          onRowsChange={(rows): void => { updateReactiveProperty(request, 'params', rows) }}
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
                variables={envVariables}
                helpers={handlebarsHelpers}
                initialRows={request.body?.type === 'form-data' || request.body?.type === 'x-www-form-urlencoded' ? request.body.fields : []}
                onRowsChange={(rows): void => { updateReactiveProperty(request, 'body', { type: bodyMode, fields: rows }) }}
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

  // Generate code snippets
  const codeSnippetsContent = useMemo(() => {
    let host = '', pathOnly = '', baseUrl = ''
    try {
      const urlObj = new URL(resolvedUrl.startsWith('http') ? resolvedUrl : `https://${resolvedUrl}`)
      host = urlObj.host
      pathOnly = urlObj.pathname
      baseUrl = `${urlObj.protocol}//${urlObj.host}`
    } catch {
      host = resolvedUrl
      pathOnly = '/'
      baseUrl = resolvedUrl
    }

    const headersData = request.headers.filter(h => h.key).map(h => ({ key: h.key, value: h.value }))
    const paramsData = request.params.filter(p => p.key).map(p => ({ key: p.key, value: p.value }))
    const pathParamsData = (request.pathParams ?? []).filter(p => p.key).map(p => ({ key: p.key, value: p.value }))

    let bodyContent: string | null = null
    if (bodyMode === 'text' && body) {
      bodyContent = body
    } else if ((bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded') && request.body?.type === bodyMode) {
      const fields = request.body.fields.filter(f => f.key)
      if (fields.length > 0) {
        bodyContent = bodyMode === 'form-data'
          ? fields.map(f => `${f.key}=${f.value}`).join('&')
          : fields.map(f => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`).join('&')
      }
    }

    const capitalMethod = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase()

    return compiledTemplate({
      method,
      lowerMethod: method.toLowerCase(),
      capitalMethod,
      url: resolvedUrl,
      host,
      path: pathOnly,
      baseUrl,
      headers: headersData.length > 0 ? headersData : null,
      params: paramsData.length > 0 ? paramsData : null,
      pathParams: pathParamsData.length > 0 ? pathParamsData : null,
      body: bodyContent,
      bodyMode,
      hasHeaders: headersData.length > 0,
      hasParams: paramsData.length > 0,
      hasPathParams: pathParamsData.length > 0,
      hasBody: !!bodyContent
    })
  }, [method, resolvedUrl, request.headers, request.params, request.pathParams, request.body, body, bodyMode])

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
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 15 }}>
        <RestormVariableInputBox
          value={url}
          onChange={(value: string) => { setUrl(value) }}
          variables={envVariables}
          helpers={handlebarsHelpers}
          resolvedValue={resolvedUrl}
          placeholder={t('requestTab.urlPlaceholder')}
        />
      </div>
      <Button onClick={handleSend} options={{ title: t('requestTab.send'), ariaLabel: t('requestTab.send') }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className="codicon codicon-send" aria-hidden="true" />
          <span>{t('requestTab.send')}</span>
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
      showResponse={httpResponse !== null}
      infosContent={infosContent}
      responseContent={responseContent}
      jsonData={jsonData}
    />
  )
}

export default HTTPRequestTabView
