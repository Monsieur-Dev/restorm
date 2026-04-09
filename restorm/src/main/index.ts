import { app, BrowserWindow } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { initializeApp, logger, initFeatureService, initFileService, getFileService, isFileServiceInitialized, i18nService, initPersistenceService, isPersistenceServiceInitialized } from 'electron-core-ui'
import { join } from 'path'
import { existsSync, statSync } from 'fs'
import { searchIndexService, contextService, responseHistoryService } from './services'
import { clearUserSettings, parseCliArgs } from './cli/args'
import { setupGraphQL } from './GraphQLSetup'
import { registerRestormIPC } from './IPCHandlers'
import { loadFolderStructure } from './FileOperations'
import { DEFAULT_UI_DELAY_MS } from '../shared/config/constants'
// DocumentEvents are handled by FileService internally for dirty state tracking

// Set the app name for proper taskbar icon on Linux
// Without this, Electron 38+ may use the default "Electron" identity
app.name = 'restorm'

const cliArgs = parseCliArgs()
if (cliArgs.clearSettings) {
  clearUserSettings()
}

const fileToOpenOnStart = cliArgs.open
if (fileToOpenOnStart) {
  logger.info('File to open on start:', { path: fileToOpenOnStart })
}

// Keep track of main window and editor windows
let mainWindow: BrowserWindow | null = null
const editorWindows = new Set<BrowserWindow>()

function createWindow(): void {
  logger.info('Creating main window...')
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
          logger.info('DOM ready, will open from command line:', { path: fileToOpenOnStart })
          // Wait for the renderer React app to be fully initialized and hooks mounted
          setTimeout(() => {
            // Check if it's a file or directory
            const isDirectory = existsSync(fileToOpenOnStart) && statSync(fileToOpenOnStart).isDirectory()

            if (isDirectory) {
              // Open as folder
              logger.info('Opening folder...', { path: fileToOpenOnStart })
              if (!isPersistenceServiceInitialized()) {
                logger.warn('PersistenceService not initialized, cannot load folder')
                return
              }
              void loadFolderStructure(fileToOpenOnStart).then((result) => {
                if (result && mainWindow && isFileServiceInitialized()) {
                  logger.info('Folder loaded, sending to renderer', {
                    collectionsCount: (result.data as { collections?: unknown[] }).collections?.length,
                    format: result.format
                  })
                  // Set the file state in FileService so the UI knows a file is open
                  const fileService = getFileService() as { setOpenedFolder: (path: string, content: unknown, format?: string) => void }
                  fileService.setOpenedFolder(fileToOpenOnStart, result.data, result.format)
                } else {
                  logger.error('Failed to load folder from command line', { result })
                }
              })
            } else if (isFileServiceInitialized()) {
              // Open as file
              logger.info('Opening file...', { path: fileToOpenOnStart })
              void getFileService().open(fileToOpenOnStart).then((result) => {
                if (result.success) {
                  logger.info('File opened successfully from command line')
                } else {
                  logger.error('Failed to open file from command line:', { path: fileToOpenOnStart })
                }
              })
            } else {
              logger.warn('FileService not initialized, cannot open file')
            }
          }, DEFAULT_UI_DELAY_MS)
        })
      }
    }

    logger.info('Main window created successfully')
  } catch (error) {
    logger.error('Failed to create main window:', { error: String(error) })
    throw error
  }
}

// Close all editor windows and then the main window
function closeAllWindows(): void {
  logger.info('Closing all windows...', { editorWindowCount: editorWindows.size })

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
    // __dirname is dist/main in compiled code, go up two levels to project root
    return join(__dirname, '../../resources/features.yaml')
  }
  return join(process.resourcesPath, 'restorm-resources/features.yaml')
}

// Get settings configuration path for restorm
function getSettingsConfigPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    const appPath = app.getAppPath()
    return join(appPath, 'resources/settings.yaml')
  }
  return join(process.resourcesPath, 'restorm-resources/settings.yaml')
}

// Initialize Feature Flipping Service
const featuresConfigPath = getFeaturesConfigPath()
initFeatureService(featuresConfigPath, 'desktop')
logger.info('Feature Flipping Service initialized', { configPath: featuresConfigPath })

// Initialize I18n Service for main process translations
// Default to system locale or 'en', will be synchronized with renderer via IPC
const systemLocale = app.getLocale().split('-')[0] ?? 'en'
const supportedLocales = ['en', 'fr']
const defaultLocale = supportedLocales.includes(systemLocale) ? systemLocale : 'en'
i18nService.initialize('', defaultLocale)
logger.info('I18n Service initialized', { locale: defaultLocale })

// Initialize File Service for .restorm files with YAML serialization
initFileService({
  extension: '.restorm',
  defaultFormat: 'yaml',
  maxRecentFiles: 10,
  storagePrefix: 'restorm_'
})
logger.info('File Service initialized')

// Initialize Persistence Service for folder mode support
initPersistenceService({
  extension: 'restorm',
  format: 'yaml',
  mode: 'single-file',
  indexFileName: 'index'
})
logger.info('Persistence Service initialized')

// Dirty state is now handled by FileService via checksum comparison
// FileService subscribes to DocumentEvents internally and tracks per-object checksums
logger.info('Dirty state managed by FileService checksum system')

// Initialize Search Index Service (listens to document events from renderer)
searchIndexService.initialize()
logger.info('Search Index Service initialized')

// Initialize Context Service (manages Handlebars context and resolved values)
contextService.initialize()
logger.info('Context Service initialized')

// Initialize Response History Service (stores executed responses)
responseHistoryService.initialize()
logger.info('Response History Service initialized')

// Initialize GraphQL Service and register graphql:query IPC handler
setupGraphQL()

// Initialize Electron application
const resourcesPath = getResourcesPath()
const rendererPath = getRendererPath()
const settingsConfigPath = getSettingsConfigPath()
initializeApp('restorm', createWindow, resourcesPath, undefined, rendererPath || undefined, settingsConfigPath)

// Register all restorm-specific IPC handlers
registerRestormIPC({ editorWindows, closeAllWindows })
