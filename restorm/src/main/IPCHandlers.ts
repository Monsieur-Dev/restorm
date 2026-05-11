import { ipcMain, BrowserWindow, dialog } from 'electron'
import { logger, getFileService, isFileServiceInitialized, isPersistenceServiceInitialized, getPersistenceService, getFeatureService, isFeatureServiceInitialized, validatedHandle } from 'electron-core-ui'
import { isTabDetachEnabled } from './featureFlags'
import { join, relative, dirname } from 'path'
import { promises as fs, existsSync, statSync, rmSync } from 'fs'
import { EditorWindow } from './windows/EditorWindow'
import { contextService, responseHistoryService } from './services'
import { assertPathWithinParent } from './utils/pathSecurity'
import { saveFolderStructure, loadFolderStructure, attachDraftStoreForFolder, attachDraftStoreForFile } from './FileOperations'
import type { PersistenceFormat } from 'electron-core-ui'
import { resolveRequestURL, type URLResolutionInput } from './services/request/HTTPRequestService'
import { httpExecutionService, type HTTPExecutionInput } from './services/HTTPExecutionService'
import { authPrefetchOneShot, resolveProducedHeaders } from './services/AuthenticationPrefetch'
import { AuthenticationRequest } from '../shared/models/requests/AuthenticationRequest'
import { StringValue, ExpressionValue } from '../shared/types/valueTypes'
import type { KeyValue } from '../shared/types/baseTypes'
import { authenticationCacheService } from './services/AuthenticationCacheService'
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
  contextSetRequestEnvironmentArgs, contextSetAvailableEnvironmentsArgs,
  contextUpdateRequestKeyValuesArgs,
  contextUpdateFullRequestDataArgs, contextGetResolvedUrlArgs,
  contextGetCodeSnippetsArgs,
  requestResolveUrlArgs,
  httpExecuteArgs, httpCancelArgs, httpIsActiveArgs,
  odataExecuteArgs, odataCancelArgs, odataIsActiveArgs,
  authPrefetchArgs,
  graphqlExecuteArgs, graphqlCancelArgs, graphqlIsActiveArgs,
  soapExecuteArgs, soapCancelArgs, soapIsActiveArgs,
  grpcExecuteArgs, grpcCancelArgs, grpcIsActiveArgs,
  websocketConnectArgs, websocketDisconnectArgs, websocketSendArgs, websocketIsActiveArgs,
  responsesHistoryListArgs, responsesHistoryGetArgs,
  responsesHistoryTogglePinArgs,
  importPreviewArgs, importImportArgs,
  findInPageArgs, findStopArgs
} from './ipc/schemas'

/**
 * Get mocked folder path for E2E tests, if E2E_MOCK_SAVE_FOLDER env var is set.
 * Returns null if not in E2E mode.
 */
/**
 * Narrow an `unknown` payload to the plain-object shape
 * `AuthenticationRequest.fromPlain` accepts. The renderer sends a
 * shallow dump of the reactive proxy over IPC; we only forward
 * objects that carry at least an `id` to the class constructor.
 */
function isPlainAuthPayload(value: unknown): value is Parameters<typeof AuthenticationRequest.fromPlain>[0] {
  return typeof value === 'object' && value !== null && 'id' in (value as Record<string, unknown>)
}

function getE2EMockedFolderPath(): string | null {
  return process.env['E2E_MOCK_SAVE_FOLDER'] ?? null
}

interface KeyValueRowFromIpc {
  id?: string | undefined
  key: string
  value: string
  enabled?: boolean | undefined
  isExpression?: boolean | undefined
}

/**
 * Rehydrate an IPC-serialised KeyValue row back to the canonical
 * `KeyValue` shape with a real `ValueType` subclass. The renderer
 * flattens `KeyValue.value` to a string on the way to main, but
 * carries the `isExpression` bit so we know whether to materialise
 * an `ExpressionValue` (which the resolver will run through
 * handlebars) or a plain `StringValue` (which the resolver will
 * pass through verbatim).
 */
function rehydrateKeyValueRow(row: KeyValueRowFromIpc): KeyValue {
  const value = row.isExpression === true ? new ExpressionValue(row.value) : new StringValue(row.value)
  return {
    ...(row.id !== undefined ? { id: row.id } : {}),
    key: row.key,
    value,
    ...(row.enabled !== undefined ? { enabled: row.enabled } : {})
  }
}

/**
 * Walk an IPC `FullRequestData` payload and rehydrate every
 * KeyValue group + body form-fields back to real `KeyValue`s with
 * `ValueType` instances. The `context:update-full-request-data`
 * handler used to forward the renderer payload verbatim, so any
 * header / param / form-data field with `isExpression: true`
 * landed in `ContextService.keyValueGroups` as a bare string —
 * the runtime `resolveKeyValueForRequest` then read `kv.value`
 * (a string) and `isExpressionValue` returned false, so handlebars
 * never fired and the wire shipped `Bearer {{token}}` literally.
 *
 * `register-request` and `update-request-keyvalues` already
 * rehydrate; this mirrors the same pass for the third entry point.
 */
function rehydrateFullRequestData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data
  const record = data as Record<string, unknown>
  const out: Record<string, unknown> = { ...record }
  for (const group of ['headers', 'params', 'pathParams', 'metadata'] as const) {
    const rows = record[group]
    if (Array.isArray(rows)) {
      out[group] = rows.map((row) => rehydrateKeyValueRow(row as KeyValueRowFromIpc))
    }
  }
  // Body fields (`form-data` / `x-www-form-urlencoded`) keep their
  // wire shape — `{ key: string, value: string }`. The downstream
  // `HTTPExecutionService` runs them through `resolveValue(field.value)`
  // which expects a raw string, and the in-form template usage is
  // identical regardless of declared `ValueType`. Rehydrating them
  // here would force every executor to unwrap via `toString()` and
  // crashes the resolver's `rawValue.includes('{{')` branch on the
  // first send.
  return out
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
    // Defence-in-depth gate: even if a renderer somehow dispatches
    // this IPC while the `workbench.tabDetach` flag is off (the
    // renderer's drag handler is supposed to short-circuit before
    // ever reaching here), refuse to spawn a detached window. The
    // pathway is partially implemented and not ready for end users.
    if (!isFeatureServiceInitialized() || !isTabDetachEnabled(getFeatureService())) {
      logger.warn('restorm:open-editor refused: workbench.tabDetach feature flag is off')
      return
    }
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
        // A successful single-file save committed the in-memory
        // tree to disk. Bulk-clear the drafts directory so the
        // close-file dialog can't be tricked by orphans — drafts
        // whose runtime id is no longer in the tree, or pending
        // writes that flushed after registry hydration — and the
        // next launch doesn't show a bogus "drafts restored" toast.
        // `clearAllDrafts` drains in-flight flushes before
        // unlinking, so the bulk-clear is race-safe against
        // debounced writes.
        if (isFileServiceInitialized()) {
          await getFileService().clearAllDrafts()
        }
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
        // Same invariant as save-as-file — bulk-clear drafts after
        // a successful folder save. See `save-as-file` above for
        // the full rationale.
        if (isFileServiceInitialized()) {
          await getFileService().clearAllDrafts()
        }
      }

      return saveResult
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error('Failed to save folder', { error: errorMsg })
      return { success: false, error: errorMsg }
    }
  })

  // Dedicated drafts-clear IPC. Used by the renderer's save-all
  // flow when the in-memory checksum already matches the on-disk
  // file (`hasRealChanges === false`), so the IPC save handlers
  // above don't run — but orphan drafts may still exist from
  // earlier sessions or from runtime ids no longer in the tree.
  // Calling this guarantees the post-save invariant
  // "zero `.draft.*` files on disk" regardless of which save path
  // ran.
  ipcMain.handle('restorm:clear-drafts', async () => {
    if (!isFileServiceInitialized()) return { success: false }
    try {
      await getFileService().clearAllDrafts()
      return { success: true }
    } catch (error) {
      logger.warn('Failed to clear drafts', { error: String(error) })
      return { success: false, error: error instanceof Error ? error.message : String(error) }
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
        await attachDraftStoreForFolder(folderPath, loadResult.format)
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
          await attachDraftStoreForFolder(path, loadResult.format)
          return { success: true, isDirectory: true, content: loadResult.data, path, format: loadResult.format }
        }
        return { success: false, error: 'Failed to load folder' }
      } else {
        // It's a file - use normal file open. FileService stamps
        // `_projectUuid` before broadcasting `file:opened` (configured
        // via `uuidKey` on init), so the renderer sees the UUID on the
        // very first open without extra wiring here.
        if (!isFileServiceInitialized()) {
          return { success: false, error: 'FileService not initialized' }
        }
        const fileResult = await getFileService().open(path)
        if (fileResult.success) {
          // Attach the crash-recovery draft store for file mode — the
          // per-unit dirty state / draft writes must behave the same as
          // in folder mode (only the on-disk layout of saved content
          // differs).
          const format = (fileResult as { format?: string }).format ?? 'yaml'
          await attachDraftStoreForFile(path, format as PersistenceFormat)
        }
        return fileResult
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
    // The IPC payload carries `value: string` plus an optional
    // `isExpression` flag — rehydrate each row to a real KeyValue
    // with the matching ValueType subclass so downstream
    // `resolveKeyValue` reads the right type. Without this, every
    // value would arrive as a bare string and the resolver
    // couldn't distinguish a templated `ExpressionValue` from a
    // verbatim `StringValue` (a `StringValue("{{token}}")` would
    // get handlebars-substituted at send time even though the
    // product rule is "templating is opt-in via expression").
    contextService.registerRequest(requestId, environmentId, {
      id: requestId,
      headers: requestData.headers?.map(rehydrateKeyValueRow),
      params: requestData.params?.map(rehydrateKeyValueRow),
      pathParams: requestData.pathParams?.map(rehydrateKeyValueRow)
    })
  })

  validatedHandle('context:unregister-request', contextUnregisterRequestArgs, (_event, [requestId]) => {
    contextService.unregisterRequest(requestId)
  })

  validatedHandle('context:set-available-environments', contextSetAvailableEnvironmentsArgs, (_event, [requestId, environmentIds]) => {
    contextService.setAvailableEnvironments(requestId, environmentIds)
  })

  validatedHandle('context:set-request-environment', contextSetRequestEnvironmentArgs, (_event, [requestId, environmentId]) => {
    contextService.setRequestEnvironment(requestId, environmentId)
  })

  validatedHandle('context:update-request-keyvalues', contextUpdateRequestKeyValuesArgs, (_event, [requestId, groupName, keyValues, sourceId]) => {
    contextService.updateRequestKeyValues(requestId, groupName, keyValues.map(rehydrateKeyValueRow), sourceId)
  })

  validatedHandle('context:update-full-request-data', contextUpdateFullRequestDataArgs, (_event, [requestId, data, sourceId]) => {
    const rehydrated = rehydrateFullRequestData(data)
    contextService.updateFullRequestData(requestId, rehydrated as Parameters<typeof contextService.updateFullRequestData>[1], sourceId)
  })

  validatedHandle('context:get-resolved-url', contextGetResolvedUrlArgs, (_event, [requestId]) => {
    return contextService.getResolvedUrl(requestId)
  })

  validatedHandle('context:get-code-snippets', contextGetCodeSnippetsArgs, (_event, [requestId]) => {
    return contextService.getCodeSnippets(requestId)
  })

  ipcMain.handle('context:clear-all', () => {
    contextService.clearAll()
    // File close — the auth token cache is scoped to the open
    // collection, so flush it here. Opening a different file (or the
    // same one again) must force a fresh round of token fetches.
    authenticationCacheService.clear()
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
    // Rehydrate the `authRequest` POJO the renderer hands over into
    // a real `AuthenticationRequest` instance so the executor can
    // call its prototype methods (Handlebars renders headers off
    // `request.producedHeaders`, the cache invalidation path checks
    // `request.authErrorCodes`, etc.).
    const authRequestPayload = (input as { authRequest?: unknown }).authRequest
    const authRequest = isPlainAuthPayload(authRequestPayload)
      ? AuthenticationRequest.fromPlain(authRequestPayload)
      : undefined
    const executionInput: HTTPExecutionInput = {
      ...(input as HTTPExecutionInput),
      ...(authRequest ? { authRequest } : {})
    }
    const result = await httpExecutionService.execute(executionInput)
    setImmediate(() => {
      void responseHistoryService.storeExecutionResult(input.requestId, 'http', result)
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
  // OData Execution IPC Handlers
  // --------------------------------------------------------------------------
  // OData requests reuse `httpExecutionService` under the hood — the
  // URL is already composed by URLResolver (with $filter / $select /
  // $top / $skip / $count appended) so the dispatcher just sees a
  // plain HTTP GET. History is recorded as a dedicated `odata` entry
  // so the modal can surface `@odata.count` / `@odata.nextLink` and
  // the originating operation kind (entity-set / function / action /
  // batch) alongside the regular HTTP metadata.
  // ==========================================================================

  validatedHandle('odata:execute', odataExecuteArgs, async (_event, [input]) => {
    const method = typeof input.method === 'string' && input.method.length > 0
      ? input.method.toUpperCase()
      : 'GET'
    const rawBody = typeof input.body === 'string' && input.body.length > 0
      ? input.body
      : undefined
    const bodyContentType = typeof input.bodyContentType === 'string' && input.bodyContentType.length > 0
      ? input.bodyContentType
      : 'application/json'
    const urlOverride = typeof input.urlOverride === 'string' && input.urlOverride.length > 0
      ? input.urlOverride
      : undefined
    const authRequestPayload = (input as { authRequest?: unknown }).authRequest
    const authRequest = isPlainAuthPayload(authRequestPayload)
      ? AuthenticationRequest.fromPlain(authRequestPayload)
      : undefined
    const result = await httpExecutionService.execute({
      requestId: input.requestId,
      method,
      ...(typeof input.timeout === 'number' ? { timeout: input.timeout } : {}),
      ...(rawBody !== undefined ? { rawBody, rawBodyContentType: bodyContentType } : {}),
      ...(urlOverride !== undefined ? { urlOverride } : {}),
      ...(authRequest ? { authRequest } : {})
    })
    setImmediate(() => {
      void responseHistoryService.storeExecutionResult(input.requestId, 'odata', result)
    })
    return result
  })

  validatedHandle('odata:cancel', odataCancelArgs, (_event, [requestId]) => {
    return httpExecutionService.cancel(requestId)
  })

  validatedHandle('odata:is-active', odataIsActiveArgs, (_event, [requestId]) => {
    return httpExecutionService.isActive(requestId)
  })

  // ==========================================================================
  // Authentication — one-shot prefetch for the import wizard
  // --------------------------------------------------------------------------
  // Fires the caller-supplied HTTP request verbatim, evaluates
  // handlebars producedHeaders against the JSON response body, and
  // returns the resolved header map. No ContextService registration:
  // the request is ephemeral (user-typed in the modal, not yet
  // persisted). The cache service isn't involved either — the
  // resulting headers are returned straight to the renderer so the
  // import modal can drive a retry.
  // ==========================================================================

  validatedHandle('auth:prefetch', authPrefetchArgs, async (_event, [spec]) => {
    try {
      // Serialize body: text → raw string; x-www-form-urlencoded →
      // URLSearchParams; form-data/file → not yet supported here (the
      // auth route is nearly always OAuth token, which is text or
      // urlencoded). We also ensure Content-Type is set for urlencoded
      // bodies so providers like login.microsoftonline.com accept the
      // payload.
      const outHeaders: { key: string; value: string; enabled?: boolean }[] =
        (spec.headers ?? []).map((h) => ({ key: h.key, value: h.value, ...(h.enabled !== undefined ? { enabled: h.enabled } : {}) }))
      let serializedBody: string | undefined
      if (spec.body?.type === 'text' && spec.body.content) {
        serializedBody = spec.body.content
      } else if (spec.body?.type === 'x-www-form-urlencoded' && spec.body.fields) {
        const params = new URLSearchParams()
        for (const f of spec.body.fields) {
          if (f.enabled === false) continue
          if (!f.key) continue
          params.append(f.key, f.value)
        }
        serializedBody = params.toString()
        const hasContentType = outHeaders.some((h) => h.enabled !== false && h.key.toLowerCase() === 'content-type')
        if (!hasContentType) {
          outHeaders.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' })
        }
      }

      const redactedHeaders = outHeaders.map((h) => ({
        ...h,
        value: /authorization|cookie|secret|token/i.test(h.key) ? '***' : h.value
      }))
      const redactedBody = serializedBody
        ? serializedBody.replace(/(client_secret|password|refresh_token|assertion)=[^&]+/gi, '$1=***')
        : undefined
      logger.info('[auth:prefetch] dispatching', {
        method: spec.method,
        url: spec.url,
        headers: redactedHeaders,
        bodyType: spec.body?.type,
        bodyPreview: redactedBody?.slice(0, 500) ?? ''
      })

      const result = await authPrefetchOneShot({
        method: spec.method,
        url: spec.url,
        headers: outHeaders,
        ...(serializedBody !== undefined ? { body: serializedBody } : {})
      })

      logger.info('[auth:prefetch] response', {
        success: result.success,
        statusCode: result.statusCode,
        bodyPreview: (result.body ?? '').slice(0, 500),
        error: result.error
      })

      if (!result.success) {
        return {
          success: false,
          statusCode: result.statusCode ?? 0,
          error: result.error ?? `HTTP ${result.statusCode ?? 0}`,
          headers: {} as Record<string, string>
        }
      }
      // Treat non-2xx as a failure so Save & retry doesn't happily
      // attach headers from a failed auth exchange. We still return
      // the raw response body — the inline Send path in the modal
      // uses it to show the server's actual payload in the Response
      // tab, which tells the user what to fix.
      if (result.statusCode !== undefined && (result.statusCode < 200 || result.statusCode >= 300)) {
        return {
          success: false,
          statusCode: result.statusCode,
          headers: {} as Record<string, string>,
          responseBody: result.body ?? ''
        }
      }
      const resolved = resolveProducedHeaders(spec.producedHeaders, result.body ?? '')
      const redactedResolved: Record<string, string> = {}
      for (const [k, v] of Object.entries(resolved)) {
        redactedResolved[k] = /authorization|cookie/i.test(k) ? `${v.slice(0, 12)}…(redacted)` : v
      }
      logger.info('[auth:prefetch] resolved producedHeaders', { headers: redactedResolved })
      return {
        success: true,
        statusCode: result.statusCode ?? 200,
        headers: resolved,
        responseBody: result.body ?? ''
      }
    } catch (err) {
      logger.error('[IPC] auth:prefetch error', err)
      return {
        success: false,
        statusCode: 0,
        error: err instanceof Error ? err.message : String(err),
        headers: {} as Record<string, string>
      }
    }
  })

  // ==========================================================================
  // GraphQL Execution IPC Handlers
  // ==========================================================================

  validatedHandle('graphql:execute', graphqlExecuteArgs, async (_event, [input]) => {
    const result = await graphqlExecutionService.execute(input as GraphQLExecutionInput)
    setImmediate(() => {
      void responseHistoryService.storeExecutionResult(input.requestId, 'graphql', result)
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
      void responseHistoryService.storeExecutionResult(input.requestId, 'soap', result)
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
      void responseHistoryService.storeExecutionResult(input.requestId, 'grpc', result)
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
      void responseHistoryService.storeExecutionResult(input.requestId, 'websocket', result)
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

  // ==========================================================================
  // Import IPC Handlers
  // ==========================================================================

  validatedHandle('import:preview', importPreviewArgs, async (_event, [input, options]) => {
    logger.info('[IPC] Import preview requested:', { input })
    try {
      const result = await importFrom(input, {
        dryRun: true,
        ...(options?.extraHeaders !== undefined ? { extraHeaders: options.extraHeaders } : {})
      })
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
  // In-page find (Chromium native via webContents.findInPage)
  //
  // The renderer's documentation viewer drives the find through the
  // `restorm.find` preload bridge. We dispatch to the calling
  // window's webContents so multiple BrowserWindows can run their
  // own concurrent find without colliding.
  // ==========================================================================

  validatedHandle('find:in-page', findInPageArgs, (event, [text, options]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { requestId: -1 }
    if (text.length === 0) {
      win.webContents.stopFindInPage('clearSelection')
      return { requestId: -1 }
    }
    const requestId = win.webContents.findInPage(text, options ?? {})
    return { requestId }
  })

  validatedHandle('find:stop', findStopArgs, (event, [action]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.stopFindInPage(action)
    return { ok: true }
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
