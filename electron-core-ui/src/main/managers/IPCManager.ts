import { BrowserWindow, app, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { getThemeService, getStorageService, initSettingsService, logger } from '../services'
import {
  registerThemeHandlers,
  registerFileHandlers,
  registerStorageHandlers,
  registerSearchHandlers,
  registerWindowHandlers,
  registerMiscHandlers,
  registerSettingsHandlers
} from './ipc'

// Register custom protocol schemes BEFORE app.whenReady()
// This is required for the app:// protocol to work correctly
// Guard for unit tests where electron is mocked (process.type is undefined in tests)
if (process.type === 'browser') {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true } }
  ])
}

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
 * @param appSettingsConfigPath - Optional path to app-specific settings YAML (loaded after defaults)
 */
export function setupIPC(resourcesPath?: string, appSettingsConfigPath?: string): void {
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

  logger.info('⚙️ Initializing settings service...')
  const settingsDefaultPath = join(finalResourcesPath, 'settings', 'defaults.yaml')
  initSettingsService(settingsDefaultPath, appSettingsConfigPath)

  logger.info('✅ Services initialized successfully')

  logger.info('🔗 Setting up IPC handlers...')

  registerThemeHandlers(themeService, storageService)
  registerMiscHandlers(storageService)
  registerWindowHandlers()
  registerStorageHandlers()
  registerFileHandlers()
  registerSearchHandlers()
  registerSettingsHandlers()

  logger.info('✅ IPC handlers setup complete')
}

/**
 * Setup application lifecycle handlers
 * Quit when all windows are closed, except on macOS
 */
export function setupAppLifecycle(): void {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  logger.info('✅ App lifecycle handlers setup complete')
}

/**
 * Setup custom protocol to serve static files in production mode
 * @param rendererPath - Path to the renderer directory containing static assets
 */
export function setupAppProtocol(rendererPath: string): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const filePath = join(rendererPath, url.pathname)
    return net.fetch(pathToFileURL(filePath).toString())
  })

  logger.info(`✅ App protocol registered with renderer path: ${rendererPath}`)
}

/**
 * Initialize Electron application
 * @param appName - Name of the application (for logging)
 * @param createWindow - Function to create the main window
 * @param devResourcesPath - Optional path to resources directory in development mode
 * @param onActivate - Optional function to handle macOS activate event
 * @param rendererPath - Optional path to renderer directory for static assets (used for app:// protocol)
 * @param appSettingsConfigPath - Optional path to app-specific settings YAML (loaded after defaults)
 */
export function initializeApp(
  appName: string,
  createWindow: () => void,
  devResourcesPath?: string,
  onActivate?: () => void,
  rendererPath?: string,
  appSettingsConfigPath?: string
): void {
  configureCommandLineSwitches()

  app.whenReady().then(() => {
    logger.info(`🚀 ${appName} application starting...`)
    logger.info(`Platform: ${process.platform}`)
    logger.info(`Node version: ${process.versions.node}`)
    logger.info(`Electron version: ${process.versions.electron}`)

    if (rendererPath) {
      setupAppProtocol(rendererPath)
    }

    logger.info('🔧 Starting setupIPC...')
    setupIPC(devResourcesPath, appSettingsConfigPath)
    logger.info('🔧 setupIPC completed')

    logger.info('🔧 Starting setupAppLifecycle...')
    setupAppLifecycle()
    logger.info('🔧 setupAppLifecycle completed')

    logger.info('🪟 Starting createWindow...')
    createWindow()
    logger.info('🪟 createWindow completed')

    logger.info(`✅ ${appName} application started successfully`)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (onActivate) {
          onActivate()
        } else {
          createWindow()
        }
      }
    })
  }).catch((error: unknown) => {
    logger.error('App failed to start:', { error: String(error) })
  })
}
