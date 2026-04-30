import { BrowserWindow, ipcMain } from 'electron'
import { validatedHandle } from '../../ipc/validate'
import { themeLoadArgs, themeSetArgs, themeUpdateWcoArgs } from '../../ipc/schemas'
import { logger } from '../../services'
import type { ThemeService } from '../../services'
import type { StorageService } from '../../services'

export function registerThemeHandlers(themeService: ThemeService, storageService: StorageService): void {
  ipcMain.handle('theme:list', () => {
    return themeService.listThemes()
  })

  validatedHandle('theme:load', themeLoadArgs, (_event, [themeId]) => {
    return themeService.getThemeWithVariables(themeId)
  })

  ipcMain.handle('theme:get-current', () => {
    const currentTheme = storageService.get('currentTheme') as string | undefined
    return currentTheme ?? 'dark/dark-plus'
  })

  validatedHandle('theme:set', themeSetArgs, (_event, [themeId]) => {
    const previousTheme = storageService.get('currentTheme') as string | undefined

    if (previousTheme === themeId) {
      logger.info('Theme set called with same theme, skipping broadcast', { themeId })
      return true
    }

    storageService.set('currentTheme', themeId)

    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('theme:changed', themeId)
      }
    }

    logger.info('Theme changed and broadcasted to all windows', { themeId, windowCount: windows.length })
    return true
  })

  validatedHandle('theme:update-wco', themeUpdateWcoArgs, (_event, [colors]) => {
    if (process.platform === 'win32') {
      const windows = BrowserWindow.getAllWindows()
      if (windows.length > 0) {
        const mainWindow = windows[0]
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setTitleBarOverlay({
            color: colors.backgroundColor,
            symbolColor: colors.symbolColor,
            height: 30
          })
        }
      }
    }
    return true
  })
}
