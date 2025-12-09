import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  VariableInputBox,
  Tabs,
  MarkdownEditor,
  SelectBox,
  Sash,
  SplitView,
  Pane,
  RadioGroup,
  InputBox,
  CodeEditor,
  ProgressBar
} from 'electron-core-ui/renderer'
import type {
  Tab,
  VariableDefinition,
  ISelectOptionItem,
  ISelectData,
  IVerticalSashLayoutProvider,
  SashEvent
} from 'electron-core-ui/renderer'
import { ParamsTabView, type ParamsTabViewHandle } from './ParamsTabView'
import { HttpMethodBadge } from './HttpMethodBadge'
import { ResponsesView } from './ResponsesView'
import type { HTTPRequest, KeyValue } from '../types/collections'

export interface HTTPRequestTabViewProps {
  /** The HTTP request to display */
  request: HTTPRequest
}

/** Convert KeyValue array to VariableDefinition array */
function keyValuesToVariables(keyValues: KeyValue[]): VariableDefinition[] {
  return keyValues.map((kv) => ({
    name: kv.key,
    value: kv.value,
    description: ''
  }))
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

export const HTTPRequestTabView: React.FC<HTTPRequestTabViewProps> = ({ request }) => {
  const { t } = useTranslation()
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
  const headersParamsRef = useRef<ParamsTabViewHandle | null>(null)
  const queryParamsRef = useRef<ParamsTabViewHandle | null>(null)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const sashStartLeftRef = useRef<number>(leftPaneWidth)
  const sendTimeoutRef = useRef<number | null>(null)

  // Convert request params to variables for autocomplete
  const urlVariables = useMemo<VariableDefinition[]>(
    () => keyValuesToVariables(request.params),
    [request.params]
  )

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

  const tabs: Tab[] = [
    {
      id: 'docs',
      label: t('requestTab.tabs.docs'),
      useScrollableElement: false,
      allowFullscreen: true,
      fullscreenModalTitle: renderRequestModalTitle(t('requestTab.tabs.docs')),
      content: (
        <MarkdownEditor
          initialValue={request.documentation || `# ${request.name}\n\nNo documentation available.`}
        />
      )
    },
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
            <ParamsTabView
              ref={headersParamsRef}
              variables={urlVariables}
              initialRows={request.headers}
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
            <ParamsTabView
              ref={queryParamsRef}
              variables={urlVariables}
              initialRows={request.params}
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
                      border: '1px solid var(--vscode-panel-border, #3c3c3c)',
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
                  <ParamsTabView
                    variables={urlVariables}
                    initialRows={
                      request.body?.type === 'form-data' || request.body?.type === 'x-www-form-urlencoded'
                        ? request.body.fields
                        : []
                    }
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

        <div style={{ flex: 1, minWidth: 0 }}>
          <VariableInputBox
            value={url}
            onChange={(value: string) => {
              setUrl(value)
            }}
            variables={urlVariables}
            placeholder={t('requestTab.urlPlaceholder')}
          />
        </div>

        <Button
          onClick={() => {
            // Simulate a send action for 5 seconds
            if (sendTimeoutRef.current !== null) {
              window.clearTimeout(sendTimeoutRef.current)
              sendTimeoutRef.current = null
            }
            setIsSending(true)
            sendTimeoutRef.current = window.setTimeout(() => {
              setIsSending(false)
              sendTimeoutRef.current = null
            }, 5000)
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
              width: leftPaneWidth || '50%',
              minWidth: 320,
              maxWidth: '80%',
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
            <ResponsesView requestTitle={`${method} ${request.name}`} />
          </div>

          <Sash
            orientation="vertical"
            layoutProvider={splitLayoutProvider}
            onStart={handleSashStart}
            onChange={handleSashChange}
            size={4}
          />
        </div>
      </div>
    </div>
  )
}

export default HTTPRequestTabView
