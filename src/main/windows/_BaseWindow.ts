import { BrowserWindow, screen, app, BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { getStorageService } from '../services/StorageService'
import { logger } from '../services/LoggerService'

/**
 * Window state interface
 */
export interface WindowState {
  width: number
  height: number
  x: number
  y: number
  fullscreen: boolean
}

/**
 * Complete window configuration interface
 */
export interface WindowConfiguration {
  name: string
  defaultWidth: number
  defaultHeight: number
  url: string | undefined
  file: string
}

/**
 * Check if DevTools should be enabled
 * In development: always enabled
 * In production: disabled by default, can be enabled with --enable-dev-tools flag
 */
export function isDevToolsEnabled(): boolean {
  return !app.isPackaged || process.argv.includes('--enable-dev-tools')
}

/**
 * BaseWindow handles window state persistence and restoration
 * with safety checks to ensure windows remain visible and accessible
 */
export abstract class BaseWindow {
  private window: BrowserWindow | null = null
  private storageService = getStorageService()

  /**
   * Window configuration provided by child classes
   */
  protected readonly configuration: WindowConfiguration

  constructor(configuration: WindowConfiguration) {
    this.configuration = configuration
    // Create the window immediately using the provided configuration
    this.createWindow()
  }

  /**
   * Set the BrowserWindow instance and setup DevTools
   */
  setWindow(window: BrowserWindow): void {
    this.window = window
    this.attachWindowListeners()
    this.setupDevTools()
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
  private createWindow(options: Partial<BrowserWindowConstructorOptions> = {}): void {
    // Load saved window state
    const state = this.loadWindowState()

    // Merge user options with defaults
    const devToolsEnabled = isDevToolsEnabled()
    const defaultOptions: BrowserWindowConstructorOptions = {
      width: state.width,
      height: state.height,
      x: state.x,
      y: state.y,
      autoHideMenuBar: !devToolsEnabled,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
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
    }

    // Create the browser window
    const window = new BrowserWindow(mergedOptions)

    // Set fullscreen state if saved
    if (state.fullscreen) {
      window.setFullScreen(true)
    }

    // Register window with manager (this will setup DevTools and listeners)
    this.setWindow(window)

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

  /**
   * Get the browser window instance
   */
  getWindow(): BrowserWindow | null {
    return this.window
  }
}

