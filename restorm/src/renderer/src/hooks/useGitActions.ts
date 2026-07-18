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
  onConflict: (folder: string, relativePath: string) => void | Promise<void>,
  saveBeforePull: () => Promise<boolean>,
  onCleanPull: () => void
): GitActions {
  const { t } = useTranslation()
  const gitFolder = useGitFolder(filePath)

  const onPull = useCallback(() => {
    if (!gitFolder || !filePath?.endsWith('.restorm')) return
    const relativePath = filePath.slice(gitFolder.length + 1)
    void saveBeforePull().then((saved) => {
      if (!saved) {
        toasterService.push('app', {
          title: t('git.pullFailedTitle'),
          body: t('git.pullSaveFailedBody'),
          durationMs: 10000
        })
        return
      }
      return window.api.git.pull(gitFolder).then(async (result) => {
        if (result.conflicted) {
          void onConflict(gitFolder, relativePath)
          return
        }
        if (!result.success) {
          // A non-conflicted failure whose working tree still shows the open
          // project locally modified means the pull was refused because the
          // saved-but-unpushed edits would be overwritten by the merge — git
          // won't merge on top of uncommitted local changes. Point the user at
          // Push rather than a generic error. Read the working-tree status
          // (locale-independent) instead of matching git's translated error
          // text; the edits are left untouched, never clobbered.
          const status = await window.api.git.getStatus(gitFolder).catch(() => null)
          const projectLocallyModified = status?.files.some((f) => f.path === relativePath) ?? false
          toasterService.push('app', {
            title: t('git.pullFailedTitle'),
            body: projectLocallyModified
              ? t('git.pullUnpushedChangesBody')
              : result.error ?? t('git.pullFailedBody'),
            durationMs: 10000
          })
          return
        }
        onCleanPull()
      })
    })
  }, [gitFolder, filePath, onConflict, saveBeforePull, onCleanPull, t])

  return { onPush: onOpenPush, onPull }
}
