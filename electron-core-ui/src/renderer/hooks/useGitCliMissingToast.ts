import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from '../components/Toaster/ToasterService'

/**
 * Surface the one-time "git isn't installed" notice as an `app`-toaster
 * toast. Mount this once at the app root — `GitService` fires
 * `git:cli-missing` at most once per process lifetime, but subscribing is
 * cheap even if several call sites mount it defensively.
 *
 * `enabled` gates the toast so it only appears where installing git would
 * actually unlock something: the main process already limits the
 * `git:cli-missing` probe to folders that ARE a repo, and the host passes
 * its git entitlement here so a user who can't use git (e.g. a Community
 * plan) never sees an install prompt — the greyed git surfaces already tell
 * that story, and a toast on top would just be noise.
 *
 * Requires the host app's preload to expose `window.api.git` and an `app`
 * toaster (`<Toaster id="app" />`) mounted somewhere in the tree.
 */
export function useGitCliMissingToast(enabled = true): void {
  const { t } = useTranslation()
  // Read the latest `enabled` at fire time without re-subscribing (the event
  // fires at most once and can land before the entitlement resolves).
  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])
  useEffect(() => {
    const unsubscribe = window.api.git.onCliMissing(() => {
      if (!enabledRef.current) return
      toasterService.push('app', {
        title: t('git.cliMissing.title'),
        body: t('git.cliMissing.body')
      })
    })
    return unsubscribe
  }, [t])
}
