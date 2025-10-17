import { app, BrowserWindow, ipcMain } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { getThemeService, getStorageService, logger } from 'electron-vscodelike-core-ui'
import { join } from 'path'

// Disable sandbox and GPU acceleration for restricted environments (WSL, containers, etc.)
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-dev-shm-usage')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-gpu-compositing')

function createWindow(): void {
  logger.info('🪟 Creating main window...')
  try {
    // Create main window (instance is stored in WindowManager singleton)
    new MainWindow()
    logger.info('✅ Main window created successfully')
  } catch (error) {
    logger.error('❌ Failed to create main window:', { error: String(error) })
    throw error
  }
}

// Initialize services and IPC handlers
function setupIPC(): void {
  logger.info('🔧 Setting up IPC handlers...')
  
  // Get resources path from the core-ui package
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  const resourcesPath = isDev
    ? join(__dirname, '../../node_modules/electron-vscodelike-core-ui/resources')
    : join(process.resourcesPath, 'resources')

  logger.info(`📁 Resources path: ${resourcesPath}`)

  logger.info('🎨 Initializing theme service...')
  const themeService = getThemeService(resourcesPath)
  logger.info('💾 Initializing storage service...')
  const storageService = getStorageService()
  logger.info('✅ Services initialized successfully')

  logger.info('🔗 Setting up IPC handlers...')
  // Theme IPC handlers
  ipcMain.handle('theme:list', () => {
    return themeService.listThemes() as unknown[]
  })

  ipcMain.handle('theme:load', (_event, themeId: string) => {
    const result = themeService.getThemeWithVariables(themeId)
    return result
  })

  ipcMain.handle('theme:get-current', () => {
    const currentTheme = storageService.get<string>('currentTheme')
    // Si aucun thème n'est sélectionné, utiliser 'theme-defaults/dark_plus' par défaut
    return currentTheme ?? 'theme-defaults/dark_plus'
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
  
  logger.info('✅ IPC handlers setup complete')
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  logger.info('🚀 Gitable application starting...')
  logger.info(`Platform: ${process.platform}`)
  logger.info(`Node version: ${process.versions.node}`)
  logger.info(`Electron version: ${process.versions.electron}`)
  
  logger.info('🔧 Starting setupIPC...')
  setupIPC()
  logger.info('🔧 setupIPC completed')
  
  logger.info('🪟 Starting createWindow...')
  createWindow()
  logger.info('🪟 createWindow completed')

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

