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
 *
 * `onOpenPush` is `usePushModal`'s `openPushModal` — repo-push's whole job
 * here is to open that modal (title/body prefill, language picker, the
 * actual stage+commit+push all live there); this hook only owns the click
 * wiring + the (unrelated) plain pull.
 */
export function useGitActions(filePath: string | null, onOpenPush: () => void): GitActions {
  const { t } = useTranslation()
  const gitFolder = useGitFolder(filePath)

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

  return { onPush: onOpenPush, onPull }
}
