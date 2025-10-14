import { app, BrowserWindow, ipcMain } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { getThemeService } from './services/ThemeService'
import { getStorageService } from './services/StorageService'
import { logger } from './services/LoggerService'
import { join } from 'path'

// Disable sandbox and GPU acceleration for restricted environments (WSL, containers, etc.)
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-dev-shm-usage')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-gpu-compositing')

function createWindow(): void {
  // Create main window (instance is stored in WindowManager singleton)
  new MainWindow()
}

// Initialize services and IPC handlers
function setupIPC(): void {
  // In development, __dirname is in dist/main, so go up to project root then to src/renderer/resources
  // In production, use process.resourcesPath
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  const resourcesPath = isDev
    ? join(__dirname, '../../src/renderer/resources')
    : join(process.resourcesPath, 'resources')


  const themeService = getThemeService(resourcesPath)
  const storageService = getStorageService()

  // Theme IPC handlers
  ipcMain.handle('theme:list', () => {
    return themeService.listThemes()
  })

  ipcMain.handle('theme:load', (_event, themeId: string) => {
    const result = themeService.getThemeWithVariables(themeId)
    return result
  })

  ipcMain.handle('theme:get-current', () => {
    return storageService.get<string>('currentTheme')
  })

  ipcMain.handle('theme:set', (_event, themeId: string) => {
    storageService.set('currentTheme', themeId)
    return true
  })

  // Logger IPC handler
  ipcMain.handle('logger:log', (_event, { level, message, meta }: { level: string; message: string; meta?: Record<string, unknown> }) => {
    switch (level) {
      case 'debug':
        logger.debug(message, meta)
        break
      case 'info':
        logger.info(message, meta)
        break
      case 'warn':
        logger.warn(message, meta)
        break
      case 'error':
        logger.error(message, meta)
        break
    }
  })
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  logger.info('🚀 Gitable application starting...')
  logger.info(`Platform: ${process.platform}`)
  logger.info(`Node version: ${process.versions.node}`)
  logger.info(`Electron version: ${process.versions.electron}`)
  
  setupIPC()
  createWindow()

  logger.info('✅ Gitable application started successfully')

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((error) => {
  logger.error('App failed to start:', { error: String(error) })
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

