import { BrowserWindow, app, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { getThemeService, getStorageService, initSettingsService, initFeatureService, logger } from '../services'
import type { BaseWindow } from './BaseWindow'
import { createSplashWindow, SplashWindowHandle, SplashWindowOptions } from './SplashWindow'
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
// `ecui-media` serves on-disk media (e.g. screencast .webm temp files) to the
// renderer — the renderer BLOCKS `file://`, so a `<video src=file://…>` never
// loads; an `ecui-media://` URL does. Registered by McpService's handler.
if (process.type === 'browser') {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true } },
    { scheme: 'ecui-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
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
 * Upper bound on how long the splash may stay up waiting for the main window
 * to become ready. If the renderer hangs / crashes / fails to load before its
 * first paint, this prevents a frozen always-on-top splash from lingering.
 */
const SPLASH_SAFETY_TIMEOUT_MS = 30_000

/**
 * Options for {@link initializeApp}. Kept as a single object so the splash
 * config + the various optional paths/callbacks don't grow into a long,
 * order-sensitive positional list.
 */
export interface InitializeAppOptions {
  /**
   * Create the main window. May return the {@link BaseWindow} instance so the
   * splash handoff can hook its `ready-to-show` (close the splash right before
   * the main window appears). When it returns nothing, the splash is closed on
   * the first window's `ready-to-show` as a fallback.
   */
  createWindow: () => BaseWindow | undefined
  /** Optional path to resources directory in development mode. */
  devResourcesPath?: string
  /** Optional handler for the macOS `activate` event. */
  onActivate?: () => void
  /** Optional renderer directory for static assets (used for the app:// protocol). */
  rendererPath?: string
  /** Optional app-specific settings YAML (loaded after defaults). */
  appSettingsConfigPath?: string
  /** Optional app-specific features YAML (loaded after defaults). */
  appFeaturesConfigPath?: string
  /**
   * Splash screen shown while the app boots. When set, the library shows the
   * splash immediately (before the main window exists), keeps the main window
   * hidden until its renderer is ready to paint, then closes the splash and
   * reveals the main window — a flash-free handoff. The app provides only the
   * content (its logo); the window + mechanics live here. Requires the main
   * window to be created with `showWhenReady: true` in its configuration.
   */
  splash?: SplashWindowOptions
}

/**
 * Initialize Electron application.
 *
 * Two call forms are supported:
 * - object form: `initializeApp(appName, { createWindow, splash, … })` — use
 *   this to opt into the splash screen + other options;
 * - legacy positional form: `initializeApp(appName, createWindow, devResourcesPath, …)`
 *   — kept working for existing callers.
 */
export function initializeApp(
  appName: string,
  optionsOrCreateWindow: InitializeAppOptions | (() => BaseWindow | undefined),
  devResourcesPath?: string,
  onActivate?: () => void,
  rendererPath?: string,
  appSettingsConfigPath?: string,
  appFeaturesConfigPath?: string
): void {
  // Normalize the two call forms into a single options object. With
  // `exactOptionalPropertyTypes`, only include the optional keys that are
  // actually defined rather than assigning `undefined`.
  const options: InitializeAppOptions = typeof optionsOrCreateWindow === 'function'
    ? {
        createWindow: optionsOrCreateWindow,
        ...(devResourcesPath !== undefined ? { devResourcesPath } : {}),
        ...(onActivate !== undefined ? { onActivate } : {}),
        ...(rendererPath !== undefined ? { rendererPath } : {}),
        ...(appSettingsConfigPath !== undefined ? { appSettingsConfigPath } : {}),
        ...(appFeaturesConfigPath !== undefined ? { appFeaturesConfigPath } : {})
      }
    : optionsOrCreateWindow

  configureCommandLineSwitches()

  let splash: SplashWindowHandle | null = null

  app.whenReady().then(() => {
    logger.info(`🚀 ${appName} application starting...`)
    logger.info(`Platform: ${process.platform}`)
    logger.info(`Node version: ${process.versions.node}`)
    logger.info(`Electron version: ${process.versions.electron}`)

    // Show the splash as early as possible — before the main window exists —
    // so the user gets immediate feedback while services + the renderer boot.
    if (options.splash) {
      splash = createSplashWindow(options.splash)
    }

    if (options.rendererPath) {
      setupAppProtocol(options.rendererPath)
    }

    logger.info('🔧 Starting setupIPC...')
    setupIPC(options.devResourcesPath, options.appSettingsConfigPath, options.appFeaturesConfigPath)
    logger.info('🔧 setupIPC completed')

    logger.info('🔧 Starting setupAppLifecycle...')
    setupAppLifecycle()
    logger.info('🔧 setupAppLifecycle completed')

    // Close the splash exactly once, however the handoff resolves. Idempotent
    // so the throw / never-ready / normal paths can all call it safely.
    let splashSafetyTimer: ReturnType<typeof setTimeout> | null = null
    const closeSplash = (): void => {
      if (splashSafetyTimer) {
        clearTimeout(splashSafetyTimer)
        splashSafetyTimer = null
      }
      splash?.close()
      splash = null
    }

    logger.info('🪟 Starting createWindow...')
    let mainWindow: BaseWindow | undefined
    try {
      mainWindow = options.createWindow()
    } catch (error) {
      // A failed window creation must not leave the always-on-top splash
      // orphaned over a broken boot. Close it, then surface the error.
      closeSplash()
      throw error
    }
    logger.info('🪟 createWindow completed')

    // Hand off from splash to main window. When the main window reports
    // ready-to-show (its renderer painted), close the splash just before it
    // becomes visible — no overlap, no flash. Prefer the BaseWindow's
    // readiness callback (precise); fall back to the BrowserWindow event when
    // the app didn't return its window instance.
    if (splash) {
      // Safety net: if the renderer never reaches ready-to-show (hang / crash
      // / load failure), don't leave a frozen always-on-top splash up forever.
      splashSafetyTimer = setTimeout(() => {
        logger.warn('Splash safety timeout reached before window was ready; closing splash')
        closeSplash()
      }, SPLASH_SAFETY_TIMEOUT_MS)

      if (mainWindow) {
        mainWindow.onReadyToShow(closeSplash)
      } else {
        const win = BrowserWindow.getAllWindows().find((w) => w !== splash?.getWindow())
        if (win) {
          win.once('ready-to-show', closeSplash)
        } else {
          // No window to hook — don't leave the splash up forever.
          closeSplash()
        }
      }
    }

    logger.info(`✅ ${appName} application started successfully`)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (options.onActivate) {
          options.onActivate()
        } else {
          options.createWindow()
        }
      }
    })
  }).catch((error: unknown) => {
    logger.error('App failed to start:', { error: String(error) })
  })
}
