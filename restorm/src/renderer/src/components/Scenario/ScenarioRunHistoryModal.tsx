import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, Tabs, VerticalSashContainer, type Tab } from 'electron-core-ui/renderer'
import type {
  ScenarioRunHistoryDetail,
  ScenarioRunHistoryEntry
} from '../../../../shared/types/scenarioRunHistory'
import { ScenarioRunLogView } from './ScenarioRunLogView'
import { ScenarioRunGraphTab } from './ScenarioRunGraphTab'
import { useUserDateFormat } from '../../hooks/useUserDateFormat'
import './scenarioRunHistoryModal.css'

export interface ScenarioRunHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  scenarioId: string
}

interface HistoryBridge {
  scenarioRunHistoryList?: (scenarioId: string) => Promise<unknown[]>
  scenarioRunHistoryDetail?: (guid: string) => Promise<unknown>
  scenarioRunHistoryTogglePin?: (guid: string, pinned: boolean) => Promise<boolean>
}

function bridge(): HistoryBridge | undefined {
  return (window as { restorm?: { runtime?: HistoryBridge } }).restorm?.runtime
}

/**
 * Persisted scenario run history, rendered as an overlay scoped to the
 * scenario tab (mirrors the response-history overlay). Master/detail:
 * the run list (date/time + status) on the left, the selected run's
 * complete log on the right.
 */
export const ScenarioRunHistoryModal: React.FC<ScenarioRunHistoryModalProps> = ({ isOpen, onClose, scenarioId }) => {
  const { t } = useTranslation()
  const { formatUserDate } = useUserDateFormat()
  const formatTimestamp = useCallback((iso: string): string => {
    // Locale date+time; fall back to the raw string if unparseable.
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return formatUserDate(d)
  }, [formatUserDate])
  const [runs, setRuns] = useState<ScenarioRunHistoryEntry[]>([])
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null)
  const [detail, setDetail] = useState<ScenarioRunHistoryDetail | null>(null)
  const [detailTab, setDetailTab] = useState('logs')
  // Above this available width the detail drops the tabs and shows the logs +
  // graph side by side; at or below it, the compact tabbed layout is kept.
  const SIDE_BY_SIDE_MIN = 500
  const [detailWidth, setDetailWidth] = useState(0)
  // Observe the detail pane's width via a callback ref (the Modal mounts its
  // children a frame after `isOpen`, so an `[isOpen]` effect would miss the
  // element). Re-attaches whenever the detail node mounts/unmounts.
  const detailObserverRef = useRef<ResizeObserver | null>(null)
  const attachDetailObserver = useCallback((el: HTMLDivElement | null): void => {
    if (detailObserverRef.current) { detailObserverRef.current.disconnect(); detailObserverRef.current = null }
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number') setDetailWidth(w)
    })
    ro.observe(el)
    detailObserverRef.current = ro
  }, [])
  // A run-log click → focus its emitter node in the graph. The token bumps so
  // the same target re-flashes; the graph tab consumes it.
  const [focusReq, setFocusReq] = useState<{ scenarioId: string; nodeId: string; token: number } | null>(null)
  const focusTokenRef = useRef(0)
  const sideBySide = detailWidth > SIDE_BY_SIDE_MIN

  // Leaving the overlay drops the transient log-focus + resets to the Logs tab
  // (compare-and-set in render, runs on the close pass — before the next open),
  // so reopening never re-zooms on the last-clicked log.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    if (!isOpen) {
      setFocusReq(null)
      setDetailTab('logs')
    }
  }

  const focusNodeFromLog = (nodeId: string, logScenarioId?: string): void => {
    focusTokenRef.current += 1
    setFocusReq({ scenarioId: logScenarioId ?? '', nodeId, token: focusTokenRef.current })
    // Tabbed layout: reveal the graph so the flash is visible.
    if (!sideBySide) setDetailTab('graph')
  }

  // Load the run list each time the overlay opens, and auto-select the
  // most recent run (state set inside the async `.then`, so it doesn't
  // cascade synchronously within the effect).
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void bridge()?.scenarioRunHistoryList?.(scenarioId).then((list) => {
      if (cancelled) return
      const arr = Array.isArray(list) ? (list as ScenarioRunHistoryEntry[]) : []
      setRuns(arr)
      setSelectedGuid(arr[0]?.guid ?? null)
    })
    return () => { cancelled = true }
  }, [isOpen, scenarioId])

  // Load the selected run's full detail (logs).
  useEffect(() => {
    if (!selectedGuid) return
    let cancelled = false
    void bridge()?.scenarioRunHistoryDetail?.(selectedGuid).then((d) => {
      if (!cancelled) setDetail(d ? (d as ScenarioRunHistoryDetail) : null)
    })
    return () => { cancelled = true }
  }, [selectedGuid])

  const togglePin = (entry: ScenarioRunHistoryEntry): void => {
    const next = !entry.pinned
    void bridge()?.scenarioRunHistoryTogglePin?.(entry.guid, next).then((ok) => {
      if (ok) setRuns((prev) => prev.map((r) => (r.guid === entry.guid ? { ...r, pinned: next } : r)))
    })
  }

  const logPane = (d: ScenarioRunHistoryDetail): React.ReactNode => (
    <div className="scn-run-history-log-pane">
      <ScenarioRunLogView logs={d.log} testIdPrefix="scenario-run-history-logs" onFocusNode={focusNodeFromLog} />
    </div>
  )

  const detailTabs = (d: ScenarioRunHistoryDetail): Tab[] => [
    {
      id: 'logs',
      label: t('scenario.runHistory.logsTab', 'Logs'),
      useScrollableElement: false,
      content: logPane(d)
    },
    {
      id: 'graph',
      label: t('scenario.runHistory.graphTab', 'Graphe'),
      useScrollableElement: false,
      content: <ScenarioRunGraphTab scenarios={d.scenarios} focusRequest={focusReq} runKey={selectedGuid} />
    }
  ]

  return (
    <Modal
      title={t('scenario.runHistory.title', 'Run history')}
      isOpen={isOpen}
      onClose={onClose}
      scopeToSelector=".restorm-workbench-tab"
      data-testid="scenario-run-history-modal"
    >
        <div className="scn-run-history-body">
          <ul className="scn-run-history-list" data-testid="scenario-run-history-list">
            {runs.length === 0 ? (
              <li className="scn-run-history-empty">{t('scenario.runHistory.empty', 'No run recorded yet')}</li>
            ) : (
              runs.map((run) => (
                <li
                  key={run.guid}
                  className={`scn-run-history-item${run.guid === selectedGuid ? ' is-selected' : ''}`}
                  onClick={() => { setSelectedGuid(run.guid) }}
                  data-testid={`scenario-run-history-item-${run.guid}`}
                >
                  <span className={`scn-run-history-dot scn-run-history-dot-${run.status}`} />
                  <span className="scn-run-history-when">{formatTimestamp(run.timestamp)}</span>
                  <Button
                    small
                    className={`scn-run-history-pin${run.pinned ? ' is-pinned' : ''}`}
                    icon={run.pinned ? 'pinned' : 'pin'}
                    onClick={(e) => { e.stopPropagation(); togglePin(run) }}
                    options={{
                      ariaLabel: run.pinned ? t('scenario.runHistory.unpin', 'Unpin') : t('scenario.runHistory.pin', 'Pin')
                    }}
                  />
                </li>
              ))
            )}
          </ul>
          <div className="scn-run-history-detail" ref={attachDetailObserver} data-testid="scenario-run-history-detail">
            {detail === null ? (
              <div className="scn-run-history-detail-empty">{t('scenario.runHistory.noLogs', 'No log for this run')}</div>
            ) : sideBySide ? (
              // Wide: drop the tabs, show logs (fixed-ish 500px, resizable via
              // the sash) + graph side by side.
              <VerticalSashContainer
                className="scn-run-history-split"
                data-testid="scenario-run-history-split"
                initialWidth={360}
                minLeftWidth={360}
                minRightWidth={320}
                storageKey="scenario-run-history-logs-width"
                Left={logPane(detail)}
                Right={<ScenarioRunGraphTab scenarios={detail.scenarios} focusRequest={focusReq} runKey={selectedGuid} />}
              />
            ) : (
              <Tabs
                tabs={detailTabs(detail)}
                activeTabId={detailTab}
                onTabChange={setDetailTab}
                data-testid="scenario-run-history-detail-tabs"
              />
            )}
          </div>
        </div>
    </Modal>
  )
}
