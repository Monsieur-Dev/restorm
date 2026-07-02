import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from 'electron-core-ui/renderer'
import { useGitFolder } from './useGitFolder'

export interface GitActions {
  onPush: () => void
  onPull: () => void
}

/**
 * The two git click actions shared by the statusbar `GIT` entry and the
 * title-bar `Git` menu (repo-push / repo-pull) — a single source of truth so
 * both surfaces trigger the exact same behavior instead of each re-deriving
 * the folder + wiring the calls independently.
 */
export function useGitActions(filePath: string | null): GitActions {
  const { t } = useTranslation()
  const gitFolder = useGitFolder(filePath)

  const onPush = useCallback(() => {
    // The atomic stage+commit+push flow — title/body fields, a generated
    // commit message, the language picker — lives in a dedicated
    // commit-message-engine + modal ticket, not built yet. A bare
    // `git push` here would be actively misleading: it only sweeps in
    // already-committed local commits, never the uncommitted changes the
    // statusbar pastille also tracks, so clicking it wouldn't do what the
    // pastille promises. Surface an honest "not available yet" toast
    // instead of a silent no-op or a half-correct push.
    toasterService.push('app', {
      title: t('git.pushComingSoonTitle'),
      body: t('git.pushComingSoonBody')
    })
  }, [t])

  const onPull = useCallback(() => {
    if (!gitFolder) return
    void window.api.git.pull(gitFolder).then((result) => {
      if (!result.success) {
        toasterService.push('app', {
          title: t('git.pullFailedTitle'),
          body: result.error ?? t('git.pullFailedBody'),
          durationMs: 10000
        })
      }
    })
  }, [gitFolder, t])

  return { onPush, onPull }
}
