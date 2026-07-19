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
  /** Invoked on the manual refresh click (the codicon-refresh button just
   * before push): the host re-checks BOTH sides — the local working tree
   * (anything to push?) and the remote (anything to pull?). */
  onRefresh: () => void
  /** Invoked on a repo-push click. The host opens its commit/push flow
   * (title + body + language picker) — this primitive only renders the
   * entry point. */
  onPush: () => void
  /** Greys out the push icon and swaps its hover tooltip for the
   * "nothing to push" explanation. The host sets it when the working tree
   * is clean AND nothing is ahead of the remote. Only relevant unlocked —
   * when the surrounding gate is locked its own upsell tooltip is the one
   * showing. */
  pushDisabled?: boolean
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
  onRefresh,
  onPush,
  pushDisabled = false,
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
        icon="refresh"
        pending={false}
        tooltip={t('statusbar.git.refreshTooltip')}
        onClick={onRefresh}
        dataTestId={`${dataTestId}-refresh`}
      />
      <GitActionIcon
        icon="repo-push"
        pending={pushPending}
        tooltip={pushDisabled ? t('statusbar.git.nothingToPushTooltip') : t('statusbar.git.pushTooltip')}
        onClick={onPush}
        disabled={pushDisabled}
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
  icon: 'repo-push' | 'repo-pull' | 'refresh'
  pending: boolean
  tooltip: string
  onClick: () => void
  /** Inert-but-explaining state: the icon greys out, clicks/Enter do
   * nothing, and the hover tooltip (passed above) tells the user WHY. */
  disabled?: boolean
  dataTestId: string
}

/**
 * One clickable codicon inside the compound git cell, with its own hover
 * tooltip and pastille. Hover state is purely local (no close-delay bridge
 * like `GatedControl` needs) since the tooltip content here is plain text,
 * never something the pointer has to travel onto.
 */
const GitActionIcon: React.FC<GitActionIconProps> = ({ icon, pending, tooltip, onClick, disabled = false, dataTestId }) => {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)

  return (
    <span
      ref={anchorRef}
      className={disabled ? 'statusbar-git-action disabled' : 'statusbar-git-action'}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      // Prevent the mousedown from focusing the span at all — a mouse click
      // must never leave a focus ring on the icon (Chromium focuses any
      // element carrying a tabindex, even -1, and can then surface
      // :focus-visible). Keyboard users still Tab in (tabindex 0 when
      // enabled) and keep their ring.
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => {
        if (disabled) return
        onClick()
      }}
      onMouseEnter={() => { setHover(true) }}
      onMouseLeave={() => { setHover(false) }}
      onKeyDown={(event) => {
        if (disabled) return
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
