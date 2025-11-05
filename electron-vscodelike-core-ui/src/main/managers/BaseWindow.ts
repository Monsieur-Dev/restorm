import { BrowserWindow, screen, BrowserWindowConstructorOptions, ipcMain, nativeImage } from "electron"
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
    private iconPath: string | undefined = undefined
  
    /**
     * Configuration for this window
     */
    protected readonly configuration: WindowConfiguration
  
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
     * Set the BrowserWindow instance and setup DevTools
     */
    setWindow(window: BrowserWindow): void {
      this.window = window
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

      // Remove existing handlers to avoid duplicates
      ipcMain.removeAllListeners('window-action')
      ipcMain.removeAllListeners('set-window-title')
      
      // Handle window actions from renderer
      ipcMain.on('window-action', (_event: Electron.IpcMainEvent, action: string) => {
        const wnd = this.window
        if (!wnd || wnd.isDestroyed()) {
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

      // Handle window title change from renderer
      ipcMain.on('set-window-title', (_event: Electron.IpcMainEvent, title: string) => {
        const wnd = this.window
        if (!wnd || wnd.isDestroyed()) {
          return
        }
        wnd.setTitle(title)
      })

      // Handle window icon request from renderer
      ipcMain.handle('get-window-icon', () => {
        if (!this.iconPath) return null
        try {
          const image = nativeImage.createFromPath(this.iconPath)
          if (image.isEmpty()) return null
          return image.toDataURL()
        } catch (error) {
          logger.error('Failed to convert icon to data URL', { error: String(error) })
          return null
        }
      })
    }
  
    /**
     * Load window state from storage with safety checks
     */
    private loadWindowState(): WindowState {
      const windows = this.storageService.get<Record<string, WindowState>>('windows') ?? {}
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
      const windows = this.storageService.get<Record<string, WindowState>>('windows') ?? {}
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
  
      // Open DevTools automatically in development mode
      if (process.env['NODE_ENV'] === 'development') {
        this.window.webContents.openDevTools()
      }
  
      // Add keyboard shortcuts for DevTools (F12 or Ctrl+Shift+I) only if enabled
      if (devToolsEnabled) {
        this.window.webContents.on('before-input-event', (event, input) => {
          if (input.type === 'keyDown') {
            const isDevToolsShortcut =
              input.key === 'F12' ||
              (input.control && input.shift && input.key === 'I') ||
              (input.meta && input.alt && input.key === 'I')
            
            if (isDevToolsShortcut && this.window) {
              this.window.webContents.toggleDevTools()
              event.preventDefault()
            }
          }
        })
      }
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
          color: '#181818', // Default VSCode titleBar background
          symbolColor: '#cccccc', // Default VSCode titleBar foreground
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

      // Set fullscreen state if saved
      if (state.fullscreen) {
        window.setFullScreen(true)
      }

      // Register window with manager (this will setup DevTools and listeners)
      this.setWindow(window)
      
      // Handle platform requests from renderer
      ipcMain.on('request-platform', () => {
        window.webContents.send('platform', process.platform)
      })

      // Send initial window state
      window.webContents.send('window-state', window.isMaximized() ? 'maximized' : 'normal')

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
        this.destroy()
      })
    }
  
    /**
     * Load content into the window
     */
    private loadWindowContent(window: BrowserWindow): void {
      // Load URL if provided, otherwise load file
      if (this.configuration.url) {
        window.loadURL(this.configuration.url).catch((error) => {
          logger.error('Failed to load URL', { error: String(error) })
        })
      } else {
        window.loadFile(this.configuration.file).catch((error) => {
          logger.error('Failed to load file', { error: String(error) })
        })
      }
    }
  }