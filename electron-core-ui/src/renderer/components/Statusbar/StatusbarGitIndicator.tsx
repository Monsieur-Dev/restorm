import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '../Tooltip'
import { IconView } from '../IconView'

export interface StatusbarGitIndicatorProps {
  /** Show the push pastille (a dot, never a number — v1 commit+push is
   * atomic so there is no meaningful "ahead N" count). The host sets this
   * when there are local changes not yet pushed: uncommitted working-tree
   * changes OR local commits still to sweep in. */
  pushPending: boolean
  /** Show the pull pastille. The host sets this when its semi-pull
   * (fetch + compare, no merge) detected a newer remote version. */
  pullPending: boolean
  /** Invoked on a repo-push click. The host opens its commit/push flow
   * (title + body + language picker) — this primitive only renders the
   * entry point. */
  onPush: () => void
  /** Invoked on a repo-pull click. Pull has no intermediate UI of its own
   * here: a plain pull either succeeds, or the host's conflict-resolution
   * surface takes over. */
  onPull: () => void
  /** Test id root. Defaults to `statusbar-git-indicator`; the two action
   * icons and their pastilles/tooltips suffix `-push` / `-pull`. */
  'data-testid'?: string
}

/**
 * One compound statusbar cell: a fixed, untranslated "GIT" label (per spec —
 * the token reads identically in every locale, like the `mcp` label on
 * {@link StatusbarMcpIndicator}) followed by two independently-clickable
 * codicon buttons (`repo-push` / `repo-pull`), each with its own hover
 * tooltip and an optional pastille (a plain dot, never a count).
 *
 * Deliberately NOT built on {@link StatusbarElement}: that primitive owns
 * exactly one icon + one click target + one tooltip per cell, but this
 * entry needs two independent click targets sharing a single visual cell
 * (one `.statusbar-item`, one separator on its right edge). The two action
 * buttons below re-implement the same hover-tooltip micro-pattern used by
 * `GatedControl` instead.
 *
 * Visibility (AC: only shown on a git-backed project) and pastille/tooltip
 * wiring are the host's job — this component has no notion of
 * `GitState`/`isRepo`, matching the plumbing/UI split documented in
 * `docs/Git/README.md`. Pro-gating (Community: visible-but-locked with an
 * upsell) wraps this whole component from the outside (e.g. `GatedControl`)
 * rather than being built in here — see the epic's gating sub-ticket.
 */
export const StatusbarGitIndicator: React.FC<StatusbarGitIndicatorProps> = ({
  pushPending,
  pullPending,
  onPush,
  onPull,
  'data-testid': dataTestId = 'statusbar-git-indicator'
}) => {
  const { t } = useTranslation()

  return (
    <div className="statusbar-item statusbar-git-indicator" data-testid={dataTestId}>
      {/* Fixed across every language — a protocol-name-like token, not a
       * sentence, so it stays "GIT" in French/German/Japanese/etc. rather
       * than going through `t()`. */}
      <span className="statusbar-item-label" data-testid={`${dataTestId}-label`}>GIT</span>
      <GitActionIcon
        icon="repo-push"
        pending={pushPending}
        tooltip={t('statusbar.git.pushTooltip')}
        onClick={onPush}
        dataTestId={`${dataTestId}-push`}
      />
      <GitActionIcon
        icon="repo-pull"
        pending={pullPending}
        tooltip={t('statusbar.git.pullTooltip')}
        onClick={onPull}
        dataTestId={`${dataTestId}-pull`}
      />
    </div>
  )
}

interface GitActionIconProps {
  icon: 'repo-push' | 'repo-pull'
  pending: boolean
  tooltip: string
  onClick: () => void
  dataTestId: string
}

/**
 * One clickable codicon inside the compound git cell, with its own hover
 * tooltip and pastille. Hover state is purely local (no close-delay bridge
 * like `GatedControl` needs) since the tooltip content here is plain text,
 * never something the pointer has to travel onto.
 */
const GitActionIcon: React.FC<GitActionIconProps> = ({ icon, pending, tooltip, onClick, dataTestId }) => {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)

  return (
    <span
      ref={anchorRef}
      className="statusbar-git-action"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => { setHover(true) }}
      onMouseLeave={() => { setHover(false) }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      aria-label={tooltip}
      data-testid={dataTestId}
    >
      <IconView
        icon={{ type: 'codicon', value: icon }}
        size={16}
        className="statusbar-item-icon"
        data-testid={`${dataTestId}-icon`}
      />
      {pending && (
        <span className="statusbar-git-pastille" data-testid={`${dataTestId}-pastille`} />
      )}
      <Tooltip
        targetRef={anchorRef}
        show={hover}
        placement="above"
        content={<div>{tooltip}</div>}
        data-testid={`${dataTestId}-tooltip`}
      />
    </span>
  )
}

export default StatusbarGitIndicator
