import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ListView, Toggle, ContextMenu, type ContextMenuItem, type ListViewItemData } from 'electron-core-ui/renderer'
import { asText, serializeRunLogEntries, serializeRunLogEntry, type ScenarioRunLogLike } from '../../../../shared/scenarioRunLog/serializeRunLog'
import { buildScenarioPathTree } from './scenarioPathTree'
import { withValueTooltips } from './scenarioTreeTooltips'
import { ScenarioTruncatedText } from './ScenarioTruncatedText'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

/**
 * A log row's `ts + message`. The message ellipsis-truncates at the row's
 * width; hovering a truncated row reveals the FULL message in an ECUI tooltip
 * (the sub-scenario provenance is reached by clicking the row instead, which
 * pops a read-only preview).
 */
const LogMessageCell: React.FC<{ ts: string; message: string }> = ({ ts, message }) => (
  <ScenarioTruncatedText text={message} before={<span className="scn-log-ts">{ts}</span>} />
)

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
type LogLevel = typeof LEVELS[number]

/** The level-filter map (which severities are shown). */
export type LogLevelFilter = Record<LogLevel, boolean>
const ALL_LEVELS_ON: LogLevelFilter = { debug: true, info: true, warn: true, error: true }

/** Minimal log-entry shape the view needs — defined once in the shared
 * serializer module and re-exported here for existing consumers. */
export type { ScenarioRunLogLike }

export interface ScenarioRunLogViewProps {
  logs: readonly ScenarioRunLogLike[]
  /** Distinguishes test ids between the inspector + the run-history modal. */
  testIdPrefix?: string
  /** When provided, renders a "clear logs" button (rightmost in the
   * actions row). Only the live inspector passes this — the persisted
   * run-history is read-only and never offers a clear action. */
  onClear?: () => void
  /** When provided, clicking a log row focuses + flashes its emitter node.
   * The optional `scenarioId` (set on cross-scenario entries) tells the caller
   * which (sub-)scenario the node lives in; `anchor` is the viewport point of
   * the clicked row (the inspector's left edge × the row's y) so a caller can
   * pop a sub-scenario preview to the LEFT of the row. */
  onFocusNode?: (nodeId: string, scenarioId?: string, anchor?: { x: number; y: number }) => void
  /** Controlled "show all logs" toggle + its filters. The inspector lifts these
   * into the (persistent) panel so they survive the log view's per-run remount;
   * the run-history modal omits them and keeps its own ephemeral state. */
  showAllLogs?: boolean
  onShowAllLogsChange?: (next: boolean) => void
  levels?: LogLevelFilter
  onLevelsChange?: (next: LogLevelFilter) => void
}

const logTs = (ts: string): string => (ts.length >= 23 ? ts.slice(11, 23) : ts)

// Prefix tree ids per row so the same data shape across rows can't collide
// on React keys.
const prefixIds = (items: ListViewItemData[], prefix: string): ListViewItemData[] =>
  items.map((it) => ({ ...it, id: `${prefix}/${it.id}`, ...(it.children ? { children: prefixIds(it.children, prefix) } : {}) }))

/**
 * Run-log display shared by the scenario inspector panel and the
 * persisted run-history modal — an ECUI `ListView` whose rows are
 * `ts + message` (status-dot icon by level), a "Show all logs" toggle
 * (filters to the user `log` entries + scenario `run` boundaries by
 * default), a copy button, and expandable metadata: an entry's `data`
 * object becomes collapsible children (the same JSON tree the JSON-path
 * picker uses).
 */
export const ScenarioRunLogView: React.FC<ScenarioRunLogViewProps> = ({ logs, testIdPrefix = 'scenario-run-log', onClear, onFocusNode, showAllLogs: showAllProp, onShowAllLogsChange, levels: levelsProp, onLevelsChange }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  // Right-click context menu on a log row → copy just that entry.
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; rowId: string } | null>(null)
  // The log tree wrapper + the y of the last pointer-down on it — together they
  // give the anchor a row click hands to `onFocusNode` (left edge × row y).
  const treeRef = useRef<HTMLDivElement>(null)
  const lastPointerY = useRef(0)
  // Controlled when the caller (the inspector) owns these — so the choice
  // survives this view's per-run remount; otherwise local (the run-history modal).
  const [internalShowAll, setInternalShowAll] = useState(false)
  const showAllLogs = showAllProp ?? internalShowAll
  const setShowAllLogs = onShowAllLogsChange ?? setInternalShowAll
  const [internalLevels, setInternalLevels] = useState<LogLevelFilter>(ALL_LEVELS_ON)
  const levels = levelsProp ?? internalLevels
  const setLevels = onLevelsChange ?? setInternalLevels

  // Unchecked "show all" = only the user-produced `Log` action entries
  // (engine debug + `run` boundaries are "system"). Then keep only the
  // levels whose filter button is pressed.
  const visibleLogs = (showAllLogs ? logs : logs.filter((e) => e.source === 'user'))
    .filter((e) => levels[e.level ?? 'info'])

  // Row id → emitter (node + its scenario), so a click (on the row or any of
  // its expanded metadata children, prefixed with the row id) can focus the box.
  const emitterByRow = new Map<string, { nodeId: string; scenarioId?: string }>()
  const logItems: ListViewItemData[] = visibleLogs.map((e, i) => {
    const level = e.level ?? 'info'
    if (e.nodeId) emitterByRow.set(`log-${i}`, { nodeId: e.nodeId, ...(e.scenarioId !== undefined ? { scenarioId: e.scenarioId } : {}) })
    // An entry may carry an i18n key (main emits no translations); translate it
    // for display, falling back to the English `message`. Copy/CLI keep `message`.
    const display = e.messageKey
      ? t(e.messageKey, { ...(e.messageArgs ?? {}), defaultValue: asText(e.message) })
      : asText(e.message)
    const item: ListViewItemData = {
      id: `log-${i}`,
      icon: <span className={`scn-log-dot scn-log-dot-${level}`} aria-hidden="true" />,
      title: <LogMessageCell ts={logTs(e.ts)} message={display} />
    }
    if (e.data !== undefined) {
      const tree = buildScenarioPathTree(typeof e.data === 'object' && e.data !== null ? (e.data as Record<string, unknown>) : { value: e.data })
      item.children = withValueTooltips(prefixIds(tree, `log-${i}`))
      // Collapsed by default — the data is a sub-element you expand on demand.
      item.isExpanded = false
    }
    return item
  })

  const copyLogs = (): void => {
    // Serialize via the shared run-log serializer — the SAME output the
    // headless CLI streams, so a copy-paste and a CLI run are byte-identical.
    const text = serializeRunLogEntries(visibleLogs)
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }).catch(() => { /* clipboard denied — no-op */ })
  }

  // Copy a SINGLE row's entry — the same YAML shape as `copyLogs`, scoped to
  // the right-clicked row (its `log-<i>` id, or a `log-<i>/…` data child).
  const copyEntry = (rowId: string): void => {
    const idx = Number((rowId.split('/')[0] ?? '').replace('log-', ''))
    const e = Number.isInteger(idx) ? visibleLogs[idx] : undefined
    if (!e) return
    void navigator.clipboard.writeText(serializeRunLogEntry(e)).catch(() => { /* clipboard denied — no-op */ })
  }

  return (
    <>
      <div className="scn-inspector-logs-toggle nodrag">
        <Toggle
          checked={showAllLogs}
          onChange={(checked) => { setShowAllLogs(checked) }}
          data-testid={`${testIdPrefix}-all`}
        >
          {t('scenario.inspector.logsShowAll', 'Show all logs')}
        </Toggle>
        <div className="scn-log-toggle-actions">
          {LEVELS.map((lvl) => (
            <HeaderHoverTooltip
              key={lvl}
              label={`${t('scenario.inspector.showLevelLogs', { level: lvl, defaultValue: 'Show {{level}} logs' })}\n${t('scenario.inspector.showLevelOnly', 'Right-click: this level only')}`}
              data-testid={`${testIdPrefix}-level-${lvl}-tip`}
            >
              {/* Toggle doesn't forward onContextMenu; this transparent
                  (display:contents) wrapper catches the bubbled right-click.
                  Toggle: if this level is the ONLY one shown, restore all;
                  otherwise solo it (keep only this level). */}
              <span
                style={{ display: 'contents' }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const onlyThis = LEVELS.every((l) => levels[l] === (l === lvl))
                  setLevels(onlyThis
                    ? { ...ALL_LEVELS_ON }
                    : (Object.fromEntries(LEVELS.map((l) => [l, l === lvl])) as LogLevelFilter))
                }}
              >
                <Toggle
                  appearance="button"
                  checked={levels[lvl]}
                  onChange={(checked) => { setLevels({ ...levels, [lvl]: checked }) }}
                  data-testid={`${testIdPrefix}-level-${lvl}`}
                  aria-label={t('scenario.inspector.showLevelLogs', { level: lvl, defaultValue: 'Show {{level}} logs' })}
                >
                  <span className={`scn-log-dot scn-log-dot-${lvl}`} aria-hidden="true" />
                </Toggle>
              </span>
            </HeaderHoverTooltip>
          ))}
          <span className="scn-log-actions-sep" aria-hidden="true" />
          <Button
            small
            secondary
            icon={copied ? 'check' : 'copy'}
            onClick={copyLogs}
            disabled={visibleLogs.length === 0}
            options={{ ariaLabel: t('scenario.inspector.copyLogs', 'Copy logs') }}
            data-testid={`${testIdPrefix}-copy`}
          />
          {onClear && (
            <Button
              small
              secondary
              icon="clear-all"
              onClick={onClear}
              disabled={logs.length === 0}
              options={{ ariaLabel: t('scenario.inspector.clearLogs', 'Clear logs') }}
              data-testid={`${testIdPrefix}-clear`}
            />
          )}
        </div>
      </div>
      {logItems.length === 0
        ? (
          <div className="scn-inspector-info" role="note">
            <i className="codicon codicon-info" aria-hidden="true" />
            <span>{t('scenario.inspector.noUserLogs', 'No user logs (entries from the Log action) in this run.')}</span>
          </div>
          )
        : (
          <div className="scn-inspector-output">
            <div className="scn-inspector-tree" ref={treeRef} onMouseDownCapture={(e) => { lastPointerY.current = e.clientY }}>
              <ListView
                items={logItems}
                selectionMode="single"
                selectedIds={[]}
                {...(onFocusNode
                  ? {
                      onItemClick: (payload: { item: ListViewItemData }) => {
                        const emitter = emitterByRow.get(payload.item.id.split('/')[0] ?? '')
                        if (!emitter) return
                        // Anchor a possible sub-scenario preview to the LEFT of the
                        // row: the inspector tree's left edge × the clicked y.
                        const rect = treeRef.current?.getBoundingClientRect()
                        const anchor = { x: rect?.left ?? 0, y: lastPointerY.current }
                        onFocusNode(emitter.nodeId, emitter.scenarioId, anchor)
                      }
                    }
                  : {})}
                onItemContextMenu={(payload, event) => {
                  event.preventDefault()
                  setRowMenu({ x: event.clientX, y: event.clientY, rowId: payload.item.id })
                }}
                data-testid={`${testIdPrefix}-list`}
              />
            </div>
          </div>
          )}
      {rowMenu && (
        <ContextMenu
          visible
          x={rowMenu.x}
          y={rowMenu.y}
          onRequestClose={() => { setRowMenu(null) }}
          data-testid={`${testIdPrefix}-row-menu`}
          items={[{
            id: 'copy-entry',
            label: t('scenario.inspector.copyThisLog', 'Copy this log'),
            icon: 'copy',
            onClick: () => { copyEntry(rowMenu.rowId); setRowMenu(null) }
          } as ContextMenuItem]}
        />
      )}
    </>
  )
}

export default ScenarioRunLogView
