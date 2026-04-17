import { ipcMain, BrowserWindow, dialog } from 'electron'
import { logger, getFileService, isFileServiceInitialized, isPersistenceServiceInitialized, getPersistenceService, validatedHandle } from 'electron-core-ui'
import { join, relative, dirname } from 'path'
import { promises as fs, existsSync, statSync, rmSync } from 'fs'
import { EditorWindow } from './windows/EditorWindow'
import { contextService, responseHistoryService } from './services'
import { assertPathWithinParent } from './utils/pathSecurity'
import { saveFolderStructure, loadFolderStructure } from './FileOperations'
import { resolveRequestURL, type URLResolutionInput } from './services/request/HTTPRequestService'
import { httpExecutionService, type HTTPExecutionInput } from './services/HTTPExecutionService'
import { graphqlExecutionService, type GraphQLExecutionInput } from './services/GraphQLExecutionService'
import { soapExecutionService, type SOAPExecutionInput } from './services/SOAPExecutionService'
import { grpcExecutionService, type GRPCExecutionInput } from './services/GRPCExecutionService'
import { websocketExecutionService, type WebSocketExecutionInput } from './services/WebSocketExecutionService'
import { importFrom } from './services/import/ImportManager'
import {
  openEditorArgs,
  saveAsFileArgs, saveAsFolderArgs,
  secretsReadArgs, secretsWriteArgs,
  openPathArgs,
  projectReadFileArgs,
  contextRegisterRequestArgs, contextUnregisterRequestArgs,
  contextSetRequestEnvironmentArgs, contextUpdateRequestKeyValuesArgs,
  contextUpdateFullRequestDataArgs, contextGetResolvedUrlArgs,
  contextGetCodeSnippetsArgs,
  requestResolveUrlArgs,
  httpExecuteArgs, httpCancelArgs, httpIsActiveArgs,
  graphqlExecuteArgs, graphqlCancelArgs, graphqlIsActiveArgs,
  soapExecuteArgs, soapCancelArgs, soapIsActiveArgs,
  grpcExecuteArgs, grpcCancelArgs, grpcIsActiveArgs,
  websocketConnectArgs, websocketDisconnectArgs, websocketSendArgs, websocketIsActiveArgs,
  responsesHistoryListArgs, responsesHistoryGetArgs,
  responsesHistoryTogglePinArgs, responsesHistoryUpdatePathArgs,
  importPreviewArgs, importImportArgs,
  docsCompileRouteArgs, docsCompileRootArgs
} from './ipc/schemas'
import {
  compileDocumentationForRoute,
  compileRootMarkdown,
  type RouteLike
} from './services/DocumentationCompiler'
import type { ApiDocumentation } from '../shared/types/apiDocumentation'

/**
 * Get mocked folder path for E2E tests, if E2E_MOCK_SAVE_FOLDER env var is set.
 * Returns null if not in E2E mode.
 */
function getE2EMockedFolderPath(): string | null {
  return process.env['E2E_MOCK_SAVE_FOLDER'] ?? null
}

/**
 * Register all restorm-specific IPC handlers.
 *
 * @param deps.editorWindows - Set of open editor windows (mutated by handlers)
 * @param deps.closeAllWindows - Function to close all windows
 */
export function registerRestormIPC(deps: {
  editorWindows: Set<BrowserWindow>
  closeAllWindows: () => void
}): void {
  const { editorWindows, closeAllWindows } = deps

  // Store file parameters for Editor window (keyed by window ID)
  const editorWindowFiles = new Map<number, { title: string; content?: string }>()

  // ==========================================================================
  // Editor Window IPC Handlers
  // ==========================================================================

  // IPC handler to open Editor window
  validatedHandle('restorm:open-editor', openEditorArgs, (_event, [file]) => {
    logger.info('Opening Restorm editor window...', { file })
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
            logger.info('Stored file parameters for window', { windowId: window.id, file: fileParams, x, y })
          }
        } else {
          logger.warn('Window not available', { hasFile: !!file })
        }
      }, 100)
      logger.info('Restorm editor window created successfully')
    } catch (error) {
      logger.error('Failed to create Restorm editor window:', { error: String(error) })
      throw error
    }
  })

  // IPC handler to force close all windows (called after save or discard)
  ipcMain.handle('restorm:force-close', () => {
    logger.info('Force closing all windows...')
    closeAllWindows()
  })

  // IPC handler to get file parameters for Editor window
  ipcMain.handle('restorm:get-editor-file', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) {
      logger.warn('Window not found for restorm:get-editor-file')
      return undefined
    }
    const file = editorWindowFiles.get(window.id)
    if (file) {
      logger.info('Returning file parameters for window', { windowId: window.id, file })
      // Clean up after sending
      editorWindowFiles.delete(window.id)
    } else {
      logger.warn('No file parameters found for window', { windowId: window.id })
    }
    return file
  })

  // ==========================================================================
  // File Save Mode IPC Handlers
  // ==========================================================================

  // IPC handler to save as single file with format choice
  validatedHandle('restorm:save-as-file', saveAsFileArgs, async (_event, [data, format]) => {
    logger.info('Save as single file requested', { format })

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
        logger.info('File saved successfully', { path: saveResult.path })
      }

      return saveResult
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to save file', { error: errorMsg })
      return { success: false, error: errorMsg }
    }
  })

  // IPC handler to save as folder structure
  validatedHandle('restorm:save-as-folder', saveAsFolderArgs, async (_event, [data, format, targetPath]) => {
    logger.info('Save as folder requested', { format, targetPath })

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
        logger.info('Folder saved successfully', { path: saveResult.path })
        // Update FileService to track the new folder path - state will be broadcast via file:opened event
      }

      return saveResult
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to save folder', { error: errorMsg })
      return { success: false, error: errorMsg }
    }
  })

  // IPC handler to open folder
  ipcMain.handle('restorm:open-folder', async (_event) => {
    logger.info('Open folder requested')

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
        logger.info('Folder loaded successfully', { path: folderPath, format: loadResult.format })
        // Update FileService so the UI knows a file is open
        const fileService = getFileService() as { setOpenedFolder: (path: string, content: unknown, format?: string) => void }
        fileService.setOpenedFolder(folderPath, loadResult.data, loadResult.format)
        return { success: true, content: loadResult.data, path: folderPath, format: loadResult.format }
      }

      return { success: false, error: 'Failed to load folder' }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to open folder', { error: errorMsg })
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
  // Secrets IPC Handlers
  // ==========================================================================

  validatedHandle('restorm:secrets:read', secretsReadArgs, async (_event, [filePath]) => {
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

  validatedHandle('restorm:secrets:write', secretsWriteArgs, async (_event, [filePath, content]) => {
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

  // ==========================================================================
  // Open Path IPC Handler
  // ==========================================================================

  validatedHandle('restorm:open-path', openPathArgs, async (_event, [path]) => {
    logger.info('Open path requested', { path })

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
      logger.error('Failed to open path', { path, error: errorMsg })
      return { success: false, error: errorMsg }
    }
  })

  // ==========================================================================
  // Project Files IPC Handlers
  // ==========================================================================

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

  validatedHandle('project:read-file', projectReadFileArgs, async (_event, [relPath]) => {
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

  // ==========================================================================
  // Context Service IPC Handlers
  // ==========================================================================

  ipcMain.handle('context:get-all-transform-results', () => {
    return contextService.getAllVariableTransformResults()
  })

  ipcMain.handle('context:get-environment-context', (_event, environmentId: string) => {
    return contextService.getContext(environmentId) ?? {}
  })

  validatedHandle('context:register-request', contextRegisterRequestArgs, (_event, [requestId, environmentId, requestData]) => {
    contextService.registerRequest(requestId, environmentId, {
      id: requestId,
      headers: requestData.headers,
      params: requestData.params,
      pathParams: requestData.pathParams
    })
  })

  validatedHandle('context:unregister-request', contextUnregisterRequestArgs, (_event, [requestId]) => {
    contextService.unregisterRequest(requestId)
  })

  validatedHandle('context:set-request-environment', contextSetRequestEnvironmentArgs, (_event, [requestId, environmentId]) => {
    contextService.setRequestEnvironment(requestId, environmentId)
  })

  validatedHandle('context:update-request-keyvalues', contextUpdateRequestKeyValuesArgs, (_event, [requestId, groupName, keyValues, sourceId]) => {
    contextService.updateRequestKeyValues(requestId, groupName, keyValues, sourceId)
  })

  validatedHandle('context:update-full-request-data', contextUpdateFullRequestDataArgs, (_event, [requestId, data, sourceId]) => {
    contextService.updateFullRequestData(requestId, data as Parameters<typeof contextService.updateFullRequestData>[1], sourceId)
  })

  validatedHandle('context:get-resolved-url', contextGetResolvedUrlArgs, (_event, [requestId]) => {
    return contextService.getResolvedUrl(requestId)
  })

  validatedHandle('context:get-code-snippets', contextGetCodeSnippetsArgs, (_event, [requestId]) => {
    return contextService.getCodeSnippets(requestId)
  })

  ipcMain.handle('context:clear-all', () => {
    contextService.clearAll()
  })

  // ==========================================================================
  // Request Service IPC Handlers
  // ==========================================================================

  validatedHandle('request:resolve-url', requestResolveUrlArgs, (_event, [input]) => {
    return resolveRequestURL(input as URLResolutionInput)
  })

  // ==========================================================================
  // HTTP Execution IPC Handlers
  // ==========================================================================

  validatedHandle('http:execute', httpExecuteArgs, async (_event, [input]) => {
    const result = await httpExecutionService.execute(input as HTTPExecutionInput)
    setImmediate(() => {
      const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
        ? (input as { requestPath?: unknown }).requestPath
        : undefined
      void responseHistoryService.storeExecutionResult(input.requestId, 'http', result, requestPath)
    })
    return result
  })

  validatedHandle('http:cancel', httpCancelArgs, (_event, [requestId]) => {
    return httpExecutionService.cancel(requestId)
  })

  validatedHandle('http:is-active', httpIsActiveArgs, (_event, [requestId]) => {
    return httpExecutionService.isActive(requestId)
  })

  // ==========================================================================
  // GraphQL Execution IPC Handlers
  // ==========================================================================

  validatedHandle('graphql:execute', graphqlExecuteArgs, async (_event, [input]) => {
    const result = await graphqlExecutionService.execute(input as GraphQLExecutionInput)
    setImmediate(() => {
      const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
        ? (input as { requestPath?: unknown }).requestPath
        : undefined
      void responseHistoryService.storeExecutionResult(input.requestId, 'graphql', result, requestPath)
    })
    return result
  })

  validatedHandle('graphql:cancel', graphqlCancelArgs, (_event, [requestId]) => {
    return graphqlExecutionService.cancel(requestId)
  })

  validatedHandle('graphql:is-active', graphqlIsActiveArgs, (_event, [requestId]) => {
    return graphqlExecutionService.isActive(requestId)
  })

  // ==========================================================================
  // SOAP Execution IPC Handlers
  // ==========================================================================

  validatedHandle('soap:execute', soapExecuteArgs, async (_event, [input]) => {
    const result = await soapExecutionService.execute(input as SOAPExecutionInput)
    setImmediate(() => {
      const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
        ? (input as { requestPath?: unknown }).requestPath
        : undefined
      void responseHistoryService.storeExecutionResult(input.requestId, 'soap', result, requestPath)
    })
    return result
  })

  validatedHandle('soap:cancel', soapCancelArgs, (_event, [requestId]) => {
    return soapExecutionService.cancel(requestId)
  })

  validatedHandle('soap:is-active', soapIsActiveArgs, (_event, [requestId]) => {
    return soapExecutionService.isActive(requestId)
  })

  // ==========================================================================
  // gRPC Execution IPC Handlers
  // ==========================================================================

  validatedHandle('grpc:execute', grpcExecuteArgs, (_event, [input]) => {
    const result = grpcExecutionService.execute(input as GRPCExecutionInput)
    setImmediate(() => {
      const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
        ? (input as { requestPath?: unknown }).requestPath
        : undefined
      void responseHistoryService.storeExecutionResult(input.requestId, 'grpc', result, requestPath)
    })
    return result
  })

  validatedHandle('grpc:cancel', grpcCancelArgs, (_event, [requestId]) => {
    return grpcExecutionService.cancel(requestId)
  })

  validatedHandle('grpc:is-active', grpcIsActiveArgs, (_event, [requestId]) => {
    return grpcExecutionService.isActive(requestId)
  })

  // ==========================================================================
  // WebSocket Execution IPC Handlers
  // ==========================================================================

  validatedHandle('websocket:connect', websocketConnectArgs, async (_event, [input]) => {
    const result = await websocketExecutionService.execute(input as WebSocketExecutionInput)
    setImmediate(() => {
      const requestPath = typeof (input as { requestPath?: unknown }).requestPath === 'string'
        ? (input as { requestPath?: unknown }).requestPath
        : undefined
      void responseHistoryService.storeExecutionResult(input.requestId, 'websocket', result, requestPath)
    })
    return result
  })

  validatedHandle('websocket:disconnect', websocketDisconnectArgs, (_event, [requestId]) => {
    return websocketExecutionService.disconnect(requestId)
  })

  validatedHandle('websocket:send', websocketSendArgs, (_event, [requestId, message, event]) => {
    return websocketExecutionService.send(requestId, message, event)
  })

  validatedHandle('websocket:is-active', websocketIsActiveArgs, (_event, [requestId]) => {
    return websocketExecutionService.isActive(requestId)
  })

  // ==========================================================================
  // Responses History IPC Handlers
  // ==========================================================================

  validatedHandle('responses:history:list', responsesHistoryListArgs, async (_event, [requestId]) => {
    return responseHistoryService.list(requestId)
  })

  validatedHandle('responses:history:get', responsesHistoryGetArgs, async (_event, [guid]) => {
    return responseHistoryService.getDetail(guid)
  })

  validatedHandle('responses:history:toggle-pin', responsesHistoryTogglePinArgs, async (_event, [guid, pinned]) => {
    return responseHistoryService.togglePin(guid, pinned)
  })

  validatedHandle('responses:history:update-path', responsesHistoryUpdatePathArgs, async (_event, [requestId, requestPath]) => {
    return responseHistoryService.updateRequestPath(requestId, requestPath)
  })

  // ==========================================================================
  // Import IPC Handlers
  // ==========================================================================

  validatedHandle('import:preview', importPreviewArgs, async (_event, [input]) => {
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

  // ==========================================================================
  // Documentation Compiler
  // ==========================================================================

  validatedHandle('docs:compile-for-route', docsCompileRouteArgs, (_event, [apiDoc, route]) => {
    try {
      const result = compileDocumentationForRoute(apiDoc as ApiDocumentation, route as RouteLike)
      if (!result) return { matched: false, markdown: '' }
      return { matched: true, markdown: result.markdown, operationId: result.operation.operationId }
    } catch (error) {
      logger.error('[IPC] docs:compile-for-route error', error)
      return { matched: false, markdown: '', error: error instanceof Error ? error.message : String(error) }
    }
  })

  validatedHandle('docs:compile-root', docsCompileRootArgs, (_event, [apiDoc]) => {
    try {
      return { markdown: compileRootMarkdown(apiDoc as ApiDocumentation) }
    } catch (error) {
      logger.error('[IPC] docs:compile-root error', error)
      return { markdown: '', error: error instanceof Error ? error.message : String(error) }
    }
  })

  validatedHandle('import:import', importImportArgs, async (_event, [input]) => {
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
}
