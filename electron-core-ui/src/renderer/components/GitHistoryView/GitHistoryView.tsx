import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { VerticalSashContainer } from '../Sash'
import { ScrollableElement } from '../ScrollableElement'
import { ContextMenu } from '../ContextMenu/ContextMenu'
import { computeLaneLayout } from './laneLayout'
import type { GitHistoryCommit, LaneRow } from './types'
import './gitHistoryView.css'

export interface GitHistoryViewProps {
  /** Commits newest-first in topological order (`git log --all --topo-order`). */
  commits: GitHistoryCommit[]
  /** Hash of the main/master tip — seeds lane 0 so that chain renders as a
   * straight vertical line (the product requirement). */
  mainTipHash?: string
  /** Initial selection; defaults to the first (newest) commit. */
  initialSelectedHash?: string
  /**
   * Restore the open file to a past commit's content. Wired to the row's
   * right-click "recover this version" entry; the host owns the actual
   * checkout-file-at-revision + re-hydrate. Omitting it hides the entry.
   * The entry is disabled on the commit the working copy is currently at
   * (recovering the current version is a no-op).
   */
  onRecoverVersion?: (hash: string) => void
  /**
   * Formats an ISO commit date for display. Defaults to a raw
   * `toLocaleString` when omitted, so consumers that don't need a custom
   * format (or don't have one, e.g. `demo/`) keep working unchanged. A host
   * app with a user-configurable date/time format setting should inject a
   * formatter here rather than the library reading that setting itself —
   * the setting is host-specific, this component isn't.
   */
  formatDate?: (iso: string) => string
  'data-testid'?: string
}

const ROW_HEIGHT = 28
const LANE_WIDTH = 14
const DOT_RADIUS = 3.5
const LANE_COLOR_COUNT = 7

/** Theme-driven lane color class — see `.ecui-git-history-lane-N` in
 * `gitHistoryView.css`, backed by the `--git-lane-N` theme variables. */
function laneClass(lane: number): string {
  return `ecui-git-history-lane-${(lane % LANE_COLOR_COUNT) + 1}`
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2
}

/** One row's SVG gutter: pass-through verticals, the commit dot, join curves
 * arriving from the top and fork curves leaving to the bottom. Row-aligned
 * by construction — no scroll-sync with a separate canvas to maintain. */
const LaneCell: React.FC<{ row: LaneRow, gutterLanes: number }> = ({ row, gutterLanes }) => {
  const width = gutterLanes * LANE_WIDTH
  const midY = ROW_HEIGHT / 2
  const cx = laneX(row.commitLane)

  const paths: React.ReactNode[] = []
  for (const lane of row.passLanes) {
    paths.push(<line key={`p${lane}`} x1={laneX(lane)} y1={0} x2={laneX(lane)} y2={ROW_HEIGHT} className={laneClass(lane)} strokeWidth={2} />)
  }
  if (row.continuesUp) {
    paths.push(<line key="up" x1={cx} y1={0} x2={cx} y2={midY} className={laneClass(row.commitLane)} strokeWidth={2} />)
  }
  if (row.continuesDown) {
    paths.push(<line key="down" x1={cx} y1={midY} x2={cx} y2={ROW_HEIGHT} className={laneClass(row.commitLane)} strokeWidth={2} />)
  }
  for (const lane of row.joinLanes) {
    const x = laneX(lane)
    paths.push(
      // The lane class also sets `fill`, but a join curve is an open stroke,
      // not a shape — force fill:none via inline style, which outranks the
      // class in the CSS cascade (a bare `fill="none"` attribute would not:
      // author stylesheet rules always beat SVG presentation attributes).
      <path key={`j${lane}`} d={`M ${x} 0 C ${x} ${midY}, ${cx} ${midY * 0.6}, ${cx} ${midY}`} style={{ fill: 'none' }} className={laneClass(lane)} strokeWidth={2} />
    )
  }
  for (const lane of row.forkLanes) {
    const x = laneX(lane)
    paths.push(
      <path key={`f${lane}`} d={`M ${cx} ${midY} C ${cx} ${midY * 1.4}, ${x} ${midY}, ${x} ${ROW_HEIGHT}`} style={{ fill: 'none' }} className={laneClass(lane)} strokeWidth={2} />
    )
  }
  paths.push(<circle key="dot" cx={cx} cy={midY} r={DOT_RADIUS} className={laneClass(row.commitLane)} />)

  return (
    <svg className="ecui-git-history-lanes" width={width} height={ROW_HEIGHT} aria-hidden="true">
      {paths}
    </svg>
  )
}

/** Fallback used when the host doesn't supply a `formatDate` prop. */
function defaultFormatDate(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Generic git-history master/detail view: a commit LIST (newest first, graph
 * lanes gutter + subject + date) on the left, the selected commit's full
 * details on the right, resizable via the shared vertical sash. Pure
 * display component — the host feeds `commits` from its own git plumbing
 * and owns any action taken on a commit (rollback etc., later).
 */
export const GitHistoryView: React.FC<GitHistoryViewProps> = ({
  commits,
  mainTipHash,
  initialSelectedHash,
  onRecoverVersion,
  formatDate,
  'data-testid': dataTestId = 'git-history-view'
}) => {
  const { t, i18n } = useTranslation()
  const formatCommitDate = formatDate ?? ((iso: string) => defaultFormatDate(iso, i18n.language))
  const [selectedHash, setSelectedHash] = useState<string | null>(initialSelectedHash ?? commits[0]?.hash ?? null)
  // Right-click "recover this version" menu. `null` = closed.
  const [menu, setMenu] = useState<{ x: number; y: number; hash: string; isHead: boolean } | null>(null)

  const rows = useMemo(() => computeLaneLayout(commits, mainTipHash), [commits, mainTipHash])
  const gutterLanes = useMemo(() => Math.max(1, ...rows.map((r) => r.laneCount)), [rows])
  const selected = commits.find((c) => c.hash === selectedHash) ?? null

  const list = (
    <ScrollableElement className="ecui-git-history-list" data-testid={`${dataTestId}-list`}>
      <div role="listbox" aria-label={t('gitHistory.commits')}>
        {commits.map((commit, index) => {
          const row = rows[index]
          if (!row) return null
          const isSelected = commit.hash === selectedHash
          // The user's CURRENT location: any ref anchored on HEAD
          // ("HEAD -> main", detached "HEAD") marks the checked-out commit.
          const isHead = commit.refs.some((ref) => ref === 'HEAD' || ref.startsWith('HEAD ->'))
          return (
            <div
              key={commit.hash}
              role="option"
              aria-selected={isSelected}
              tabIndex={0}
              className={[
                'ecui-git-history-row',
                isSelected ? 'selected' : '',
                isHead ? 'head' : ''
              ].filter(Boolean).join(' ')}
              style={{ height: ROW_HEIGHT }}
              onClick={() => { setSelectedHash(commit.hash) }}
              onContextMenu={onRecoverVersion
                ? (event) => {
                    event.preventDefault()
                    setSelectedHash(commit.hash)
                    setMenu({ x: event.clientX, y: event.clientY, hash: commit.hash, isHead })
                  }
                : undefined}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedHash(commit.hash)
                }
              }}
              data-testid={`${dataTestId}-row-${commit.hash.slice(0, 8)}`}
            >
              <LaneCell row={row} gutterLanes={gutterLanes} />
              <span className="ecui-git-history-subject" title={commit.subject}>{commit.subject}</span>
              {commit.refs.length > 0 && (
                <span className="ecui-git-history-refs">
                  {commit.refs.map((ref) => (
                    <span key={ref} className="ecui-git-history-ref-badge">{ref}</span>
                  ))}
                </span>
              )}
              <span className="ecui-git-history-date">{formatCommitDate(commit.date)}</span>
            </div>
          )
        })}
      </div>
    </ScrollableElement>
  )

  const details = (
    <ScrollableElement className="ecui-git-history-details" data-testid={`${dataTestId}-details`}>
      {selected === null ? (
        <div className="ecui-git-history-empty">{t('gitHistory.noCommitSelected')}</div>
      ) : (
        <div className="ecui-git-history-details-body">
          <h3 className="ecui-git-history-details-subject">{selected.subject}</h3>
          {selected.refs.length > 0 && (
            <div className="ecui-git-history-details-refs">
              {selected.refs.map((ref) => (
                <span key={ref} className="ecui-git-history-ref-badge">{ref}</span>
              ))}
            </div>
          )}
          <dl className="ecui-git-history-details-grid">
            <dt>{t('gitHistory.author')}</dt>
            <dd>{selected.authorName} &lt;{selected.authorEmail}&gt;</dd>
            <dt>{t('gitHistory.date')}</dt>
            <dd>{formatCommitDate(selected.date)}</dd>
            <dt>{t('gitHistory.hash')}</dt>
            <dd className="ecui-git-history-hash">{selected.hash}</dd>
            {selected.parents.length > 0 && (
              <>
                <dt>{t('gitHistory.parents')}</dt>
                <dd className="ecui-git-history-hash">{selected.parents.map((p) => p.slice(0, 10)).join(', ')}</dd>
              </>
            )}
          </dl>
          {selected.body.trim().length > 0 && (
            <pre className="ecui-git-history-details-message">{selected.body.trim()}</pre>
          )}
        </div>
      )}
    </ScrollableElement>
  )

  return (
    <div className="ecui-git-history-view" data-testid={dataTestId}>
      <VerticalSashContainer
        Left={list}
        Right={details}
        initialLeftRatio={0.62}
        minLeftWidth={280}
        minRightWidth={260}
        data-testid={`${dataTestId}-sash`}
      />
      {menu && onRecoverVersion && (
        <ContextMenu
          visible
          x={menu.x}
          y={menu.y}
          onRequestClose={() => { setMenu(null) }}
          data-testid={`${dataTestId}-context-menu`}
          items={[{
            id: 'recover-version',
            label: t('gitHistory.recoverVersion'),
            icon: 'history',
            // Recovering the commit the working copy is already at is a no-op.
            disabled: menu.isHead,
            onClick: () => {
              onRecoverVersion(menu.hash)
              setMenu(null)
            },
            'data-testid': `${dataTestId}-recover-version`
          }]}
        />
      )}
    </div>
  )
}

export default GitHistoryView
