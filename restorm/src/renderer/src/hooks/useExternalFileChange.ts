import { useCallback } from 'react'
import { useFileExternallyChanged, useFileService } from 'electron-core-ui/renderer'

/**
 * Handles the open project file being rewritten behind the app's back —
 * in practice a `git checkout` / `git pull` run from a terminal while
 * restorm has the project open.
 *
 * The in-memory tree still holds the pre-checkout content and autosave
 * fires about a second later, so the main process refuses the write and
 * broadcasts instead of silently undoing the checkout on disk. This hook
 * turns that broadcast into the user's choice:
 *
 * - **reload** — re-hydrate from what is now on disk, dropping the
 *   in-memory tree (the same path a clean pull uses);
 * - **keep mine** — re-baseline on the new bytes so the ordinary save
 *   goes through and overwrites them.
 *
 * Either way the guard re-arms, so a second external rewrite prompts
 * again rather than being swallowed.
 */
export function useExternalFileChange(
  reloadOpenFile: () => void,
  saveOpenFile: () => Promise<boolean>
): void {
  const { showExternalChangeDialog, acceptExternalChange } = useFileService()

  const onExternallyChanged = useCallback((): void => {
    void showExternalChangeDialog().then(async (choice) => {
      if (choice === 'keepMine') {
        await acceptExternalChange()
        await saveOpenFile()
        return
      }
      reloadOpenFile()
    })
  }, [showExternalChangeDialog, acceptExternalChange, saveOpenFile, reloadOpenFile])

  useFileExternallyChanged(onExternallyChanged)
}
