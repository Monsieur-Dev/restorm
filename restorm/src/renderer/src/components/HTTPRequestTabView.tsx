import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Editor from '@monaco-editor/react'
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
  Modal
} from 'electron-core-ui/renderer'
import type {
  Tab,
  TabsProps,
  VariableDefinition,
  ISelectOptionItem,
  ISelectData,
  IVerticalSashLayoutProvider,
  SashEvent
} from 'electron-core-ui/renderer'
import { ParamsTabView, type ParamsTabViewHandle } from './ParamsTabView'
import { HttpMethodBadge } from './HttpMethodBadge'
import { ResponsesView } from './ResponsesView'

export interface HTTPRequestTabViewProps {
  requestTitle: string
}

export const HTTPRequestTabView: React.FC<HTTPRequestTabViewProps> = ({ requestTitle }) => {
  const { t } = useTranslation()
  const [method, setMethod] = useState<string>('GET')
  const [url, setUrl] = useState<string>('')
  const [body, setBody] = useState<string>('')
  const [bodyMode, setBodyMode] = useState<'text' | 'form-data' | 'x-www-form-urlencoded' | 'file'>('text')
  const [bodyFilePath, setBodyFilePath] = useState<string>('')
  const [activeTabId, setActiveTabId] = useState<string>('requestLayout')
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(0)
  const headersParamsRef = useRef<ParamsTabViewHandle | null>(null)
  const queryParamsRef = useRef<ParamsTabViewHandle | null>(null)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const sashStartLeftRef = useRef<number>(leftPaneWidth)
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
    return themeAttr === 'dark' || themeAttr === 'hc'
  })

  useEffect(() => {
    if (typeof document === 'undefined') return

    const handleThemeChange = (): void => {
      const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
      const dark = themeAttr === 'dark' || themeAttr === 'hc'
      setIsDarkTheme(dark)
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          handleThemeChange()
        }
      }
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })

    // Sync initial value in case theme changed before effect ran
    handleThemeChange()

    return () => {
      observer.disconnect()
    }
  }, [])

  const urlVariables = useMemo<VariableDefinition[]>(
    () => [
      {
        name: 'baseUrl',
        value: 'https://api.example.com',
        description: 'Base API URL'
      },
      {
        name: 'userId',
        value: '123456',
        description: 'Current user identifier'
      }
    ],
    []
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

  const [activeModalTabId, setActiveModalTabId] = useState<string | null>(null)

  const TabsAny = Tabs as React.ComponentType<TabsProps & { onTabDoubleClick?: (tabId: string) => void }>

  const tabs: Tab[] = [
    {
      id: 'docs',
      label: t('requestTab.tabs.docs'),
      // For docs, we let the editor handle its own scrolling, so we disable the Tabs ScrollableElement wrapper.
      useScrollableElement: false,
      content: (
        <MarkdownEditor
          initialValue={
            '# Request documentation\n\nThis is some **random** default text for the Docs tab.\n\n- Item 1\n- Item 2\n- Item 3\n'
          }
        />
      )
    },
    {
      id: 'requestLayout',
      label: t('requestTab.tabs.requestLayout'),
      useScrollableElement: false,
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
            collapsed
            minSize={150}
            headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
              <Button
                secondary
                small
                options={{ ariaLabel: 'Add header', title: 'Add header' }}
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
            <ParamsTabView ref={headersParamsRef} variables={urlVariables} />
          </Pane>
          <Pane
            title={t('requestTab.tabs.params')}
            initialSize={0.25}
            minSize={150}
            headerActions={({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) => (
              <Button
                small
                secondary
                options={{ ariaLabel: 'Add param', title: 'Add param' }}
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
            <ParamsTabView ref={queryParamsRef} variables={urlVariables} />
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
                    <Editor
                      height="100%"
                      language="json"
                      theme={isDarkTheme ? 'vs-dark' : 'vs'}
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
                  <ParamsTabView variables={urlVariables} />
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
                      options={{ ariaLabel: 'Browse file', title: 'Browse file' }}
                    >
                      parcourir...
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

  const renderRequestModalTitle = (tabId: string | null): React.ReactNode => {
    if (!tabId) return null
    let suffix = ''
    switch (tabId) {
      case 'docs':
        suffix = 'Request documentation'
        break
      case 'requestLayout':
        suffix = 'Request'
        break
      default:
        suffix = ''
    }
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <HttpMethodBadge method={requestTitle.split(' ')[0] ?? 'GET'} />
        <span>{requestTitle}{suffix ? ` - ${suffix}` : ''}</span>
      </span>
    )
  }

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
            // Send action will be implemented later
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
            <TabsAny
              tabs={tabs}
              activeTabId={activeTabId}
              onTabChange={setActiveTabId}
              onTabDoubleClick={(tabId: string) => {
                setActiveModalTabId(tabId)
              }}
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
            <ResponsesView requestTitle={requestTitle} />
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
      <Modal
        isOpen={activeModalTabId !== null}
        onClose={() => {
          setActiveModalTabId(null)
        }}
        title={renderRequestModalTitle(activeModalTabId)}
      >
        {tabs.find(tab => tab.id === activeModalTabId)?.content}
      </Modal>
    </div>
  )
}

export default HTTPRequestTabView


