import React from 'react'
import { StatusbarGitIndicator as EcuiStatusbarGitIndicator, GatedControl } from 'electron-core-ui/renderer'
import { useGitPendingFlags } from '../../hooks/useGitPendingFlags'
import { useGitGateState } from '../../hooks/useGitGateState'
import { subscribeToPro } from '../../services/subscribeToPro'

export interface StatusbarGitIndicatorProps {
  /** The currently open project file, or `null` when nothing is open —
   * gates whether the entry renders AT ALL (independent of the Pro/git-repo
   * gating below, which only decides its enabled/locked APPEARANCE). */
  filePath: string | null
  /** IN-MEMORY dirty state (unsaved edits). The push flow saves before
   * staging, so unsaved edits ARE pushable — without this the button greys
   * out on a clean working tree even though the editor holds real changes
   * (bitten by the e2e push scenario: edit → push, autosave off). */
  hasUnsavedChanges?: boolean
  /** Repo-push click. Shared with the title-bar `Git → Push` menu item via
   * `useGitActions` — see `App.tsx`. */
  onPush: () => void
  /** Repo-pull click. Shared with the title-bar `Git → Pull` menu item via
   * `useGitActions` — see `App.tsx`. */
  onPull: () => void
  /** Opens the git-history modal (the `source-control` icon). */
  onHistory: () => void
}

/**
 * restorm container around the generic electron-core-ui `StatusbarGitIndicator`.
 * Reads the live `useGitState()` snapshot and derives the two pastille
 * booleans; the ECUI component itself has no notion of `GitState` — see
 * `docs/Git/README.md`'s plumbing/UI split.
 *
 * Renders nothing only when there is NO open project at all — once a
 * project is open, the entry is ALWAYS visible and its enabled/locked
 * appearance is driven entirely by `useGitGateState()`'s 3-state model:
 * (Pro + git repo) enabled; (Pro + no git repo) a "initialize git"
 * informational lock, no subscribe link; (Community, regardless of the
 * folder) the standard Pro upsell. This supersedes the original, narrower
 * "hidden unless a git repo" rule — Pro-gating needs the control to stay
 * visible-but-locked even without a repo, per spec.
 * `GatedControl` wraps the WHOLE compound cell (both buttons together)
 * rather than each button individually, per this component's own design
 * note.
 */
export const StatusbarGitIndicator: React.FC<StatusbarGitIndicatorProps> = ({ filePath, hasUnsavedChanges = false, onPush, onPull, onHistory }) => {
  const gate = useGitGateState()
  // Pastille derivation shared with the title-bar Git menu — one formula,
  // two surfaces (see useGitPendingFlags).
  const { pushPending, pullPending } = useGitPendingFlags(hasUnsavedChanges)

  if (filePath === null) return null

  return (
    <GatedControl
      locked={gate.locked}
      onSubscribe={() => { void subscribeToPro() }}
      showSubscribeLink={gate.showSubscribeLink}
      {...(gate.message !== undefined ? { proLabel: gate.message } : {})}
      data-testid="statusbar-git-indicator-gate"
    >
      <EcuiStatusbarGitIndicator
        onRefresh={() => { void window.api.git.refreshState() }}
        pushPending={pushPending}
        pushDisabled={!pushPending}
        pullPending={pullPending}
        onPush={onPush}
        onPull={onPull}
        onHistory={onHistory}
      />
    </GatedControl>
  )
}

export default StatusbarGitIndicator
