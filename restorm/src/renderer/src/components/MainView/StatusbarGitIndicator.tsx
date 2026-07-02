import React from 'react'
import { StatusbarGitIndicator as EcuiStatusbarGitIndicator, useGitState } from 'electron-core-ui/renderer'

export interface StatusbarGitIndicatorProps {
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
 * `docs/Git/README.md`'s plumbing/UI split. Renders nothing when the active
 * folder isn't a git repo (AC: the entry is visible ONLY on a git-backed
 * project).
 */
export const StatusbarGitIndicator: React.FC<StatusbarGitIndicatorProps> = ({ onPush, onPull }) => {
  const gitState = useGitState()

  // Push pastille: uncommitted working-tree changes OR local commits still
  // to sweep in. Pull pastille: the folder-watch-triggered semi-pull found a
  // newer remote version. Neither ever renders a count — see GitState's doc.
  const pushPending = (gitState.status?.files.length ?? 0) > 0 || (gitState.status?.ahead ?? 0) > 0

  if (!gitState.isRepo) return null

  return (
    <EcuiStatusbarGitIndicator
      pushPending={pushPending}
      pullPending={gitState.remoteHasNewerVersion}
      onPush={onPush}
      onPull={onPull}
    />
  )
}

export default StatusbarGitIndicator
