import { BrowserWindow, screen, BrowserWindowConstructorOptions, ipcMain, nativeImage, Menu } from "electron"
import { join } from "path"
import { getStorageService, logger } from "../services"
import { WindowConfiguration, WindowState, isDevToolsEnabled } from "./WindowManager"

/**
 * BaseWindow handles window state persistence and restoration
 * with safety checks to ensure windows remain visible and accessible
 */
export abstract class BaseWindow {
    private window: BrowserWindow | null = null
    private storageService = getStorageService()
    protected iconPath: string | undefined = undefined

    /**
     * Callbacks fired once the window is ready to be shown. When the window
     * is created with `showWhenReady`, these run on the Electron
     * `ready-to-show` event, just before the window is revealed — the splash
     * handoff registers here to close the splash right before the main
     * window appears. If the window is shown immediately (no `showWhenReady`)
     * they fire as soon as the renderer finishes loading.
     */
    private readyToShowCallbacks: (() => void)[] = []

    /**
     * Set once the ready-to-show callbacks have fired, so a callback
     * registered after readiness still runs immediately instead of waiting
     * for an event that already passed.
     */
    private isReadyToShow = false

    /**
     * Configuration for this window
     */
    protected readonly configuration: WindowConfiguration

    /**
     * Static flags to ensure IPC handlers are registered only once
     */
    private static iconHandlerRegistered = false
    private static windowActionHandlerRegistered = false
    private static windowTitleHandlerRegistered = false
    private static platformHandlerRegistered = false
    private static interceptedShortcutsHandlerRegistered = false
    private static isDevModeHandlerRegistered = false

    /**
     * Static Map to associate BrowserWindow instances with BaseWindow instances
     */
    private static windowInstances = new Map<BrowserWindow, BaseWindow>()
    
    /**
     * Map to store intercepted shortcuts per window (webContentsId -> Set of shortcuts)
     */
    private static interceptedShortcutsPerWindow = new Map<number, Set<string>>()
  
    constructor(configuration: WindowConfiguration) {
      this.configuration = configuration
      // Create the window immediately using the provided configuration
      logger.info('🔧 BaseWindow: About to call createWindow()')
      this.createWindow()
      logger.info('🔧 BaseWindow: createWindow() completed')
    }
  
    /**
     * Get the BrowserWindow instance
     */
    getWindow(): BrowserWindow | null {
      return this.window
    }

    /**
     * Register a callback fired once the window is ready to be shown. If the
     * window is already past readiness, the callback runs synchronously. Used
     * to hand off from a splash screen (close the splash) right before the
     * main window becomes visible.
     */
    onReadyToShow(callback: () => void): void {
      if (this.isReadyToShow) {
        callback()
        return
      }
      this.readyToShowCallbacks.push(callback)
    }

    /**
     * Fire (once) every ready-to-show callback and clear the queue.
     */
    private fireReadyToShow(): void {
      if (this.isReadyToShow) {
        return
      }
      this.isReadyToShow = true
      const callbacks = this.readyToShowCallbacks
      this.readyToShowCallbacks = []
      for (const callback of callbacks) {
        try {
          callback()
        } catch (error) {
          logger.error('ready-to-show callback failed', { error: String(error) })
        }
      }
    }
  
    /**
     * Set the BrowserWindow instance and setup DevTools
     */
    setWindow(window: BrowserWindow): void {
      this.window = window
      // Register this instance in the static Map
      BaseWindow.windowInstances.set(window, this)
      this.attachWindowListeners()
      this.setupDevTools()
      this.setupWindowControls()
    }
  
    /**
     * Minimize the window
     */
    minimizeWindow(): void {
      const wnd = this.window
      if (!wnd || wnd.isDestroyed()) {
        return
      }
      wnd.minimize()
    }
  
    /**
     * Maximize/Restore the window
     */
    maximizeWindow(): void {
      const wnd = this.window
      if (!wnd || wnd.isDestroyed()) {
        return
      }
      if (wnd.isMaximized()) {
        wnd.unmaximize()
      } else {
        wnd.maximize()
      }
    }
  
    /**
     * Close the window
     */
    closeWindow(): void {
      const wnd = this.window
      if (!wnd || wnd.isDestroyed()) {
        return
      }
      wnd.close()
    }
  
    /**
     * Set window title
     */
    setWindowTitle(title: string): void {
      const wnd = this.window
      if (!wnd || wnd.isDestroyed()) {
        return
      }
      wnd.setTitle(title)
    }
  
    /**
     * Setup window control handlers
     */
    private setupWindowControls(): void {
      if (!this.window) {
        return
      }

      // Register window action handler (only once)
      if (!BaseWindow.windowActionHandlerRegistered) {
        ipcMain.on('window-action', (event: Electron.IpcMainEvent, action: string) => {
          const wnd = BrowserWindow.fromWebContents(event.sender)
        if (!wnd || wnd.isDestroyed()) {
          return
        }
          const instance = BaseWindow.windowInstances.get(wnd)
          if (!instance) {
            return
          }
        switch (action) {
          case 'minimize':
            wnd.minimize()
            break
          case 'maximize':
            if (wnd.isMaximized()) {
              wnd.unmaximize()
            } else {
              wnd.maximize()
            }
            // Send window state update after a short delay
            setTimeout(() => {
              if (!wnd.isDestroyed()) {
                wnd.webContents.send('window-state', wnd.isMaximized() ? 'maximized' : 'normal')
              }
            }, 100)
            break
          case 'close':
            wnd.close()
            break
        }
      })
        BaseWindow.windowActionHandlerRegistered = true
      }

      // Register window title handler (only once)
      if (!BaseWindow.windowTitleHandlerRegistered) {
        ipcMain.on('set-window-title', (event: Electron.IpcMainEvent, title: string) => {
          const wnd = BrowserWindow.fromWebContents(event.sender)
        if (!wnd || wnd.isDestroyed()) {
          return
        }
        wnd.setTitle(title)
      })
        BaseWindow.windowTitleHandlerRegistered = true
      }

      // Register window icon handler (only once)
      if (!BaseWindow.iconHandlerRegistered) {
        logger.info('📋 Registering get-window-icon handler (first time)')
        ipcMain.handle('get-window-icon', (event: Electron.IpcMainInvokeEvent) => {
          const wnd = BrowserWindow.fromWebContents(event.sender)
          if (!wnd || wnd.isDestroyed()) {
            return null
          }
          const instance = BaseWindow.windowInstances.get(wnd)
          if (!instance?.iconPath) {
            return null
          }
        try {
            const image = nativeImage.createFromPath(instance.iconPath)
          if (image.isEmpty()) return null
          return image.toDataURL()
        } catch (error) {
          logger.error('Failed to convert icon to data URL', { error: String(error) })
          return null
        }
      })
        BaseWindow.iconHandlerRegistered = true
        logger.info('✅ get-window-icon handler registered successfully')
      } else {
        logger.info('⏭️ get-window-icon handler already registered, skipping')
      }

      // Register platform request handler (only once)
      if (!BaseWindow.platformHandlerRegistered) {
        ipcMain.on('request-platform', (event: Electron.IpcMainEvent) => {
          // Check if WebContents is still valid before sending
          if (event.sender.isDestroyed()) {
            return
          }
          event.sender.send('platform', process.platform)
        })
        BaseWindow.platformHandlerRegistered = true
      }

      // Register intercepted shortcuts handler (only once)
      if (!BaseWindow.interceptedShortcutsHandlerRegistered) {
        ipcMain.on('register-intercepted-shortcuts', (event: Electron.IpcMainEvent, shortcuts: string[]) => {
          if (event.sender.isDestroyed()) {
            return
          }
          const webContentsId = event.sender.id
          // Parse shortcuts to extract keys that need interception (Ctrl+X pattern)
          const keysToIntercept = new Set<string>()
          for (const shortcut of shortcuts) {
            const parts = shortcut.toLowerCase().split('+')
            if (parts.length === 0) continue
            const hasCtrl = parts.includes('ctrl') || parts.includes('control')
            const hasShift = parts.includes('shift')
            const hasAlt = parts.includes('alt')
            // Only intercept simple Ctrl+X shortcuts (not Ctrl+Shift+X, etc.)
            // These are the ones Chromium would handle by default
            if (hasCtrl && !hasShift && !hasAlt) {
              const key = parts[parts.length - 1]
              if (key?.length === 1) {
                keysToIntercept.add(key)
              }
            }
          }
          BaseWindow.interceptedShortcutsPerWindow.set(webContentsId, keysToIntercept)
        })
        BaseWindow.interceptedShortcutsHandlerRegistered = true
      }

      // Register isDevMode handler (only once)
      if (!BaseWindow.isDevModeHandlerRegistered) {
        ipcMain.handle('is-dev-mode', () => {
          return isDevToolsEnabled()
        })
        BaseWindow.isDevModeHandlerRegistered = true
      }
    }
  
    /**
     * Load window state from storage with safety checks
     */
    private loadWindowState(): WindowState {
      const windows = (this.storageService.get('windows') ?? {}) as Record<string, WindowState>
      const savedState = windows[this.configuration.name]
  
      // Default state
      const defaultState: WindowState = {
        width: this.configuration.defaultWidth,
        height: this.configuration.defaultHeight,
        x: 0,
        y: 0,
        fullscreen: false
      }
  
      // Center default position
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
      defaultState.x = Math.floor((screenWidth - defaultState.width) / 2)
      defaultState.y = Math.floor((screenHeight - defaultState.height) / 2)
  
      // If no saved state, return default
      if (!savedState) {
        return defaultState
      }
  
      // Validate saved state with safety checks
      const state: WindowState = { ...savedState }
  
      // Ensure dimensions are reasonable
      if (state.width < 400 || state.width > screenWidth) {
        state.width = defaultState.width
      }
      if (state.height < 300 || state.height > screenHeight) {
        state.height = defaultState.height
      }
  
      // Safety check: ensure window is at least partially visible horizontally
      if (state.x + state.width <= 0 || state.x >= screenWidth) {
        state.x = defaultState.x
      }
  
      // Safety check: ensure title bar is visible (at least 40px from top)
      // and window is not completely below the screen
      if (state.y < 0 || state.y + 40 >= screenHeight) {
        state.y = defaultState.y
      }
  
      return state
    }
  
    /**
     * Save window state to storage
     */
    private saveWindowState(): void {
      if (!this.window || this.window.isDestroyed()) {
        return
      }
  
      const bounds = this.window.getBounds()
      const isFullscreen = this.window.isFullScreen()
  
      // Safety check: prevent negative Y position
      const y = Math.max(0, bounds.y)
  
      const state: WindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: y,
        fullscreen: isFullscreen
      }
  
      // Get existing windows data
      const windows = (this.storageService.get('windows') ?? {}) as Record<string, WindowState>
      windows[this.configuration.name] = state
  
      // Save to storage
      this.storageService.set('windows', windows)
    }
  
    /**
     * Attach event listeners to save window state
     */
    private attachWindowListeners(): void {
      if (!this.window) {
        return
      }
  
      // Save state when window is moved or resized
      this.window.on('moved', () => {
        this.saveWindowState()
      })
      this.window.on('resized', () => {
        this.saveWindowState()
      })
  
      // Save state when entering/leaving fullscreen
      this.window.on('enter-full-screen', () => {
        this.saveWindowState()
      })
      this.window.on('leave-full-screen', () => {
        this.saveWindowState()
      })
    }
  
    /**
     * Setup DevTools for the window
     */
    private setupDevTools(): void {
      if (!this.window) {
        return
      }
  
      const devToolsEnabled = isDevToolsEnabled()
  
      // Intercept keyboard shortcuts before Chromium handles them
      // This allows shortcuts like Ctrl+N, Ctrl+O to reach the renderer
      this.window.webContents.on('before-input-event', (event, input) => {
        // DevTools shortcuts stay on `keyDown` — `toggleDevTools()` doesn't
        // fire reliably from the earlier `rawKeyDown` stage on Linux.
        // Intentionally NOT calling `event.preventDefault()` here: letting
        // Chromium dispatch the DevTools shortcut naturally (on top of our
        // explicit `toggleDevTools()`) avoids the Linux input-pipeline
        // freeze that `preventDefault` at the `keyDown` stage causes, and
        // the duplicate "toggle" is harmless because Chromium's built-in
        // F12 handling doesn't fire when we open DevTools ourselves.
        if (input.type === 'keyDown' && devToolsEnabled) {
          const isDevToolsShortcut =
            input.key === 'F12' ||
            (input.control && input.shift && input.key === 'I') ||
            (input.meta && input.alt && input.key === 'I')

          if (isDevToolsShortcut && this.window) {
            this.window.webContents.toggleDevTools()
            return
          }
        }

        // Registered Ctrl/Meta+letter shortcuts are intercepted on
        // `rawKeyDown` (earliest stage, before Chromium's modifier / IME
        // pipeline runs). Calling `preventDefault` at the later `keyDown`
        // stage leaves Chromium's input pipeline in a stuck composition-
        // like state on Linux, swallowing the next printable keystroke in
        // every text field (plain <input> and Monaco) until any
        // non-character key resynchronises things.
        if (input.type === 'rawKeyDown') {
          const isModifiedKey = input.control || input.meta

          if (isModifiedKey && input.key.length === 1 && this.window) {
            const webContentsId = this.window.webContents.id
            const shortcutsToIntercept = BaseWindow.interceptedShortcutsPerWindow.get(webContentsId) ?? new Set<string>()
            
            const keyLower = input.key.toLowerCase()
            
            // Only intercept if this is a shortcut registered by the renderer
            if (shortcutsToIntercept.has(keyLower)) {
              // Build shortcut string
              const parts: string[] = []
              if (input.control || input.meta) parts.push('Ctrl')
              if (input.shift) parts.push('Shift')
              if (input.alt) parts.push('Alt')
              parts.push(input.key.toUpperCase())
              const shortcut = parts.join('+')

              // Send to renderer and prevent default Chromium behavior
              this.window.webContents.send('keyboard-shortcut', shortcut)
              event.preventDefault()
            }
            // Other shortcuts (Ctrl+Space, Ctrl+F, etc.) pass through to renderer naturally
          }
        }
      })
    }
  
    /**
     * Destroy the window manager
     */
    private destroy(): void {
      this.window = null
    }
  
    /**
     * Create and configure a BrowserWindow with the saved state
     */
  protected createWindow(options: Partial<BrowserWindowConstructorOptions> = {}): void {
    logger.info('🔧 BaseWindow: createWindow() method started')
    // Load saved window state
    const state = this.loadWindowState()
  
      // Merge user options with defaults
      const devToolsEnabled = isDevToolsEnabled()
      
      // Configure icon path if provided in configuration
      if (this.configuration.iconPath) {
        let iconExt = '.png' // Linux default
        if (process.platform === 'win32') {
          iconExt = '.ico'
        } else if (process.platform === 'darwin') {
          iconExt = '.icns'
        }
        this.iconPath = `${this.configuration.iconPath}${iconExt}`
        logger.info(`🔖 Icon path: ${this.iconPath}`)
      }
      
      // Configure window style
      // According to Electron docs, titleBarStyle: 'hidden' is supported on macOS, Windows, and Linux
      // We use it with titleBarOverlay for native window controls on all platforms
      const defaultOptions: BrowserWindowConstructorOptions = {
        width: state.width,
        height: state.height,
        x: state.x,
        y: state.y,
        frame: false,
        // Create hidden when the caller wants to defer the reveal until the
        // renderer is ready to paint (splash handoff) — avoids the flash of
        // an unstyled / half-loaded window.
        ...(this.configuration.showWhenReady ? { show: false } : {}),
        ...(this.iconPath && { icon: this.iconPath }),
        /*titleBarStyle: 'hidden',
        titleBarOverlay: 
        process.platform === 'win32' || process.platform === 'darwin'
          ? { color: '#2b2b2b', symbolColor: '#fff', height: 32 }
          : false,*/
        //autoHideMenuBar: true,
        webPreferences: {
          preload: this.configuration.preloadScript ?? join(__dirname, '../../preload/index.js'),
          nodeIntegration: false,
          contextIsolation: true,
          devTools: devToolsEnabled
        }
      }
      
      // Deep merge webPreferences if provided
      const mergedOptions = {
        ...defaultOptions,
        ...options,
        webPreferences: {
          ...defaultOptions.webPreferences,
          ...(options.webPreferences ?? {})
        }
      } as BrowserWindowConstructorOptions
      
      // Force titleBarStyle and titleBarOverlay for custom titlebar
      mergedOptions.titleBarStyle = 'hidden'
      
      // Enable native Window Controls Overlay on Windows only
      // Linux uses CustomWCO component, macOS has its own native controls
      // Note: titleBarOverlay colors must be hex values, not CSS variables
      if (process.platform === 'win32') {
        mergedOptions.titleBarOverlay = {
          color: '#181818', // Default titleBar background
          symbolColor: '#cccccc', // Default titleBar foreground
          height: 30
        }
      }
      
      logger.info('Creating window with options:', {
        titleBarStyle: mergedOptions.titleBarStyle,
        titleBarOverlay: mergedOptions.titleBarOverlay,
        frame: mergedOptions.frame,
        platform: process.platform
      })
  
      // Create the browser window
      const window = new BrowserWindow(mergedOptions)

      // Disable default Electron menu to prevent it from capturing keyboard shortcuts
      // This allows shortcuts like Ctrl+N, Ctrl+O to be handled by the renderer process
      Menu.setApplicationMenu(null)
      
      // Tell Electron to ignore menu shortcuts and let them through to the renderer
      window.webContents.on('did-finish-load', () => {
        window.webContents.setIgnoreMenuShortcuts(true)
      })

      // Set fullscreen state if saved
      if (state.fullscreen) {
        window.setFullScreen(true)
      }

      // Reveal-when-ready handoff (splash). When created hidden, wait for the
      // renderer to signal it is FULLY mounted (real UI painted, not just the
      // window's first paint), run the ready-to-show callbacks (e.g. close the
      // splash), then show the window — a clean, flash-free transition with no
      // intermediate loading state ever visible.
      //
      // The signal is an explicit `app:renderer-ready` IPC the renderer fires
      // after its app has mounted (e.g. once a lazy/Suspense root has
      // resolved), NOT Electron's `ready-to-show`: `ready-to-show` fires on the
      // window's FIRST paint, which for a Suspense-based app is the loading
      // fallback — showing it would defeat the splash. `app:renderer-ready` is
      // exposed to the renderer as `window.electronAPI.notifyReady()`.
      //
      // When shown immediately (no `showWhenReady`), still fire the callbacks
      // once the renderer finishes loading so consumers get a single readiness
      // signal either way.
      if (this.configuration.showWhenReady) {
        const webContentsId = window.webContents.id
        const onRendererReady = (event: Electron.IpcMainEvent): void => {
          // Scope to THIS window — the channel is shared across all windows.
          if (event.sender.id !== webContentsId) {
            return
          }
          ipcMain.removeListener('app:renderer-ready', onRendererReady)
          if (window.isDestroyed()) {
            return
          }
          logger.info('BaseWindow: renderer signalled ready, revealing window')
          this.fireReadyToShow()
          window.show()
        }
        ipcMain.on('app:renderer-ready', onRendererReady)
        // Stop listening if the window goes away before the renderer signals.
        window.once('closed', () => {
          ipcMain.removeListener('app:renderer-ready', onRendererReady)
        })
      } else {
        window.webContents.once('did-finish-load', () => {
          this.fireReadyToShow()
        })
      }

      // Register window with manager (this will setup DevTools and listeners)
      this.setWindow(window)

      // Send initial window state
      window.webContents.send('window-state', window.isMaximized() ? 'maximized' : 'normal')
      
      // Send platform info immediately
      window.webContents.send('platform', process.platform)

      // Listen for window state changes
      window.on('maximize', () => {
        if (window.isDestroyed()) {
          return
        }
        window.webContents.send('window-state', 'maximized')
      })

      window.on('unmaximize', () => {
        if (window.isDestroyed()) {
          return
        }
        window.webContents.send('window-state', 'normal')
      })
  
      // Load content
      this.loadWindowContent(window)
  
      // Save state before closing
      window.on('close', () => {
        this.saveWindowState()
      })
  
      // Cleanup on closed
      window.on('closed', () => {
        // Remove from static Map
        BaseWindow.windowInstances.delete(window)
        this.destroy()
      })
    }
  
    /**
     * Load content into the window
     */
    private loadWindowContent(window: BrowserWindow): void {
      const loadStart = performance.now()
      
      // Log when DOM is ready
      window.webContents.once('dom-ready', () => {
        logger.info(`BaseWindow: dom-ready in ${(performance.now() - loadStart).toFixed(2)}ms`)
      })
      
      // Log when page finishes loading
      window.webContents.once('did-finish-load', () => {
        logger.info(`BaseWindow: did-finish-load in ${(performance.now() - loadStart).toFixed(2)}ms`)
      })
      
      // Load URL if provided, otherwise load file
      if (this.configuration.url) {
        logger.info(`BaseWindow: Loading URL ${this.configuration.url}...`)
        window.loadURL(this.configuration.url).catch((error: unknown) => {
          logger.error('Failed to load URL', { error: String(error) })
        })
      } else {
        // Use app:// protocol for absolute paths to work (both dev and production)
        const fileName = this.configuration.file.split('/').pop() ?? 'index.html'
        const appUrl = `app://./${fileName}`
        logger.info(`BaseWindow: Loading via app:// protocol: ${appUrl}...`)
        window.loadURL(appUrl).catch((error: unknown) => {
          logger.error('Failed to load app:// URL, falling back to loadFile', { error: String(error) })
          window.loadFile(this.configuration.file).catch((err: unknown) => {
            logger.error('Failed to load file', { error: String(err) })
          })
        })
      }
    }
  }
