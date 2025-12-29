import { app, ipcMain, BrowserWindow } from 'electron'
import { MainWindow } from './windows/MainWindow'
import { initializeApp, logger, initFeatureService, initFileService, getFileService, isFileServiceInitialized, eventBusService, i18nService } from 'electron-core-ui'
import { join, relative } from 'path'
import { promises as fs } from 'fs'
import { EditorWindow } from './windows/EditorWindow'
import { searchIndexService, contextService } from './services'
import { DocumentEvents } from './services/DocumentEvents'

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

// Subscribe to document events to mark file as dirty
const dirtyEvents = [
  DocumentEvents.REQUEST_CREATED,
  DocumentEvents.REQUEST_UPDATED,
  DocumentEvents.REQUEST_DELETED,
  DocumentEvents.FOLDER_CREATED,
  DocumentEvents.FOLDER_UPDATED,
  DocumentEvents.FOLDER_DELETED,
  DocumentEvents.ENVIRONMENT_CREATED,
  DocumentEvents.ENVIRONMENT_UPDATED,
  DocumentEvents.ENVIRONMENT_DELETED
]
for (const event of dirtyEvents) {
  eventBusService.subscribe(event, () => {
    if (isFileServiceInitialized() && getFileService().getFilePath() && !getFileService().isLoading()) {
      logger.debug(`[DirtyState] Document change detected (${event}), marking file as dirty`)
      getFileService().markDirty()
    }
  })
}
logger.info('✅ Dirty state subscriptions registered')

// Initialize Search Index Service (listens to document events from renderer)
searchIndexService.initialize()
logger.info('✅ Search Index Service initialized')

// Initialize Context Service (manages Handlebars context and resolved values)
contextService.initialize()
logger.info('✅ Context Service initialized')

// Initialize Electron application
const resourcesPath = getResourcesPath()
initializeApp('restorm', createWindow, resourcesPath)

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
