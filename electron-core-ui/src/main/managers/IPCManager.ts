import { BrowserWindow, app, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { getThemeService, getStorageService, initSettingsService, initFeatureService, logger } from '../services'
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
 * Configure Electron command line switches needed for restricted
 * runtime environments (WSL, headless containers, …) where the
 * default sandbox / shared-memory / GPU pipeline is unreliable.
 *
 * GPU acceleration is left ON by default so hosts with working
 * drivers (like a regular Linux desktop with NVIDIA / Mesa /
 * AMDGPU) get hardware compositing + WebGL. Set
 * `ECUI_DISABLE_GPU=1` in restricted environments where the GPU
 * pipeline crashes during init — that re-applies the legacy
 * disable-* trio.
 */
export function configureCommandLineSwitches(): void {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-dev-shm-usage')

  if (process.env['ECUI_DISABLE_GPU'] === '1') {
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-software-rasterizer')
    app.commandLine.appendSwitch('disable-gpu-compositing')
  }

  logger.info('✅ Command line switches configured')
}

/**
 * Setup all IPC handlers for the application
 * @param resourcesPath - Path to resources directory containing themes
 * @param appSettingsConfigPath - Optional path to app-specific settings YAML (loaded after defaults)
 * @param appFeaturesConfigPath - Optional path to app-specific features YAML (loaded after defaults)
 */
export function setupIPC(resourcesPath?: string, appSettingsConfigPath?: string, appFeaturesConfigPath?: string): void {
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

  logger.info('🚩 Initializing feature service...')
  const featuresDefaultPath = join(finalResourcesPath, 'features', 'defaults.yaml')
  // Environment is propagated to the FeatureFlippingService so YAML
  // configs can gate features behind `Type: Environment` /
  // `AvailableIn: [dev]`. Same `isDev` predicate the resources-path
  // resolver uses above — packaged builds (`app.isPackaged`) get
  // `prod`; everything else (`pnpm dev`, electron-vite dev, CI) gets
  // `dev`.
  initFeatureService(featuresDefaultPath, appFeaturesConfigPath, 'desktop', isDev ? 'dev' : 'prod')

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
 * @param appFeaturesConfigPath - Optional path to app-specific features YAML (loaded after defaults)
 */
export function initializeApp(
  appName: string,
  createWindow: () => void,
  devResourcesPath?: string,
  onActivate?: () => void,
  rendererPath?: string,
  appSettingsConfigPath?: string,
  appFeaturesConfigPath?: string
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
    setupIPC(devResourcesPath, appSettingsConfigPath, appFeaturesConfigPath)
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
