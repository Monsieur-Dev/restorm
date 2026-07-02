import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from '../components/Toaster/ToasterService'
import { Button } from '../components/Button'

const TOAST_ID = 'git-pull-available'

/**
 * Surface every semi-pull "a newer remote version exists" detection
 * (`GitService.checkForRemoteUpdate` on the folder watch, check-on-open,
 * and the `GitSemiPullController` CRON — see `docs/Git/README.md`) as an
 * `app`-toaster toast offering the real pull. Mount once at the app root,
 * alongside `useGitCliMissingToast()`.
 *
 * `onPull` is the host's injection point for AC#2: this hook only knows
 * a newer version was DETECTED, never how to perform the actual pull
 * (conflict handling, the 4-panel resolution UI, etc. are the host's
 * `useGitActions`/`useGitPullConflict` concern) — clicking "Pull now"
 * calls `onPull` and dismisses the toast; the host decides what happens
 * next (a plain pull, or opening the conflict-resolution flow).
 *
 * Unlike `useGitCliMissingToast` (fires at most once per process
 * lifetime), `git:pull-available` can fire more than once: pulling
 * clears the flag, and a later remote commit re-arms it — a fixed
 * `TOAST_ID` means a re-detection while the previous toast is still
 * showing updates it in place rather than stacking a duplicate.
 *
 * Requires the host preload to expose `window.api.git` and an `app`
 * toaster mounted somewhere in the tree.
 */
export function useGitPullAvailableToast(onPull: () => void): void {
  const { t } = useTranslation()
  useEffect(() => {
    const unsubscribe = window.api.git.onPullAvailable(() => {
      const pullNow = (): void => {
        onPull()
        toasterService.dismiss('app', TOAST_ID)
      }
      toasterService.push('app', {
        id: TOAST_ID,
        title: t('git.pullAvailable.title'),
        body: (
          <div>
            <div>{t('git.pullAvailable.body')}</div>
            <Button data-testid="git-pull-available-pull-now" onClick={pullNow}>
              {t('git.pullAvailable.pullNow')}
            </Button>
          </div>
        )
      })
    })
    return unsubscribe
  }, [t, onPull])
}
