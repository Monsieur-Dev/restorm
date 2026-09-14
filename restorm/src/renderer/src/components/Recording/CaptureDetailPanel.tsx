import React, { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs } from 'electron-core-ui/renderer'
import type { RecordedCallDetail } from '../../../../shared/types/recordingCapture'
import { useUserDateFormat } from '../../hooks/useUserDateFormat'
import { buildHttpResponseViewData } from '../RequestTabViews/HTTPResponsePanel'
import { buildResponseTabs, formatJsonForGraph } from '../RequestTabViews/responseTabs'
import { buildWebSocketResponseView } from '../RequestTabViews/webSocketResponseView'
import { buildGraphqlResponseView } from '../RequestTabViews/graphqlResponseView'
import { buildGrpcResponseView } from '../RequestTabViews/grpcResponseView'
import { captureToGraphqlResponse, captureToGrpcResponse, captureToHttpResponse, captureToWebSocketResponse } from '../../../../shared/recording/captureToResponse'

/** What every protocol builder hands back — the input of the shared response tabs. */
interface CaptureResponseView {
  infosContent: ReactNode | null
  responseContent: ReactNode | null
  cookiesContent: ReactNode | null
  jsonData: unknown
}

export interface CaptureDetailPanelProps {
  sessionId: string
  captureId: string | null
}

function isDarkThemeNow(): boolean {
  if (typeof document === 'undefined') return true
  const themeAttr = document.documentElement.getAttribute('data-theme') ?? 'dark'
  return themeAttr === 'dark' || themeAttr === 'hcDark'
}

/**
 * The right-hand pane of the captures tab: the selected call rendered with
 * the very components a request's response uses — the protocol's own view
 * builder feeding the shared Response / Infos / Cookies / Graph tabs. The
 * detail (headers, bodies, frames) is fetched from the main store on demand.
 */
export const CaptureDetailPanel: React.FC<CaptureDetailPanelProps> = ({ sessionId, captureId }) => {
  const { t } = useTranslation()
  const { formatUserDate } = useUserDateFormat()
  // The last detail fetched, tagged with the id it answers — a selection
  // change shows the loading state until its own detail lands (no reset
  // setState inside the effect).
  const [fetched, setFetched] = useState<{ id: string; detail: RecordedCallDetail | null } | null>(null)
  const [activeTabId, setActiveTabId] = useState('response')

  useEffect(() => {
    if (captureId === null) return undefined
    let cancelled = false
    void window.restorm?.recording.get(sessionId, captureId).then((loaded) => {
      if (!cancelled) setFetched({ id: captureId, detail: loaded })
    })
    return () => { cancelled = true }
  }, [sessionId, captureId])
  const detail = captureId !== null && fetched?.id === captureId ? fetched.detail : null

  const view = useMemo((): CaptureResponseView | null => {
    if (detail === null) return null
    switch (detail.protocol) {
      case 'graphql':
        return buildGraphqlResponseView(captureToGraphqlResponse(detail))
      case 'grpc-web':
        return { ...buildGrpcResponseView(captureToGrpcResponse(detail), { ...(detail.grpc ? { service: detail.grpc.service, method: detail.grpc.method } : {}), callType: 'unary' }), cookiesContent: null }
      case 'websocket':
        return buildWebSocketResponseView(captureToWebSocketResponse(detail), { protocol: 'websocket' }, t)
      default: {
        const http = buildHttpResponseViewData(captureToHttpResponse(detail), undefined, { t, formatDate: (date) => formatUserDate(date) })
        return { infosContent: http.infosContent, responseContent: http.responseContent, cookiesContent: http.cookiesContent, jsonData: http.jsonData }
      }
    }
  }, [detail, t, formatUserDate])

  const tabs = useMemo(() => {
    if (view === null) return []
    return buildResponseTabs({
      t,
      showResponse: true,
      isLoading: false,
      infosContent: view.infosContent ?? undefined,
      responseContent: view.responseContent ?? undefined,
      cookiesContent: view.cookiesContent ?? undefined,
      formattedJson: formatJsonForGraph(view.jsonData),
      isDarkTheme: isDarkThemeNow(),
      hadResponseOnce: true,
      hadJsonOnce: view.jsonData !== undefined && view.jsonData !== null,
      showInfos: true
    })
  }, [view, t])

  if (captureId === null) {
    return <div className="recording-capture-detail-empty" data-testid="recording-capture-detail-empty">{t('recording.captures.selectOne')}</div>
  }
  if (detail === null) {
    return <div className="recording-capture-detail-empty" data-testid="recording-capture-detail-loading">{t('recording.captures.loadingDetail')}</div>
  }
  const effectiveTabId = tabs.some((tab) => tab.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? 'response')
  return (
    <div className="recording-capture-detail" data-testid="recording-capture-detail" data-capture-id={detail.id} data-protocol={detail.protocol}>
      <Tabs
        data-testid="recording-capture-detail-tabs"
        tabs={tabs}
        activeTabId={effectiveTabId}
        onTabChange={setActiveTabId}
        mountStrategy="lazy-once"
      />
    </div>
  )
}
