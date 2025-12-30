import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { initializeApp, logger, initFeatureService, initFileService, getFileService, isFileServiceInitialized, i18nService, initPersistenceService, getPersistenceService, isPersistenceServiceInitialized } from 'electron-core-ui'
import { join, relative, basename } from 'path'
import { promises as fs, existsSync, mkdirSync } from 'fs'
import { EditorWindow } from './windows/EditorWindow'
import { searchIndexService, contextService } from './services'
import { graphQLService } from 'electron-core-ui/main'
import { typeDefs, resolvers, pubsub } from './graphql'
import type { PersistenceFormat } from 'electron-core-ui'
// DocumentEvents are handled by FileService internally for dirty state tracking

// Parse command line arguments for --open / -o
function parseOpenFileArg(): string | undefined {
  const args = process.argv.slice(app.isPackaged ? 1 : 2) // Skip electron executable and script in dev
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg === '-o' || arg === '--open') {
      return args[i + 1]
    }
    if (arg.startsWith('--open=')) {
      return arg.substring('--open='.length)
    }
    if (arg.startsWith('-o=')) {
      return arg.substring('-o='.length)
    }
  }
  return undefined
}

const fileToOpenOnStart = parseOpenFileArg()
if (fileToOpenOnStart) {
  logger.info('📂 File to open on start:', { path: fileToOpenOnStart })
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
      
      // Open file from command line argument if specified
      if (fileToOpenOnStart) {
        // Use dom-ready which fires reliably with app:// protocol
        mainWindow.webContents.on('dom-ready', () => {
          logger.info('📂 DOM ready, will open file from command line:', { path: fileToOpenOnStart })
          // Wait for the renderer React app to be fully initialized and hooks mounted
          // 3 seconds should be enough for React to mount and subscribe to events
          setTimeout(() => {
            if (isFileServiceInitialized()) {
              logger.info('📂 Opening file now...', { path: fileToOpenOnStart })
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
    const appPath = app.getAppPath()
    return join(appPath, '../electron-core-ui/resources')
  }

  // In production, resources are bundled under process.resourcesPath/resources
  return join(process.resourcesPath, 'resources')
}

// Get renderer path for static assets (images, etc.)
function getRendererPath(): string {
  // Only use app:// protocol in packaged production builds
  // In development/test, use loadFile which works without the protocol
  if (!app.isPackaged) {
    return ''
  }
  // In production, renderer files are in the app resources
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
ipcMain.handle('restorm:save-as-folder', async (_event, data: unknown, format: PersistenceFormat) => {
  logger.info('📁 Save as folder requested', { format })
  
  try {
    const window = BrowserWindow.fromWebContents(_event.sender)
    if (!window) {
      return { success: false, error: 'No window found' }
    }

    // Show folder selection dialog
    const result = await dialog.showOpenDialog(window, {
      title: 'Select Folder for Collection',
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || !result.filePaths[0]) {
      return { success: false, error: 'Cancelled' }
    }

    const folderPath = result.filePaths[0]
    
    // Use PersistenceService for folder mode save
    if (!isPersistenceServiceInitialized()) {
      return { success: false, error: 'PersistenceService not initialized' }
    }
    
    // Save the data using folder mode
    // The PersistenceService will use decorators to determine file/folder structure
    const dataObj = data as Record<string, unknown>
    const saveResult = await saveFolderStructure(folderPath, dataObj, format)

    if (saveResult.success) {
      logger.info('✅ Folder saved successfully', { path: saveResult.path })
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
    const content = await loadFolderStructure(folderPath)
    
    if (content) {
      logger.info('✅ Folder loaded successfully', { path: folderPath })
      return { success: true, content, path: folderPath }
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

// ==========================================================================
// Folder Structure Save/Load Helpers
// ==========================================================================

/**
 * Save a collection as folder structure with separate files for each item
 */
async function saveFolderStructure(
  folderPath: string,
  data: Record<string, unknown>,
  format: PersistenceFormat
): Promise<{ success: boolean; path?: string; error?: string }> {
  const ext = format === 'json5' ? 'json5' : format
  
  try {
    // Ensure folder exists
    if (!existsSync(folderPath)) {
      mkdirSync(folderPath, { recursive: true })
    }

    const collections = data['collections'] as unknown[] | undefined
    if (!collections || !Array.isArray(collections)) {
      // No collections, save as single index file
      const persistenceService = getPersistenceService()
      return await persistenceService.saveSingleFile(
        join(folderPath, `index.${ext}`),
        data,
        { format }
      )
    }

    // Save each collection (EnvironmentFolder) as a subfolder
    for (let collIdx = 0; collIdx < collections.length; collIdx++) {
      const collection = collections[collIdx] as Record<string, unknown>
      const collectionName = (collection['name'] as string) || `Collection_${collIdx + 1}`
      const safeName = sanitizeName(collectionName)
      const collectionPath = join(folderPath, `${String(collIdx + 1).padStart(2, '0')} - ${safeName}`)
      
      if (!existsSync(collectionPath)) {
        mkdirSync(collectionPath, { recursive: true })
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
        for (let envIdx = 0; envIdx < environments.length; envIdx++) {
          const env = environments[envIdx] as Record<string, unknown>
          const envName = (env['name'] as string) || `Environment_${envIdx + 1}`
          const safeEnvName = sanitizeName(envName)
          await saveFile(
            join(envsPath, `${String(envIdx + 1).padStart(2, '0')} - ${safeEnvName}.${ext}`),
            env,
            format
          )
        }
      }

      // Save items (folders and requests)
      if (collItems && Array.isArray(collItems)) {
        await saveFolderItems(collectionPath, collItems as Record<string, unknown>[], format, ext)
      }
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
  ext: string
): Promise<void> {
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]
    if (!item) continue
    
    const rawName = item['name']
    const itemName = typeof rawName === 'string' ? rawName : `Item_${idx + 1}`
    const safeName = sanitizeName(itemName)
    const itemType = item['type'] as string | undefined

    if (itemType === 'folder' || item['items'] !== undefined) {
      // It's a folder - create subfolder
      const folderPath = join(parentPath, `${String(idx + 1).padStart(2, '0')} - ${safeName}`)
      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true })
      }

      // Save folder index (without items)
      const { items: subItems, ...folderIndex } = item
      await saveFile(join(folderPath, `index.${ext}`), folderIndex, format)

      // Recursively save sub-items
      if (subItems && Array.isArray(subItems)) {
        await saveFolderItems(folderPath, subItems as Record<string, unknown>[], format, ext)
      }
    } else {
      // It's a request - save as file
      const rawMethod = item['method']
      const method = typeof rawMethod === 'string' ? rawMethod : (itemType?.toUpperCase() ?? 'REQ')
      await saveFile(
        join(parentPath, `${String(idx + 1).padStart(2, '0')} - ${method} - ${safeName}.${ext}`),
        item,
        format
      )
    }
  }
}

/**
 * Save a single file with the given format
 */
async function saveFile(
  filePath: string,
  data: Record<string, unknown>,
  format: PersistenceFormat
): Promise<void> {
  const persistenceService = getPersistenceService()
  await persistenceService.saveSingleFile(filePath, data, { format })
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
 * Load a collection from folder structure
 */
async function loadFolderStructure(
  folderPath: string
): Promise<Record<string, unknown> | null> {
  try {
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

    // If no index file, try to reconstruct from folder structure
    if (!indexPath) {
      return await reconstructFromFolders(folderPath)
    }

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
      return await reconstructFromFolders(folderPath)
    }

    return result.data as Record<string, unknown>
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
  const safePath = join(projectRoot, relPath)

  // Basic safety: ensure resolved path stays under project root
  if (!safePath.startsWith(projectRoot)) {
    logger.warn('Blocked attempt to read file outside project root', { relPath })
    return ''
  }

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
// HTTP Execution IPC handlers
// ========================

import { httpExecutionService, type HTTPExecutionInput } from './services/HTTPExecutionService'

// IPC handler to execute HTTP request
ipcMain.handle('http:execute', async (_event, input: HTTPExecutionInput) => {
  return httpExecutionService.execute(input)
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
  return graphqlExecutionService.execute(input)
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
  return soapExecutionService.execute(input)
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
  return grpcExecutionService.execute(input)
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
  return websocketExecutionService.execute(input)
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
