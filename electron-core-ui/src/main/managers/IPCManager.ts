import { BrowserWindow, ipcMain, app, screen, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { getThemeService, getStorageService, logger, isFeatureServiceInitialized, getFeatureService, isFileServiceInitialized, getFileService, eventBusService, searchService, i18nService, type SearchDocument, type CategoryMeta } from '../services'

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
    const currentTheme = storageService.get('currentTheme') as string | undefined
    // If no theme is selected, use 'theme-defaults/dark_plus' as default
    return currentTheme ?? 'theme-defaults/dark_plus'
  })

  ipcMain.handle('theme:set', (_event, themeId: string) => {
    const previousTheme = storageService.get('currentTheme') as string | undefined

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
        }
      }
    }
    return true
  })

  // I18n IPC handlers
  ipcMain.handle('i18n:set-language', (_event, language: string) => {
    storageService.set('language', language)
    i18nService.setLanguage(language)
    logger.debug('Language changed via IPC', { language })
    return true
  })

  ipcMain.handle('i18n:get-language', () => {
    const stored = storageService.get('language') as string | undefined
    return stored ?? i18nService.getLanguage()
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
      win.loadURL(urlToLoad).catch((err: unknown) => { logger.error('Failed to load URL in aux window', { error: String(err) }); });
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
  ipcMain.handle('storage:get', (_event, key: string): unknown => {
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

  // Feature Flipping IPC handlers
  // Note: The feature service must be initialized by the consuming app before these handlers can work
  ipcMain.handle('feature:is-enabled', (_event, featureName: string) => {
    if (!isFeatureServiceInitialized()) {
      logger.warn('Feature service not initialized, returning false for feature check', { featureName })
      return false
    }
    return getFeatureService().isEnabled(featureName)
  })

  ipcMain.handle('feature:get-platform', () => {
    if (!isFeatureServiceInitialized()) {
      logger.warn('Feature service not initialized, returning "desktop" as default platform')
      return 'desktop'
    }
    return getFeatureService().getPlatform()
  })

  // File Service IPC handlers
  // Note: The file service must be initialized by the consuming app before these handlers can work
  ipcMain.handle('file:new', async () => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().newFile()
  })

  ipcMain.handle('file:open', async (_event, path?: string) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return { success: false }
    }
    return getFileService().open(path)
  })

  ipcMain.handle('file:save', async (_event, content: unknown) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().save(content)
  })

  ipcMain.handle('file:save-as', async (_event, content: unknown, filename?: string, format?: string) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().saveAs(content, filename, format as 'json' | 'yaml' | undefined)
  })

  ipcMain.handle('file:close', () => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().close()
  })

  ipcMain.handle('file:get-state', () => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return null
    }
    return getFileService().getState()
  })

  ipcMain.handle('file:get-name', () => {
    if (!isFileServiceInitialized()) {
      return null
    }
    return getFileService().getFileName()
  })

  ipcMain.handle('file:get-path', () => {
    if (!isFileServiceInitialized()) {
      return null
    }
    return getFileService().getFilePath()
  })

  ipcMain.handle('file:is-dirty', () => {
    if (!isFileServiceInitialized()) {
      return false
    }
    return getFileService().isDirty()
  })

  ipcMain.handle('file:mark-dirty', () => {
    if (!isFileServiceInitialized()) {
      return
    }
    getFileService().markDirty()
  })

  ipcMain.handle('file:clear-dirty', () => {
    if (!isFileServiceInitialized()) {
      return
    }
    getFileService().clearDirty()
  })

  ipcMain.handle('file:finish-loading', () => {
    if (!isFileServiceInitialized()) {
      return
    }
    getFileService().finishLoading()
  })

  ipcMain.handle('file:check-and-update-dirty', (_event, currentChecksum: string) => {
    if (!isFileServiceInitialized()) {
      return
    }
    const fileService = getFileService()
    const hasChanges = fileService.hasContentChanged(currentChecksum)
    const isDirty = fileService.isDirty()
    
    if (hasChanges && !isDirty) {
      logger.debug('[FileService] Content changed, marking dirty')
      fileService.markDirty()
    } else if (!hasChanges && isDirty) {
      logger.debug('[FileService] Content returned to saved state, clearing dirty')
      fileService.clearDirty()
    }
  })

  ipcMain.handle('file:show-unsaved-dialog', async (_event, labels?: {
    title?: string
    message?: string
    detail?: string
    save?: string
    dontSave?: string
    cancel?: string
  }) => {
    if (!isFileServiceInitialized()) {
      return 'cancel'
    }
    return getFileService().showUnsavedChangesDialog(labels)
  })

  ipcMain.handle('file:get-recent', () => {
    if (!isFileServiceInitialized()) {
      return []
    }
    return getFileService().getRecentFiles()
  })

  ipcMain.handle('file:get-favorites', () => {
    if (!isFileServiceInitialized()) {
      return []
    }
    return getFileService().getFavorites()
  })

  ipcMain.handle('file:toggle-favorite', (_event, path: string) => {
    if (!isFileServiceInitialized()) {
      return false
    }
    return getFileService().toggleFavorite(path)
  })

  ipcMain.handle('file:remove-from-recent', (_event, path: string) => {
    if (!isFileServiceInitialized()) {
      return
    }
    getFileService().removeFromRecent(path)
  })

  ipcMain.handle('file:get-content-checksum', () => {
    if (!isFileServiceInitialized()) {
      return null
    }
    return getFileService().getContentChecksum()
  })

  ipcMain.handle('file:set-content-checksum', (_event, checksum: string) => {
    if (!isFileServiceInitialized()) {
      return
    }
    getFileService().setContentChecksum(checksum)
  })

  ipcMain.handle('file:has-content-changed', (_event, currentChecksum: string) => {
    if (!isFileServiceInitialized()) {
      return false
    }
    return getFileService().hasContentChanged(currentChecksum)
  })

  // Object checksum tracking handlers
  ipcMain.handle('file:register-initial-checksums', (_event, objects: [string, unknown][]) => {
    logger.debug('[IPCManager] file:register-initial-checksums called', { count: objects.length })
    if (!isFileServiceInitialized()) {
      logger.warn('[IPCManager] FileService not initialized')
      return
    }
    getFileService().registerInitialChecksums(new Map(objects))
  })

  ipcMain.handle('file:update-object-checksum', (_event, runtimeId: string, data: unknown) => {
    if (!isFileServiceInitialized()) {
      return
    }
    getFileService().updateObjectChecksum(runtimeId, data)
  })

  ipcMain.handle('file:remove-object-checksum', (_event, runtimeId: string) => {
    if (!isFileServiceInitialized()) {
      return
    }
    getFileService().removeObjectChecksum(runtimeId)
  })

  ipcMain.handle('file:commit-checksums', () => {
    if (!isFileServiceInitialized()) {
      return
    }
    getFileService().commitChecksums()
  })

  ipcMain.handle('file:get-dirty-state-details', () => {
    if (!isFileServiceInitialized()) {
      return { isDirty: false, changedIds: [], newIds: [], deletedIds: [] }
    }
    return getFileService().getDirtyStateDetails()
  })

  // EventBus IPC handlers
  ipcMain.handle('eventbus:emit', async (_event, eventName: string, payload: unknown) => {
    await eventBusService.emit(eventName, payload)
    return true
  })

  ipcMain.handle('eventbus:emit-sync', (_event, eventName: string, payload: unknown) => {
    eventBusService.emitSync(eventName, payload)
    return true
  })

  // Search Service IPC handlers
  ipcMain.handle('search:register-categories', (_event, categories: Record<string, CategoryMeta>) => {
    searchService.registerCategories(categories)
    return true
  })

  ipcMain.handle('search:index-document', (_event, doc: SearchDocument) => {
    searchService.indexDocument(doc)
    return true
  })

  ipcMain.handle('search:index-documents', (_event, docs: SearchDocument[]) => {
    searchService.indexDocuments(docs)
    return true
  })

  ipcMain.handle('search:remove-document', (_event, id: string) => {
    searchService.removeDocument(id)
    return true
  })

  ipcMain.handle('search:clear-index', () => {
    searchService.clearIndex()
    return true
  })

  ipcMain.handle('search:search', (_event, query: string) => {
    return searchService.search(query)
  })

  ipcMain.handle('search:get-document-count', () => {
    return searchService.getDocumentCount()
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
 * Setup custom protocol to serve static files in production mode
 * This allows absolute paths like /imgs/logo.png to work with file:// URLs
 * @param rendererPath - Path to the renderer directory containing static assets
 */
export function setupAppProtocol(rendererPath: string): void {
  // Register the app:// protocol to serve files from the renderer directory
  protocol.handle('app', (request) => {
    // Convert app://path to file://rendererPath/path
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
 */
export function initializeApp(
  appName: string,
  createWindow: () => void,
  devResourcesPath?: string,
  onActivate?: () => void,
  rendererPath?: string
): void {
  // Configure command line switches first (before app is ready)
  configureCommandLineSwitches()
  
  app.whenReady().then(() => {
    logger.info(`🚀 ${appName} application starting...`)
    logger.info(`Platform: ${process.platform}`)
    logger.info(`Node version: ${process.versions.node}`)
    logger.info(`Electron version: ${process.versions.electron}`)
    
    // Setup app:// protocol for serving static files if rendererPath provided
    if (rendererPath) {
      setupAppProtocol(rendererPath)
    }
    
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
  }).catch((error: unknown) => {
    logger.error('App failed to start:', { error: String(error) })
  })
}
