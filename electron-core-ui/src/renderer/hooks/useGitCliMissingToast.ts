import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from '../components/Toaster/ToasterService'

/**
 * Surface the one-time "git isn't installed" notice as an `app`-toaster
 * toast. Mount this once at the app root — `GitService` fires
 * `git:cli-missing` at most once per process lifetime, but subscribing is
 * cheap even if several call sites mount it defensively.
 *
 * Requires the host app's preload to expose `window.api.git` and an `app`
 * toaster (`<Toaster id="app" />`) mounted somewhere in the tree.
 */
export function useGitCliMissingToast(): void {
  const { t } = useTranslation()
  useEffect(() => {
    const unsubscribe = window.api.git.onCliMissing(() => {
      toasterService.push('app', {
        title: t('git.cliMissing.title'),
        body: t('git.cliMissing.body')
      })
    })
    return unsubscribe
  }, [t])
}
