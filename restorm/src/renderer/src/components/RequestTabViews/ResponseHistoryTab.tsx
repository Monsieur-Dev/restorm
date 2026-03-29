import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { GraphRef } from 'jsoncrack-react'
import {
  Tabs,
  VerticalSashContainer,
  ListView,
  CodeEditor,
  type ListViewItemData,
  type Tab,
  type ContextMenuItem
} from 'electron-core-ui/renderer'
import { logger } from 'electron-core-ui/renderer'
import type { ResponseHistoryDetail, ResponseHistoryEntry } from '../../types/collections'
import { getResponseHistoryDetail, getResponseHistoryList } from '../../services/GraphQLIntegration'

const Graph = React.lazy(() => import('jsoncrack-react').then(mod => ({ default: mod.Graph })))

function formatRequestBodyValue(text: string): { text: string; language: string } {
  const trimmed = text.trim()
  if (!trimmed) return { text, language: 'plaintext' }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text)
      return { text: JSON.stringify(parsed, null, 2), language: 'json' }
    } catch {
      return { text, language: 'plaintext' }
    }
  }
  if (trimmed.startsWith('<')) {
    return { text, language: 'xml' }
  }
  return { text, language: 'plaintext' }
}

function resolveRequestBody(detail: ResponseHistoryDetail | null): { text: string; language: string } | null {
  if (!detail) return null
  const response = detail.response
  if (response.type === 'http') {
    const body = response.requestBody
    if (!body) return null
    switch (body.type) {
      case 'text': {
        const content = body.content ?? ''
        return content ? formatRequestBodyValue(content) : null
      }
      case 'file': {
        const content = body.path ?? ''
        return content ? { text: content, language: 'plaintext' } : null
      }
      case 'form-data':
      case 'x-www-form-urlencoded': {
        const fields = (body.fields ?? []).filter((item) => item.enabled !== false)
        const content = fields.map((item) => `${item.key}=${item.value}`).join('\n')
        return content ? { text: content, language: 'plaintext' } : null
      }
      default:
        return null
    }
  }
  if (response.type === 'grpc') {
    const content = response.requestMessage
    return content ? formatRequestBodyValue(content) : null
  }
  if (response.type === 'soap') {
    const content = response.requestBody
    return content ? formatRequestBodyValue(content) : null
  }
  return null
}

interface ResponseHistoryStoreState {
  entries: ResponseHistoryEntry[]
  selectedGuid: string | null
  selectedDetail: ResponseHistoryDetail | null
}

class ResponseHistoryStore {
  private requestPath: string | undefined
  private state: ResponseHistoryStoreState = {
    entries: [],
    selectedGuid: null,
    selectedDetail: null
  }
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): ResponseHistoryStoreState => this.state

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  setRequestPath(requestPath?: string): void {
    this.requestPath = requestPath
  }

  async loadEntries(requestId: string): Promise<void> {
    logger.debug('[ResponseHistoryTab] Loading history entries', { requestId, requestPath: this.requestPath })
    const result = await getResponseHistoryList(requestId, this.requestPath)
    const entries = Array.isArray(result) ? result.filter((item) => this.isHistoryEntry(item)) : []
    const selectedGuid = entries.find((item) => item.guid === this.state.selectedGuid)?.guid ?? entries[0]?.guid ?? null
    const selectedDetail = selectedGuid ? await this.loadDetail(selectedGuid) : null
    this.state = { entries, selectedGuid, selectedDetail }
    this.emit()
  }

  async select(guid: string | null): Promise<void> {
    if (!guid) {
      this.state = { ...this.state, selectedGuid: null, selectedDetail: null }
      this.emit()
      return
    }
    const selectedDetail = await this.loadDetail(guid)
    this.state = { ...this.state, selectedGuid: guid, selectedDetail }
    this.emit()
  }

  async togglePin(guid: string, pinned: boolean): Promise<boolean> {
    const root = window as { restorm?: { responsesHistory?: { togglePin?: (guid: string, pinned: boolean) => Promise<boolean> } } }
    const updated = await root.restorm?.responsesHistory?.togglePin?.(guid, pinned)
    if (!updated) return false
    const entries = this.state.entries.map((item) => (item.guid === guid ? { ...item, pinned } : item))
    const selectedDetail = this.state.selectedDetail?.guid === guid
      ? { ...this.state.selectedDetail, pinned }
      : this.state.selectedDetail
    this.state = { ...this.state, entries, selectedDetail }
    this.emit()
    return true
  }

  private async loadDetail(guid: string): Promise<ResponseHistoryDetail | null> {
    const detail = await getResponseHistoryDetail(guid)
    return this.isHistoryDetail(detail) ? detail : null
  }

  private isHistoryEntry(value: unknown): value is ResponseHistoryEntry {
    if (!this.isRecord(value)) return false
    return typeof value['guid'] === 'string'
      && typeof value['timestamp'] === 'string'
      && typeof value['success'] === 'boolean'
      && typeof value['pinned'] === 'boolean'
  }

  private isHistoryDetail(value: unknown): value is ResponseHistoryDetail {
    if (!this.isRecord(value)) return false
    return typeof value['guid'] === 'string'
      && typeof value['requestPath'] === 'string'
      && typeof value['type'] === 'string'
      && typeof value['timestamp'] === 'string'
      && typeof value['pinned'] === 'boolean'
      && this.isRecord(value['response'])
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }
}

export interface ResponseHistoryTabProps {
  requestId: string
  requestPath?: string | undefined
  refreshKey?: number | undefined
  buildResponseView: (detail: ResponseHistoryDetail) => {
    infosContent?: React.ReactNode | undefined
    responseContent?: React.ReactNode | undefined
    jsonData?: unknown
  }
}

export const ResponseHistoryTab: React.FC<ResponseHistoryTabProps> = ({
  requestId,
  requestPath,
  refreshKey,
  buildResponseView
}) => {
  const { t, i18n } = useTranslation()
  const store = useMemo(() => new ResponseHistoryStore(), [])
  const { entries, selectedGuid, selectedDetail } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const graphRef = useRef<GraphRef | null>(null)
  const [graphKey, setGraphKey] = useState(0)
  const [activeTabId, setActiveTabId] = useState('response')
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
    return themeAttr === 'dark' || themeAttr === 'hcDark'
  })

  const dateFormatter = useMemo(() => {
    return new Intl.DateTimeFormat(i18n.language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }, [i18n.language])

  useEffect(() => {
    store.setRequestPath(requestPath)
    void store.loadEntries(requestId)
  }, [requestId, requestPath, refreshKey, store])

  const handleTogglePin = useCallback(async (entry: ResponseHistoryEntry) => {
    const nextPinned = !entry.pinned
    await store.togglePin(entry.guid, nextPinned)
  }, [store])

  const listItems: ListViewItemData[] = useMemo(() => {
    return entries.map((entry) => {
      const dateLabel = dateFormatter.format(new Date(entry.timestamp))
      const pinIcon = (
        <i
          className="codicon codicon-pin"
          style={{ opacity: entry.pinned ? 1 : 0 }}
        />
      )
      const statusDot = (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: entry.success ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)'
          }}
        />
      )
      const contextMenuItems: ContextMenuItem[] = [
        {
          id: entry.pinned ? `${entry.guid}-unpin` : `${entry.guid}-pin`,
          label: entry.pinned ? t('requestTab.responses.history.unpin') : t('requestTab.responses.history.pin'),
          onClick: () => { void handleTogglePin(entry) }
        }
      ]

      return {
        id: entry.guid,
        title: dateLabel,
        contextMenuItems,
        leftActions: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 6 }}>
            <span style={{ width: 16, display: 'flex', justifyContent: 'center' }}>{pinIcon}</span>
            {statusDot}
          </div>
        )
      }
    })
  }, [entries, dateFormatter, handleTogglePin, t])

  const { infosContent, responseContent, jsonData } = useMemo(() => {
    if (!selectedDetail) return { infosContent: undefined, responseContent: undefined, jsonData: undefined }
    return buildResponseView(selectedDetail)
  }, [selectedDetail, buildResponseView])

  const requestBodyPayload = useMemo(() => resolveRequestBody(selectedDetail), [selectedDetail])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handleThemeChange = (): void => {
      const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
      const dark = themeAttr === 'dark' || themeAttr === 'hcDark'
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

    handleThemeChange()

    return () => {
      observer.disconnect()
    }
  }, [])

  const formattedJson = useMemo(() => {
    if (jsonData === undefined || jsonData === null) return ''
    if (typeof jsonData === 'string') {
      try {
        const parsed: unknown = JSON.parse(jsonData)
        return JSON.stringify(parsed, null, 2)
      } catch {
        return jsonData
      }
    }
    return JSON.stringify(jsonData, null, 2)
  }, [jsonData])

  const handleResponseTabChange = useCallback((tabId: string) => {
    if (tabId === 'jsoncrack') {
      setGraphKey(prev => prev + 1)
    }
  }, [])

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTabId(tabId)
    handleResponseTabChange(tabId)
  }, [handleResponseTabChange])

  const responseTabs: Tab[] = useMemo(() => {
    if (!selectedDetail) {
      return [{
        id: 'empty',
        label: t('requestTab.responses.tabs.response'),
        useScrollableElement: false,
        content: (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--descriptionForeground)'
          }}>
            {entries.length === 0 ? t('requestTab.responses.history.empty') : t('requestTab.responses.history.select')}
          </div>
        )
      }]
    }

    const tabs: Tab[] = []
    if (responseContent) {
      tabs.push({
        id: 'response',
        label: t('requestTab.responses.tabs.response'),
        useScrollableElement: false,
        content: (
          <div style={{ height: '100%', boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
            {responseContent}
          </div>
        )
      })
    }

    if (requestBodyPayload?.text) {
      tabs.push({
        id: 'requestBody',
        label: t('requestTab.responses.tabs.requestBody'),
        useScrollableElement: false,
        content: (
          <div style={{ height: '100%', boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
            <div style={{ height: '100%', border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }}>
              <CodeEditor
                height="100%"
                language={requestBodyPayload.language}
                value={requestBodyPayload.text}
                options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true, readOnly: true }}
                data-testid="response-history-code-editor"
              />
            </div>
          </div>
        )
      })
    }

    tabs.push({
      id: 'infos',
      label: 'Infos',
      useScrollableElement: false,
      content: (
        <div style={{ height: '100%', boxSizing: 'border-box', padding: '8px 0px 0px 8px' }}>
          {infosContent ?? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--descriptionForeground)'
            }}>
              {t('requestTab.responses.noResponse')}
            </div>
          )}
        </div>
      )
    })

    if (formattedJson) {
      tabs.push({
        id: 'jsoncrack',
        label: t('requestTab.responses.tabs.jsoncrack'),
        useScrollableElement: false,
        content: (
          <div
            style={{
              boxSizing: 'border-box',
              padding: '8px 0px 0px 8px',
              width: '100%',
              height: '100%',
              overflow: 'hidden'
            }}
            onWheelCapture={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const api = graphRef.current
              if (!api) return
              if (event.deltaY < 0) {
                api.zoomIn()
              } else if (event.deltaY > 0) {
                api.zoomOut()
              }
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
              <div style={{
                flex: 1,
                minHeight: 0,
                border: '1px solid var(--panel-border)',
                borderRadius: 3,
                boxSizing: 'border-box',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><i className="codicon codicon-loading codicon-modifier-spin" /></div>}>
                  <Graph
                    key={graphKey}
                    ref={graphRef}
                    json={formattedJson || '{}'}
                    layout={{ theme: isDarkTheme ? 'dark' : 'light' }}
                    style={{ width: '100%', height: '100%' }}
                  />
                </Suspense>
              </div>
            </div>
          </div>
        )
      })
    }

    return tabs
  }, [selectedDetail, responseContent, infosContent, formattedJson, isDarkTheme, graphKey, t, entries.length, requestBodyPayload])

  const resolvedActiveTabId = useMemo(() => {
    if (responseTabs.some((tab) => tab.id === activeTabId)) return activeTabId
    return responseTabs[0]?.id ?? ''
  }, [activeTabId, responseTabs])

  return (
    <VerticalSashContainer
      Left={(
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ListView
            items={listItems}
            selectedIds={selectedGuid ? [selectedGuid] : []}
            activeId={selectedGuid ?? undefined}
            onSelectionChange={(ids) => {
              const next = ids[0] ?? null
              void store.select(next)
              setActiveTabId('response')
            }}
            ariaLabel={t('requestTab.responses.history.list')}
            data-testid="response-history-list-view"
          />
        </div>
      )}
      Right={(
        <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Tabs
            tabs={responseTabs}
            activeTabId={resolvedActiveTabId}
            onTabChange={handleTabChange}
            data-testid="response-history-tabs"
          />
        </div>
      )}
      initialWidth={320}
      minLeftWidth={240}
      minRightWidth={300}
      sashConfig={{ size: 4 }}
      data-testid="response-history-vertical-sash-container"
    />
  )
}

export default ResponseHistoryTab
