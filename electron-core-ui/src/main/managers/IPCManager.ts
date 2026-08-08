import { BrowserWindow, app, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { getThemeService, getStorageService, initSettingsService, initFeatureService, logger } from '../services'
import type { BaseWindow } from './BaseWindow'
import { isInactiveRevealRequested, clearStartupActivationEnv } from './WindowManager'
import { createSplashWindow, SplashWindowHandle, SplashWindowOptions } from './SplashWindow'
import {
  registerThemeHandlers,
  registerFileHandlers,
  registerStorageHandlers,
  registerSearchHandlers,
  registerWindowHandlers,
  registerMiscHandlers,
  registerSettingsHandlers,
  registerGitHandlers,
  registerNativeMenuHandlers
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

  if (isInactiveRevealRequested()) {
    // Make `--inactive-window` actually keep focus on a native Wayland session.
    //
    // `showInactive()` is an X11 mechanism. Under Ozone-Wayland it is silently
    // ignored: a Wayland window cannot focus itself, and Chromium's
    // WaylandToplevelWindow requests activation on its first map — using an
    // inherited `XDG_ACTIVATION_TOKEN` if present, else calling
    // `RequestNewToken()` to ask the compositor for a fresh one — so the window
    // still grabs focus regardless of `showInactive()`. There is no public
    // switch to suppress that self-activation.
    //
    // Forcing the **X11 backend (XWayland)** sidesteps it entirely: under
    // XWayland `showInactive()` works exactly as it does on a native X11
    // session (verified), so both the splash and the main window reveal without
    // focus. These instances are launched for automation / agent / background
    // use, where running on XWayland instead of native Wayland is an acceptable
    // tradeoff (the cost is no native-Wayland niceties like per-monitor
    // fractional scaling — irrelevant for a background window). On an X11
    // session this switch is a no-op.
    app.commandLine.appendSwitch('ozone-platform', 'x11')
    logger.info('Inactive launch: forcing the X11/XWayland backend so showInactive() suppresses focus on Wayland')

    // Belt-and-suspenders: also drop any inherited activation token so the
    // backend has nothing to redeem even before the XWayland path takes over.
    // `clearStartupActivationEnv` uses `delete` (unsetenv), not an `= undefined`
    // assignment that Node would store as the literal string "undefined".
    const cleared = clearStartupActivationEnv()
    if (cleared.length > 0) {
      logger.info(`Inactive launch: cleared ${cleared.join(', ')} (inherited activation token)`)
    }
  }

  logger.info('Command line switches configured')
}

/**
 * Setup all IPC handlers for the application
 * @param resourcesPath - Path to resources directory containing themes
 * @param appSettingsConfigPath - Optional path to app-specific settings YAML (loaded after defaults)
 * @param appFeaturesConfigPath - Optional path to app-specific features YAML (loaded after defaults)
 */
export function setupIPC(resourcesPath?: string, appSettingsConfigPath?: string, appFeaturesConfigPath?: string): void {
  logger.info('Setting up IPC handlers...')

  // Get resources path if not provided
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  const finalResourcesPath = resourcesPath ?? (isDev
    ? join(__dirname, '../../../resources')
    : join(process.resourcesPath, 'resources'))

  logger.info(`Resources path: ${finalResourcesPath}`)

  logger.info('Initializing theme service...')
  const themeService = getThemeService(finalResourcesPath)
  logger.info('Initializing storage service...')
  const storageService = getStorageService()

  logger.info('Initializing settings service...')
  const settingsDefaultPath = join(finalResourcesPath, 'settings', 'defaults.yaml')
  initSettingsService(settingsDefaultPath, appSettingsConfigPath)

  logger.info('Initializing feature service...')
  const featuresDefaultPath = join(finalResourcesPath, 'features', 'defaults.yaml')
  // Environment is propagated to the FeatureFlippingService so YAML
  // configs can gate features behind `Type: Environment` /
  // `AvailableIn: [dev]`. Same `isDev` predicate the resources-path
  // resolver uses above — packaged builds (`app.isPackaged`) get
  // `prod`; everything else (`pnpm dev`, electron-vite dev, CI) gets
  // `dev`.
  initFeatureService({
    defaultConfigPath: featuresDefaultPath,
    appConfigPath: appFeaturesConfigPath,
    platform: 'desktop',
    environment: isDev ? 'dev' : 'prod'
  })

  logger.info('Services initialized successfully')

  logger.info('Setting up IPC handlers...')

  registerThemeHandlers(themeService, storageService)
  registerMiscHandlers(storageService)
  registerWindowHandlers()
  registerStorageHandlers()
  registerFileHandlers()
  registerSearchHandlers()
  registerSettingsHandlers()
  registerGitHandlers()
  registerNativeMenuHandlers()

  logger.info('IPC handlers setup complete')
}

/**
 * How long the process may still be running after a quit started before that
 * quit is assumed wedged. Not a teardown budget — `app.quit()` awaits none of
 * the app's teardown — just a threshold well past any plausible shutdown.
 */
const DEFAULT_QUIT_WATCHDOG_MS = 10_000

/** Pending force-exit timer, or `null` when no quit is in flight. */
let quitWatchdogTimer: ReturnType<typeof setTimeout> | null = null

/** Options for {@link setupAppLifecycle}. */
export interface AppLifecycleOptions {
  /**
   * Grace period before a quit that never completed is turned into a hard
   * exit, in ms. Pass `false` to disable the watchdog entirely — do that only
   * in an app that deliberately keeps running without windows (close-to-tray),
   * since without it a wedged quit leaves an invisible process behind.
   * Defaults to 10 s.
   *
   * A quit that a `before-quit` listener legitimately CANCELS is not affected:
   * the watchdog only exits when no live window is left by the time it fires.
   */
  quitWatchdogMs?: number | false
}

/**
 * Last-resort guarantee that a quit really ends the process.
 *
 * `app.quit()` is a *request*, not an exit: it runs the `before-quit` /
 * `will-quit` chain first, and a listener there can throw (which aborts the
 * listeners after it) or cancel the shutdown outright. The failure mode is
 * invisible to the user: a windowless main process that keeps its user-data
 * lock, its single-instance lock and its memory, and that accumulates one entry
 * per session until the machine reboots.
 *
 * So: arm a timer alongside the graceful quit and hard-exit when it expires. If
 * the quit worked, the process is gone long before the timer fires.
 *
 * Limit worth knowing: this is a JavaScript timer, so it cannot rescue a quit
 * handler that BLOCKS the main thread (a synchronous child process, a modal
 * native prompt). Teardown on the quit path has to stay non-blocking.
 */
function armQuitWatchdog(delayMs: number): void {
  if (quitWatchdogTimer !== null) {
    return
  }
  quitWatchdogTimer = setTimeout(() => {
    quitWatchdogTimer = null
    // A window came back in the meantime (deep link, dock re-activation, a
    // newly opened project): the app is legitimately alive again, leave it be.
    if (BrowserWindow.getAllWindows().some((window) => !window.isDestroyed())) {
      return
    }
    // Write the diagnosis to stderr as well as through the logger: a packaged
    // app launched from the desktop configures neither a console nor a file
    // transport, and the exit on the next line would truncate a buffered one
    // anyway. A desktop launch's stderr lands in the session journal, which is
    // the only place a force-exit can still be accounted for after the fact.
    process.stderr.write(`Quit watchdog: still running ${delayMs}ms after the quit started, forcing exit\n`)
    logger.warn('Quit watchdog: process still alive after the quit started, forcing exit', {
      afterMs: delayMs
    })
    // Honour a host that already decided on a failure code; 0 otherwise.
    app.exit(typeof process.exitCode === 'number' ? process.exitCode : 0)
  }, delayMs)
  // Un-ref'd so the watchdog itself can never be the last handle keeping a
  // would-be-exiting loop open. In an Electron main process the loop is pumped
  // by the browser regardless, so the timer still fires.
  quitWatchdogTimer.unref()
}

/**
 * Setup application lifecycle handlers
 * Quit when all windows are closed, except on macOS
 */
export function setupAppLifecycle(options: AppLifecycleOptions = {}): void {
  const watchdogMs = options.quitWatchdogMs ?? DEFAULT_QUIT_WATCHDOG_MS
  const arm = (): void => {
    // macOS: running with no window is normal there, and a Cmd+Q that a
    // `before-quit` listener cancels legitimately leaves the process up.
    if (process.platform === 'darwin' || watchdogMs === false) {
      return
    }
    armQuitWatchdog(watchdogMs)
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // Arm BEFORE asking: `app.quit()` runs the whole `before-quit` chain
      // synchronously, and a listener in it that throws would unwind straight
      // past the arming line.
      arm()
      app.quit()
    }
  })

  // Every OTHER route into a quit — the app menu's Quit role, an in-app
  // `app.quit()`, the updater's quit-and-install — closes the windows itself and
  // goes straight to `will-quit`, WITHOUT emitting `window-all-closed`. Arming
  // here as well covers them. Idempotent, and harmless when the quit is
  // cancelled: the watchdog exits only if no live window is left when it fires.
  //
  // PREPENDED on purpose: listeners run in registration order and the chain
  // stops at the first one that throws. The host app registers its teardown at
  // module scope, long before this runs inside `whenReady`, so a plain
  // `app.on` would put the watchdog last — disarmed by exactly the failure it
  // exists to catch.
  app.prependListener('before-quit', arm)

  logger.info('App lifecycle handlers setup complete')
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

  logger.info(`App protocol registered with renderer path: ${rendererPath}`)
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
  /**
   * Grace period, in ms, before a quit that never completed is turned into a
   * hard exit — see {@link AppLifecycleOptions.quitWatchdogMs}. `false`
   * disables the watchdog. Defaults to 10 s.
   */
  quitWatchdogMs?: number | false
}

/**
 * Initialize Electron application.
 *
 * One call form: `initializeApp(appName, { createWindow, splash, … })`.
 */
export function initializeApp(appName: string, options: InitializeAppOptions): void {
  configureCommandLineSwitches()

  let splash: SplashWindowHandle | null = null

  app.whenReady().then(() => {
    logger.info(`${appName} application starting...`)
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

    logger.info('Starting setupIPC...')
    setupIPC(options.devResourcesPath, options.appSettingsConfigPath, options.appFeaturesConfigPath)
    logger.info('setupIPC completed')

    logger.info('Starting setupAppLifecycle...')
    setupAppLifecycle({ ...(options.quitWatchdogMs !== undefined && { quitWatchdogMs: options.quitWatchdogMs }) })
    logger.info('setupAppLifecycle completed')

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

    logger.info('Starting createWindow...')
    let mainWindow: BaseWindow | undefined
    try {
      mainWindow = options.createWindow()
    } catch (error) {
      // A failed window creation must not leave the always-on-top splash
      // orphaned over a broken boot. Close it, then surface the error.
      closeSplash()
      throw error
    }
    logger.info('createWindow completed')

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

    logger.info(`${appName} application started successfully`)

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
