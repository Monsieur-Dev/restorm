import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppIconAction } from 'electron-core-ui/types'

/** The guarded file commands the OS application-icon menu drives. */
interface AppIconMenuHandlers {
  /** Run the app's "new file" command (with its unsaved-work guard). */
  onNewFile: () => void
  /** Run the app's "open recent file" command for a path (with its guard). */
  onOpenFile: (path: string) => void
}

/**
 * Bridge the OS application-icon menu (the Dock menu on macOS) to the app.
 *
 * Two directions meet here. Outbound: the menu's three static labels are
 * published to the main process, which builds the menu with no window open
 * and so can't resolve them itself — the main-process translator carries only
 * a couple of locales, while the renderer carries all of them; they are
 * re-sent on every language change. Inbound: when the user activates an entry
 * and a window is open, main forwards the action here so it runs the SAME
 * guarded command the in-app menus use — the unsaved-work confirmation fires
 * before the current project is replaced, instead of being bypassed.
 *
 * The wording is shared with the File menu — same actions, and a Dock entry
 * that named them differently would read as a different feature.
 */
export function useAppIconMenu({ onNewFile, onOpenFile }: AppIconMenuHandlers): void {
  const { t, i18n } = useTranslation()

  useEffect(() => {
    window.api.appIconMenu.setLabels({
      newFile: t('menuBar.new'),
      recentFiles: t('menuBar.recentFiles'),
      favorites: t('menuBar.favorites')
    })
  }, [t, i18n.language])

  useEffect(() => {
    return window.api.appIconMenu.onInvoke((action: AppIconAction) => {
      if (action.kind === 'new-file') {
        onNewFile()
        return
      }
      onOpenFile(action.path)
    })
  }, [onNewFile, onOpenFile])
}
