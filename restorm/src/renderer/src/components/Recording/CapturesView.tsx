import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, GatedControl, InputBox, ListView, MessageType, VerticalSashContainer, useAuthState, type ContextMenuItem, type ListViewItemData, type ListViewItemEventPayload } from 'electron-core-ui/renderer'
import type { RecordingSession } from '../../../../shared/types/collections'
import type { RecordedCallSummary, RecordingRun } from '../../../../shared/types/recordingCapture'
import { isValidFilterPattern } from '../../../../shared/recording/captureFilters'
import { useUserDateFormat } from '../../hooks/useUserDateFormat'
import { useRecordingStatus } from '../../services/recordingStatusStore'
import { subscribeToPro } from '../../services/subscribeToPro'
import { isRecordingDeduceLocked } from '../../../../shared/auth/planCapabilities'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'
import { RegistryBadge } from '../common/RegistryBadge'
import { useRecordingCaptures } from './useRecordingCaptures'
import { CaptureDetailPanel } from './CaptureDetailPanel'
import { AddFilterPatternModal, type FilterListKind } from './AddFilterPatternModal'
import { assignRecordingField, recordingFilterConfigOf } from './recordingMutations'
import { captureRouteLabel, captureBadgeId, runRowId, isRunRowId, escapeForRegex } from './capturesViewHelpers'
import './capturesView.css'

export interface CapturesViewProps {
  session: RecordingSession
  /** Deduce the routes from the captured calls (Pro+). Absent = the button stays disabled. */
  onDeduceRoutes?: ((sessionId: string) => void) | undefined
}

/**
 * The captures tab: a regex filter, then a master-detail — the runs (level 1,
 * foldable, not selectable, a trash to drop their calls) holding the captured
 * calls (level 2: time, protocol badge, route) on the left, the selected
 * call's response on the right — and, under it, the "Deduce the routes"
 * button (greyed while recording). Empty state until the first call.
 */
export const CapturesView: React.FC<CapturesViewProps> = ({ session, onDeduceRoutes }) => {
  const { t } = useTranslation()
  const { formatUserDate } = useUserDateFormat()
  const status = useRecordingStatus(session.id)
  // Recording is open to every plan; deducing the routes is Pro and above.
  const deduceLocked = isRecordingDeduceLocked(useAuthState())
  const { runs, captures, loaded } = useRecordingCaptures(session.id)
  const [filter, setFilter] = useState('')
  const [collapsedRuns, setCollapsedRuns] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ kind: FilterListKind; pattern: string } | null>(null)

  const filterRegex = useMemo(() => {
    if (filter.trim() === '' || !isValidFilterPattern(filter)) return null
    return new RegExp(filter.trim(), 'i')
  }, [filter])

  const visibleCaptures = useMemo(() => (
    filterRegex === null ? captures : captures.filter((c) => filterRegex.test(c.url) || filterRegex.test(captureRouteLabel(c)) || filterRegex.test(c.method))
  ), [captures, filterRegex])

  const openFilterModal = useCallback((kind: FilterListKind, capture: RecordedCallSummary) => {
    setModal({ kind, pattern: escapeForRegex(capture.url) })
  }, [])

  const items = useMemo<ListViewItemData[]>(() => {
    const byRun = new Map<string, RecordedCallSummary[]>()
    for (const capture of visibleCaptures) {
      const list = byRun.get(capture.runId) ?? []
      list.push(capture)
      byRun.set(capture.runId, list)
    }
    const orderedRuns: RecordingRun[] = [...runs].sort((a, b) => b.startedAt - a.startedAt)
    return orderedRuns.flatMap((run): ListViewItemData[] => {
      const calls = byRun.get(run.id) ?? []
      if (calls.length === 0 && filterRegex !== null) return []
      const rowId = runRowId(run.id)
      const label = run.endedAt === null
        ? `${formatUserDate(new Date(run.startedAt))} · ${t('recording.captures.live')}`
        : `${formatUserDate(new Date(run.startedAt))} → ${formatUserDate(new Date(run.endedAt))}`
      const children: ListViewItemData[] = calls.map((capture) => {
        const menu: ContextMenuItem[] = [
          { id: 'whitelist', label: t('recording.captures.addToWhitelist'), icon: 'check', onClick: () => { openFilterModal('whitelist', capture) } },
          { id: 'blacklist', label: t('recording.captures.addToBlacklist'), icon: 'circle-slash', onClick: () => { openFilterModal('blacklist', capture) } }
        ]
        const time = formatUserDate(new Date(capture.timestamp), { timeOnly: true })
        return {
          id: capture.id,
          title: (
            <span className="recording-capture-row" data-testid={`recording-capture-row-${capture.id}`}>
              <span className="recording-capture-time">{time}</span>
              <span className="recording-capture-route">{captureRouteLabel(capture)}</span>
              {capture.status !== undefined && <span className="recording-capture-status">{capture.status}</span>}
              {capture.error !== undefined && <span className="recording-capture-error codicon codicon-error" aria-label={capture.error} />}
            </span>
          ),
          icon: <RegistryBadge badgeId={captureBadgeId(capture)} />,
          draggable: false,
          contextMenuItems: menu,
          data: capture
        }
      })
      return [{
        id: rowId,
        title: <span className="recording-run-label" data-testid={`recording-run-row-${run.id}`}>{label}</span>,
        icon: run.endedAt === null ? 'record' : 'history',
        isSelectable: false,
        isExpandable: true,
        isExpanded: !collapsedRuns.has(rowId),
        draggable: false,
        children,
        rightActions: (
          <span onClick={(e) => { e.stopPropagation() }} onKeyDown={(e) => { e.stopPropagation() }} role="presentation">
            <HeaderHoverTooltip label={t('recording.captures.clearRun')}>
              <Button
                secondary
                small
                icon="trash"
                options={{ ariaLabel: t('recording.captures.clearRun') }}
                onClick={() => { void window.restorm?.recording.clearRun(session.id, run.id) }}
                data-testid={`recording-run-clear-${run.id}`}
              />
            </HeaderHoverTooltip>
          </span>
        )
      }]
    })
  }, [runs, visibleCaptures, filterRegex, collapsedRuns, formatUserDate, t, openFilterModal, session.id])

  const handleItemClick = useCallback((payload: ListViewItemEventPayload) => {
    const id = payload.item.id
    if (isRunRowId(id)) {
      setCollapsedRuns((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      return
    }
    setSelectedId(id)
  }, [])

  const handleToggle = useCallback((payload: ListViewItemEventPayload, expanded: boolean) => {
    const id = payload.item.id
    setCollapsedRuns((prev) => {
      const next = new Set(prev)
      if (expanded) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleAddPattern = useCallback((pattern: string, applyToExisting: boolean) => {
    if (modal === null) return
    const kind = modal.kind
    const current = kind === 'whitelist' ? session.whitelist : session.blacklist
    if (!current.includes(pattern)) assignRecordingField(session, kind, [...current, pattern])
    const api = window.restorm?.recording
    if (api) {
      const config = recordingFilterConfigOf(session)
      void api.setFilters(session.id, config).then(() => (applyToExisting ? api.applyFilters(session.id) : undefined))
    }
    setModal(null)
  }, [modal, session])

  const recording = status.state !== 'idle'
  const hasCaptures = captures.length > 0
  const deduceTooltip = deduceLocked
    ? t('recording.captures.deduceLocked')
    : recording
      ? t('recording.captures.deduceWhileRecording')
      : onDeduceRoutes === undefined ? t('recording.captures.deduceUnavailable') : t('recording.captures.deduce')

  if (loaded && !hasCaptures) {
    return (
      <div className="recording-captures recording-captures--empty" data-testid="recording-captures-empty">
        <p className="recording-tab-placeholder">{t('recording.captures.empty')}</p>
      </div>
    )
  }

  return (
    <div className="recording-captures" data-testid="recording-captures-view">
      <div className="recording-captures-filter">
        <InputBox
          value={filter}
          onChange={setFilter}
          options={{
            type: 'text',
            placeholder: t('recording.captures.filterPlaceholder'),
            ariaLabel: t('recording.captures.filterPlaceholder'),
            validationOptions: {
              validation: (value: string) => (value.trim() === '' || isValidFilterPattern(value)
                ? null
                : { content: t('recording.config.invalidPattern'), type: MessageType.ERROR })
            }
          }}
          data-testid="recording-captures-filter"
        />
      </div>
      <div className="recording-captures-body">
        <VerticalSashContainer
          data-testid="recording-captures-sash"
          initialLeftRatio={0.5}
          minLeftWidth={240}
          minRightWidth={240}
          sashConfig={{ size: 4 }}
          Left={
            <div className="recording-captures-list">
              <ListView
                data-testid="recording-captures-list"
                items={items}
                selectionMode="single"
                selectedIds={selectedId !== null ? [selectedId] : []}
                onItemClick={handleItemClick}
                onItemToggle={handleToggle}
                ariaLabel={t('recording.node.captures')}
              />
            </div>
          }
          Right={<CaptureDetailPanel sessionId={session.id} captureId={selectedId} />}
        />
      </div>
      <div className="recording-captures-footer">
        <GatedControl locked={deduceLocked} onSubscribe={() => { void subscribeToPro() }} data-testid="recording-captures-deduce-gate">
          <HeaderHoverTooltip label={deduceTooltip}>
            {/* `GatedControl` blocks pointers only — the lock also disables the button. */}
            <Button
              emphasis={1}
              disabled={deduceLocked || recording || onDeduceRoutes === undefined}
              onClick={() => { onDeduceRoutes?.(session.id) }}
              options={{ ariaLabel: t('recording.captures.deduce') }}
              data-testid="recording-captures-deduce"
            >
              {t('recording.captures.deduce')}
            </Button>
          </HeaderHoverTooltip>
        </GatedControl>
      </div>
      <AddFilterPatternModal
        key={modal === null ? 'closed' : `${modal.kind}:${modal.pattern}`}
        open={modal !== null}
        kind={modal?.kind ?? 'blacklist'}
        initialPattern={modal?.pattern ?? ''}
        onCancel={() => { setModal(null) }}
        onAdd={handleAddPattern}
      />
    </div>
  )
}
