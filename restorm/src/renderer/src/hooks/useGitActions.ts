import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from 'electron-core-ui/renderer'
import { useGitFolder } from './useGitFolder'
import { useGitUpdateGate } from './useGitUpdateGate'
import { useGitUpdateActions } from './useGitUpdateActions'
import type { PendingGitUpdate } from './usePushModal'

export interface GitActions {
  onPush: () => void
  onPull: () => void
}

/**
 * The two git click actions shared by the statusbar `GIT` entry and the
 * title-bar `Git` menu (repo-push / repo-pull) — a single source of truth so
 * both surfaces trigger the exact same behavior instead of each re-deriving
 * the folder + wiring the calls independently.
 *
 * `onOpenPush` is `usePushModal`'s `openPushModal` — repo-push's whole job
 * here is to open that modal (title/body prefill, language picker, the
 * actual stage+commit+push all live there); this hook only owns the click
 * wiring. A contested pull no longer relies on git's own merge state:
 * conflicts are computed before anything is written, and the prompt (then
 * the 4-panel view) is raised through `onUpdateRequired`.
 *
 * `saveBeforePull` flushes the live in-memory model to disk BEFORE the pull
 * runs — the pull merges whatever is on disk, so unsaved edits must be
 * persisted first or they'd be at risk. Wired to the same save-all the Push
 * flow uses; it writes only when the tree actually changed (content-checksum
 * guarded), so a pull with no pending edits leaves the file untouched and
 * fast-forwards cleanly. It resolves `false` only when the save itself failed,
 * in which case the pull is skipped (never pull over a half-written file).
 *
 * `onCleanPull` re-hydrates the open project after a clean (success,
 * non-conflicted) fast-forward, through the normal file-open path, so the
 * sidebar tree and open editor tabs reflect the pulled content without a
 * manual reopen.
 */
export function useGitActions(
  filePath: string | null,
  onOpenPush: () => void,
  saveBeforePull: () => Promise<boolean>,
  onCleanPull: () => void,
  /** Raise the update prompt — Pull shares the Push flow's modal, minus
   * the publish step. */
  onUpdateRequired?: (pending: PendingGitUpdate) => void
): GitActions {
  const { t } = useTranslation()
  const gitFolder = useGitFolder(filePath)
  const { checkForUpdate } = useGitUpdateGate()
  const { updateKeepingMine } = useGitUpdateActions()

  const onPull = useCallback(() => {
    if (!gitFolder || !filePath?.endsWith('.restorm')) return
    const relativePath = filePath.slice(gitFolder.length + 1)

    // Save first: everything below reads the working tree, and an unsaved
    // edit would otherwise be compared (and merged) as if it didn't exist.
    void saveBeforePull().then(async (saved) => {
      if (!saved) {
        toasterService.push('app', {
          title: t('git.pullFailedTitle'),
          body: t('git.pullSaveFailedBody'),
          durationMs: 10000
        })
        return
      }

      const gate = await checkForUpdate(gitFolder, relativePath)

      // Nothing newer upstream — there is simply nothing to pull. Say so
      // rather than running a merge that would be a no-op anyway.
      if (gate.behind === 0 || gate.versions === null) {
        if (gate.error !== undefined) {
          toasterService.push('app', {
            title: t('git.pullFailedTitle'),
            body: gate.error,
            durationMs: 10000
          })
          return
        }
        onCleanPull()
        return
      }

      // Behind with nothing contested: merge their work in and refresh.
      // No prompt — there is no decision for the user to make.
      if (gate.conflicts.length === 0) {
        const updated = await updateKeepingMine(gitFolder, relativePath, gate.versions)
        if (!updated.success) {
          toasterService.push('app', {
            title: t('gitUpdate.updateFailedTitle'),
            body: updated.error ?? t('gitUpdate.updateFailedBody'),
            durationMs: 10000
          })
          return
        }
        toasterService.push('app', { title: t('gitUpdate.updatedTitle'), body: t('gitUpdate.updatedBody'), durationMs: 5000 })
        onCleanPull()
        return
      }

      // Genuinely contested — same prompt as Push, minus the publish.
      onUpdateRequired?.({ gitFolder, relativePath, versions: gate.versions, conflicts: gate.conflicts, mode: 'pull' })
    })
  }, [gitFolder, filePath, saveBeforePull, onCleanPull, t, checkForUpdate, updateKeepingMine, onUpdateRequired])

  return { onPush: onOpenPush, onPull }
}
