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
 * wiring. `onConflict` is `useGitPullConflict`'s `openFromPull` — a pull
 * that comes back `conflicted: true` hands off to the 4-panel resolution
 * UI instead of showing a plain failure toast.
 */
export function useGitActions(
  filePath: string | null,
  onOpenPush: () => void,
  onConflict: (folder: string, relativePath: string) => void | Promise<void>
): GitActions {
  const { t } = useTranslation()
  const gitFolder = useGitFolder(filePath)

  const onPull = useCallback(() => {
    if (!gitFolder || !filePath?.endsWith('.restorm')) return
    const relativePath = filePath.slice(gitFolder.length + 1)
    void window.api.git.pull(gitFolder).then((result) => {
      if (result.conflicted) {
        void onConflict(gitFolder, relativePath)
        return
      }
      if (!result.success) {
        toasterService.push('app', {
          title: t('git.pullFailedTitle'),
          body: result.error ?? t('git.pullFailedBody'),
          durationMs: 10000
        })
      }
    })
  }, [gitFolder, filePath, onConflict, t])

  return { onPush: onOpenPush, onPull }
}
