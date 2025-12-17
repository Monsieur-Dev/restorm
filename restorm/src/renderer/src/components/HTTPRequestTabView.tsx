import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Handlebars from 'handlebars'
import {
  Button,
  ListViewDropdown,
  type ListViewItemData,
  VariableInputBox,
  Tabs,
  MarkdownEditor,
  MarkdownViewer,
  SelectBox,
  Sash,
  SplitView,
  Pane,
  RadioGroup,
  InputBox,
  CodeEditor,
  ProgressBar,
  IconSelect,
  KeyValueTable,
  logger
} from 'electron-core-ui/renderer'
import codeSnippetsTemplate from '../resources/templates/code-snippets.hbs?raw'

// Compile the code snippets Handlebars template
const compiledCodeSnippetsTemplate = Handlebars.compile(codeSnippetsTemplate)
import type {
  Tab,
  VariableDefinition,
  ISelectOptionItem,
  ISelectData,
  IVerticalSashLayoutProvider,
  SashEvent,
  KeyValueTableHandle
} from 'electron-core-ui/renderer'
import { HttpMethodBadge } from './HttpMethodBadge'
import { HTTPResponseView } from './HTTPResponseView'
import type { HTTPRequest, Environment, HTTPResponse, HTTPMethod } from '../types/collections'
import { useEnvironmentContext } from '../contexts/useEnvironmentContext'
import { useEnvironmentValues } from '../contexts/useEnvironmentValues'
import {
  resolveEnvironmentVariables,
  type VariableContext
} from '../services/VariableResolutionService'
import { executeHTTPRequest, resolveRequestURL, type HTTPRequestInput } from '../services/HTTPRequestService'

export interface HTTPRequestTabViewProps {
  /** The HTTP request to display */
  request: HTTPRequest
  /** Environments available for this request (from nearest ancestor folder) */
  environments?: Environment[]
}

/** Determine body mode from request body type */
function getBodyMode(request: HTTPRequest): 'text' | 'form-data' | 'x-www-form-urlencoded' | 'file' {
  if (!request.body) return 'text'
  switch (request.body.type) {
    case 'text':
      return 'text'
    case 'file':
      return 'file'
    case 'form-data':
      return 'form-data'
    case 'x-www-form-urlencoded':
      return 'x-www-form-urlencoded'
    default:
      return 'text'
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

/** Convert environments to ListView items */
function environmentsToListViewItems(
  environments: Environment[],
  expandedIds: string[]
): ListViewItemData[] {
  return environments.map((env) => ({
    id: env.id,
    title: env.name,
    isExpandable: (env.subEnvironments?.length ?? 0) > 0,
    isExpanded: expandedIds.includes(env.id),
    icon: !env.icon ? (expandedIds.includes(env.id) ? 'folder-opened' : 'folder') : undefined,
    leftActions: env.icon ? <IconSelect value={env.icon} readonly /> : undefined,
    children: env.subEnvironments ? environmentsToListViewItems(env.subEnvironments, expandedIds) : []
  }))
}

/** Collect all environment IDs recursively */
function collectEnvironmentIds(environments: Environment[]): string[] {
  const ids: string[] = []
  for (const env of environments) {
    ids.push(env.id)
    if (env.subEnvironments) {
      ids.push(...collectEnvironmentIds(env.subEnvironments))
    }
  }
  return ids
}

/** Find an environment by ID recursively */
function findEnvironmentById(environments: Environment[], id: string): Environment | null {
  for (const env of environments) {
    if (env.id === id) {
      return env
    }
    if (env.subEnvironments) {
      const found = findEnvironmentById(env.subEnvironments, id)
      if (found) return found
    }
  }
  return null
}

export const EnvironmentDropdown: React.FC = () => {
  const { t } = useTranslation()
  const { environments, selectedEnvId, setSelectedEnvId } = useEnvironmentContext()
  const [expandedIds, setExpandedIds] = useState<string[]>(() =>
    environments && environments.length > 0 ? collectEnvironmentIds(environments) : []
  )

  // Reset state when environments change
  useEffect(() => {
    if (environments && environments.length > 0) {
      setExpandedIds(collectEnvironmentIds(environments))
      // Keep current selected environment if still present (including sub-environments), otherwise default to first
      if (!selectedEnvId || !findEnvironmentById(environments, selectedEnvId)) {
        setSelectedEnvId(environments[0]?.id ?? null)
      }
    } else {
      setExpandedIds([])
      setSelectedEnvId(null)
    }
  }, [environments, selectedEnvId, setSelectedEnvId])

  const items = useMemo(
    () => (environments && environments.length > 0 ? environmentsToListViewItems(environments, expandedIds) : []),
    [environments, expandedIds]
  )

  const selectedEnvironment = useMemo(() => {
    if (!environments || environments.length === 0 || !selectedEnvId) {
      return null
    }
    return findEnvironmentById(environments, selectedEnvId)
  }, [environments, selectedEnvId])

  const selectedEnvironmentName = selectedEnvironment?.name ?? t('requestTab.environmentSelector.noEnvironment')

  if (!environments || environments.length === 0) {
    return null
  }

  return (
    <div
      style={{
        marginLeft: 8
      }}
    >
      <ListViewDropdown
        items={items}
        rootRole="tree"
        menuAriaLabel={t('requestTab.environmentSelector.listAriaLabel')}
        selectedIds={selectedEnvId ? [selectedEnvId] : []}
        expandedIds={expandedIds}
        buttonProps={{
          secondary: true,
          options: {
            ariaLabel: t('requestTab.environmentSelector.ariaLabel'),
            title: t('requestTab.environmentSelector.ariaLabel')
          }
        }}
        buttonContent={
          <>
            {selectedEnvironment?.icon && (
              <IconSelect value={selectedEnvironment.icon} readonly style={{ marginRight: 4 }} />
            )}
            <span style={{ marginRight: 4, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedEnvironmentName}
            </span>
            <i className="codicon codicon-chevron-down" />
          </>
        }
        onItemClick={(payload) => {
          const id = payload.item.id
          if (id) {
            setSelectedEnvId(id)
          }
        }}
        onItemToggle={(payload, expanded) => {
          const id = payload.item.id
          if (!id) return
          setExpandedIds((prev) =>
            expanded ? Array.from(new Set([...prev, id])) : prev.filter((existingId) => existingId !== id)
          )
        }}
      />
    </div>
  )
}

export const HTTPRequestTabView: React.FC<HTTPRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
  const { environments, selectedEnvId } = useEnvironmentContext()
  const { valuesByEnvId } = useEnvironmentValues()
  const [method, setMethod] = useState<string>(request.method)
  const [url, setUrl] = useState<string>(request.url)
  const [body, setBody] = useState<string>(getBodyContent(request))
  const [bodyMode, setBodyMode] = useState<'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'>(
    getBodyMode(request)
  )
  const [bodyFilePath, setBodyFilePath] = useState<string>(getBodyFilePath(request))
  const [activeTabId, setActiveTabId] = useState<string>('requestLayout')
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(0)
  const [isSending, setIsSending] = useState<boolean>(false)
  const [httpResponse, setHttpResponse] = useState<HTTPResponse | null>(null)
  const [resolvedQueryParamsContext, setResolvedQueryParamsContext] = useState<VariableContext>({})
  const [resolvedPathParamsContext, setResolvedPathParamsContext] = useState<VariableContext>({})
  const headersParamsRef = useRef<KeyValueTableHandle | null>(null)
  const queryParamsRef = useRef<KeyValueTableHandle | null>(null)
  const pathParamsRef = useRef<KeyValueTableHandle | null>(null)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const sashStartLeftRef = useRef<number>(leftPaneWidth)
  const sendTimeoutRef = useRef<number | null>(null)

  // Track request.id to detect when switching to a different request
  const requestIdRef = useRef<string>(request.id)

  // Reset local state when switching to a different request
  useEffect(() => {
    if (requestIdRef.current !== request.id) {
      requestIdRef.current = request.id
      setMethod(request.method)
      setUrl(request.url)
      setBody(getBodyContent(request))
      setBodyMode(getBodyMode(request))
      setBodyFilePath(getBodyFilePath(request))
    }
  }, [request])

  // Sync method changes to reactive object
  useEffect(() => {
    if (method !== request.method && requestIdRef.current === request.id) {
      request.method = method as HTTPMethod
    }
  }, [method, request])

  // Sync url changes to reactive object
  useEffect(() => {
    if (url !== request.url && requestIdRef.current === request.id) {
      request.url = url
    }
  }, [url, request])

  // Sync body changes to reactive object
  useEffect(() => {
    if (requestIdRef.current !== request.id) return
    if (bodyMode === 'text') {
      const currentContent = request.body?.type === 'text' ? request.body.content : ''
      if (body !== currentContent) {
        request.body = { type: 'text', content: body }
      }
    } else if (bodyMode === 'file') {
      const currentPath = request.body?.type === 'file' ? request.body.path : ''
      if (bodyFilePath !== currentPath) {
        request.body = { type: 'file', path: bodyFilePath }
      }
    }
    // form-data and x-www-form-urlencoded are handled by KeyValueTable onRowsChange
  }, [body, bodyMode, bodyFilePath, request])

  const runtimeEnvironmentContext = useMemo<VariableContext | undefined>(
    () => (selectedEnvId ? valuesByEnvId[selectedEnvId] : undefined),
    [valuesByEnvId, selectedEnvId]
  )

  const environmentContext = useMemo<VariableContext>(
    () => {
      if (runtimeEnvironmentContext) {
        return runtimeEnvironmentContext
      }
      return resolveEnvironmentVariables(environments ?? [], selectedEnvId)
    },
    [runtimeEnvironmentContext, environments, selectedEnvId]
  )

  const environmentVariablesForInputs = useMemo<VariableDefinition[]>(
    () =>
      Object.entries(environmentContext).map(([name, value]) => ({
        name,
        value,
        description: ''
      })),
    [environmentContext]
  )

  const combinedContextForBodyAndUrl = useMemo<VariableContext>(
    () => ({
      ...environmentContext,
      ...resolvedPathParamsContext,
      ...resolvedQueryParamsContext
    }),
    [environmentContext, resolvedPathParamsContext, resolvedQueryParamsContext]
  )

  // Convert request params to variables for autocomplete
  const urlVariables = useMemo<VariableDefinition[]>(
    () =>
      Object.entries(combinedContextForBodyAndUrl).map(([name, value]) => ({
        name,
        value,
        description: ''
      })),
    [combinedContextForBodyAndUrl]
  )

  // Build path params KeyValue[] from resolved context
  const pathParamsForUrl = useMemo(
    () => Object.entries(resolvedPathParamsContext).map(([key, value]) => ({ key, value })),
    [resolvedPathParamsContext]
  )

  // Build query params KeyValue[] from resolved context
  const queryParamsForUrl = useMemo(
    () => Object.entries(resolvedQueryParamsContext).map(([key, value]) => ({ key, value })),
    [resolvedQueryParamsContext]
  )

  // Use the service to resolve the URL (centralized logic)
  const resolvedUrlResult = useMemo(
    () =>
      resolveRequestURL({
        urlTemplate: url,
        pathParams: pathParamsForUrl,
        queryParams: queryParamsForUrl,
        environmentContext: environmentContext
      }),
    [url, pathParamsForUrl, queryParamsForUrl, environmentContext]
  )

  const resolvedUrl = resolvedUrlResult.url

  const methodOptions = useMemo<ISelectOptionItem[]>(
    () =>
      [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
        'OPTIONS'
      ].map((verb) => ({
        text: verb,
        label: <HttpMethodBadge method={verb} />
      })),
    []
  )

  const renderRequestModalTitle = useCallback((tabLabel: string): React.ReactNode => {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <HttpMethodBadge method={method} />
        <span>{request.name}{tabLabel ? ` - ${tabLabel}` : ''}</span>
      </span>
    )
  }, [method, request.name])

  // Generate code snippets markdown
  const codeSnippetsMarkdown = useMemo(() => {
    // Parse URL to extract host and path
    let host = ''
    let path = ''
    let baseUrl = ''
    try {
      const urlObj = new URL(resolvedUrl.startsWith('http') ? resolvedUrl : `https://${resolvedUrl}`)
      host = urlObj.host
      path = urlObj.pathname + urlObj.search
      baseUrl = `${urlObj.protocol}//${urlObj.host}`
    } catch {
      // If URL parsing fails, use the raw URL
      host = resolvedUrl
      path = '/'
      baseUrl = resolvedUrl
    }

    // Prepare headers array
    const headers = request.headers
      .filter(h => h.key)
      .map(h => ({ key: h.key, value: h.value }))

    // Prepare body content
    let bodyContent = ''
    if (request.body?.type === 'text' && request.body.content) {
      bodyContent = request.body.content
    }

    // Capitalize method for C#/Ruby
    const capitalMethod = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase()

    return compiledCodeSnippetsTemplate({
      method,
      lowerMethod: method.toLowerCase(),
      capitalMethod,
      url: resolvedUrl,
      host,
      path,
      baseUrl,
      headers,
      body: bodyContent || null
    })
  }, [method, resolvedUrl, request.headers, request.body])

  const tabs: Tab[] = [
    {
      id: 'requestLayout',
      label: t('requestTab.tabs.requestLayout'),
      useScrollableElement: false,
      allowFullscreen: true,
      fullscreenModalTitle: renderRequestModalTitle(t('requestTab.tabs.requestLayout')),
      content: (
        <SplitView
          orientation="vertical"
          style={{ width: '100%', height: '100%' }}
        >
          <Pane
            title={t('requestTab.tabs.authorization').toUpperCase()}
            initialSize={0.2}
            collapsed
            minSize={120}
          >
            <div
              style={{
                height: '100%',
                boxSizing: 'border-box',
                padding: 8
              }}
            >
              {/* Authorization configuration UI will be added here */}
            </div>
          </Pane>
          <Pane
            title={t('requestTab.tabs.headers')}
            initialSize={0.25}
            collapsed={request.headers.length === 0}
            minSize={150}
            headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
              <Button
                secondary
                small
                options={{ ariaLabel: t('requestTab.addHeader'), title: t('requestTab.addHeader') }}
                onClick={() => {
                  if (collapsed) {
                    toggle()
                  }
                  headersParamsRef.current?.addRow()
                }}
              >
                <i className="codicon codicon-add" />
              </Button>
            )}
          >
            <KeyValueTable
              ref={headersParamsRef}
              // Headers can only see environment variables inside their fields
              variables={environmentVariablesForInputs}
              initialRows={request.headers}
              visibilityMode="base-only"
              onRowsChange={(rows) => {
                request.headers = rows
              }}
            />
          </Pane>
          <Pane
            title={t('requestTab.tabs.pathParams')}
            initialSize={0.25}
            collapsed={(request.pathParams?.length ?? 0) === 0}
            minSize={150}
            headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
              <Button
                small
                secondary
                options={{ ariaLabel: t('requestTab.addParam'), title: t('requestTab.addParam') }}
                onClick={() => {
                  if (collapsed) {
                    toggle()
                  }
                  pathParamsRef.current?.addRow()
                }}
              >
                <i className="codicon codicon-add" />
              </Button>
            )}
          >
            <KeyValueTable
              ref={pathParamsRef}
              // Path params can only see environment variables, but their resolved
              // values contribute to the context for body and URL.
              variables={environmentVariablesForInputs}
              initialRows={request.pathParams ?? []}
              visibilityMode="base-only"
              onResolvedContextChange={setResolvedPathParamsContext}
              onRowsChange={(rows) => {
                request.pathParams = rows
              }}
            />
          </Pane>
          <Pane
            title={t('requestTab.tabs.params')}
            initialSize={0.25}
            collapsed={request.params.length === 0}
            minSize={150}
            headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
              <Button
                small
                secondary
                options={{ ariaLabel: t('requestTab.addParam'), title: t('requestTab.addParam') }}
                onClick={() => {
                  if (collapsed) {
                    toggle()
                  }
                  queryParamsRef.current?.addRow()
                }}
              >
                <i className="codicon codicon-add" />
              </Button>
            )}
          >
            <KeyValueTable
              ref={queryParamsRef}
              // Query params can only see environment variables, but their resolved
              // values contribute to the context for body and URL.
              variables={environmentVariablesForInputs}
              initialRows={request.params}
              visibilityMode="base-only"
              onResolvedContextChange={setResolvedQueryParamsContext}
              onRowsChange={(rows) => {
                request.params = rows
              }}
            />
          </Pane>
          <Pane
            title={t('requestTab.tabs.body')}
            initialSize={0.5}
          >
            <div
              style={{
                height: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 0
              }}
            >
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
                  const modes: ('text' | 'form-data' | 'x-www-form-urlencoded' | 'file')[] = [
                    'text',
                    'form-data',
                    'x-www-form-urlencoded',
                    'file'
                  ]
                  setBodyMode(modes[index] ?? 'text')
                }}
              />

              <div style={{ flex: 1, minHeight: 0 }}>
                {bodyMode === 'text' && (
                  <div
                    style={{
                      height: '100%',
                      border: '1px solid var(--vscode-panel-border)',
                      borderRadius: 3,
                      boxSizing: 'border-box'
                    }}
                  >
                    <CodeEditor
                      height="100%"
                      language="json"
                      value={body}
                      onChange={(value) => {
                        setBody(value ?? '')
                      }}
                      options={{
                        minimap: { enabled: false },
                        wordWrap: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true
                      }}
                    />
                  </div>
                )}

                {(bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded') && (
                  <KeyValueTable
                    // Body fields can see environment + resolved path/params variables
                    variables={urlVariables}
                    initialRows={
                      request.body?.type === 'form-data' || request.body?.type === 'x-www-form-urlencoded'
                        ? request.body.fields
                        : []
                    }
                    visibilityMode="base-only"
                    onRowsChange={(rows) => {
                      request.body = { type: bodyMode as 'form-data' | 'x-www-form-urlencoded', fields: rows }
                    }}
                  />
                )}

                {bodyMode === 'file' && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 12
                      }}
                    >
                      {t('requestTab.body.fileLabel')}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <InputBox
                        options={{
                          placeholder: '',
                          type: 'text'
                        }}
                        value={bodyFilePath}
                        onChange={(value: string) => {
                          setBodyFilePath(value)
                        }}
                      />
                    </div>
                    <Button
                      options={{ ariaLabel: t('requestTab.body.browse'), title: t('requestTab.body.browse') }}
                    >
                      {t('requestTab.body.browse')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Pane>
        </SplitView>
      )
    },
    {
      id: 'docs',
      label: t('requestTab.tabs.docs'),
      useScrollableElement: false,
      allowFullscreen: true,
      fullscreenModalTitle: renderRequestModalTitle(t('requestTab.tabs.docs')),
      content: (
        <MarkdownViewer
          value={request.documentation || `# ${request.name}\n\nNo documentation available.`}
        />
      )
    },
    {
      id: 'notes',
      label: t('requestTab.tabs.notes'),
      useScrollableElement: false,
      allowFullscreen: true,
      fullscreenModalTitle: renderRequestModalTitle(t('requestTab.tabs.notes')),
      content: (
        <MarkdownEditor
          initialValue={request.notes ?? ''}
          onChange={(markdown) => {
            request.notes = markdown
          }}
        />
      )
    },
    {
      id: 'codeSnippets',
      label: t('requestTab.tabs.codeSnippets'),
      useScrollableElement: false,
      allowFullscreen: true,
      fullscreenModalTitle: renderRequestModalTitle(t('requestTab.tabs.codeSnippets')),
      content: (
        <MarkdownViewer value={codeSnippetsMarkdown} />
      )
    }
  ]

  // Initialize left pane width to 50% of available space on first layout
  useEffect(() => {
    if (!splitContainerRef.current) return
    if (leftPaneWidth !== 0) return

    const containerWidth = splitContainerRef.current.clientWidth
    if (containerWidth > 0) {
      setLeftPaneWidth(containerWidth / 2)
      sashStartLeftRef.current = containerWidth / 2
    }
  }, [leftPaneWidth])

  const splitLayoutProvider = useMemo<IVerticalSashLayoutProvider>(
    () => ({
      getVerticalSashLeft: () => {
        if (leftPaneWidth !== 0) return leftPaneWidth
        const width = splitContainerRef.current?.clientWidth ?? 0
        return width > 0 ? width / 2 : 0
      },
      getVerticalSashTop: () => 0,
      getVerticalSashHeight: () => splitContainerRef.current?.clientHeight ?? 0
    }),
    [leftPaneWidth]
  )

  const handleSashStart = useCallback(
    (_event: SashEvent): void => {
      if (leftPaneWidth !== 0) {
        sashStartLeftRef.current = leftPaneWidth
      } else if (splitContainerRef.current) {
        const width = splitContainerRef.current.clientWidth
        sashStartLeftRef.current = width > 0 ? width / 2 : 0
      }
    },
    [leftPaneWidth]
  )

  const handleSashChange = useCallback(
    (event: SashEvent): void => {
      if (!splitContainerRef.current) return

      const containerWidth = splitContainerRef.current.clientWidth
      const minLeft = 320
      const minRight = 260
      const maxLeft = Math.max(minLeft, containerWidth - minRight)

      const delta = event.currentX - event.startX
      const start = sashStartLeftRef.current
      const next = Math.min(maxLeft, Math.max(minLeft, start + delta))

      setLeftPaneWidth(next)
    },
    []
  )

  useEffect(() => {
    return () => {
      if (sendTimeoutRef.current !== null) {
        window.clearTimeout(sendTimeoutRef.current)
        sendTimeoutRef.current = null
      }
    }
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        height: '100%',
        padding: '8px 0',
        boxSizing: 'border-box'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%'
        }}
      >
        <div style={{ width: 90, flexShrink: 0 }}>
          <SelectBox
            id="http-method-select"
            className=""
            options={methodOptions}
            selected={methodOptions.findIndex((opt) => opt.text === method)}
            onDidSelect={(data: ISelectData) => {
              setMethod(data.selected)
            }}
            selectBoxOptions={{
              ariaLabel: t('requestTab.methodSelect'),
              useCustomDrawn: true
            }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0, paddingLeft: 15 }}>
          <VariableInputBox
            value={url}
            onChange={(value: string) => {
              setUrl(value)
            }}
            variables={urlVariables}
            resolvedValue={resolvedUrl}
            placeholder={t('requestTab.urlPlaceholder')}
          />
        </div>

        <Button
          onClick={() => {
            if (isSending) return

            setIsSending(true)
            setHttpResponse(null)

            // Build request input from current UI state
            // Use resolved values from KeyValueTable contexts
            const requestInput: HTTPRequestInput = {
              request,
              method: method as HTTPMethod,
              url,
              headers: request.headers,
              params: queryParamsForUrl,
              pathParams: pathParamsForUrl,
              bodyContent: body,
              bodyMode,
              formFields:
                bodyMode === 'form-data' || bodyMode === 'x-www-form-urlencoded'
                  ? (request.body?.type === 'form-data' || request.body?.type === 'x-www-form-urlencoded'
                      ? request.body.fields
                      : [])
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
          }}
          options={{
            title: t('requestTab.send'),
            ariaLabel: t('requestTab.send')
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <i className="codicon codicon-send" aria-hidden="true" />
            <span>{t('requestTab.send')}</span>
          </span>
        </Button>
      </div>

      <div style={{ width: '100%', height: 4 }}>
        {isSending && <ProgressBar mode="infinite" />}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          ref={splitContainerRef}
          style={{
            position: 'relative',
            display: 'flex',
            flex: 1,
            minHeight: 0,
            minWidth: 0
          }}
        >
          <div
            style={{
              width: httpResponse ?? isSending ? leftPaneWidth || '50%' : '100%',
              minWidth: 320,
              maxWidth: httpResponse ?? isSending ? '80%' : '100%',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0
            }}
          >
            <Tabs
              tabs={tabs}
              activeTabId={activeTabId}
              onTabChange={setActiveTabId}
            />
          </div>

          {(httpResponse ?? isSending) && (
            <>
              <div
                style={{
                  flex: 1,
                  minWidth: 260,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  marginLeft: 4
                }}
              >
                <HTTPResponseView
                  response={httpResponse}
                  requestTitle={`${method} ${request.name}`}
                  isLoading={isSending}
                />
              </div>

              <Sash
                orientation="vertical"
                layoutProvider={splitLayoutProvider}
                onStart={handleSashStart}
                onChange={handleSashChange}
                size={4}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default HTTPRequestTabView
