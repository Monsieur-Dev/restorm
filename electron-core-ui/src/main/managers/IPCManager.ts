import { BrowserWindow, ipcMain, app, screen } from 'electron'
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
    const previousTheme = storageService.get<string>('currentTheme')

    // If the requested theme is already active, avoid rebroadcasting
    if (previousTheme === themeId) {
      logger.info('Theme set called with same theme, skipping broadcast', { themeId })
      return true
    }

    storageService.set('currentTheme', themeId)
    
    // Notify all windows that theme has changed
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('theme:changed', themeId)
      }
    }
    
    logger.info('Theme changed and broadcasted to all windows', { themeId, windowCount: windows.length })
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

  // Window control IPC handlers
  ipcMain.handle('minimize-window', (event) => {
    const wnd = BrowserWindow.fromWebContents(event.sender)
    if (wnd && !wnd.isDestroyed()) {
      wnd.minimize()
      logger.info('Window minimized')
    }
  })

  ipcMain.handle('maximize-window', (event) => {
    const wnd = BrowserWindow.fromWebContents(event.sender)
    if (wnd && !wnd.isDestroyed()) {
      if (wnd.isMaximized()) {
        wnd.unmaximize()
        logger.info('Window unmaximized')
      } else {
        wnd.maximize()
        logger.info('Window maximized')
      }
    }
  })

  ipcMain.handle('close-window', (event) => {
    const wnd = BrowserWindow.fromWebContents(event.sender)
    if (wnd && !wnd.isDestroyed()) {
      logger.info('Closing window', { windowId: wnd.id })
      wnd.close()
    }
  })
  
  // Tabs: helpers for aux windows and pointer position
  ipcMain.handle('tabs:get-cursor-screen-point', () => {
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    return { x: point.x, y: point.y, display: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height } };
  });

  ipcMain.handle('tabs:get-active-window-bounds', () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const bounds = win.getBounds();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });

  // Get current window bounds (the window that sent the IPC request)
  ipcMain.handle('tabs:get-current-window-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      return { x: 0, y: 0, width: 0, height: 0, windowId: -1 };
    }
    const bounds = win.getBounds();
    // Use win.id (BrowserWindow ID) instead of webContents.id for consistency
    return { 
      x: bounds.x, 
      y: bounds.y, 
      width: bounds.width, 
      height: bounds.height,
      windowId: win.id
    };
  });

  ipcMain.handle('tabs:create-aux-window', (_event, payload: { editorId: string; title: string }, bounds: { x: number; y: number; width?: number; height?: number }) => {
    const win = new BrowserWindow({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: bounds.width ?? 900,
      height: bounds.height ?? 600,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js')
      },
      show: true,
      title: payload.title
    });
    // Inherit app URL from first window
    const first = BrowserWindow.getAllWindows()[0];
    const urlToLoad = first?.webContents.getURL();
    if (urlToLoad && urlToLoad.length > 0) {
      win.loadURL(urlToLoad).catch((err) => { logger.error('Failed to load URL in aux window', { error: String(err) }); });
    }
  });

  // Get window under cursor for cross-window drag & drop
  ipcMain.handle('tabs:get-window-under-cursor', () => {
    const point = screen.getCursorScreenPoint();
    const windows = BrowserWindow.getAllWindows();
    
    logger.info('Finding window under cursor', { 
      cursorPoint: { x: point.x, y: point.y },
      windowCount: windows.length,
      windows: windows.map(win => ({ 
        id: win.id, 
        webContentsId: win.webContents.id, 
        destroyed: win.isDestroyed(),
        bounds: win.getBounds()
      }))
    })
    
    for (const win of windows) {
      if (win.isDestroyed()) continue;
      const bounds = win.getBounds();
      if (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height
      ) {
        // Use win.id (BrowserWindow ID) instead of webContents.id
        // BrowserWindow.fromId() expects win.id, not webContents.id
        // win.id should always be defined for created windows
        if (!win.id) {
          logger.warn('Window ID is undefined', { webContentsId: win.webContents.id })
          continue
        }
        
        logger.info('Found window under cursor', { 
          windowId: win.id, 
          webContentsId: win.webContents.id,
          bounds 
        })
        
        return {
          windowId: win.id,
          bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }
        }
      }
    }
    
    logger.warn('No window found under cursor', { cursorPoint: { x: point.x, y: point.y } })
    return null
  });

  // Send tab data to target window for cross-window drag & drop
  ipcMain.handle('tabs:send-workbench-tab-to-window', (_event, targetWindowId: number, tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => {
    // Get all windows to debug
    const allWindows = BrowserWindow.getAllWindows()
    logger.info('Attempting to send tab to window', { 
      targetWindowId, 
      allWindowIds: allWindows.map(win => ({ id: win.id, webContentsId: win.webContents.id, destroyed: win.isDestroyed() }))
    })
    
    const targetWindow = BrowserWindow.fromId(targetWindowId)
    if (!targetWindow || targetWindow.isDestroyed()) {
      logger.warn('Target window not found for cross-window tab drag', { 
        targetWindowId,
        allWindowIds: allWindows.map(win => win.id),
        allWebContentsIds: allWindows.map(win => win.webContents.id)
      })
      return false
    }
    
    // Send tab data to target window
    targetWindow.webContents.send('tabs:workbench-tab-dropped', tabData)
    logger.info('Tab data sent to target window', { targetWindowId, tabId: tabData.tabId, cursorX: tabData.cursorX, cursorY: tabData.cursorY })
    return true
  });

  // Storage API for persisting application data (workbench config, etc.)
  ipcMain.handle('storage:get', (_event, key: string) => {
    const storage = getStorageService()
    return storage.get(key)
  })

  ipcMain.handle('storage:set', (_event, key: string, value: unknown) => {
    const storage = getStorageService()
    storage.set(key, value)
    return true
  })

  ipcMain.handle('storage:delete', (_event, key: string) => {
    const storage = getStorageService()
    storage.delete(key)
    return true
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

