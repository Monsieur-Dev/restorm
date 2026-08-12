import { ipcMain } from 'electron'
import { logger, getAppIconMenuService, isAppIconMenuServiceInitialized } from '../../services'
import { APP_ICON_MENU_SET_LABELS_CHANNEL, type AppIconMenuLabels } from '../../../types/appIconMenu'

/**
 * Validate the labels payload crossing the bridge.
 *
 * The renderer owns the translations, but the payload is still untrusted
 * data on an IPC channel: a partial object would render a menu with `undefined`
 * entries rather than fail, so it is rejected outright.
 */
const asLabels = (value: unknown): AppIconMenuLabels | null => {
  if (typeof value !== 'object' || value === null) return null
  const { newFile, recentFiles, favorites } = value as Record<string, unknown>
  if (typeof newFile !== 'string') return null
  if (typeof recentFiles !== 'string') return null
  if (typeof favorites !== 'string') return null
  return { newFile, recentFiles, favorites }
}

/**
 * Accept the app-icon menu's static labels from the renderer.
 *
 * The dynamic entries (recent files, favorites) come from the main-side
 * `FileService`, so the menu survives having no window; only the labels need
 * the renderer, which is the process holding every shipped locale. The host
 * re-sends them whenever the UI language changes.
 */
export function registerAppIconMenuHandlers(): void {
  ipcMain.on(APP_ICON_MENU_SET_LABELS_CHANNEL, (_event, payload: unknown) => {
    const labels = asLabels(payload)
    if (!labels) {
      logger.warn(`${APP_ICON_MENU_SET_LABELS_CHANNEL} received an invalid payload; ignoring`)
      return
    }
    if (!isAppIconMenuServiceInitialized()) {
      logger.warn(`${APP_ICON_MENU_SET_LABELS_CHANNEL} received before the service was initialized; ignoring`)
      return
    }
    getAppIconMenuService().setLabels(labels)
  })
}
