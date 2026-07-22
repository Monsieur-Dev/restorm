import { useGitState } from 'electron-core-ui/renderer'

/** The two pastille booleans, derived ONCE and shared by every surface that
 * shows them (statusbar GIT cell, title-bar Git menu). Push: on-disk changes
 * (minus the never-committed sidecars) OR unpushed local commits OR unsaved
 * in-memory edits (the push flow saves first, so those are pushable too).
 * Pull: the semi-pull detected a newer remote version.
 *
 * `hasConflicts` rides along from the same state read: it is not a
 * pastille, but the repository being mid-merge is surfaced from the same
 * place and there is no reason to subscribe twice. */
export function useGitPendingFlags(hasUnsavedChanges: boolean): { pushPending: boolean; pullPending: boolean; hasConflicts: boolean } {
  const gitState = useGitState()
  const relevantFiles = (gitState.status?.files ?? []).filter(
    (f) => !f.path.endsWith('.restorm.env') && !f.path.endsWith('.responses.zip')
  )
  return {
    pushPending: relevantFiles.length > 0 || (gitState.status?.ahead ?? 0) > 0 || hasUnsavedChanges,
    pullPending: gitState.remoteHasNewerVersion,
    hasConflicts: gitState.hasConflicts
  }
}
