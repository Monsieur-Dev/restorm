import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, setContentChecksum, toasterService, useFileDirty, useFileEvents, useFileExternallyChanged, useFileService } from 'electron-core-ui/renderer'

/** Fixed id: a re-detection (or a save refused while the prompt is still
 * up) updates the toast in place — never a second stacked toast. */
const TOAST_ID = 'file-external-change'

/**
 * Handles the open project file being rewritten behind the app's back —
 * in practice a `git checkout` / `git pull` run from a terminal, or
 * another editor saving over it while restorm has the project open.
 *
 * The main-process watcher (and, as a backstop, the save-time guard)
 * broadcasts `file:externally-changed`; this hook turns it into a
 * NON-BLOCKING, indefinite toast — no timer, the user answers whenever
 * they want, and the app never reloads silently:
 *
 * - **Recharger** — re-hydrate from what is now on disk, dropping the
 *   in-memory tree (the same path a clean pull uses). When there are
 *   unsaved edits the body says explicitly that reloading discards them.
 * - **Conserver ma version** — re-baseline on the new bytes so the
 *   ordinary save goes through and overwrites them.
 *
 * The toast retracts itself when the file gets re-opened through ANY
 * path (clean pull, conflict resolution, manual re-open) — it must not
 * keep offering to reload what was already reloaded.
 */
export function useExternalFileChange(
  reloadOpenFile: () => void,
  saveOpenFile: () => Promise<boolean>
): void {
  const { t } = useTranslation()
  const { acceptExternalChange, fileName } = useFileService()
  const { isDirty } = useFileDirty()

  useFileEvents(() => { toasterService.dismiss('app', TOAST_ID) })

  const onExternallyChanged = useCallback((): void => {
    const reload = (): void => {
      toasterService.dismiss('app', TOAST_ID)
      reloadOpenFile()
    }
    const keepMine = (): void => {
      toasterService.dismiss('app', TOAST_ID)
      // Re-baseline the digest, then INVALIDATE the content checksum before
      // the save-all: with no in-app edits the ordinary save is a no-op
      // ("nothing changed"), which would leave the third party's bytes on
      // disk — the exact opposite of what "keep mine" promises.
      void acceptExternalChange()
        .then(() => setContentChecksum(''))
        .then(() => saveOpenFile())
    }
    toasterService.push('app', {
      id: TOAST_ID,
      title: t('file.externalChange.title'),
      // No durationMs: the toast stays until the user answers (or the file
      // is re-opened) — an external rewrite is not a fire-and-forget info.
      ariaLive: 'assertive',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>{t('file.externalChange.message', { fileName: fileName ?? '' })}</div>
          <div>{isDirty ? t('file.externalChange.detailDirty') : t('file.externalChange.detail')}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button secondary data-testid="file-external-change-keep-mine" onClick={keepMine}>
              {t('file.externalChange.keepMine')}
            </Button>
            <Button data-testid="file-external-change-reload" onClick={reload}>
              {t('file.externalChange.reload')}
            </Button>
          </div>
        </div>
      )
    })
  }, [t, fileName, isDirty, acceptExternalChange, saveOpenFile, reloadOpenFile])

  useFileExternallyChanged(onExternallyChanged)
}
