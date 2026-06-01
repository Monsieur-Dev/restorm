import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { stringify as yamlStringify } from 'yaml'
import { Button, ListView, Toggle, Tooltip, type ListViewItemData } from 'electron-core-ui/renderer'
import { buildScenarioPathTree } from './scenarioPathTree'
import { HeaderHoverTooltip } from '../MainView/HeaderHoverTooltip'

/** Lets a log row whose entry came from a DIFFERENT scenario than the one
 * being viewed surface its provenance (a link to the source scenario). */
export interface LogProvenanceApi {
  /** The scenario the view belongs to — an entry with a different
   * `scenarioId` came from a sub-scenario. */
  currentScenarioId: string
  /** The source scenario's CURRENT name, or null if it's been deleted since
   * the log was produced. Resolved lazily (on hover) so the "still exists"
   * check reflects the moment the tooltip is shown. */
  resolveName: (scenarioId: string) => string | null
  /** Open the source scenario in a workbench tab. */
  open: (scenarioId: string) => void
}

/**
 * A log row's `ts + message`. The message ellipsis-truncates; on hover an ECUI
 * tooltip appears when there's something extra to show:
 *  - the FULL message, when the row is truncated, and/or
 *  - a clickable link to the SOURCE scenario, when the entry came from a
 *    sub-scenario (and that scenario still exists).
 * When both apply, the full message is shown first, then the link.
 * The tooltip is hover-bridged (a short close delay) so the user can move into
 * it to click the link without it vanishing.
 */
const LogMessageCell: React.FC<{ ts: string; message: string; scenarioId?: string; provenance?: LogProvenanceApi }> = ({ ts, message, scenarioId, provenance }) => {
  const msgRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [sourceName, setSourceName] = useState<string | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (showTimer.current) clearTimeout(showTimer.current)
  }, [])

  const fromSubScenario = provenance !== undefined && scenarioId !== undefined && scenarioId !== provenance.currentScenarioId

  const open = (): void => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    if (hover || showTimer.current) return // already shown, or appearance pending
    // Delay before the tooltip appears, so a quick pass over the row doesn't
    // flash it. Measuring + provenance resolution happen when it actually shows.
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      const el = msgRef.current
      setTruncated(el !== null && el.scrollWidth > el.clientWidth)
      // Resolve provenance NOW so the link reflects whether the scenario still
      // exists at display time.
      setSourceName(fromSubScenario ? provenance.resolveName(scenarioId) : null)
      setHover(true)
    }, 600)
  }
  const scheduleClose = (): void => {
    // Cancel a still-pending appearance (the user left before it showed).
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null }
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setHover(false) }, 160)
  }

  const hasLink = fromSubScenario && sourceName !== null
  const show = hover && (truncated || hasLink)

  return (
    <span className="scn-log-line" onMouseEnter={open} onMouseLeave={scheduleClose}>
      <span className="scn-log-ts">{ts}</span>
      <span className="scn-log-msg" ref={msgRef}>{message}</span>
      <Tooltip
        targetRef={msgRef}
        show={show}
        placement="below"
        content={
          <span className="scn-log-tooltip" onMouseEnter={open} onMouseLeave={scheduleClose}>
            {truncated && <span className="scn-log-tooltip-msg">{message}</span>}
            {hasLink && (
              <button
                type="button"
                className="scn-log-tooltip-link"
                onClick={() => { provenance.open(scenarioId) }}
              >
                <i className="codicon codicon-link-external" aria-hidden="true" />
                <span>{sourceName}</span>
              </button>
            )}
          </span>
        }
      />
    </span>
  )
}

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
type LogLevel = typeof LEVELS[number]

// Status-dot colour rendered as an emoji for the plain-text (YAML) copy, so a
// pasted log keeps the level cue without the styled `<span>` dot.
const LEVEL_EMOJI: Record<LogLevel, string> = { debug: '⚪', info: '🔵', warn: '🟠', error: '🔴' }

/** The level-filter map (which severities are shown). */
export type LogLevelFilter = Record<LogLevel, boolean>
const ALL_LEVELS_ON: LogLevelFilter = { debug: true, info: true, warn: true, error: true }

/** Minimal log-entry shape the view needs — satisfied by both the live
 * `ScenarioLogEntry` (inspector) and the persisted `ScenarioRunLogEntry`
 * (run history). */
export interface ScenarioRunLogLike {
  ts: string
  level?: 'debug' | 'info' | 'warn' | 'error'
  source?: 'engine' | 'user' | 'run'
  /** The node that emitted this entry — lets a click on the row focus +
   * flash the box in the editor. */
  nodeId?: string
  /** The (sub-)scenario the entry came from — in the run-history a click
   * selects this scenario in the graph before flashing the node. */
  scenarioId?: string
  message: string
  data?: unknown
}

export interface ScenarioRunLogViewProps {
  logs: readonly ScenarioRunLogLike[]
  /** Distinguishes test ids between the inspector + the run-history modal. */
  testIdPrefix?: string
  /** When provided, renders a "clear logs" button (rightmost in the
   * actions row). Only the live inspector passes this — the persisted
   * run-history is read-only and never offers a clear action. */
  onClear?: () => void
  /** When provided, clicking a log row focuses + flashes its emitter node.
   * The optional `scenarioId` (set on run-history entries) tells the caller
   * which (sub-)scenario the node lives in. */
  onFocusNode?: (nodeId: string, scenarioId?: string) => void
  /** When provided, a log row from a DIFFERENT scenario shows a provenance
   * link in its hover tooltip. Only the live inspector passes this. */
  provenance?: LogProvenanceApi
  /** Controlled "show all logs" toggle + its filters. The inspector lifts these
   * into the (persistent) panel so they survive the log view's per-run remount;
   * the run-history modal omits them and keeps its own ephemeral state. */
  showAllLogs?: boolean
  onShowAllLogsChange?: (next: boolean) => void
  levels?: LogLevelFilter
  onLevelsChange?: (next: LogLevelFilter) => void
}

const logTs = (ts: string): string => (ts.length >= 23 ? ts.slice(11, 23) : ts)

// Full, human-readable timestamp for the copied log (`YYYY-MM-DD HH:MM:SS.mmm`)
// — unlike the row's time-only display, a pasted log may be read across days.
const logDate = (ts: string): string => (ts.length >= 23 ? ts.slice(0, 23).replace('T', ' ') : ts)

// Defensive: a log `message` may arrive as a non-string (e.g. a typed
// ValueType `{ type, value }`); never hand a raw object to React.
const asText = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  try { return JSON.stringify(v) } catch { return '[unserializable]' }
}

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
export const ScenarioRunLogView: React.FC<ScenarioRunLogViewProps> = ({ logs, testIdPrefix = 'scenario-run-log', onClear, onFocusNode, provenance, showAllLogs: showAllProp, onShowAllLogsChange, levels: levelsProp, onLevelsChange }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
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
    const item: ListViewItemData = {
      id: `log-${i}`,
      icon: <span className={`scn-log-dot scn-log-dot-${level}`} aria-hidden="true" />,
      title: <LogMessageCell ts={logTs(e.ts)} message={asText(e.message)} {...(e.scenarioId !== undefined ? { scenarioId: e.scenarioId } : {})} {...(provenance ? { provenance } : {})} />
    }
    if (e.data !== undefined) {
      const tree = buildScenarioPathTree(typeof e.data === 'object' && e.data !== null ? (e.data as Record<string, unknown>) : { value: e.data })
      item.children = prefixIds(tree, `log-${i}`)
      // Collapsed by default — the data is a sub-element you expand on demand.
      item.isExpanded = false
    }
    return item
  })

  const copyLogs = (): void => {
    // Serialize each entry as a YAML object: a single `message` line
    // ("<level-emoji> [<date>] <text>") and, when present, the structured
    // `data` object as a second property — far more human-readable when pasted
    // than the previous inline-JSON-per-line form.
    const entries = visibleLogs.map((e) => {
      const level = e.level ?? 'info'
      const message = `${LEVEL_EMOJI[level]} [${logDate(e.ts)}] ${asText(e.message)}`
      return e.data !== undefined ? { message, data: e.data } : { message }
    })
    let text: string
    try { text = yamlStringify(entries) } catch { text = '' }
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    }).catch(() => { /* clipboard denied — no-op */ })
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
              label={t('scenario.inspector.showLevelLogs', { level: lvl, defaultValue: 'Show {{level}} logs' })}
              data-testid={`${testIdPrefix}-level-${lvl}-tip`}
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
            </HeaderHoverTooltip>
          ))}
          <span className="scn-log-actions-sep" aria-hidden="true" />
          <Button
            small
            secondary
            icon={copied ? 'check' : 'copy'}
            onClick={copyLogs}
            disabled={visibleLogs.length === 0}
            options={{ ariaLabel: t('scenario.inspector.copyLogs', 'Copy logs'), title: t('scenario.inspector.copyLogs', 'Copy logs') }}
            data-testid={`${testIdPrefix}-copy`}
          />
          {onClear && (
            <Button
              small
              secondary
              icon="clear-all"
              onClick={onClear}
              disabled={logs.length === 0}
              options={{ ariaLabel: t('scenario.inspector.clearLogs', 'Clear logs'), title: t('scenario.inspector.clearLogs', 'Clear logs') }}
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
            <div className="scn-inspector-tree">
              <ListView
                items={logItems}
                selectionMode="single"
                selectedIds={[]}
                {...(onFocusNode
                  ? {
                      onItemClick: (payload: { item: ListViewItemData }) => {
                        const emitter = emitterByRow.get(payload.item.id.split('/')[0] ?? '')
                        if (emitter) onFocusNode(emitter.nodeId, emitter.scenarioId)
                      }
                    }
                  : {})}
                data-testid={`${testIdPrefix}-list`}
              />
            </div>
          </div>
          )}
    </>
  )
}

export default ScenarioRunLogView
