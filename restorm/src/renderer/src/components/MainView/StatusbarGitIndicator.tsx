import React from 'react'
import { StatusbarGitIndicator as EcuiStatusbarGitIndicator, useGitState, GatedControl } from 'electron-core-ui/renderer'
import { useGitGateState } from '../../hooks/useGitGateState'
import { subscribeToPro } from '../../services/subscribeToPro'

export interface StatusbarGitIndicatorProps {
  /** The currently open project file, or `null` when nothing is open —
   * gates whether the entry renders AT ALL (independent of the Pro/git-repo
   * gating below, which only decides its enabled/locked APPEARANCE). */
  filePath: string | null
  /** Repo-push click. Shared with the title-bar `Git → Push` menu item via
   * `useGitActions` — see `App.tsx`. */
  onPush: () => void
  /** Repo-pull click. Shared with the title-bar `Git → Pull` menu item via
   * `useGitActions` — see `App.tsx`. */
  onPull: () => void
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
export const StatusbarGitIndicator: React.FC<StatusbarGitIndicatorProps> = ({ filePath, onPush, onPull }) => {
  const gitState = useGitState()
  const gate = useGitGateState()

  // Push pastille: uncommitted working-tree changes OR local commits still
  // to sweep in. Pull pastille: the folder-watch-triggered semi-pull found a
  // newer remote version. Neither ever renders a count — see GitState's doc.
  // The env-values sidecar (`*.restorm.env` — secrets, deliberately never
  // committed by the push flow) and the response-history archive
  // (`*.responses.zip`) sit untracked next to every project; counting them
  // would keep the pastille lit forever right after a successful push.
  const relevantFiles = (gitState.status?.files ?? []).filter(
    (f) => !f.path.endsWith('.restorm.env') && !f.path.endsWith('.responses.zip')
  )
  const pushPending = relevantFiles.length > 0 || (gitState.status?.ahead ?? 0) > 0

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
        pullPending={gitState.remoteHasNewerVersion}
        onPush={onPush}
        onPull={onPull}
      />
    </GatedControl>
  )
}

export default StatusbarGitIndicator
