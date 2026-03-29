import { BrowserWindow, ipcMain, app, screen, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { getThemeService, getStorageService, logger, isFeatureServiceInitialized, getFeatureService, isFileServiceInitialized, getFileService, eventBusService, searchService, i18nService, type SearchDocument, type CategoryMeta } from '../services'
import { validatedHandle } from '../ipc/validate'
import {
  themeLoadArgs, themeSetArgs, themeUpdateWcoArgs,
  i18nSetLanguageArgs,
  loggerLogArgs,
  storageGetArgs, storageSetArgs, storageDeleteArgs,
  featureIsEnabledArgs,
  fileOpenArgs, fileSaveArgs, fileSaveAsArgs,
  fileToggleFavoriteArgs, fileRemoveFromRecentArgs,
  fileChecksumArgs, fileShowUnsavedDialogArgs,
  fileRegisterChecksumsArgs, fileUpdateObjectChecksumArgs, fileRemoveObjectChecksumArgs,
  eventBusEmitArgs,
  searchRegisterCategoriesArgs, searchIndexDocumentArgs, searchIndexDocumentsArgs,
  searchRemoveDocumentArgs, searchQueryArgs,
  tabsCreateAuxWindowArgs, tabsSendToWindowArgs
} from '../ipc/schemas'

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

  // ========================================================================
  // Theme IPC handlers
  // ========================================================================
  ipcMain.handle('theme:list', () => {
    return themeService.listThemes()
  })

  validatedHandle('theme:load', themeLoadArgs, (_event, [themeId]) => {
    return themeService.getThemeWithVariables(themeId)
  })

  ipcMain.handle('theme:get-current', () => {
    const currentTheme = storageService.get('currentTheme') as string | undefined
    return currentTheme ?? 'theme-defaults/dark_plus'
  })

  validatedHandle('theme:set', themeSetArgs, (_event, [themeId]) => {
    const previousTheme = storageService.get('currentTheme') as string | undefined

    if (previousTheme === themeId) {
      logger.info('Theme set called with same theme, skipping broadcast', { themeId })
      return true
    }

    storageService.set('currentTheme', themeId)

    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('theme:changed', themeId)
      }
    }

    logger.info('Theme changed and broadcasted to all windows', { themeId, windowCount: windows.length })
    return true
  })

  validatedHandle('theme:update-wco', themeUpdateWcoArgs, (_event, [colors]) => {
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

  // ========================================================================
  // I18n IPC handlers
  // ========================================================================
  validatedHandle('i18n:set-language', i18nSetLanguageArgs, (_event, [language]) => {
    storageService.set('language', language)
    i18nService.setLanguage(language)
    logger.debug('Language changed via IPC', { language })
    return true
  })

  ipcMain.handle('i18n:get-language', () => {
    const stored = storageService.get('language') as string | undefined
    return stored ?? i18nService.getLanguage()
  })

  // ========================================================================
  // Logger IPC handler
  // ========================================================================
  validatedHandle('logger:log', loggerLogArgs, (_event, [{ level, message, meta }]) => {
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

  // ========================================================================
  // Developer Tools IPC handler
  // ========================================================================
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

  // ========================================================================
  // Window control IPC handlers (no args, use event.sender)
  // ========================================================================
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

  // ========================================================================
  // Tabs: helpers for aux windows and pointer position
  // ========================================================================
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

  ipcMain.handle('tabs:get-current-window-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) {
      return { x: 0, y: 0, width: 0, height: 0, windowId: -1 };
    }
    const bounds = win.getBounds();
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      windowId: win.id
    };
  });

  validatedHandle('tabs:create-aux-window', tabsCreateAuxWindowArgs, (_event, [payload, bounds]) => {
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
    const first = BrowserWindow.getAllWindows()[0];
    const urlToLoad = first?.webContents.getURL();
    if (urlToLoad && urlToLoad.length > 0) {
      win.loadURL(urlToLoad).catch((err: unknown) => { logger.error('Failed to load URL in aux window', { error: String(err) }); });
    }
  });

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

  validatedHandle('tabs:send-workbench-tab-to-window', tabsSendToWindowArgs, (_event, [targetWindowId, tabData]) => {
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

    targetWindow.webContents.send('tabs:workbench-tab-dropped', tabData)
    logger.info('Tab data sent to target window', { targetWindowId, tabId: tabData.tabId, cursorX: tabData.cursorX, cursorY: tabData.cursorY })
    return true
  });

  // ========================================================================
  // Storage API
  // ========================================================================
  validatedHandle('storage:get', storageGetArgs, (_event, [key]) => {
    const storage = getStorageService()
    return storage.get(key)
  })

  validatedHandle('storage:set', storageSetArgs, (_event, [key, value]) => {
    const storage = getStorageService()
    storage.set(key, value)
    return true
  })

  validatedHandle('storage:delete', storageDeleteArgs, (_event, [key]) => {
    const storage = getStorageService()
    storage.delete(key)
    return true
  })

  // ========================================================================
  // Feature Flipping IPC handlers
  // ========================================================================
  validatedHandle('feature:is-enabled', featureIsEnabledArgs, (_event, [featureName]) => {
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

  // ========================================================================
  // File Service IPC handlers
  // ========================================================================
  ipcMain.handle('file:new', async () => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().newFile()
  })

  validatedHandle('file:open', fileOpenArgs, async (_event, [path]) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return { success: false }
    }
    return getFileService().open(path)
  })

  validatedHandle('file:save', fileSaveArgs, async (_event, [content]) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().save(content)
  })

  validatedHandle('file:save-as', fileSaveAsArgs, async (_event, [content, filename, format]) => {
    if (!isFileServiceInitialized()) {
      logger.warn('File service not initialized')
      return false
    }
    return getFileService().saveAs(content, filename, format)
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
    if (!isFileServiceInitialized()) { return null }
    return getFileService().getFileName()
  })

  ipcMain.handle('file:get-path', () => {
    if (!isFileServiceInitialized()) { return null }
    return getFileService().getFilePath()
  })

  ipcMain.handle('file:is-dirty', () => {
    if (!isFileServiceInitialized()) { return false }
    return getFileService().isDirty()
  })

  ipcMain.handle('file:mark-dirty', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().markDirty()
  })

  ipcMain.handle('file:clear-dirty', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().clearDirty()
  })

  ipcMain.handle('file:finish-loading', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().finishLoading()
  })

  validatedHandle('file:check-and-update-dirty', fileChecksumArgs, (_event, [currentChecksum]) => {
    if (!isFileServiceInitialized()) { return }
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

  validatedHandle('file:show-unsaved-dialog', fileShowUnsavedDialogArgs, async (_event, [labels]) => {
    if (!isFileServiceInitialized()) { return 'cancel' as const }
    return getFileService().showUnsavedChangesDialog(
      labels as { title?: string; message?: string; detail?: string; save?: string; dontSave?: string; cancel?: string } | undefined
    )
  })

  ipcMain.handle('file:get-recent', () => {
    if (!isFileServiceInitialized()) { return [] }
    return getFileService().getRecentFiles()
  })

  ipcMain.handle('file:get-favorites', () => {
    if (!isFileServiceInitialized()) { return [] }
    return getFileService().getFavorites()
  })

  validatedHandle('file:toggle-favorite', fileToggleFavoriteArgs, (_event, [path]) => {
    if (!isFileServiceInitialized()) { return false }
    return getFileService().toggleFavorite(path)
  })

  validatedHandle('file:remove-from-recent', fileRemoveFromRecentArgs, (_event, [path]) => {
    if (!isFileServiceInitialized()) { return }
    getFileService().removeFromRecent(path)
  })

  ipcMain.handle('file:get-content-checksum', () => {
    if (!isFileServiceInitialized()) { return null }
    return getFileService().getContentChecksum()
  })

  validatedHandle('file:set-content-checksum', fileChecksumArgs, (_event, [checksum]) => {
    if (!isFileServiceInitialized()) { return }
    getFileService().setContentChecksum(checksum)
  })

  validatedHandle('file:has-content-changed', fileChecksumArgs, (_event, [currentChecksum]) => {
    if (!isFileServiceInitialized()) { return false }
    return getFileService().hasContentChanged(currentChecksum)
  })

  validatedHandle('file:register-initial-checksums', fileRegisterChecksumsArgs, (_event, [objects]) => {
    logger.debug('[IPCManager] file:register-initial-checksums called', { count: objects.length })
    if (!isFileServiceInitialized()) {
      logger.warn('[IPCManager] FileService not initialized')
      return
    }
    getFileService().registerInitialChecksums(new Map(objects))
  })

  validatedHandle('file:update-object-checksum', fileUpdateObjectChecksumArgs, (_event, [runtimeId, data]) => {
    if (!isFileServiceInitialized()) { return }
    getFileService().updateObjectChecksum(runtimeId, data)
  })

  validatedHandle('file:remove-object-checksum', fileRemoveObjectChecksumArgs, (_event, [runtimeId]) => {
    if (!isFileServiceInitialized()) { return }
    getFileService().removeObjectChecksum(runtimeId)
  })

  ipcMain.handle('file:commit-checksums', () => {
    if (!isFileServiceInitialized()) { return }
    getFileService().commitChecksums()
  })

  ipcMain.handle('file:get-dirty-state-details', () => {
    if (!isFileServiceInitialized()) {
      return { isDirty: false, changedIds: [], newIds: [], deletedIds: [] }
    }
    return getFileService().getDirtyStateDetails()
  })

  // ========================================================================
  // EventBus IPC handlers
  // ========================================================================
  validatedHandle('eventbus:emit', eventBusEmitArgs, async (_event, [eventName, payload]) => {
    await eventBusService.emit(eventName, payload)
    return true
  })

  validatedHandle('eventbus:emit-sync', eventBusEmitArgs, (_event, [eventName, payload]) => {
    eventBusService.emitSync(eventName, payload)
    return true
  })

  // ========================================================================
  // Search Service IPC handlers
  // ========================================================================
  validatedHandle('search:register-categories', searchRegisterCategoriesArgs, (_event, [categories]) => {
    searchService.registerCategories(categories as Record<string, CategoryMeta>)
    return true
  })

  validatedHandle('search:index-document', searchIndexDocumentArgs, (_event, [doc]) => {
    searchService.indexDocument(doc as SearchDocument)
    return true
  })

  validatedHandle('search:index-documents', searchIndexDocumentsArgs, (_event, [docs]) => {
    searchService.indexDocuments(docs as SearchDocument[])
    return true
  })

  validatedHandle('search:remove-document', searchRemoveDocumentArgs, (_event, [id]) => {
    searchService.removeDocument(id)
    return true
  })

  ipcMain.handle('search:clear-index', () => {
    searchService.clearIndex()
    return true
  })

  validatedHandle('search:search', searchQueryArgs, (_event, [query]) => {
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
 */
export function initializeApp(
  appName: string,
  createWindow: () => void,
  devResourcesPath?: string,
  onActivate?: () => void,
  rendererPath?: string
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
    setupIPC(devResourcesPath)
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
