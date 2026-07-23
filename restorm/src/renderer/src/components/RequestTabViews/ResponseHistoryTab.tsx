import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Tabs,
  ListView,
  SelectBox,
  CodeEditor,
  JsonViewer,
  type ListViewItemData,
  type Tab,
  type ContextMenuItem,
  type ISelectOptionItem,
  type ISelectData
} from 'electron-core-ui/renderer'
import { logger } from 'electron-core-ui/renderer'
import type { ResponseHistoryDetail, ResponseHistoryEntry } from '../../../../shared/types/collections'
import { getResponseHistoryDetail, getResponseHistoryList } from '../../services/GraphQLIntegration'
import { useUserDateFormat } from '../../hooks/useUserDateFormat'

/**
 * Resolve the dot color for a history entry. New entries carry a 3-way
 * `outcome`; older entries (pre-`outcome`) only have the boolean
 * `success`, in which case we can't distinguish 3xx-warning from
 * 2xx-ok and fall back to a binary green/red mapping.
 */
function outcomeDotColor(entry: ResponseHistoryEntry): string {
  if (entry.outcome === 'ok') return 'var(--testing-iconPassed)'
  if (entry.outcome === 'warning') return 'var(--editorWarning-foreground)'
  if (entry.outcome === 'failure') return 'var(--testing-iconFailed)'
  return entry.success ? 'var(--testing-iconPassed)' : 'var(--testing-iconFailed)'
}

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

  async loadEntries(requestId: string): Promise<void> {
    logger.debug('[ResponseHistoryTab] Loading history entries', { requestId })
    const result = await getResponseHistoryList(requestId)
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
      && typeof value['requestId'] === 'string'
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
  refreshKey?: number | undefined
  buildResponseView: (detail: ResponseHistoryDetail) => {
    infosContent?: React.ReactNode | undefined
    responseContent?: React.ReactNode | undefined
    jsonData?: unknown
  }
}

export const ResponseHistoryTab: React.FC<ResponseHistoryTabProps> = ({
  requestId,
  refreshKey,
  buildResponseView
}) => {
  const { t } = useTranslation()
  const { formatUserDate: formatDate } = useUserDateFormat()
  const store = useMemo(() => new ResponseHistoryStore(), [])
  const { entries, selectedGuid, selectedDetail } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [activeTabId, setActiveTabId] = useState('response')
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true
    const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
    return themeAttr === 'dark' || themeAttr === 'hcDark'
  })

  useEffect(() => {
    void store.loadEntries(requestId)
  }, [requestId, refreshKey, store])

  const handleTogglePin = useCallback(async (entry: ResponseHistoryEntry) => {
    const nextPinned = !entry.pinned
    await store.togglePin(entry.guid, nextPinned)
  }, [store])

  const listItems: ListViewItemData[] = useMemo(() => {
    return entries.map((entry) => {
      const dateLabel = formatDate(new Date(entry.timestamp))
      const titleContent = (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          {dateLabel}
          {entry.pinned && (
            <i
              className="codicon codicon-pin"
              aria-hidden="true"
              style={{ fontSize: 12, opacity: 0.7 }}
            />
          )}
        </span>
      )
      const statusDot = (
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            backgroundColor: outcomeDotColor(entry)
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
        title: titleContent,
        contextMenuItems,
        leftActions: (
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: 6 }}>
            {statusDot}
          </div>
        )
      }
    })
  }, [entries, formatDate, handleTogglePin, t])

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

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

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
        // The wrapper must be a flex column so the inner CodeEditor's
        // `flex: 1, minHeight: 0` (set by `buildHttpResponseViewData`)
        // grows to fill the modal panel. Without `display: flex`, the
        // editor collapses to its content height and the modal shows
        // a single-line strip with empty space below.
        content: (
          <div style={{ height: '100%', boxSizing: 'border-box', padding: '8px 0px 0px 8px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
          <div style={{ height: '100%', boxSizing: 'border-box', padding: '8px 0px 0px 8px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--panel-border)', borderRadius: 3, boxSizing: 'border-box' }}>
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
        id: 'graph',
        label: t('requestTab.responses.tabs.graph'),
        useScrollableElement: false,
        content: (
          <JsonViewer
            json={formattedJson}
            darkTheme={isDarkTheme}
            data-testid="history-graph"
          />
        )
      })
    }

    return tabs
  }, [selectedDetail, responseContent, infosContent, formattedJson, isDarkTheme, t, entries.length, requestBodyPayload])

  const resolvedActiveTabId = useMemo(() => {
    if (responseTabs.some((tab) => tab.id === activeTabId)) return activeTabId
    return responseTabs[0]?.id ?? ''
  }, [activeTabId, responseTabs])

  // Responsive: detect narrow width to switch from sidebar to dropdown
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((obs) => {
      const entry = obs[0]
      if (entry) {
        setIsNarrow(entry.contentRect.width < 550)
      }
    })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])

  // SelectBox options for narrow mode
  const selectOptions: ISelectOptionItem[] = useMemo(() => {
    return entries.map((entry) => {
      const dateLabel = formatDate(new Date(entry.timestamp))
      const statusColor = outcomeDotColor(entry)
      return {
        text: entry.guid,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, backgroundColor: statusColor }} />
            <span>{dateLabel}</span>
            {entry.pinned && <i className="codicon codicon-pin" aria-hidden="true" style={{ fontSize: 12, opacity: 0.7 }} />}
          </span>
        )
      }
    })
  }, [entries, formatDate])

  const selectedSelectIndex = useMemo(() => {
    if (!selectedGuid) return 0
    const idx = entries.findIndex((e) => e.guid === selectedGuid)
    return idx >= 0 ? idx : 0
  }, [entries, selectedGuid])

  const handleSelectChange = useCallback((data: ISelectData) => {
    const entry = entries[data.index]
    if (entry) {
      void store.select(entry.guid)
      setActiveTabId('response')
    }
  }, [entries, store])

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} data-testid="response-history-container">
      {isNarrow ? (
        <>
          <div style={{ flexShrink: 0, padding: '4px 8px' }}>
            <SelectBox
              id="response-history-select"
              className=""
              options={selectOptions}
              selected={selectedSelectIndex}
              onDidSelect={handleSelectChange}
              selectBoxOptions={{ useCustomDrawn: true, ariaLabel: t('requestTab.responses.history.list') }}
              data-testid="response-history-select"
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Tabs
              tabs={responseTabs}
              activeTabId={resolvedActiveTabId}
              onTabChange={handleTabChange}
              data-testid="response-history-tabs"
            />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--panel-border)' }}>
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
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Tabs
              tabs={responseTabs}
              activeTabId={resolvedActiveTabId}
              onTabChange={handleTabChange}
              data-testid="response-history-tabs"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default ResponseHistoryTab
