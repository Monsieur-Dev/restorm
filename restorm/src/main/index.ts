import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { initializeApp, logger, initFeatureService, initFileService, getFileService, isFileServiceInitialized, i18nService, initPersistenceService, getPersistenceService, isPersistenceServiceInitialized } from 'electron-core-ui'
import { join, relative, basename, dirname } from 'path'
import { promises as fs, existsSync, mkdirSync, statSync, readFileSync, writeFileSync, renameSync, rmSync } from 'fs'
import { EditorWindow } from './windows/EditorWindow'
import { searchIndexService, contextService, responseHistoryService } from './services'
import { clearUserSettings, parseCliArgs } from './cli/args'
import { graphQLService } from 'electron-core-ui/main'
import { typeDefs, resolvers, pubsub } from './graphql'
import type { PersistenceFormat } from 'electron-core-ui'
import { randomUUID } from 'crypto'
import { folderMappingService } from './services/FolderMappingService'
import { saveFolderSecretsEnvFile, applyFolderSecretsEnvFile } from './services/SecretsEnvFileService'
import { normalizeDocumentValuesForPersistence } from '../shared/utils/valuePersistence'
import { assertPathWithinParent } from './utils/pathSecurity'
// DocumentEvents are handled by FileService internally for dirty state tracking

const cliArgs = parseCliArgs()
if (cliArgs.clearSettings) {
  clearUserSettings()
}

const fileToOpenOnStart = cliArgs.open
if (fileToOpenOnStart) {
  logger.info('📂 File to open on start:', { path: fileToOpenOnStart })
}

/**
 * Get mocked folder path for E2E tests, if E2E_MOCK_SAVE_FOLDER env var is set.
 * Returns null if not in E2E mode.
 */
function getE2EMockedFolderPath(): string | null {
  return process.env['E2E_MOCK_SAVE_FOLDER'] ?? null
}

// Keep track of main window and editor windows
let mainWindow: BrowserWindow | null = null
const editorWindows = new Set<BrowserWindow>()

function createWindow(): void {
  logger.info('🪟 Creating main window...')
  try {
    // Create main window (instance is stored in WindowManager singleton)
    const mainWin = new MainWindow()
    mainWindow = mainWin.getWindow()
    
    if (mainWindow) {
      // Handle main window close event - check for unsaved changes
      mainWindow.on('close', (event) => {
        // Check if file is dirty and ask for confirmation
        if (isFileServiceInitialized() && getFileService().isDirty()) {
          event.preventDefault()
          
          // Show confirmation dialog
          void getFileService().showUnsavedChangesDialog().then((result) => {
            if (result === 'cancel') {
              // User cancelled - don't close
              return
            }
            
            if (result === 'save') {
              // User wants to save - send message to renderer to save
              // The renderer will handle saving and then close
              mainWindow?.webContents.send('app:save-and-close')
            } else {
              // User chose to discard - close all windows
              closeAllWindows()
            }
          })
        } else {
          // No unsaved changes - close all windows
          closeAllWindows()
        }
      })
      
      mainWindow.on('closed', () => {
        mainWindow = null
      })
      
      // Open file or folder from command line argument if specified
      if (fileToOpenOnStart) {
        // Use dom-ready which fires reliably with app:// protocol
        mainWindow.webContents.on('dom-ready', () => {
          logger.info('📂 DOM ready, will open from command line:', { path: fileToOpenOnStart })
          // Wait for the renderer React app to be fully initialized and hooks mounted
          setTimeout(() => {
            // Check if it's a file or directory
            const isDirectory = existsSync(fileToOpenOnStart) && statSync(fileToOpenOnStart).isDirectory()
            
            if (isDirectory) {
              // Open as folder
              logger.info('📂 Opening folder...', { path: fileToOpenOnStart })
              if (!isPersistenceServiceInitialized()) {
                logger.warn('⚠️ PersistenceService not initialized, cannot load folder')
                return
              }
              void loadFolderStructure(fileToOpenOnStart).then((result) => {
                if (result && mainWindow && isFileServiceInitialized()) {
                  logger.info('✅ Folder loaded, sending to renderer', { 
                    collectionsCount: (result.data as { collections?: unknown[] }).collections?.length,
                    format: result.format
                  })
                  // Set the file state in FileService so the UI knows a file is open
                  const fileService = getFileService() as { setOpenedFolder: (path: string, content: unknown, format?: string) => void }
                  fileService.setOpenedFolder(fileToOpenOnStart, result.data, result.format)
                } else {
                  logger.error('❌ Failed to load folder from command line', { result })
                }
              })
            } else if (isFileServiceInitialized()) {
              // Open as file
              logger.info('📂 Opening file...', { path: fileToOpenOnStart })
              void getFileService().open(fileToOpenOnStart).then((result) => {
                if (result.success) {
                  logger.info('✅ File opened successfully from command line')
                } else {
                  logger.error('❌ Failed to open file from command line:', { path: fileToOpenOnStart })
                }
              })
            } else {
              logger.warn('⚠️ FileService not initialized, cannot open file')
            }
          }, 3000)
        })
      }
    }
    
    logger.info('✅ Main window created successfully')
  } catch (error) {
    logger.error('❌ Failed to create main window:', { error: String(error) })
    throw error
  }
}

// Close all editor windows and then the main window
function closeAllWindows(): void {
  logger.info('🚪 Closing all windows...', { editorWindowCount: editorWindows.size })
  
  // Close all editor windows first
  for (const editorWin of editorWindows) {
    if (!editorWin.isDestroyed()) {
      editorWin.destroy() // Use destroy() to force close without triggering close event
    }
  }
  editorWindows.clear()
  
  // Then close main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy() // Use destroy() to force close
  }
}

// Get resources path from the core-ui package
function getResourcesPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    // In development, point directly to the monorepo's electron-core-ui resources
    // so that changes to YAML/JSON themes are picked up without reinstalling.
    // __dirname is restorm/dist/main, so we go up 3 levels to reach monorepo root
    return join(__dirname, '../../../electron-core-ui/resources')
  }

  // In production, resources are bundled under process.resourcesPath/resources
  return join(process.resourcesPath, 'resources')
}

// Get renderer path for static assets (images, etc.)
function getRendererPath(): string {
  // __dirname is dist/main in compiled code
  // In both dev and production, renderer is at ../renderer relative to main
  return join(__dirname, '../renderer')
}

// Get features configuration path for restorm
function getFeaturesConfigPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    const appPath = app.getAppPath()
    return join(appPath, 'resources/features.yaml')
  }
  return join(process.resourcesPath, 'restorm-resources/features.yaml')
}

// Initialize Feature Flipping Service
const featuresConfigPath = getFeaturesConfigPath()
initFeatureService(featuresConfigPath, 'desktop')
logger.info('✅ Feature Flipping Service initialized', { configPath: featuresConfigPath })

// Initialize I18n Service for main process translations
// Default to system locale or 'en', will be synchronized with renderer via IPC
const systemLocale = app.getLocale().split('-')[0] ?? 'en'
const supportedLocales = ['en', 'fr']
const defaultLocale = supportedLocales.includes(systemLocale) ? systemLocale : 'en'
i18nService.initialize('', defaultLocale)
logger.info('✅ I18n Service initialized', { locale: defaultLocale })

// Initialize File Service for .restorm files with YAML serialization
initFileService({
  extension: '.restorm',
  defaultFormat: 'yaml',
  maxRecentFiles: 10,
  storagePrefix: 'restorm_'
})
logger.info('✅ File Service initialized')

// Initialize Persistence Service for folder mode support
initPersistenceService({
  extension: 'restorm',
  format: 'yaml',
  mode: 'single-file',
  indexFileName: 'index'
})
logger.info('✅ Persistence Service initialized')

// Dirty state is now handled by FileService via checksum comparison
// FileService subscribes to DocumentEvents internally and tracks per-object checksums
logger.info('✅ Dirty state managed by FileService checksum system')

// Initialize Search Index Service (listens to document events from renderer)
searchIndexService.initialize()
logger.info('✅ Search Index Service initialized')

// Initialize Context Service (manages Handlebars context and resolved values)
contextService.initialize()
logger.info('✅ Context Service initialized')

// Initialize Response History Service (stores executed responses)
responseHistoryService.initialize()
logger.info('✅ Response History Service initialized')

// Initialize GraphQL Service
graphQLService.initialize({
  typeDefs,
  resolvers,
  pubsub,
  port: 4123, // Use non-standard port to avoid conflicts
  context: () => ({
    pubsub
  })
})
void graphQLService.start().then(() => {
  logger.info('✅ GraphQL Service started', { endpoint: graphQLService.getEndpoint() })
}).catch((error: unknown) => {
  logger.error('❌ Failed to start GraphQL Service', { error: String(error) })
})

ipcMain.handle('graphql:query', async (_event, input: { query: string; variables?: Record<string, unknown> }) => {
  const response = await fetch(graphQLService.getEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: input.query,
      variables: input.variables
    })
  })

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`)
  }

  const result: unknown = await response.json()
  return result
})

// Initialize Electron application
const resourcesPath = getResourcesPath()
const rendererPath = getRendererPath()
initializeApp('restorm', createWindow, resourcesPath, undefined, rendererPath || undefined)

// Store file parameters for Editor window (keyed by window ID)
const editorWindowFiles = new Map<number, { title: string; content?: string }>()

// IPC handler to open Editor window
ipcMain.handle('restorm:open-editor', (_event, file?: { title: string; content?: string; x?: number; y?: number }) => {
  logger.info('📝 Opening Restorm editor window...', { file })
  try {
    const editorWindow = new EditorWindow(file)
    // Wait a bit for window to be fully created, then store file parameters
    setTimeout(() => {
      const window = editorWindow.getWindow()
      if (window) {
        // Add to editor windows set
        editorWindows.add(window)
        
        // Remove from set when closed
        window.on('closed', () => {
          editorWindows.delete(window)
        })
        
        if (file) {
          // Store file parameters with window ID as key (without x, y which are used for positioning)
          const { x, y, ...fileParams } = file
          editorWindowFiles.set(window.id, fileParams)
          logger.info('📦 Stored file parameters for window', { windowId: window.id, file: fileParams, x, y })
        }
      } else {
        logger.warn('⚠️ Window not available', { hasFile: !!file })
      }
    }, 100)
    logger.info('✅ Restorm editor window created successfully')
  } catch (error) {
    logger.error('❌ Failed to create Restorm editor window:', { error: String(error) })
    throw error
  }
})

// IPC handler to force close all windows (called after save or discard)
ipcMain.handle('restorm:force-close', () => {
  logger.info('🚪 Force closing all windows...')
  closeAllWindows()
})

// IPC handler to get file parameters for Editor window
ipcMain.handle('restorm:get-editor-file', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) {
    logger.warn('⚠️ Window not found for restorm:get-editor-file')
    return undefined
  }
  const file = editorWindowFiles.get(window.id)
  if (file) {
    logger.info('📤 Returning file parameters for window', { windowId: window.id, file })
    // Clean up after sending
    editorWindowFiles.delete(window.id)
  } else {
    logger.warn('⚠️ No file parameters found for window', { windowId: window.id })
  }
  return file
})

// ==========================================================================
// File Save Mode IPC Handlers
// ==========================================================================

// IPC handler to save as single file with format choice
ipcMain.handle('restorm:save-as-file', async (_event, data: unknown, format: PersistenceFormat) => {
  logger.info('📄 Save as single file requested', { format })
  
  try {
    const window = BrowserWindow.fromWebContents(_event.sender)
    if (!window) {
      return { success: false, error: 'No window found' }
    }

    // Show save dialog
    const result = await dialog.showSaveDialog(window, {
      title: 'Save Collection',
      defaultPath: 'collection.restorm',
      filters: [
        { name: 'Restorm Collection', extensions: ['restorm'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' }
    }

    // Use PersistenceService for single file save
    if (!isPersistenceServiceInitialized()) {
      return { success: false, error: 'PersistenceService not initialized' }
    }

    const persistenceService = getPersistenceService()
    const saveResult = await persistenceService.saveSingleFile(
      result.filePath,
      data as Record<string, unknown>,
      { format }
    )

    if (saveResult.success) {
      logger.info('✅ File saved successfully', { path: saveResult.path })
    }

    return saveResult
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger.error('❌ Failed to save file', { error: errorMsg })
    return { success: false, error: errorMsg }
  }
})

// IPC handler to save as folder structure
ipcMain.handle('restorm:save-as-folder', async (_event, data: unknown, format: PersistenceFormat, targetPath?: string) => {
  logger.info('📁 Save as folder requested', { format, targetPath })
  
  try {
    let folderPath: string
    
    if (targetPath) {
      // Use provided path directly (for Ctrl+S on already opened folder)
      // Path traversal protection: targetPath from renderer must be an absolute real path
      if (isFileServiceInitialized()) {
        const openedFolder = (getFileService() as { getOpenedFolderPath?: () => string | null }).getOpenedFolderPath?.()
        if (openedFolder) {
          try {
            assertPathWithinParent(dirname(openedFolder), targetPath)
          } catch {
            logger.warn('Blocked save-as-folder - path traversal detected', { targetPath })
            return { success: false, error: 'Path traversal detected' }
          }
        }
      }
      folderPath = targetPath
    } else {
      // Check for E2E mock path first
      const mockedPath = getE2EMockedFolderPath()
      if (mockedPath) {
        folderPath = mockedPath
        logger.info('E2E: Using mocked folder path', { path: mockedPath })
      } else {
        // Show folder selection dialog (for Save As)
        const window = BrowserWindow.fromWebContents(_event.sender)
        if (!window) {
          return { success: false, error: 'No window found' }
        }

        const result = await dialog.showOpenDialog(window, {
          title: 'Select Folder for Collection',
          properties: ['openDirectory', 'createDirectory']
        })

        if (result.canceled || !result.filePaths[0]) {
          return { success: false, error: 'Cancelled' }
        }

        folderPath = result.filePaths[0]
      }
    }
    
    // Use PersistenceService for folder mode save
    if (!isPersistenceServiceInitialized()) {
      return { success: false, error: 'PersistenceService not initialized' }
    }
    
    // Save the data using folder mode
    // The PersistenceService will use decorators to determine file/folder structure
    const dataObj = data as Record<string, unknown>
    const saveResult = await saveFolderStructure(folderPath, dataObj, format)

    if (saveResult.success && saveResult.path) {
      logger.info('✅ Folder saved successfully', { path: saveResult.path })
      // Update FileService to track the new folder path - state will be broadcast via file:opened event
    }

    return saveResult
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger.error('❌ Failed to save folder', { error: errorMsg })
    return { success: false, error: errorMsg }
  }
})

// IPC handler to open folder
ipcMain.handle('restorm:open-folder', async (_event) => {
  logger.info('📁 Open folder requested')
  
  try {
    const window = BrowserWindow.fromWebContents(_event.sender)
    if (!window) {
      return { success: false, error: 'No window found' }
    }

    // Show folder selection dialog
    const result = await dialog.showOpenDialog(window, {
      title: 'Open Collection Folder',
      properties: ['openDirectory']
    })

    if (result.canceled || !result.filePaths[0]) {
      return { success: false }
    }

    const folderPath = result.filePaths[0]
    
    // Load the folder structure
    const loadResult = await loadFolderStructure(folderPath)
    
    if (loadResult && isFileServiceInitialized()) {
      logger.info('✅ Folder loaded successfully', { path: folderPath, format: loadResult.format })
      // Update FileService so the UI knows a file is open
      const fileService = getFileService() as { setOpenedFolder: (path: string, content: unknown, format?: string) => void }
      fileService.setOpenedFolder(folderPath, loadResult.data, loadResult.format)
      return { success: true, content: loadResult.data, path: folderPath, format: loadResult.format }
    }

    return { success: false, error: 'Failed to load folder' }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger.error('❌ Failed to open folder', { error: errorMsg })
    return { success: false, error: errorMsg }
  }
})

// IPC handler to show folder selection dialog
ipcMain.handle('restorm:show-folder-dialog', async (_event) => {
  const window = BrowserWindow.fromWebContents(_event.sender)
  if (!window) {
    return { canceled: true }
  }

  const result = await dialog.showOpenDialog(window, {
    title: 'Select Folder',
    properties: ['openDirectory', 'createDirectory']
  })

  return {
    canceled: result.canceled,
    filePath: result.filePaths[0]
  }
})

// IPC handlers for PasswordValue secrets file (dotenv-like)
ipcMain.handle('restorm:secrets:read', async (_event, filePath: string) => {
  try {
    if (!filePath || !existsSync(filePath)) return null

    // Path traversal protection: secrets must be within the opened folder
    if (isFileServiceInitialized()) {
      const openedFolder = (getFileService() as { getOpenedFolderPath?: () => string | null }).getOpenedFolderPath?.()
      if (openedFolder) {
        try {
          assertPathWithinParent(openedFolder, filePath)
        } catch {
          logger.warn('Blocked secrets:read - path traversal detected', { filePath })
          return null
        }
      }
    }

    return await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    logger.warn('Failed to read secrets file', { path: filePath, error: String(error) })
    return null
  }
})

ipcMain.handle('restorm:secrets:write', async (_event, filePath: string, content: string) => {
  try {
    if (!filePath) return { success: false, error: 'Missing path' }

    // Path traversal protection: secrets must be within the opened folder
    if (isFileServiceInitialized()) {
      const openedFolder = (getFileService() as { getOpenedFolderPath?: () => string | null }).getOpenedFolderPath?.()
      if (openedFolder) {
        try {
          assertPathWithinParent(openedFolder, filePath)
        } catch {
          logger.warn('Blocked secrets:write - path traversal detected', { filePath })
          return { success: false, error: 'Path traversal detected' }
        }
      }
    }

    await fs.mkdir(dirname(filePath), { recursive: true })
    if (content.trim() === '') {
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true })
      }
      return { success: true }
    }
    await fs.writeFile(filePath, content, 'utf-8')
    return { success: true }
  } catch (error) {
    logger.warn('Failed to write secrets file', { path: filePath, error: String(error) })
    return { success: false, error: String(error) }
  }
})

// IPC handler to open a file or folder (smart detection)
ipcMain.handle('restorm:open-path', async (_event, path: string) => {
  logger.info('📂 Open path requested', { path })
  
  try {
    const stats = statSync(path)
    
    if (stats.isDirectory()) {
      // It's a directory - load as folder
      if (!isPersistenceServiceInitialized()) {
        return { success: false, error: 'PersistenceService not initialized' }
      }
      
      const loadResult = await loadFolderStructure(path)
      if (loadResult && isFileServiceInitialized()) {
        const fileService = getFileService() as { setOpenedFolder: (path: string, content: unknown, format?: string) => void }
        fileService.setOpenedFolder(path, loadResult.data, loadResult.format)
        return { success: true, isDirectory: true, content: loadResult.data, path, format: loadResult.format }
      }
      return { success: false, error: 'Failed to load folder' }
    } else {
      // It's a file - use normal file open
      if (!isFileServiceInitialized()) {
        return { success: false, error: 'FileService not initialized' }
      }
      return await getFileService().open(path)
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    logger.error('❌ Failed to open path', { path, error: errorMsg })
    return { success: false, error: errorMsg }
  }
})

// ==========================================================================
// Folder Structure Save/Load Helpers
// ==========================================================================

/**
 * Save a collection as folder structure with separate files for each item
 */
/** Configuration file name for folder-mode projects */
const RESTORM_CONF_FILE = 'restorm.conf'

/** Configuration stored in restorm.conf */
interface RestormConfig {
  format: PersistenceFormat
}

/**
 * Read restorm.conf from a folder, returns default config if not found
 * The config file is stored as YAML for readability
 */
function readRestormConfig(folderPath: string): RestormConfig {
  const confPath = join(folderPath, RESTORM_CONF_FILE)
  if (existsSync(confPath)) {
    try {
      const content = readFileSync(confPath, 'utf-8')
      // Simple YAML parsing for format: value
      const match = /^format:\s*(\w+)/m.exec(content)
      if (match?.[1]) {
        const format = match[1] as PersistenceFormat
        if (['json', 'yaml', 'json5'].includes(format)) {
          return { format }
        }
      }
    } catch (error) {
      logger.warn('Failed to read restorm.conf, using defaults', { error: String(error) })
    }
  }
  // Default to yaml
  return { format: 'yaml' }
}

/**
 * Write restorm.conf to a folder
 * The config file is stored as simple YAML for readability
 */
function writeRestormConfig(folderPath: string, config: RestormConfig): void {
  const confPath = join(folderPath, RESTORM_CONF_FILE)
  const content = `format: ${config.format}\n`
  writeFileSync(confPath, content, 'utf-8')
}

/**
 * Handle rename if the path has changed for an item.
 * Returns the actual path to use (new path after rename, or new path for new items).
 */
function handleRenameIfNeeded(id: string | undefined, newPath: string, _isDirectory: boolean, basePath?: string): string {
  if (!id) return newPath

  const oldPath = folderMappingService.getPath(id)

  if (oldPath && oldPath !== newPath && existsSync(oldPath)) {
    // Path traversal protection: ensure both old and new paths stay within the save root
    if (basePath) {
      try {
        assertPathWithinParent(basePath, oldPath)
        assertPathWithinParent(basePath, newPath)
      } catch {
        logger.warn('Blocked rename - path traversal detected', { oldPath, newPath, basePath })
        return newPath
      }
    }

    try {
      // Ensure parent directory exists
      const parentDir = join(newPath, '..')
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true })
      }

      renameSync(oldPath, newPath)
      logger.debug('Renamed item', { from: oldPath, to: newPath })
    } catch (error) {
      logger.warn('Failed to rename, will create new', { oldPath, newPath, error: String(error) })
    }
  }

  return newPath
}

async function saveFolderStructure(
  folderPath: string,
  data: Record<string, unknown>,
  format: PersistenceFormat
): Promise<{ success: boolean; path?: string; error?: string }> {
  const ext = format === 'json5' ? 'json5' : format
  
  try {
    normalizeDocumentValuesForPersistence(data)
    // Start save session to track what's being saved
    folderMappingService.startSaveSession()
    
    // Ensure folder exists
    if (!existsSync(folderPath)) {
      mkdirSync(folderPath, { recursive: true })
    }

    // Write restorm.conf with the format
    writeRestormConfig(folderPath, { format })

    const collections = data['collections'] as unknown[] | undefined
    if (!collections || !Array.isArray(collections)) {
      // No collections, save as single index file
      const persistenceService = getPersistenceService()
      folderMappingService.commitSaveSession()
      return await persistenceService.saveSingleFile(
        join(folderPath, `index.${ext}`),
        data,
        { format }
      )
    }

    // Save each collection (EnvironmentFolder) as a subfolder
    const collectionCount = collections.length
    for (let collIdx = 0; collIdx < collectionCount; collIdx++) {
      const collection = collections[collIdx] as Record<string, unknown>
      const collectionId = collection['id'] as string | undefined
      const collectionName = (collection['name'] as string) || `Collection_${collIdx + 1}`
      const safeName = sanitizeName(collectionName)
      const newCollectionPath = join(folderPath, `${formatIndex(collIdx, collectionCount)} - ${safeName}`)
      
      // Handle rename if path changed
      const collectionPath = handleRenameIfNeeded(collectionId, newCollectionPath, true, folderPath)
      
      if (!existsSync(collectionPath)) {
        mkdirSync(collectionPath, { recursive: true })
      }
      
      // Mark as seen
      if (collectionId) {
        folderMappingService.markAsSeen(collectionId, collectionPath)
      }

      // Save collection index (without items and environments)
      const { items: collItems, environments, ...collectionIndex } = collection
      await saveFile(join(collectionPath, `index.${ext}`), collectionIndex, format)

      // Save environments in environments/ subfolder
      if (environments && Array.isArray(environments)) {
        const envsPath = join(collectionPath, 'environments')
        if (!existsSync(envsPath)) {
          mkdirSync(envsPath, { recursive: true })
        }
        const envCount = environments.length
        for (let envIdx = 0; envIdx < envCount; envIdx++) {
          const env = environments[envIdx] as Record<string, unknown>
          const envId = env['id'] as string | undefined
          const envName = (env['name'] as string) || `Environment_${envIdx + 1}`
          const safeEnvName = sanitizeName(envName)
          const newEnvPath = join(envsPath, `${formatIndex(envIdx, envCount)} - ${safeEnvName}.${ext}`)
          
          // Handle rename if path changed
          const envPath = handleRenameIfNeeded(envId, newEnvPath, false, folderPath)
          
          await saveFile(envPath, env, format)
          
          // Mark as seen
          if (envId) {
            folderMappingService.markAsSeen(envId, envPath)
          }
        }
      }

      // Save items (folders and requests)
      if (collItems && Array.isArray(collItems)) {
        await saveFolderItems(collectionPath, collItems as Record<string, unknown>[], format, ext, folderPath)
      }
    }

    // Delete orphaned files/folders (items that were removed)
    const orphanedPaths = folderMappingService.getOrphanedPaths()
    for (const orphanPath of orphanedPaths) {
      try {
        if (existsSync(orphanPath)) {
          rmSync(orphanPath, { recursive: true, force: true })
          logger.info('Deleted orphaned path', { path: orphanPath })
        }
      } catch (error) {
        logger.warn('Failed to delete orphaned path', { path: orphanPath, error: String(error) })
      }
    }

    // Commit the save session
    folderMappingService.commitSaveSession()

    // Save PasswordValue secrets to restorm.env at the root of the folder
    try {
      await saveFolderSecretsEnvFile(folderPath, data)
    } catch (error) {
      logger.warn('Failed to save restorm.env secrets file', { error: String(error) })
    }

    return { success: true, path: folderPath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * Recursively save folder items
 */
async function saveFolderItems(
  parentPath: string,
  items: Record<string, unknown>[],
  format: PersistenceFormat,
  ext: string,
  basePath?: string
): Promise<void> {
  const itemCount = items.length
  for (let idx = 0; idx < itemCount; idx++) {
    const item = items[idx]
    if (!item) continue

    const itemId = item['id'] as string | undefined
    const rawName = item['name']
    const itemName = typeof rawName === 'string' ? rawName : `Item_${idx + 1}`
    const safeName = sanitizeName(itemName)
    const itemType = item['type'] as string | undefined
    const prefix = formatIndex(idx, itemCount)

    if (itemType === 'folder' || item['items'] !== undefined) {
      // It's a folder - create subfolder
      const newFolderPath = join(parentPath, `${prefix} - ${safeName}`)

      // Handle rename if path changed
      const folderPath = handleRenameIfNeeded(itemId, newFolderPath, true, basePath)

      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true })
      }

      // Mark as seen
      if (itemId) {
        folderMappingService.markAsSeen(itemId, folderPath)
      }

      // Save folder index (without items)
      const { items: subItems, ...folderIndex } = item
      await saveFile(join(folderPath, `index.${ext}`), folderIndex, format)

      // Recursively save sub-items
      if (subItems && Array.isArray(subItems)) {
        await saveFolderItems(folderPath, subItems as Record<string, unknown>[], format, ext, basePath)
      }
    } else {
      // It's a request - save as file
      const newFilePath = join(parentPath, `${prefix} - ${safeName}.${ext}`)

      // Handle rename if path changed
      const filePath = handleRenameIfNeeded(itemId, newFilePath, false, basePath)
      
      await saveFile(filePath, item, format)
      
      // Mark as seen
      if (itemId) {
        folderMappingService.markAsSeen(itemId, filePath)
      }
    }
  }
}

/**
 * Recursively strip 'id' properties from an object for serialization
 */
function stripIds<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => stripIds(item)) as T
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'id') continue // Skip id properties
      result[key] = stripIds(value)
    }
    return result as T
  }
  return obj
}

/**
 * Save a single file with the given format, stripping IDs before serialization
 */
async function saveFile(
  filePath: string,
  data: Record<string, unknown>,
  format: PersistenceFormat
): Promise<void> {
  const persistenceService = getPersistenceService()
  const cleanData = stripIds(data)
  await persistenceService.saveSingleFile(filePath, cleanData, { format })
}

/**
 * Calculate the padding width needed for numbering items
 * @param count Total number of items
 * @returns Number of digits needed (e.g., 9→1, 99→2, 999→3)
 */
function getPaddingWidth(count: number): number {
  if (count <= 0) return 1
  return String(count).length
}

/**
 * Format an index number with dynamic padding based on total count
 * @param index 0-based index
 * @param count Total number of items
 * @returns Formatted string (e.g., "1", "01", "001")
 */
function formatIndex(index: number, count: number): string {
  const width = getPaddingWidth(count)
  return String(index + 1).padStart(width, '0')
}

/**
 * Sanitize a name for use as a file/folder name
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim()
    .slice(0, 100)                 // Limit length
}

/**
 * Generate runtime IDs for all objects in the data structure.
 * Called after loading to assign IDs that will be used for tracking.
 * 
 * @param data - The loaded data structure
 * @param idProperty - Property name to use for IDs (default: 'id')
 */
function generateRuntimeIds(data: unknown, idProperty = 'id'): void {
  if (!data || typeof data !== 'object') return
  
  const obj = data as Record<string, unknown>
  
  // Assign ID if not already present
  obj[idProperty] ??= randomUUID()
  
  // Recurse into collections
  if (obj['collections'] && Array.isArray(obj['collections'])) {
    for (const collection of obj['collections']) {
      generateRuntimeIds(collection, idProperty)
    }
  }
  
  // Recurse into items (folders and requests)
  if (obj['items'] && Array.isArray(obj['items'])) {
    for (const item of obj['items']) {
      generateRuntimeIds(item, idProperty)
    }
  }
  
  // Recurse into environments
  if (obj['environments'] && Array.isArray(obj['environments'])) {
    for (const env of obj['environments']) {
      generateRuntimeIds(env, idProperty)
    }
  }
  
  // Recurse into sub-environments
  if (obj['subEnvironments'] && Array.isArray(obj['subEnvironments'])) {
    for (const subEnv of obj['subEnvironments']) {
      generateRuntimeIds(subEnv, idProperty)
    }
  }
}

/**
 * Build mapping from loaded data structure with actual file paths.
 * Called during folder loading to associate IDs with their paths.
 */
function buildMappingFromStructure(
  basePath: string,
  data: unknown,
  currentPath: string,
  idProperty = 'id'
): void {
  if (!data || typeof data !== 'object') return
  
  const obj = data as Record<string, unknown>
  const id = obj[idProperty]
  
  // Register this object's path
  if (typeof id === 'string' && id) {
    folderMappingService.registerPath(id, currentPath)
  }
  
  // Recurse into collections (they are subfolders)
  if (obj['collections'] && Array.isArray(obj['collections'])) {
    const collections = obj['collections'] as Record<string, unknown>[]
    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i]
      if (!collection) continue
      const collName = (collection['name'] as string) || `Collection_${i + 1}`
      const collPath = join(currentPath, `${formatIndex(i, collections.length)} - ${sanitizeName(collName)}`)
      buildMappingFromStructure(basePath, collection, collPath, idProperty)
    }
  }
  
  // Recurse into items
  if (obj['items'] && Array.isArray(obj['items'])) {
    const items = obj['items'] as Record<string, unknown>[]
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item) continue
      const itemName = (item['name'] as string) || `Item_${i + 1}`
      const isFolder = item['items'] !== undefined
      
      if (isFolder) {
        const folderPath = join(currentPath, `${formatIndex(i, items.length)} - ${sanitizeName(itemName)}`)
        buildMappingFromStructure(basePath, item, folderPath, idProperty)
      } else {
        // It's a request - file path includes method/type
        const methodVal = item['method']
        const typeVal = item['type']
        const method = (typeof methodVal === 'string' ? methodVal : null) 
          ?? (typeof typeVal === 'string' ? typeVal : null) 
          ?? 'REQ'
        const ext = 'yaml' // Default, actual ext determined by format
        const filePath = join(currentPath, `${formatIndex(i, items.length)} - ${method} - ${sanitizeName(itemName)}.${ext}`)
        const itemIdVal = item[idProperty]
        if (typeof itemIdVal === 'string') {
          folderMappingService.registerPath(itemIdVal, filePath)
        }
      }
    }
  }
  
  // Recurse into environments
  if (obj['environments'] && Array.isArray(obj['environments'])) {
    const envs = obj['environments'] as Record<string, unknown>[]
    const envsPath = join(currentPath, 'environments')
    for (let i = 0; i < envs.length; i++) {
      const env = envs[i]
      if (!env) continue
      const envName = (env['name'] as string) || `Environment_${i + 1}`
      const envPath = join(envsPath, `${formatIndex(i, envs.length)} - ${sanitizeName(envName)}.yaml`)
      const envIdVal = env[idProperty]
      if (typeof envIdVal === 'string') {
        folderMappingService.registerPath(envIdVal, envPath)
      }
      // Recurse for sub-environments
      buildMappingFromStructure(basePath, env, envPath, idProperty)
    }
  }
}

/**
 * Load a collection from folder structure
 */
async function loadFolderStructure(
  folderPath: string
): Promise<{ data: Record<string, unknown>; format: PersistenceFormat } | null> {
  try {
    // Read configuration to get format
    const config = readRestormConfig(folderPath)
    const format = config.format
    
    // Look for index file
    const indexFiles = ['index.yaml', 'index.yml', 'index.json', 'index.json5']
    let indexPath: string | null = null
    
    for (const indexFile of indexFiles) {
      const testPath = join(folderPath, indexFile)
      if (existsSync(testPath)) {
        indexPath = testPath
        break
      }
    }

    let data: Record<string, unknown>

    // If no index file, try to reconstruct from folder structure
    if (!indexPath) {
      data = await reconstructFromFolders(folderPath)
    } else {
      // Load the index file
      const persistenceService = getPersistenceService()
      const result = await persistenceService.loadSingleFile(indexPath)
      
      if (!result.success || !result.data) {
        return null
      }

      // If it's a collection folder (has subfolders), reconstruct the full structure
      const entries = await fs.readdir(folderPath, { withFileTypes: true })
      const hasSubfolders = entries.some(e => e.isDirectory())
      
      if (hasSubfolders) {
        data = await reconstructFromFolders(folderPath)
      } else {
        data = result.data as Record<string, unknown>
      }
    }

    // Apply PasswordValue secrets from restorm.env (if present)
    await applyFolderSecretsEnvFile(folderPath, data)

    // Generate runtime IDs for all objects
    generateRuntimeIds(data, 'id')
    
    // Build the mapping from IDs to file paths for tracking
    folderMappingService.clear()
    buildMappingFromStructure(folderPath, data, folderPath, 'id')
    
    logger.info('Folder loaded with ID mapping', { 
      path: folderPath,
      mappingSize: folderMappingService.getBasePath() ? 'active' : 'inactive'
    })

    return { data, format }
  } catch (error) {
    logger.error('Failed to load folder structure', { error: String(error) })
    return null
  }
}

/**
 * Reconstruct collection data from folder structure
 */
async function reconstructFromFolders(
  folderPath: string
): Promise<Record<string, unknown>> {
  const collections: Record<string, unknown>[] = []
  const persistenceService = getPersistenceService()

  const entries = await fs.readdir(folderPath, { withFileTypes: true })
  
  // Sort entries by name (to maintain order from numbered prefixes)
  const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of sortedEntries) {
    if (entry.isDirectory()) {
      const collectionPath = join(folderPath, entry.name)
      const collection = await loadCollectionFolder(collectionPath, persistenceService)
      if (collection) {
        collections.push(collection)
      }
    }
  }

  // If no subfolders found, this might be a single collection root
  if (collections.length === 0) {
    const singleCollection = await loadCollectionFolder(folderPath, persistenceService)
    if (singleCollection) {
      collections.push(singleCollection)
    }
  }

  return { collections }
}

/**
 * Load a single collection folder
 */
async function loadCollectionFolder(
  collectionPath: string,
  persistenceService: ReturnType<typeof getPersistenceService>
): Promise<Record<string, unknown> | null> {
  try {
    // Try to load index file
    let collection: Record<string, unknown> = {}
    const indexFiles = ['index.yaml', 'index.yml', 'index.json', 'index.json5']
    
    for (const indexFile of indexFiles) {
      const indexPath = join(collectionPath, indexFile)
      if (existsSync(indexPath)) {
        const result = await persistenceService.loadSingleFile(indexPath)
        if (result.success && result.data) {
          collection = result.data as Record<string, unknown>
          break
        }
      }
    }

    // If no index found, create basic collection from folder name
    if (Object.keys(collection).length === 0) {
      const folderName = basename(collectionPath)
      const cleanName = folderName.replace(/^\d+\s*-\s*/, '') // Remove numbering prefix
      collection = { name: cleanName }
    }

    // Load environments from environments/ subfolder
    const envsPath = join(collectionPath, 'environments')
    if (existsSync(envsPath)) {
      const environments: Record<string, unknown>[] = []
      const envEntries = await fs.readdir(envsPath, { withFileTypes: true })
      const sortedEnvEntries = envEntries.sort((a, b) => a.name.localeCompare(b.name))
      
      for (const envEntry of sortedEnvEntries) {
        if (envEntry.isFile() && /\.(yaml|yml|json|json5)$/.test(envEntry.name)) {
          const envPath = join(envsPath, envEntry.name)
          const result = await persistenceService.loadSingleFile(envPath)
          if (result.success && result.data) {
            environments.push(result.data as Record<string, unknown>)
          }
        }
      }
      
      if (environments.length > 0) {
        collection['environments'] = environments
      }
    }

    // Load items from other subfolders and files
    const items = await loadFolderItemsRecursive(collectionPath, persistenceService)
    if (items.length > 0) {
      collection['items'] = items
    }

    return collection
  } catch (error) {
    logger.error('Failed to load collection folder', { path: collectionPath, error: String(error) })
    return null
  }
}

/**
 * Recursively load folder items (folders and requests)
 */
async function loadFolderItemsRecursive(
  parentPath: string,
  persistenceService: ReturnType<typeof getPersistenceService>
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []

  const entries = await fs.readdir(parentPath, { withFileTypes: true })
  const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of sortedEntries) {
    // Skip index files and environments folder
    if (entry.name.startsWith('index.') || entry.name === 'environments') {
      continue
    }

    if (entry.isDirectory()) {
      // It's a folder
      const folderPath = join(parentPath, entry.name)
      const folder = await loadSubFolder(folderPath, persistenceService)
      if (folder) {
        items.push(folder)
      }
    } else if (/\.(yaml|yml|json|json5)$/.test(entry.name)) {
      // It's a request file
      const filePath = join(parentPath, entry.name)
      const result = await persistenceService.loadSingleFile(filePath)
      if (result.success && result.data) {
        items.push(result.data as Record<string, unknown>)
      }
    }
  }

  return items
}

/**
 * Load a subfolder (which is a Folder item)
 */
async function loadSubFolder(
  folderPath: string,
  persistenceService: ReturnType<typeof getPersistenceService>
): Promise<Record<string, unknown> | null> {
  try {
    let folder: Record<string, unknown> = {}
    
    // Try to load index file
    const indexFiles = ['index.yaml', 'index.yml', 'index.json', 'index.json5']
    for (const indexFile of indexFiles) {
      const indexPath = join(folderPath, indexFile)
      if (existsSync(indexPath)) {
        const result = await persistenceService.loadSingleFile(indexPath)
        if (result.success && result.data) {
          folder = result.data as Record<string, unknown>
          break
        }
      }
    }

    // If no index found, create basic folder from name
    if (Object.keys(folder).length === 0) {
      const folderName = basename(folderPath)
      const cleanName = folderName.replace(/^\d+\s*-\s*/, '') // Remove numbering prefix
      folder = { name: cleanName, type: 'folder' }
    }

    // Recursively load sub-items
    const subItems = await loadFolderItemsRecursive(folderPath, persistenceService)
    if (subItems.length > 0) {
      folder['items'] = subItems
    }

    return folder
  } catch (error) {
    logger.error('Failed to load subfolder', { path: folderPath, error: String(error) })
    return null
  }
}

// IPC handler to list project files from the Restorm workspace root
ipcMain.handle('project:list-files', async () => {
  const projectRoot = join(__dirname, '../..')

  const results: { path: string; isDirectory: boolean }[] = []

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue
      }
      const fullPath = join(dir, entry.name)
      const relPath = relative(projectRoot, fullPath)
      const isDirectory = entry.isDirectory()
      results.push({ path: relPath, isDirectory })
      if (isDirectory) {
        await walk(fullPath)
      }
    }
  }

  try {
    await walk(projectRoot)
    return results
  } catch (error) {
    logger.error('Failed to list project files', { error: String(error) })
    return []
  }
})

// IPC handler to read a project file (relative to the Restorm workspace root)
ipcMain.handle('project:read-file', async (_event, relPath: string) => {
  const projectRoot = join(__dirname, '../..')

  // Path traversal protection: ensure resolved path stays under project root
  try {
    assertPathWithinParent(projectRoot, relPath)
  } catch {
    logger.warn('Blocked attempt to read file outside project root', { relPath })
    return ''
  }

  const safePath = join(projectRoot, relPath)

  try {
    const content = await fs.readFile(safePath, 'utf8')
    return content
  } catch (error) {
    logger.error('Failed to read project file', { relPath, error: String(error) })
    return ''
  }
})

// IPC handler to get all variable transform results from ContextService
ipcMain.handle('context:get-all-transform-results', () => {
  return contextService.getAllVariableTransformResults()
})

// IPC handler to register a request for context tracking
ipcMain.handle('context:register-request', (_event, requestId: string, environmentId: string | null, requestData: { headers?: { id?: string; key: string; value: string }[]; params?: { id?: string; key: string; value: string }[]; pathParams?: { id?: string; key: string; value: string }[] }) => {
  contextService.registerRequest(requestId, environmentId, {
    id: requestId,
    headers: requestData.headers,
    params: requestData.params,
    pathParams: requestData.pathParams
  })
})

// IPC handler to unregister a request from context tracking
ipcMain.handle('context:unregister-request', (_event, requestId: string) => {
  contextService.unregisterRequest(requestId)
})

// IPC handler to set the environment for a request
ipcMain.handle('context:set-request-environment', (_event, requestId: string, environmentId: string | null) => {
  contextService.setRequestEnvironment(requestId, environmentId)
})

// IPC handler to update KeyValues for a request
ipcMain.handle('context:update-request-keyvalues', (_event, requestId: string, groupName: string, keyValues: { id?: string; key: string; value: string }[]) => {
  contextService.updateRequestKeyValues(requestId, groupName, keyValues)
})

// IPC handler to update full request data for URL resolution and code snippets
ipcMain.handle('context:update-full-request-data', (_event, requestId: string, data: unknown) => {
  contextService.updateFullRequestData(requestId, data as Parameters<typeof contextService.updateFullRequestData>[1])
})

// IPC handler to get resolved URL for a request
ipcMain.handle('context:get-resolved-url', (_event, requestId: string) => {
  return contextService.getResolvedUrl(requestId)
})

// IPC handler to get code snippets for a request
ipcMain.handle('context:get-code-snippets', (_event, requestId: string) => {
  return contextService.getCodeSnippets(requestId)
})

// IPC handler to clear all context data
ipcMain.handle('context:clear-all', () => {
  contextService.clearAll()
})

// ========================
// Request Service IPC handlers
// ========================

import { resolveRequestURL, type URLResolutionInput } from './services/request/HTTPRequestService'

// IPC handler to resolve HTTP request URL
ipcMain.handle('request:resolve-url', (_event, input: URLResolutionInput) => {
  return resolveRequestURL(input)
})

// ========================
// HTTP Execution IPC handlers
// ========================

import { httpExecutionService, type HTTPExecutionInput } from './services/HTTPExecutionService'

// IPC handler to execute HTTP request
ipcMain.handle('http:execute', async (_event, input: HTTPExecutionInput) => {
  const result = await httpExecutionService.execute(input)
  setImmediate(() => {
    const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
      ? (input as { requestPath?: unknown }).requestPath
      : undefined
    void responseHistoryService.storeExecutionResult(input.requestId, 'http', result, requestPath)
  })
  return result
})

// IPC handler to cancel HTTP request
ipcMain.handle('http:cancel', (_event, requestId: string) => {
  return httpExecutionService.cancel(requestId)
})

// IPC handler to check if request is active
ipcMain.handle('http:is-active', (_event, requestId: string) => {
  return httpExecutionService.isActive(requestId)
})

// ========================
// GraphQL Execution IPC handlers
// ========================

import { graphqlExecutionService, type GraphQLExecutionInput } from './services/GraphQLExecutionService'

// IPC handler to execute GraphQL request
ipcMain.handle('graphql:execute', async (_event, input: GraphQLExecutionInput) => {
  const result = await graphqlExecutionService.execute(input)
  setImmediate(() => {
    const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
      ? (input as { requestPath?: unknown }).requestPath
      : undefined
    void responseHistoryService.storeExecutionResult(input.requestId, 'graphql', result, requestPath)
  })
  return result
})

// IPC handler to cancel GraphQL request
ipcMain.handle('graphql:cancel', (_event, requestId: string) => {
  return graphqlExecutionService.cancel(requestId)
})

// IPC handler to check if request is active
ipcMain.handle('graphql:is-active', (_event, requestId: string) => {
  return graphqlExecutionService.isActive(requestId)
})

// ========================
// SOAP Execution IPC handlers
// ========================

import { soapExecutionService, type SOAPExecutionInput } from './services/SOAPExecutionService'

// IPC handler to execute SOAP request
ipcMain.handle('soap:execute', async (_event, input: SOAPExecutionInput) => {
  const result = await soapExecutionService.execute(input)
  setImmediate(() => {
    const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
      ? (input as { requestPath?: unknown }).requestPath
      : undefined
    void responseHistoryService.storeExecutionResult(input.requestId, 'soap', result, requestPath)
  })
  return result
})

// IPC handler to cancel SOAP request
ipcMain.handle('soap:cancel', (_event, requestId: string) => {
  return soapExecutionService.cancel(requestId)
})

// IPC handler to check if request is active
ipcMain.handle('soap:is-active', (_event, requestId: string) => {
  return soapExecutionService.isActive(requestId)
})

// ========================
// gRPC Execution IPC handlers
// ========================

import { grpcExecutionService, type GRPCExecutionInput } from './services/GRPCExecutionService'

// IPC handler to execute gRPC request
ipcMain.handle('grpc:execute', (_event, input: GRPCExecutionInput) => {
  const result = grpcExecutionService.execute(input)
  setImmediate(() => {
    const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
      ? (input as { requestPath?: unknown }).requestPath
      : undefined
    void responseHistoryService.storeExecutionResult(input.requestId, 'grpc', result, requestPath)
  })
  return result
})

// IPC handler to cancel gRPC request
ipcMain.handle('grpc:cancel', (_event, requestId: string) => {
  return grpcExecutionService.cancel(requestId)
})

// IPC handler to check if request is active
ipcMain.handle('grpc:is-active', (_event, requestId: string) => {
  return grpcExecutionService.isActive(requestId)
})

// ========================
// WebSocket Execution IPC handlers
// ========================

import { websocketExecutionService, type WebSocketExecutionInput } from './services/WebSocketExecutionService'

// IPC handler to connect WebSocket
ipcMain.handle('websocket:connect', async (_event, input: WebSocketExecutionInput) => {
  const result = await websocketExecutionService.execute(input)
  setImmediate(() => {
    const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
      ? (input as { requestPath?: unknown }).requestPath
      : undefined
    void responseHistoryService.storeExecutionResult(input.requestId, 'websocket', result, requestPath)
  })
  return result
})

// IPC handler to disconnect WebSocket
ipcMain.handle('websocket:disconnect', (_event, requestId: string) => {
  return websocketExecutionService.disconnect(requestId)
})

// IPC handler to send WebSocket message
ipcMain.handle('websocket:send', (_event, requestId: string, message: string, event?: string) => {
  return websocketExecutionService.send(requestId, message, event)
})

// IPC handler to check if connection is active
ipcMain.handle('websocket:is-active', (_event, requestId: string) => {
  return websocketExecutionService.isActive(requestId)
})

// ========================
// Responses History IPC handlers
// ========================

ipcMain.handle('responses:history:list', async (_event, requestId: string) => {
  return responseHistoryService.list(requestId)
})

ipcMain.handle('responses:history:get', async (_event, guid: string) => {
  return responseHistoryService.getDetail(guid)
})

ipcMain.handle('responses:history:toggle-pin', async (_event, guid: string, pinned: boolean) => {
  return responseHistoryService.togglePin(guid, pinned)
})

ipcMain.handle('responses:history:update-path', async (_event, requestId: string, requestPath: string) => {
  return responseHistoryService.updateRequestPath(requestId, requestPath)
})

// ============================================================================
// Import IPC Handlers
// ============================================================================

import { importFrom } from './services/import/ImportManager'

// IPC handler to preview import (dry-run)
ipcMain.handle('import:preview', async (_event, input: string) => {
  logger.info('[IPC] Import preview requested:', { input })
  try {
    const result = await importFrom(input, { dryRun: true })
    logger.info('[IPC] Import preview result:', { success: result.success, itemsCount: result.items.length })
    return result
  } catch (error) {
    logger.error('[IPC] Import preview error:', error)
    return {
      success: false,
      items: [],
      source: input,
      error: error instanceof Error ? error.message : String(error)
    }
  }
})

// IPC handler to actually import
ipcMain.handle('import:import', async (_event, input: string) => {
  logger.info('[IPC] Import requested:', { input })
  try {
    const result = await importFrom(input, { dryRun: false })
    logger.info('[IPC] Import result:', { success: result.success, itemsCount: result.items.length })
    return result
  } catch (error) {
    logger.error('[IPC] Import error:', error)
    return {
      success: false,
      items: [],
      source: input,
      error: error instanceof Error ? error.message : String(error)
    }
  }
})
