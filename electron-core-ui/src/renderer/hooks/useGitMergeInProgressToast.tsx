import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from '../components/Toaster/ToasterService'
import { Button } from '../components/Button'

const TOAST_ID = 'git-merge-in-progress'

/**
 * Surface a repository left mid-merge — the state a conflict resolution
 * that never finished leaves behind.
 *
 * Cancelling the resolution screen aborts the merge itself, so the only
 * way to reach this state is to not cancel: the window is closed, the
 * app is killed, the machine loses power. There is no "resume later"
 * path back into the resolution screen, and a mid-merge working tree
 * holds conflict markers in the project file — so without this the user
 * is stranded in a state nothing in the app mentions, recoverable only
 * from a git CLI.
 *
 * The toast is informational plus one escape hatch: abort the merge,
 * which returns to the pre-merge branch tip. Committed work is untouched;
 * only the unfinished merge is undone.
 *
 * `hasConflicts` is the host's live git flag (`GitState.hasConflicts`).
 * The toast retracts itself as soon as the repository is clean again,
 * however that happened — an abort from here, a resolution completed
 * elsewhere, or a merge finished from a terminal.
 *
 * Requires the host preload to expose `window.api.git` and an `app`
 * toaster mounted somewhere in the tree.
 */
export function useGitMergeInProgressToast(folder: string | null, hasConflicts: boolean): void {
  const { t } = useTranslation()

  useEffect(() => {
    if (!hasConflicts || folder === null) {
      toasterService.dismiss('app', TOAST_ID)
      return
    }

    const abort = (): void => {
      void window.api.git.abortMerge(folder)
      toasterService.dismiss('app', TOAST_ID)
    }

    toasterService.push('app', {
      id: TOAST_ID,
      title: t('git.mergeInProgress.title'),
      body: (
        <div>
          <div>{t('git.mergeInProgress.body')}</div>
          <Button data-testid="git-merge-in-progress-abort" onClick={abort}>
            {t('git.mergeInProgress.abort')}
          </Button>
        </div>
      )
    })
  }, [t, folder, hasConflicts])
}
