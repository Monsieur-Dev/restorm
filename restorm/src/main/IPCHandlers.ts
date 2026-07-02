import { ipcMain, BrowserWindow, dialog } from 'electron'
import { logger, getFileService, isFileServiceInitialized, isPersistenceServiceInitialized, getPersistenceService, getFeatureService, isFeatureServiceInitialized, validatedHandle } from 'electron-core-ui'
import { isTabDetachEnabled } from './featureFlags'
import { join, relative, dirname } from 'path'
import { promises as fs, existsSync, statSync, rmSync } from 'fs'
import { EditorWindow } from './windows/EditorWindow'
import { contextService, responseHistoryService, requestUsageService, scenarioUsageService } from './services'
import { miniBrowserService } from './services/MiniBrowserService'
import { assertPathWithinParent, isPathContained } from './utils/pathSecurity'
import { secretHydrationService } from './services/secrets/SecretHydrationService'
import { saveFolderStructure, loadFolderStructure, attachDraftStoreForFolder, attachDraftStoreForFile } from './FileOperations'
import type { PersistenceFormat } from 'electron-core-ui'
import { resolveRequestURL, type URLResolutionInput } from './services/request/HTTPRequestService'
import { httpExecutionService, type HTTPExecutionInput } from './services/HTTPExecutionService'
import { authPrefetchOneShot, resolveProducedHeaders } from './services/AuthenticationPrefetch'
import { AuthenticationRequest } from '../shared/models/requests/AuthenticationRequest'
import { StringValue, ExpressionValue, CustomListValue, CustomListMultiValue, SecretValue } from '../shared/types/valueTypes'
import type { KeyValue } from '../shared/types/baseTypes'
import { authenticationCacheService } from './services/AuthenticationCacheService'
import { graphqlExecutionService, type GraphQLExecutionInput } from './services/GraphQLExecutionService'
import { graphqlMockServerService } from './services/GraphQLMockServerService'
import { graphqlSubscriptionService } from './services/GraphQLSubscriptionService'
import { soapExecutionService, type SOAPExecutionInput } from './services/SOAPExecutionService'
import { grpcExecutionService, normalizeAddress as normalizeGrpcAddress, type GRPCExecutionInput } from './services/GRPCExecutionService'
import { grpcMockServerService } from './services/GRPCMockServerService'
import { odataMockServerService } from './services/ODataMockServerService'
import { trpcExecutionService } from './services/TrpcExecutionService'
import { websocketExecutionService, type WebSocketExecutionInput } from './services/WebSocketExecutionService'
import { jsonRpcExecutionService } from './services/JsonRpcExecutionService'
import { scenarioEngine } from './scenarioEngine/engine'
import { importFrom } from './services/import/ImportManager'
import { importGrpcFromReflection, findExistingGrpcReflectionFolder, reimportGrpcReflection } from './services/import/GrpcReflectionImportService'
import { queryReflection, GrpcReflectionUnsupportedError } from './services/grpc/grpcReflectionClient'
import {
  openEditorArgs,
  saveAsFileArgs, saveAsFolderArgs,
  secretsReadArgs, secretsWriteArgs, secretsInvalidateArgs, secretsResolveArgs, secretsRefreshArgs,
  openPathArgs,
  projectReadFileArgs,
  contextRegisterRequestArgs, contextUnregisterRequestArgs, contextGetEnvironmentContextArgs,
  contextSetRequestEnvironmentArgs, contextSetAvailableEnvironmentsArgs,
  contextUpdateRequestKeyValuesArgs,
  contextUpdateFullRequestDataArgs, contextGetResolvedUrlArgs,
  contextGetCodeSnippetsArgs,
  requestResolveUrlArgs,
  httpExecuteArgs, httpCancelArgs, httpIsActiveArgs,
  httpListenArgs, httpStopArgs, httpIsListeningArgs,
  odataExecuteArgs, odataCancelArgs, odataIsActiveArgs,
  jsonrpcExecuteArgs, jsonrpcExecuteBatchArgs, jsonrpcCancelArgs, jsonrpcIsActiveArgs,
  trpcExecuteArgs, trpcCancelArgs, trpcIsActiveArgs,
  authPrefetchArgs,
  graphqlExecuteArgs, graphqlCancelArgs, graphqlIsActiveArgs,
  soapExecuteArgs, soapCancelArgs, soapIsActiveArgs, soapListenArgs, soapStopArgs, soapIsListeningArgs,
  graphqlListenArgs, graphqlStopArgs, graphqlIsListeningArgs,
  graphqlSubscribeArgs, graphqlUnsubscribeArgs, graphqlIsSubscribingArgs,
  grpcExecuteArgs, grpcConnectArgs, grpcSendArgs, grpcDisconnectArgs, grpcCancelArgs, grpcIsActiveArgs,
  grpcListenArgs, grpcStopArgs, grpcIsListeningArgs,
  grpcReflectImportArgs, grpcReflectQueryArgs,
  odataListenArgs, odataStopArgs, odataIsListeningArgs,
  websocketConnectArgs, websocketDisconnectArgs, websocketSendArgs, websocketIsActiveArgs,
  responsesHistoryListArgs, responsesHistoryGetArgs,
  responsesHistoryTogglePinArgs,
  requestUsageGetArgs,
  scenarioUsageGetArgs,
  importPreviewArgs, importImportArgs,
  miniBrowserCreateArgs, miniBrowserDestroyArgs, miniBrowserSetBoundsArgs,
  miniBrowserNavigateArgs, miniBrowserReloadArgs,
  miniBrowserGoBackArgs, miniBrowserGoForwardArgs, miniBrowserGetStateArgs,
  miniBrowserCaptureArgs
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

/**
 * Containment root for renderer-supplied secrets / save paths. Secrets
 * live either inside the opened project FOLDER (folder mode) or next to
 * the opened `.restorm` FILE as `<file>.env` (single-file mode — the
 * renderer writes `${filePath}.env`). So the legitimate root is the
 * opened folder when present, otherwise the opened file's directory.
 * Returns `null` when nothing is open at all — e.g. a brand-new
 * unsaved single-file document whose path isn't registered yet. In
 * that window the renderer still legitimately writes `<file>.env`
 * next to where the document will be saved, so callers treat a null
 * root as "no containment boundary to enforce" (allow) rather than a
 * hard refusal — matching the prior single-file behaviour. Containment
 * is enforced (forbidding `..` / absolute escapes) only once a root IS
 * resolvable.
 */
function getSecretsContainmentRoot(): string | null {
  if (!isFileServiceInitialized()) return null
  const fileService = getFileService() as {
    getOpenedFolderPath?: () => string | null
    getFilePath?: () => string | null
  }
  const folder = fileService.getOpenedFolderPath?.() ?? null
  if (folder) return folder
  const file = fileService.getFilePath?.() ?? null
  return file ? dirname(file) : null
}

interface KeyValueRowFromIpc {
  id?: string | undefined
  key: string
  value: string
  enabled?: boolean | undefined
  isExpression?: boolean | undefined
  customList?: { listId: string; label: string } | undefined
  customListMulti?: { listId: string; labels: string[] } | undefined
  secret?: { source: string; params: Record<string, unknown> } | undefined
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
  // Custom-list rows carry the structured shape so the dispatch
  // resolver can substitute the entry value; the flat `value` (the
  // label) is only a display fallback.
  const value = row.secret
    ? new SecretValue(row.secret.source, row.secret.params)
    : row.customList
      ? new CustomListValue(row.customList.listId, row.customList.label)
      : row.customListMulti
        ? new CustomListMultiValue(row.customListMulti.listId, row.customListMulti.labels)
        : row.isExpression === true
          ? new ExpressionValue(row.value)
          : new StringValue(row.value)
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
        // Re-saving into an already-opened folder (Ctrl+S). The target
        // must stay WITHIN that folder — not merely under its parent,
        // which would let a renderer-supplied path clobber sibling
        // projects. Enforce that boundary ONLY once a folder is open; the
        // INITIAL save-as (which establishes the folder) runs before any
        // folder is open, so a null `openedFolder` has no boundary to
        // enforce and the user-chosen target is allowed.
        const openedFolder = isFileServiceInitialized()
          ? (getFileService() as { getOpenedFolderPath?: () => string | null }).getOpenedFolderPath?.() ?? null
          : null
        // `targetPath` may legitimately equal `openedFolder` itself
        // (a plain re-save); containment is satisfied in that case.
        if (openedFolder && !isPathContained(openedFolder, targetPath)) {
          logger.warn('Blocked save-as-folder - path not contained in opened folder', { targetPath })
          return { success: false, error: 'Path traversal detected' }
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

      // Containment: a secrets file is only ever legitimate inside the
      // opened project folder (folder mode) or next to the opened
      // `.restorm` file (single-file mode). Enforce that boundary —
      // forbidding `..`/absolute escapes — ONLY once a root is
      // resolvable. A null root (e.g. a brand-new unsaved single-file
      // document not yet registered) has no boundary to enforce, so the
      // renderer-derived `<file>.env` path is allowed, matching the
      // prior single-file behaviour.
      const root = getSecretsContainmentRoot()
      if (root && !isPathContained(root, filePath)) {
        logger.warn('Blocked secrets:read - path not contained in the open project', { filePath })
        return null
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

      // Containment (see secrets:read): enforce the boundary — forbidding
      // `..`/absolute escapes — ONLY once a root is resolvable. A null
      // root (brand-new unsaved single-file document) has no boundary to
      // enforce, so the renderer-derived `<file>.env` path is allowed.
      const root = getSecretsContainmentRoot()
      if (root && !isPathContained(root, filePath)) {
        logger.warn('Blocked secrets:write - path not contained in the open project', { filePath })
        return { success: false, error: 'Path traversal detected' }
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

  // Drop the resolution cache for one secret source + params so the next
  // resolution re-fetches from the provider. Honors a `scopeId` when the caller
  // knows it; otherwise clears the entry across every scope.
  validatedHandle('restorm:secrets:invalidate', secretsInvalidateArgs, (_event, [{ source, params, scopeId }]) => {
    if (scopeId) {
      secretHydrationService.invalidate(scopeId, source, params)
    } else {
      secretHydrationService.invalidateAll(source, params)
    }
    return { success: true }
  })

  // Resolve a single secret on demand and return its plaintext for a renderer
  // preview. Errors are returned as `{ error }` rather than thrown so a failed
  // resolution (missing env var, etc.) doesn't reject across the IPC boundary.
  validatedHandle('restorm:secrets:resolve', secretsResolveArgs, async (_event, [{ source, params }]) => {
    // Reuse an already-resolved value (the env / item hydration likely just
    // fetched this exact credential) instead of hitting the provider again — so
    // the cell preview doesn't re-run a slow secret the env table already
    // resolved. A `refresh` invalidates every scope first, so this never serves
    // stale. (Concurrent in-flight fetches are deduped inside the service.)
    const cached = secretHydrationService.peekResolved(source, params)
    if (cached !== undefined) return { value: cached }
    try {
      const value = await secretHydrationService.resolveOne('preview', source, params)
      return { value }
    } catch (error) {
      return { error: String(error instanceof Error ? error.message : error) }
    }
  })

  // Refresh a secret used as an env-folder variable: invalidate the cache, blank
  // its resolved value, recompute the affected env contexts (so the secret and
  // any expression composing it go empty immediately), then re-hydrate.
  validatedHandle('restorm:secrets:refresh', secretsRefreshArgs, (_event, [{ source, params }]) => {
    contextService.refreshEnvSecret(source, params)
    return { success: true }
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

  validatedHandle('context:get-environment-context', contextGetEnvironmentContextArgs, (_event, [environmentId]) => {
    return contextService.getContext(environmentId) ?? {}
  })

  // Snapshot of which environments are currently resolving secrets, so a UI
  // mounting mid-resolution can show its spinner without waiting for the next
  // `context:env-secrets-resolving` broadcast.
  ipcMain.handle('context:get-resolving-environments', () => {
    return contextService.getResolvingEnvironmentIds()
  })

  // Snapshot of which environments last failed to resolve a secret, so a UI
  // mounting after a failure can show its error badge without waiting for the
  // next `context:env-secrets-error` broadcast.
  ipcMain.handle('context:get-errored-environments', () => {
    return contextService.getErroredEnvironmentIds()
  })

  // Snapshot of every item's effective secret status (direct + inherited), so a
  // UI mounting mid-resolution can badge requests / scenarios without waiting
  // for the next `context:item-secrets-status` broadcast.
  ipcMain.handle('context:get-item-secret-statuses', () => {
    return contextService.getItemSecretStatuses()
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

  ipcMain.handle('context:clear-all', async () => {
    contextService.clearAll()
    // File close — stop every running scenario. Runs are project-scoped: closing
    // the file (or opening another over it) must halt anything still executing,
    // exactly as if the user had stopped each run by hand. Sub-runs included.
    scenarioEngine.abortAll()
    // File close — tear down every live connection AND any hosted WebSocket /
    // Socket.IO server. A server is collection-scoped: closing the file must
    // release its port, otherwise it keeps listening with no UI left to stop it.
    // Await it so the OS socket is fully released before this round-trip
    // resolves — a reopen that rebinds the same port can't race EADDRINUSE.
    await websocketExecutionService.closeAll()
    // File close — same for any hosted gRPC mock server (its own grpc.Server on
    // its own port): release the port so it doesn't keep listening past the file.
    grpcMockServerService.closeAll()
    // File close — same for any hosted OData mock service (its routes on the
    // shared HTTP PortHost): release the port so it doesn't outlive the file.
    odataMockServerService.closeAll()
    // File close — the auth token cache is scoped to the open
    // collection, so flush it here. Opening a different file (or the
    // same one again) must force a fresh round of token fetches.
    authenticationCacheService.clear()
    // Resolved secrets are equally collection-scoped: drop every cached
    // credential so a freshly opened file re-fetches from its providers.
    secretHydrationService.clearAll()
    // Session cookies (Set-Cookie store / Cookie re-send) are likewise
    // scoped to the open collection — clear the jar so a freshly opened
    // file starts with no inherited cookies.
    httpExecutionService.clearCookies()
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
      requestUsageService.recordSend(input.requestId)
    })
    return result
  })

  validatedHandle('http:cancel', httpCancelArgs, (_event, [requestId]) => {
    return httpExecutionService.cancel(requestId)
  })

  validatedHandle('http:is-active', httpIsActiveArgs, (_event, [requestId]) => {
    return httpExecutionService.isActive(requestId)
  })

  // HTTP mock server (server mode): start hosting a local mock route, stop it,
  // and check whether it is currently listening. `http:listen` resolves as soon
  // as the route is listening (or fails to bind / collides); the route then
  // stays up until `http:stop` (the stop signal arrives via http:request-progress).
  validatedHandle('http:listen', httpListenArgs, async (_event, [requestId]) => {
    return await httpExecutionService.listen(requestId)
  })

  validatedHandle('http:stop', httpStopArgs, (_event, [requestId]) => {
    return httpExecutionService.stopListening(requestId)
  })

  validatedHandle('http:is-listening', httpIsListeningArgs, (_event, [requestId]) => {
    return httpExecutionService.isListening(requestId)
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
      requestUsageService.recordSend(input.requestId)
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
  // JSON-RPC Execution IPC Handlers
  // --------------------------------------------------------------------------
  // JSON-RPC calls compose `{ jsonrpc: '2.0', method, params, id }` and POST it
  // through httpExecutionService, exactly like OData composes its own body —
  // JsonRpcExecutionService reads method/params/id off the registered
  // request's fullData (flushed by the tab view) and does the envelope
  // shaping + result/error unwrap itself.
  // ==========================================================================

  validatedHandle('jsonrpc:execute', jsonrpcExecuteArgs, async (_event, [input]) => {
    const result = await jsonRpcExecutionService.execute(input)
    setImmediate(() => {
      void responseHistoryService.storeExecutionResult(input.requestId, 'jsonrpc', result)
      requestUsageService.recordSend(input.requestId)
    })
    return result
  })

  validatedHandle('jsonrpc:execute-batch', jsonrpcExecuteBatchArgs, async (_event, [input]) => {
    const result = await jsonRpcExecutionService.executeBatch(input)
    setImmediate(() => {
      void responseHistoryService.storeExecutionResult(input.requestId, 'jsonrpcBatch', result)
      requestUsageService.recordSend(input.requestId)
    })
    return result
  })

  validatedHandle('jsonrpc:cancel', jsonrpcCancelArgs, (_event, [requestId]) => {
    return jsonRpcExecutionService.cancel(requestId)
  })

  validatedHandle('jsonrpc:is-active', jsonrpcIsActiveArgs, (_event, [requestId]) => {
    return jsonRpcExecutionService.isActive(requestId)
  })

  // ==========================================================================
  // tRPC Execution IPC Handlers
  // --------------------------------------------------------------------------
  // tRPC reuses `httpExecutionService` under the hood, like OData — a thin
  // `TrpcExecutionService` composes the v10 wire format (URL already carries
  // the procedure + `?input=` from URLResolver) and unwraps the response
  // envelope before returning.
  // ==========================================================================

  validatedHandle('trpc:execute', trpcExecuteArgs, async (_event, [input]) => {
    const authRequestPayload = (input as { authRequest?: unknown }).authRequest
    const authRequest = isPlainAuthPayload(authRequestPayload)
      ? AuthenticationRequest.fromPlain(authRequestPayload)
      : undefined
    const result = await trpcExecutionService.execute({
      requestId: input.requestId,
      ...(typeof input.timeout === 'number' ? { timeout: input.timeout } : {}),
      ...(authRequest ? { authRequest } : {})
    })
    setImmediate(() => {
      void responseHistoryService.storeExecutionResult(input.requestId, 'trpc', result)
      requestUsageService.recordSend(input.requestId)
    })
    return result
  })

  validatedHandle('trpc:cancel', trpcCancelArgs, (_event, [requestId]) => {
    return trpcExecutionService.cancel(requestId)
  })

  validatedHandle('trpc:is-active', trpcIsActiveArgs, (_event, [requestId]) => {
    return trpcExecutionService.isActive(requestId)
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
      requestUsageService.recordSend(input.requestId)
    })
    return result
  })

  validatedHandle('graphql:cancel', graphqlCancelArgs, (_event, [requestId]) => {
    return graphqlExecutionService.cancel(requestId)
  })

  validatedHandle('graphql:is-active', graphqlIsActiveArgs, (_event, [requestId]) => {
    return graphqlExecutionService.isActive(requestId)
  })

  // GraphQL mock server (server mode): start hosting a local GraphQL endpoint,
  // stop it, and check whether it is currently listening. `graphql:listen`
  // resolves as soon as the route is listening (or fails to bind / collides);
  // the route stays up until `graphql:stop` (stop arrives via graphql:request-progress).
  validatedHandle('graphql:listen', graphqlListenArgs, async (_event, [requestId]) => {
    return await graphqlMockServerService.listen(requestId)
  })

  validatedHandle('graphql:stop', graphqlStopArgs, (_event, [requestId]) => {
    return graphqlMockServerService.stopListening(requestId)
  })

  validatedHandle('graphql:is-listening', graphqlIsListeningArgs, (_event, [requestId]) => {
    return graphqlMockServerService.isListening(requestId)
  })

  // GraphQL subscription client (consume an SSE subscription stream): open a
  // long-lived subscription, unsubscribe (Stop), and check whether it is
  // streaming. Pushed payloads + lifecycle reach the renderer via the
  // `graphql-sub:event` / `graphql-sub:progress` broadcasts the service fires
  // internally, so the callbacks here are no-ops.
  validatedHandle('graphql-sub:subscribe', graphqlSubscribeArgs, (_event, [input]) => {
    const noop = (): void => { /* lifecycle is delivered via the IPC broadcasts */ }
    graphqlSubscriptionService.connectStreaming({
      requestId: input.requestId,
      onConnect: noop,
      onMessage: noop,
      onClose: noop,
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {})
    })
    setImmediate(() => { requestUsageService.recordSend(input.requestId) })
    return { started: true }
  })

  validatedHandle('graphql-sub:unsubscribe', graphqlUnsubscribeArgs, (_event, [requestId]) => {
    return graphqlSubscriptionService.unsubscribe(requestId)
  })

  validatedHandle('graphql-sub:is-subscribing', graphqlIsSubscribingArgs, (_event, [requestId]) => {
    return graphqlSubscriptionService.isActive(requestId)
  })

  // ==========================================================================
  // SOAP Execution IPC Handlers
  // ==========================================================================

  validatedHandle('soap:execute', soapExecuteArgs, async (_event, [input]) => {
    const result = await soapExecutionService.execute(input as SOAPExecutionInput)
    setImmediate(() => {
      void responseHistoryService.storeExecutionResult(input.requestId, 'soap', result)
      requestUsageService.recordSend(input.requestId)
    })
    return result
  })

  validatedHandle('soap:cancel', soapCancelArgs, (_event, [requestId]) => {
    return soapExecutionService.cancel(requestId)
  })

  validatedHandle('soap:is-active', soapIsActiveArgs, (_event, [requestId]) => {
    return soapExecutionService.isActive(requestId)
  })

  // SOAP mock server (server mode): start hosting a local SOAP mock route, stop
  // it, and check whether it is currently listening. `soap:listen` resolves as
  // soon as the route is listening (or fails to bind / collides); the route then
  // stays up until `soap:stop` (the stop signal arrives via soap:request-progress).
  validatedHandle('soap:listen', soapListenArgs, async (_event, [requestId]) => {
    return await soapExecutionService.listen(requestId)
  })

  validatedHandle('soap:stop', soapStopArgs, (_event, [requestId]) => {
    return soapExecutionService.stopListening(requestId)
  })

  validatedHandle('soap:is-listening', soapIsListeningArgs, (_event, [requestId]) => {
    return soapExecutionService.isListening(requestId)
  })

  // ==========================================================================
  // gRPC Execution IPC Handlers
  // ==========================================================================

  validatedHandle('grpc:execute', grpcExecuteArgs, async (_event, [input]) => {
    // `execute()` persists the call to history itself (so direct + streaming
    // callers behave the same); the handler only records usage.
    const result = await grpcExecutionService.execute(input as GRPCExecutionInput)
    setImmediate(() => {
      requestUsageService.recordSend(input.requestId)
    })
    return result
  })

  validatedHandle('grpc:connect', grpcConnectArgs, (_event, [input]) => {
    // Open a long-lived streaming call (server / client / bidi). Frames +
    // lifecycle reach the renderer via the `grpc:message` / `grpc:request-progress`
    // broadcasts the service fires internally, so the callbacks are no-ops.
    const noop = (): void => { /* lifecycle is delivered via the IPC broadcasts */ }
    grpcExecutionService.connectStreaming({
      requestId: input.requestId,
      onConnect: noop,
      onMessage: noop,
      onClose: noop,
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {})
    })
    setImmediate(() => { requestUsageService.recordSend(input.requestId) })
    return { started: true }
  })

  validatedHandle('grpc:send', grpcSendArgs, (_event, [requestId, message]) => {
    return grpcExecutionService.send(requestId, message)
  })

  validatedHandle('grpc:disconnect', grpcDisconnectArgs, (_event, [requestId]) => {
    return grpcExecutionService.disconnect(requestId)
  })

  validatedHandle('grpc:cancel', grpcCancelArgs, (_event, [requestId]) => {
    return grpcExecutionService.cancel(requestId)
  })

  validatedHandle('grpc:is-active', grpcIsActiveArgs, (_event, [requestId]) => {
    return grpcExecutionService.isActive(requestId)
  })

  // gRPC mock server (server mode): start hosting a local gRPC server (its own
  // @grpc/grpc-js Server, NOT the shared HTTP PortHost), stop it, and check
  // whether it is listening. `grpc:listen` resolves once the server is bound (or
  // fails); it then stays up until `grpc:stop` (stop signal via
  // grpc:server-progress).
  validatedHandle('grpc:listen', grpcListenArgs, async (_event, [requestId]) => {
    return await grpcMockServerService.listen(requestId)
  })

  validatedHandle('grpc:stop', grpcStopArgs, (_event, [requestId]) => {
    return grpcMockServerService.stopListening(requestId)
  })

  validatedHandle('grpc:is-listening', grpcIsListeningArgs, (_event, [requestId]) => {
    return grpcMockServerService.isListening(requestId)
  })

  // gRPC server reflection: import a live server's services/methods without a
  // `.proto` file, or re-fetch just the descriptor bundle for the "Refresh
  // from reflection" button on an already-imported request.
  validatedHandle('grpc:reflect-import', grpcReflectImportArgs, async (_event, [input]) => {
    const { address, secure } = normalizeGrpcAddress(input.address)
    try {
      // Idempotent re-import (same GrpcAdapter contract every other
      // importer's "Refresh from source" uses, see
      // `main/services/import/idempotent/GrpcAdapter.ts`): connecting to a
      // server already imported via reflection merges into that folder
      // instead of creating a duplicate. Re-fetching an unchanged server
      // yields an empty diff — no added/removed/merged operations.
      const existing = findExistingGrpcReflectionFolder(address)
      if (existing) {
        const { diff, protoDescriptorSet } = await reimportGrpcReflection(existing, address, {
          tls: input.tls ?? secure,
          metadata: input.metadata
        })
        return {
          success: true,
          merged: true,
          folderId: existing.id,
          protoDescriptorSet,
          diff: {
            added: diff.added.length,
            removed: diff.removed.length,
            merged: diff.merged.length,
            deprecated: diff.deprecated.length
          }
        }
      }
      const { folder } = await importGrpcFromReflection(address, {
        tls: input.tls ?? secure,
        metadata: input.metadata,
        name: input.name
      })
      return { success: true, folder }
    } catch (error) {
      const unsupported = error instanceof GrpcReflectionUnsupportedError
      logger.error('[IPC] gRPC reflection import error:', error)
      return {
        success: false,
        unsupported,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  validatedHandle('grpc:reflect-query', grpcReflectQueryArgs, async (_event, [input]) => {
    const { address, secure } = normalizeGrpcAddress(input.address)
    try {
      const { services, fileDescriptorSet } = await queryReflection(address, {
        tls: input.tls ?? secure,
        metadata: input.metadata
      })
      return { success: true, services, protoDescriptorSet: fileDescriptorSet.toString('base64') }
    } catch (error) {
      const unsupported = error instanceof GrpcReflectionUnsupportedError
      logger.error('[IPC] gRPC reflection query error:', error)
      return {
        success: false,
        unsupported,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // OData mock server (server mode): host a local OData v4 service on the shared
  // HTTP PortHost (one matchPrefix route per method under the service root), stop
  // it, and check whether it is listening. `odata:listen` resolves once the
  // routes are registered (or fail); it stays up until `odata:stop`.
  validatedHandle('odata:listen', odataListenArgs, async (_event, [requestId]) => {
    return await odataMockServerService.listen(requestId)
  })

  validatedHandle('odata:stop', odataStopArgs, (_event, [requestId]) => {
    return odataMockServerService.stopListening(requestId)
  })

  validatedHandle('odata:is-listening', odataIsListeningArgs, (_event, [requestId]) => {
    return odataMockServerService.isListening(requestId)
  })

  // ==========================================================================
  // WebSocket Execution IPC Handlers
  // ==========================================================================

  validatedHandle('websocket:connect', websocketConnectArgs, async (_event, [input]) => {
    const result = await websocketExecutionService.execute(input as WebSocketExecutionInput)
    setImmediate(() => {
      void responseHistoryService.storeExecutionResult(input.requestId, 'websocket', result)
      requestUsageService.recordSend(input.requestId)
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
  // Request Usage IPC Handlers
  // --------------------------------------------------------------------------
  // The renderer reads the full usage map on EmptyBench mount; updates
  // arrive via the `request-usage:changed` push event broadcast from
  // `RequestUsageService.recordSend` next to each protocol's history
  // write.
  // ==========================================================================

  validatedHandle('request-usage:get', requestUsageGetArgs, () => {
    return requestUsageService.getAll()
  })

  validatedHandle('scenario-usage:get', scenarioUsageGetArgs, () => {
    return scenarioUsageService.getAll()
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
  // MiniBrowser — main-process `WebContentsView` lifecycle. Each Mini-
  // Browser tab in the renderer is backed by one WebContentsView here;
  // the renderer doesn't host the embedded page in its own DOM at all,
  // so cross-group tab moves are just `setBounds` updates instead of
  // re-parenting a `<webview>` (which Chromium would tear down on every
  // move). See `services/MiniBrowserService.ts` for the full rationale.
  // ==========================================================================

  validatedHandle('miniBrowser:create', miniBrowserCreateArgs, (event, [tabId, initialUrl]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      logger.warn('[IPC] miniBrowser:create: no owner BrowserWindow', { tabId })
      return { ok: false }
    }
    miniBrowserService.create(tabId, win, initialUrl)
    return { ok: true }
  })

  validatedHandle('miniBrowser:destroy', miniBrowserDestroyArgs, (_event, [tabId]) => {
    miniBrowserService.destroy(tabId)
    return { ok: true }
  })

  validatedHandle('miniBrowser:set-bounds', miniBrowserSetBoundsArgs, (_event, [tabId, bounds]) => {
    miniBrowserService.setBounds(tabId, bounds)
    return { ok: true }
  })

  validatedHandle('miniBrowser:navigate', miniBrowserNavigateArgs, (_event, [tabId, url]) => {
    miniBrowserService.navigate(tabId, url)
    return { ok: true }
  })

  validatedHandle('miniBrowser:reload', miniBrowserReloadArgs, (_event, [tabId]) => {
    miniBrowserService.reload(tabId)
    return { ok: true }
  })

  validatedHandle('miniBrowser:go-back', miniBrowserGoBackArgs, (_event, [tabId]) => {
    miniBrowserService.goBack(tabId)
    return { ok: true }
  })

  validatedHandle('miniBrowser:go-forward', miniBrowserGoForwardArgs, (_event, [tabId]) => {
    miniBrowserService.goForward(tabId)
    return { ok: true }
  })

  validatedHandle('miniBrowser:get-state', miniBrowserGetStateArgs, (_event, [tabId]) => {
    return miniBrowserService.getState(tabId)
  })

  validatedHandle('miniBrowser:capture', miniBrowserCaptureArgs, async (_event, [tabId]) => {
    return await miniBrowserService.capturePage(tabId)
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
