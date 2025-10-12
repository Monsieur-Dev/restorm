import { BrowserWindow } from 'electron'
import { Setting } from './_Setting'
import { SettingsService } from '../services/SettingsService'

/**
 * Language setting handler
 * Manages the application language setting and notifies the renderer process when it changes
 */
export class LangSetting extends Setting<string> {
  constructor(settingsService: SettingsService) {
    super('workbench.appearance.language', settingsService)
  }

  /**
   * Apply the language setting by notifying all renderer windows
   */
  protected apply(value: string, previousValue: string): void {
    console.log(`Applying language setting: ${value} (was: ${previousValue})`)

    // Get all windows
    const allWindows = BrowserWindow.getAllWindows()

    if (allWindows.length === 0) {
      console.warn('No windows available to apply language setting')
      return
    }

    // Notify all renderer windows to change language
    allWindows.forEach((window) => {
      window.webContents.send('settings:language-changed', value)
    })

    console.log(`Language setting applied to ${allWindows.length} window(s)`)
  }
}

