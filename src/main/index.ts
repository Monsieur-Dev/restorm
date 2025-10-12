import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { MainWindow } from './windows/MainWindow'
import { getSettingsService } from './services/SettingsService'
import { LangSetting } from './settings/LangSetting'

// Disable sandbox and GPU acceleration for restricted environments (WSL, containers, etc.)
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-dev-shm-usage')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-gpu-compositing')

let _mainWindow: MainWindow | null = null
let _langSetting: LangSetting | null = null

function createWindow(): void {
  _mainWindow = new MainWindow()
}

// Initialize Settings Service
function initializeSettingsService(): void {
  const schemaPath = join(__dirname, '../resources/settings-schema.json')
  const settingsService = getSettingsService(schemaPath)

  // Register IPC handlers for settings
  ipcMain.handle('settings:get-schema', (): unknown => {
    return settingsService.getSchema()
  })

  ipcMain.handle('settings:get', (_event, key: string): unknown => {
    return settingsService.getSetting(key)
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown): boolean => {
    return settingsService.setSetting(key, value)
  })

  ipcMain.handle('settings:reset', (_event, key: string): boolean => {
    return settingsService.resetSetting(key)
  })

  ipcMain.handle('settings:search', (_event, query: string): unknown => {
    return settingsService.searchSettings(query)
  })

  ipcMain.handle('settings:get-all', (): unknown => {
    return settingsService.getAllSettings()
  })

  // Initialize setting handlers
  _langSetting = new LangSetting(settingsService)
  _langSetting.initialize()
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  initializeSettingsService()
  createWindow()

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((error) => {
  console.error('App failed to start:', error)
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

