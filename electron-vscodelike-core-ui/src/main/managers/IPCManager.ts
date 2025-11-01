import { BrowserWindow, ipcMain, app } from 'electron'
import { join } from 'path'
import { getThemeService, getStorageService, logger } from '../services'


/**
 * Configure Electron command line switches
 * Disables sandbox and GPU acceleration for restricted environments (WSL, containers, etc.)
 */
export function configureCommandLineSwitches(): void {
  // Disable sandbox and GPU acceleration for restricted environments (WSL, containers, etc.)
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-dev-shm-usage')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  
  logger.info('✅ Command line switches configured')
}

/**
 * Setup all IPC handlers for the application
 * @param resourcesPath - Path to resources directory containing themes
 */
export function setupIPC(resourcesPath?: string): void {
  logger.info('🔧 Setting up IPC handlers...')
  
  // Get resources path if not provided
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  const finalResourcesPath = resourcesPath ?? (isDev
    ? join(__dirname, '../../../resources')
    : join(process.resourcesPath, 'resources'))

  logger.info(`📁 Resources path: ${finalResourcesPath}`)

  logger.info('🎨 Initializing theme service...')
  const themeService = getThemeService(finalResourcesPath)
  logger.info('💾 Initializing storage service...')
  const storageService = getStorageService()
  logger.info('✅ Services initialized successfully')

  logger.info('🔗 Setting up IPC handlers...')
  
  // Theme IPC handlers
  ipcMain.handle('theme:list', () => {
    return themeService.listThemes()
  })

  ipcMain.handle('theme:load', (_event, themeId: string) => {
    const result = themeService.getThemeWithVariables(themeId)
    return result
  })

  ipcMain.handle('theme:get-current', () => {
    const currentTheme = storageService.get<string>('currentTheme')
    // If no theme is selected, use 'theme-defaults/dark_plus' as default
    return currentTheme ?? 'theme-defaults/dark_plus'
  })

  ipcMain.handle('theme:set', (_event, themeId: string) => {
    storageService.set('currentTheme', themeId)
    return true
  })

  // Handler to update WCO colors when theme changes (Windows only)
  ipcMain.handle('theme:update-wco', (_event, colors: { backgroundColor: string; symbolColor: string }) => {
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
          logger.info('WCO colors updated', { backgroundColor: colors.backgroundColor, symbolColor: colors.symbolColor })
        }
      }
    }
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

  // Developer Tools IPC handler
  ipcMain.handle('devtools:toggle', () => {
    const mainWindow = BrowserWindow.getFocusedWindow()
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools()
        logger.info('Developer Tools closed')
      } else {
        mainWindow.webContents.openDevTools()
        logger.info('Developer Tools opened')
      }
    }
  })
  
  logger.info('✅ IPC handlers setup complete')
}

/**
 * Setup application lifecycle handlers
 * Quit when all windows are closed, except on macOS
 */
export function setupAppLifecycle(): void {
  // Quit when all windows are closed, except on macOS
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
  
  logger.info('✅ App lifecycle handlers setup complete')
}

/**
 * Initialize Electron application
 * @param appName - Name of the application (for logging)
 * @param createWindow - Function to create the main window
 * @param devResourcesPath - Optional path to resources directory in development mode
 * @param onActivate - Optional function to handle macOS activate event
 */
export function initializeApp(
  appName: string,
  createWindow: () => void,
  devResourcesPath?: string,
  onActivate?: () => void
): void {
  // Configure command line switches first (before app is ready)
  configureCommandLineSwitches()
  
  app.whenReady().then(() => {
    logger.info(`🚀 ${appName} application starting...`)
    logger.info(`Platform: ${process.platform}`)
    logger.info(`Node version: ${process.versions.node}`)
    logger.info(`Electron version: ${process.versions.electron}`)
    
    logger.info('🔧 Starting setupIPC...')
    setupIPC(devResourcesPath)
    logger.info('🔧 setupIPC completed')
    
    logger.info('🔧 Starting setupAppLifecycle...')
    setupAppLifecycle()
    logger.info('🔧 setupAppLifecycle completed')
    
    logger.info('🪟 Starting createWindow...')
    createWindow()
    logger.info('🪟 createWindow completed')

    logger.info(`✅ ${appName} application started successfully`)

    // Setup macOS activate handler
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open
      if (BrowserWindow.getAllWindows().length === 0) {
        if (onActivate) {
          onActivate()
        } else {
          createWindow()
        }
      }
    })
  }).catch((error) => {
    logger.error('App failed to start:', { error: String(error) })
  })
}

