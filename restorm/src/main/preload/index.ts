import { contextBridge, ipcRenderer, webUtils } from 'electron'
// Import from core-ui preload modules using relative paths
// This works in both dev and prod because:
// - In dev: Vite resolves these imports via aliases in electron.vite.config.ts
// - In prod: These are bundled into the preload script
import { createCoreUIAPI } from '../../../../electron-core-ui/src/preload/api'
import { createElectronAPI } from '../../../../electron-core-ui/src/preload/electronAPI'
import type { PersistenceFormat } from '../../../../electron-core-ui/src/main/services/PersistenceService'
import {
  MINI_BROWSER_OPEN_CHANNEL,
  MINI_BROWSER_EXECUTE_CHANNEL,
  MINI_BROWSER_EXECUTE_REPLY_CHANNEL,
  CONSOLE_OPEN_CHANNEL,
  CONSOLE_CLEAR_CHANNEL,
  SET_TAB_MAXIMIZED_CHANNEL
} from '../../../../electron-core-ui/src/types/ipcChannels'
import {
  FIREWALL_IPC,
  FIREWALL_REQUEST_RECORD_CHANNEL,
  type FirewallOrigin,
  type FirewallPromptPayload,
  type RequestRecord
} from '../../../../electron-core-ui/src/types/firewall'
import {
  httpExecuteResultSchema,
  graphqlExecuteResultSchema,
  soapExecuteResultSchema,
  grpcExecuteResultSchema,
  websocketConnectResultSchema,
  authPrefetchResultSchema,
  importPreviewResultSchema,
  importImportResultSchema,
  apiUpdateRefreshFetchResultSchema,
} from '../ipc/schemas'
import type { z } from 'zod/v4'

// Expose core-ui APIs (imported from core-ui preload modules) and extend with restorm project API
const coreUIAPI = createCoreUIAPI()

contextBridge.exposeInMainWorld('api', {
  ...coreUIAPI,
  project: {
    listFiles: async (): Promise<{ path: string; isDirectory: boolean }[]> => {
      const result: unknown = await ipcRenderer.invoke('project:list-files')
      return result as { path: string; isDirectory: boolean }[]
    },
    readFile: async (filePath: string): Promise<string> => {
      const result: unknown = await ipcRenderer.invoke('project:read-file', filePath)
      return typeof result === 'string' ? result : ''
    }
  },
  // Firewall + console feed. Layer A (renderer webRequest) + Layer
  // B (main-process http/https/fetch monkey-patches) both broadcast
  // `RequestRecord` objects through this channel; the Console
  // workbench tab subscribes via `useConsoleFeed`. Returns an
  // unsubscribe fn so consumers can detach on unmount.
  firewall: {
    onRecord: (cb: (record: RequestRecord) => void): (() => void) => {
      const handler = (_event: unknown, record: RequestRecord): void => { cb(record) }
      ipcRenderer.on(FIREWALL_REQUEST_RECORD_CHANNEL, handler)
      return (): void => { ipcRenderer.off(FIREWALL_REQUEST_RECORD_CHANNEL, handler) }
    },
    // Control-plane — the Firewall workbench panel reads + mutates
    // the PermissionService state through these calls. Persistence
    // is handled main-side; the renderer never touches the on-disk
    // file directly.
    listWhitelist: async (): Promise<FirewallOrigin[]> => {
      const result: unknown = await ipcRenderer.invoke(FIREWALL_IPC.LIST_WHITELIST)
      return Array.isArray(result) ? (result as FirewallOrigin[]) : []
    },
    addToWhitelist: async (origin: FirewallOrigin): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.ADD_WHITELIST, origin)
    },
    removeFromWhitelist: async (origin: FirewallOrigin): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.REMOVE_WHITELIST, origin)
    },
    listBlacklist: async (): Promise<FirewallOrigin[]> => {
      const result: unknown = await ipcRenderer.invoke(FIREWALL_IPC.LIST_BLACKLIST)
      return Array.isArray(result) ? (result as FirewallOrigin[]) : []
    },
    addToBlacklist: async (origin: FirewallOrigin): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.ADD_BLACKLIST, origin)
    },
    removeFromBlacklist: async (origin: FirewallOrigin): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.REMOVE_BLACKLIST, origin)
    },
    /** Replace the project-derived origins set in one shot. The
     * renderer recomputes the set on every project tree change
     * (URL edit, env-var edit, request import, etc.) and pushes
     * here. Treated as the authoritative project view by the
     * permission check. */
    setProjectOrigins: async (origins: FirewallOrigin[]): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.SET_PROJECT_ORIGINS, origins)
    },
    onPromptShow: (cb: (payload: FirewallPromptPayload) => void): (() => void) => {
      const handler = (_event: unknown, payload: FirewallPromptPayload): void => { cb(payload) }
      ipcRenderer.on(FIREWALL_IPC.PROMPT_SHOW, handler)
      return (): void => { ipcRenderer.off(FIREWALL_IPC.PROMPT_SHOW, handler) }
    },
    resolvePrompt: async (promptId: string, verdict: 'allow' | 'deny'): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.PROMPT_RESOLVE, { promptId, verdict })
    }
  }
})
contextBridge.exposeInMainWorld('electronAPI', createElectronAPI())

/** Variable transformation result from context service */
interface VariableTransformResult {
  variableId: string
  contextUsed: Record<string, string>
  transformedValue: string
  rawValue: string
  key: string
}

/** Resolved URL result from context service */
interface ResolvedUrlResult {
  requestId: string
  resolvedUrl: string
  baseUrl: string
  queryString: string
  sourceId?: string
}

/** Code snippets result from context service */
interface CodeSnippetsResult {
  requestId: string
  markdown: string
  sourceId?: string
}

/** Available variables for autocompletion (per field) */
interface AvailableVariablesResult {
  variableId: string
  variables: { name: string; value: string }[]
  /** Echo of the sourceId of the renderer call that triggered this update (if any). */
  sourceId?: string
}

/** Full request data for backend processing */
interface FullRequestData {
  id: string
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'odata' | 'auth'
  url: string
  headers: { id?: string; key: string; value: string }[]
  method?: string
  params?: { id?: string; key: string; value: string }[]
  pathParams?: { id?: string; key: string; value: string }[]
  body?: { type: string; content?: string; path?: string; fields?: { id?: string; key: string; value: string }[] }
  /** HTTP mock server: status code the mock serves (defaults to 200). */
  mockStatus?: number
  operationType?: string
  query?: string
  variables?: string
  service?: string
  grpcMethod?: string
  callType?: string
  requestMessage?: string
  metadata?: { id?: string; key: string; value: string }[]
  soapAction?: string
  soapService?: string
  operation?: string
  soapBody?: string
  /** SOAP mock server: the operations the hosted mock answers. */
  soapMockOperations?: { name: string; soapAction?: string; responseBody: string; isFault?: boolean }[]
  protocol?: string
  event?: string
  message?: string
  server?: boolean
  // MQTT specific (protocol === 'mqtt'; `event` carries the topic)
  qos?: number
  retain?: boolean
  clientId?: string
  username?: string
  password?: string
  keepalive?: number
  mqttSubscribe?: boolean
  lwtTopic?: string
  lwtPayload?: string
  lwtQos?: number
  lwtRetain?: boolean
}

/** Save result type */
interface SaveResult {
  success: boolean
  path?: string
  error?: string
}

/**
 * Defense-in-depth shape check for IPC output bridges.
 * Failure is WARN-ONLY: a schema mismatch logs a warning through the
 * main-process logger, never throws. The caller returns the raw value
 * regardless, matching the `result as <Type>` pattern used throughout.
 */
function warnOnOutputMismatch(bridge: string, schema: z.ZodType, raw: unknown): void {
  const check = schema.safeParse(raw)
  if (!check.success) {
    // Fire-and-forget — do not await so the hot path stays synchronous
    void ipcRenderer.invoke('logger:log', {
      level: 'warn',
      message: `[preload] IPC output shape mismatch on "${bridge}"`,
      meta: { issues: check.error.issues },
    })
  }
}

// Expose restorm-specific APIs
contextBridge.exposeInMainWorld('restorm', {
  openEditor: async (file?: { title: string; content?: string; x?: number; y?: number }): Promise<void> => {
    await ipcRenderer.invoke('restorm:open-editor', file)
  },
  
  // File operations with mode support
  file: {
    /** Save as single file */
    saveAsFile: async (data: unknown, format: PersistenceFormat): Promise<SaveResult> => {
      const result: unknown = await ipcRenderer.invoke('restorm:save-as-file', data, format)
      return result as SaveResult
    },
    /** Save as folder structure */
    saveAsFolder: async (data: unknown, format: PersistenceFormat, targetPath?: string): Promise<SaveResult> => {
      const result: unknown = await ipcRenderer.invoke('restorm:save-as-folder', data, format, targetPath)
      return result as SaveResult
    },
    /** Open folder */
    openFolder: async (): Promise<{ success: boolean; content?: unknown; path?: string; format?: PersistenceFormat }> => {
      const result: unknown = await ipcRenderer.invoke('restorm:open-folder')
      return result as { success: boolean; content?: unknown; path?: string; format?: PersistenceFormat }
    },
    /** Show save dialog for folder selection */
    showFolderDialog: async (): Promise<{ canceled: boolean; filePath?: string }> => {
      const result: unknown = await ipcRenderer.invoke('restorm:show-folder-dialog')
      return result as { canceled: boolean; filePath?: string }
    },
    /** Open a file or folder (smart detection) */
    openPath: async (path: string): Promise<{ success: boolean; isDirectory?: boolean; content?: unknown; path?: string; format?: PersistenceFormat }> => {
      const result: unknown = await ipcRenderer.invoke('restorm:open-path', path)
      return result as { success: boolean; isDirectory?: boolean; content?: unknown; path?: string; format?: PersistenceFormat }
    },
    /**
     * Bulk-clear `.draft.*` files in the project's drafts
     * directory. Call this after a save-all path that may have
     * skipped the disk write (no whole-file delta) so the
     * post-save invariant "zero drafts on disk" holds regardless.
     */
    clearDrafts: async (): Promise<{ success: boolean; error?: string }> => {
      const result: unknown = await ipcRenderer.invoke('restorm:clear-drafts')
      return result as { success: boolean; error?: string }
    },
    /**
     * Resolve the absolute path of a `File` produced by a drag-and-
     * drop or file-input event. Electron 32 removed the legacy
     * `File.path` property — `webUtils.getPathForFile` is the
     * supported replacement and runs synchronously in the preload
     * context (no IPC). Returns an empty string if the File came
     * from a Blob with no on-disk backing (e.g. clipboard image),
     * which the caller can detect and fall back on.
     */
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  secrets: {
    read: async (filePath: string): Promise<string | null> => {
      const result: unknown = await ipcRenderer.invoke('restorm:secrets:read', filePath)
      return typeof result === 'string' ? result : null
    },
    write: async (filePath: string, content: string): Promise<{ success: boolean; error?: string }> => {
      const result: unknown = await ipcRenderer.invoke('restorm:secrets:write', filePath, content)
      return result as { success: boolean; error?: string }
    },
    /** Invalidate the main-side resolution cache for one secret source + params
     * (the per-secret "refresh" action). Omitting `scopeId` clears the entry in
     * every scope. */
    invalidate: async (
      args: { source: string; params: Record<string, unknown>; scopeId?: string }
    ): Promise<{ success: boolean }> => {
      const result: unknown = await ipcRenderer.invoke('restorm:secrets:invalidate', args)
      return result as { success: boolean }
    },
    /** Resolve a single secret's plaintext on demand for a renderer preview.
     * Returns `{ value }` on success or `{ error }` on failure — the resolved
     * plaintext is never written into the persisted document. */
    resolve: async (
      args: { source: string; params: Record<string, unknown> }
    ): Promise<{ value?: string; error?: string }> => {
      const result: unknown = await ipcRenderer.invoke('restorm:secrets:resolve', args)
      return result as { value?: string; error?: string }
    },
    /** Refresh a secret used as an env-folder variable: invalidate the cache,
     * blank the resolved value + recompute the affected env contexts (so the
     * secret and any expression composing it go empty), then re-hydrate. Drives
     * the env-folder context preview to reflect the in-flight refresh. */
    refresh: async (
      args: { source: string; params: Record<string, unknown> }
    ): Promise<{ success: boolean }> => {
      const result: unknown = await ipcRenderer.invoke('restorm:secrets:refresh', args)
      return result as { success: boolean }
    }
  },
  getEditorFile: async (): Promise<{ title: string; content?: string } | undefined> => {
    const result: unknown = await ipcRenderer.invoke('restorm:get-editor-file')
    return result as { title: string; content?: string } | undefined
  },
  forceClose: async (): Promise<void> => {
    await ipcRenderer.invoke('restorm:force-close')
  },
  onSaveAndClose: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }
    ipcRenderer.on('app:save-and-close', handler)
    return () => {
      ipcRenderer.removeListener('app:save-and-close', handler)
    }
  },
  request: {
    /** Resolve HTTP request URL with variables and parameters */
    resolveURL: async (input: unknown): Promise<unknown> => {
      return await ipcRenderer.invoke('request:resolve-url', input)
    }
  },
  context: {
    /** Get all variable transformation results */
    getAllTransformResults: async (): Promise<Record<string, VariableTransformResult>> => {
      const result: unknown = await ipcRenderer.invoke('context:get-all-transform-results')
      return result as Record<string, VariableTransformResult>
    },
    /** Get the resolved context for a specific environment */
    getEnvironmentContext: async (environmentId: string): Promise<Record<string, string>> => {
      const result: unknown = await ipcRenderer.invoke('context:get-environment-context', environmentId)
      return result as Record<string, string>
    },
    /** Listen for environment context changes */
    onEnvironmentContextChanged: (callback: (result: { environmentId: string; context: Record<string, string> }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: { environmentId: string; context: Record<string, string> }): void => {
        callback(result)
      }
      ipcRenderer.on('context:environment-context-changed', handler)
      return () => {
        ipcRenderer.removeListener('context:environment-context-changed', handler)
      }
    },
    /** Snapshot of environments currently resolving secrets (initial UI sync). */
    getResolvingEnvironments: async (): Promise<string[]> => {
      const result: unknown = await ipcRenderer.invoke('context:get-resolving-environments')
      return Array.isArray(result) ? (result as string[]) : []
    },
    /** Listen for "an environment started/stopped resolving its secrets" so the
     * UI can show a spinner while at least one variable is in flight. */
    onEnvSecretsResolving: (callback: (result: { environmentId: string; resolving: boolean }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: { environmentId: string; resolving: boolean }): void => {
        callback(result)
      }
      ipcRenderer.on('context:env-secrets-resolving', handler)
      return () => {
        ipcRenderer.removeListener('context:env-secrets-resolving', handler)
      }
    },
    /** Snapshot of environments whose last secret resolution failed (initial UI sync). */
    getErroredEnvironments: async (): Promise<string[]> => {
      const result: unknown = await ipcRenderer.invoke('context:get-errored-environments')
      return Array.isArray(result) ? (result as string[]) : []
    },
    /** Listen for "an environment's secret resolution failed/recovered" so the UI
     * can show an error badge next to a failing env wherever it appears. */
    onEnvSecretsError: (callback: (result: { environmentId: string; hasError: boolean }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: { environmentId: string; hasError: boolean }): void => {
        callback(result)
      }
      ipcRenderer.on('context:env-secrets-error', handler)
      return () => {
        ipcRenderer.removeListener('context:env-secrets-error', handler)
      }
    },
    /** Snapshot of every item's effective secret status (direct + inherited). */
    getItemSecretStatuses: async (): Promise<{ itemId: string; resolving: boolean; error: boolean }[]> => {
      const result: unknown = await ipcRenderer.invoke('context:get-item-secret-statuses')
      return Array.isArray(result) ? (result as { itemId: string; resolving: boolean; error: boolean }[]) : []
    },
    /** Listen for "a request/scenario's effective secret status changed" so the
     * UI can badge its tab / sidebar row / node (spinner while resolving, red on
     * error) from a single per-item signal. */
    onItemSecretsStatus: (callback: (result: { itemId: string; resolving: boolean; error: boolean }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: { itemId: string; resolving: boolean; error: boolean }): void => {
        callback(result)
      }
      ipcRenderer.on('context:item-secrets-status', handler)
      return () => {
        ipcRenderer.removeListener('context:item-secrets-status', handler)
      }
    },
    /** Listen for variable transformation updates */
    onVariableTransformed: (callback: (result: VariableTransformResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: VariableTransformResult): void => {
        callback(result)
      }
      ipcRenderer.on('context:variable-transformed', handler)
      return () => {
        ipcRenderer.removeListener('context:variable-transformed', handler)
      }
    },
    /** Register a request for context tracking (when tab opens) */
    registerRequest: async (
      requestId: string,
      environmentId: string | null,
      requestData: {
        headers?: { id?: string; key: string; value: string; enabled?: boolean; isExpression?: boolean }[]
        params?: { id?: string; key: string; value: string; enabled?: boolean; isExpression?: boolean }[]
        pathParams?: { id?: string; key: string; value: string; enabled?: boolean; isExpression?: boolean }[]
      }
    ): Promise<void> => {
      await ipcRenderer.invoke('context:register-request', requestId, environmentId, requestData)
    },
    /** Unregister a request from context tracking (when tab closes) */
    unregisterRequest: async (requestId: string): Promise<void> => {
      await ipcRenderer.invoke('context:unregister-request', requestId)
    },
    /** Set the selected environment for a request */
    setRequestEnvironment: async (requestId: string, environmentId: string | null): Promise<void> => {
      await ipcRenderer.invoke('context:set-request-environment', requestId, environmentId)
    },
    /** Tell the main side which env IDs are visible to a request through
     * its env-folder ancestor chain — used by the auth-resolver. */
    setAvailableEnvironments: async (requestId: string, environmentIds: string[]): Promise<void> => {
      await ipcRenderer.invoke('context:set-available-environments', requestId, environmentIds)
    },
    /** Update KeyValues for a request (headers, params, etc.) */
    updateRequestKeyValues: async (
      requestId: string,
      groupName: string,
      keyValues: { id?: string; key: string; value: string; enabled?: boolean }[],
      sourceId?: string
    ): Promise<void> => {
      await ipcRenderer.invoke('context:update-request-keyvalues', requestId, groupName, keyValues, sourceId)
    },
    /** Update full request data for URL resolution and code snippet generation */
    updateFullRequestData: async (requestId: string, data: FullRequestData, sourceId?: string): Promise<void> => {
      await ipcRenderer.invoke('context:update-full-request-data', requestId, data, sourceId)
    },
    /** Get resolved URL for a request */
    getResolvedUrl: async (requestId: string): Promise<ResolvedUrlResult | undefined> => {
      const result: unknown = await ipcRenderer.invoke('context:get-resolved-url', requestId)
      return result as ResolvedUrlResult | undefined
    },
    /** Get code snippets for a request */
    getCodeSnippets: async (requestId: string): Promise<CodeSnippetsResult | undefined> => {
      const result: unknown = await ipcRenderer.invoke('context:get-code-snippets', requestId)
      return result as CodeSnippetsResult | undefined
    },
    /** Listen for URL resolution updates */
    onUrlResolved: (callback: (result: ResolvedUrlResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: ResolvedUrlResult): void => {
        callback(result)
      }
      ipcRenderer.on('context:url-resolved', handler)
      return () => {
        ipcRenderer.removeListener('context:url-resolved', handler)
      }
    },
    /** Listen for code snippets updates */
    onCodeSnippetsUpdated: (callback: (result: CodeSnippetsResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: CodeSnippetsResult): void => {
        callback(result)
      }
      ipcRenderer.on('context:code-snippets-updated', handler)
      return () => {
        ipcRenderer.removeListener('context:code-snippets-updated', handler)
      }
    },
    /** Listen for available variables updates (for autocompletion) */
    onAvailableVariables: (callback: (result: AvailableVariablesResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: AvailableVariablesResult): void => {
        callback(result)
      }
      ipcRenderer.on('context:available-variables', handler)
      return () => {
        ipcRenderer.removeListener('context:available-variables', handler)
      }
    },
    /** Clear all context data (when file is closed) */
    clearAll: async (): Promise<void> => {
      await ipcRenderer.invoke('context:clear-all')
    }
  },
  miniBrowser: {
    /** Create a `WebContentsView` for a Mini-Browser tab, attached to
     * the calling window's `contentView`. Idempotent — a duplicate call
     * for the same `tabId` is a no-op. */
    create: async (tabId: string, initialUrl?: string): Promise<{ ok: boolean }> => {
      return await ipcRenderer.invoke('miniBrowser:create', tabId, initialUrl) as { ok: boolean }
    },
    /** Tear down the view (close its contents, free the slot). Called
     * on the Mini-Browser tab's final unmount — NOT on cross-group
     * moves (those are pure `setBounds` updates). */
    destroy: async (tabId: string): Promise<{ ok: boolean }> => {
      return await ipcRenderer.invoke('miniBrowser:destroy', tabId) as { ok: boolean }
    },
    /** Position the view in window-coordinate space (DIP). The panel's
     * `ResizeObserver` on its placeholder slot drives this every time
     * the slot's rect changes. A zero-size rect hides the view. */
    setBounds: async (tabId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean }> => {
      return await ipcRenderer.invoke('miniBrowser:set-bounds', tabId, bounds) as { ok: boolean }
    },
    navigate: async (tabId: string, url: string): Promise<{ ok: boolean }> => {
      return await ipcRenderer.invoke('miniBrowser:navigate', tabId, url) as { ok: boolean }
    },
    reload: async (tabId: string): Promise<{ ok: boolean }> => {
      return await ipcRenderer.invoke('miniBrowser:reload', tabId) as { ok: boolean }
    },
    goBack: async (tabId: string): Promise<{ ok: boolean }> => {
      return await ipcRenderer.invoke('miniBrowser:go-back', tabId) as { ok: boolean }
    },
    goForward: async (tabId: string): Promise<{ ok: boolean }> => {
      return await ipcRenderer.invoke('miniBrowser:go-forward', tabId) as { ok: boolean }
    },
    /** Synchronous URL + back/forward snapshot. Used to seed the
     * toolbar before the first `did-navigate` event lands. */
    getState: async (tabId: string): Promise<{ url: string; canGoBack: boolean; canGoForward: boolean } | null> => {
      return await ipcRenderer.invoke('miniBrowser:get-state', tabId) as { url: string; canGoBack: boolean; canGoForward: boolean } | null
    },
    /** PNG data URL of the current page. Used by the panel to paint a
     * still image of the page in place of the live view during HTML5
     * drag gestures (the OS-compositor-level view paints above HTML
     * pixels, so a real drag overlay would otherwise be occluded). */
    capture: async (tabId: string): Promise<string | null> => {
      return await ipcRenderer.invoke('miniBrowser:capture', tabId) as string | null
    },
    onDidNavigate: (callback: (result: { tabId: string; url: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: { tabId: string; url: string }): void => {
        callback(result)
      }
      ipcRenderer.on('miniBrowser:did-navigate', handler)
      ipcRenderer.on('miniBrowser:did-navigate-in-page', handler)
      return () => {
        ipcRenderer.removeListener('miniBrowser:did-navigate', handler)
        ipcRenderer.removeListener('miniBrowser:did-navigate-in-page', handler)
      }
    },
    onDidStopLoading: (callback: (result: { tabId: string; canGoBack: boolean; canGoForward: boolean }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: { tabId: string; canGoBack: boolean; canGoForward: boolean }): void => {
        callback(result)
      }
      ipcRenderer.on('miniBrowser:did-stop-loading', handler)
      return () => {
        ipcRenderer.removeListener('miniBrowser:did-stop-loading', handler)
      }
    },
    onUserInteraction: (callback: (result: { tabId: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: { tabId: string }): void => {
        callback(result)
      }
      ipcRenderer.on('miniBrowser:user-interaction', handler)
      return () => {
        ipcRenderer.removeListener('miniBrowser:user-interaction', handler)
      }
    }
  },
  http: {
    /** Execute an HTTP request */
    execute: async (input: { requestId: string; method: string; timeout?: number; authRequest?: unknown; requestPath?: string }): Promise<{
      requestId: string
      success: boolean
      statusCode?: number
      statusText?: string
      headers?: Record<string, string | string[]>
      body?: string
      error?: string
      timings: { startedAt: string; durationMs: number }
      requestUrl?: string
      requestHeaders?: Record<string, string>
    }> => {
      const result: unknown = await ipcRenderer.invoke('http:execute', input)
      warnOnOutputMismatch('http:execute', httpExecuteResultSchema, result)
      return result as {
        requestId: string
        success: boolean
        statusCode?: number
        statusText?: string
        headers?: Record<string, string | string[]>
        body?: string
        error?: string
        timings: { startedAt: string; durationMs: number }
        requestUrl?: string
        requestHeaders?: Record<string, string>
      }
    },
    /** Cancel an HTTP request */
    cancel: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('http:cancel', requestId)
      return result as boolean
    },
    /** Check if a request is currently active */
    isActive: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('http:is-active', requestId)
      return result as boolean
    },
    /** Listen for request progress updates */
    onProgress: (callback: (data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }): void => {
        callback(data)
      }
      ipcRenderer.on('http:request-progress', handler)
      return () => {
        ipcRenderer.removeListener('http:request-progress', handler)
      }
    },
    /** SERVER MODE: start hosting this request as a local HTTP mock server.
     * Resolves once the mock route stops (Stop / file close / quit). */
    listen: async (requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> => {
      const result: unknown = await ipcRenderer.invoke('http:listen', requestId)
      return result as { success: boolean; listening: boolean; error?: string }
    },
    /** SERVER MODE: stop hosting this request's HTTP mock route. */
    stop: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('http:stop', requestId)
      return result as boolean
    },
    /** SERVER MODE: whether this request is currently hosting a mock route. */
    isListening: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('http:is-listening', requestId)
      return result as boolean
    },
    /** SERVER MODE: served-request count updates for the "served N" banner. */
    onServerServed: (callback: (data: { requestId: string; count: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; count: number }): void => {
        callback(data)
      }
      ipcRenderer.on('http:server-served', handler)
      return () => {
        ipcRenderer.removeListener('http:server-served', handler)
      }
    }
  },
  graphql: {
    /** Execute a GraphQL request */
    execute: async (input: { requestId: string; timeout?: number }): Promise<{
      requestId: string
      success: boolean
      statusCode?: number
      data?: unknown
      errors?: { message: string; locations?: { line: number; column: number }[]; path?: string[] }[]
      headers?: Record<string, string | string[]>
      error?: string
      timings: { startedAt: string; durationMs: number }
      requestUrl?: string
    }> => {
      const result: unknown = await ipcRenderer.invoke('graphql:execute', input)
      warnOnOutputMismatch('graphql:execute', graphqlExecuteResultSchema, result)
      return result as {
        requestId: string
        success: boolean
        statusCode?: number
        data?: unknown
        errors?: { message: string; locations?: { line: number; column: number }[]; path?: string[] }[]
        headers?: Record<string, string | string[]>
        error?: string
        timings: { startedAt: string; durationMs: number }
        requestUrl?: string
      }
    },
    /** Cancel a GraphQL request */
    cancel: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('graphql:cancel', requestId)
      return result as boolean
    },
    /** Check if a request is currently active */
    isActive: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('graphql:is-active', requestId)
      return result as boolean
    },
    /** Listen for request progress updates */
    onProgress: (callback: (data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }): void => {
        callback(data)
      }
      ipcRenderer.on('graphql:request-progress', handler)
      return () => {
        ipcRenderer.removeListener('graphql:request-progress', handler)
      }
    },
    /** SERVER MODE: start hosting this request as a local GraphQL mock server. */
    listen: async (requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> => {
      const result: unknown = await ipcRenderer.invoke('graphql:listen', requestId)
      return result as { success: boolean; listening: boolean; error?: string }
    },
    /** SERVER MODE: stop hosting this request's GraphQL mock route. */
    stop: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('graphql:stop', requestId)
      return result as boolean
    },
    /** SERVER MODE: whether this request is currently hosting a mock route. */
    isListening: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('graphql:is-listening', requestId)
      return result as boolean
    },
    /** SERVER MODE: served-operation count updates for the "served N" banner. */
    onServerServed: (callback: (data: { requestId: string; count: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; count: number }): void => {
        callback(data)
      }
      ipcRenderer.on('graphql:server-served', handler)
      return () => {
        ipcRenderer.removeListener('graphql:server-served', handler)
      }
    }
  },
  graphqlApi: {
    query: async (query: string, variables?: Record<string, unknown>): Promise<unknown> => {
      const result: unknown = await ipcRenderer.invoke('graphql:query', { query, variables })
      return result
    }
  },
  soap: {
    /** Execute a SOAP request */
    execute: async (input: { requestId: string; timeout?: number }): Promise<{
      requestId: string
      success: boolean
      statusCode?: number
      responseBody?: string
      headers?: Record<string, string | string[]>
      fault?: { code: string; message: string }
      error?: string
      timings: { startedAt: string; durationMs: number }
      requestUrl?: string
    }> => {
      const result: unknown = await ipcRenderer.invoke('soap:execute', input)
      warnOnOutputMismatch('soap:execute', soapExecuteResultSchema, result)
      return result as {
        requestId: string
        success: boolean
        statusCode?: number
        responseBody?: string
        headers?: Record<string, string | string[]>
        fault?: { code: string; message: string }
        error?: string
        timings: { startedAt: string; durationMs: number }
        requestUrl?: string
      }
    },
    /** Cancel a SOAP request */
    cancel: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('soap:cancel', requestId)
      return result as boolean
    },
    /** Check if a request is currently active */
    isActive: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('soap:is-active', requestId)
      return result as boolean
    },
    /** Listen for request progress updates */
    onProgress: (callback: (data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }): void => {
        callback(data)
      }
      ipcRenderer.on('soap:request-progress', handler)
      return () => {
        ipcRenderer.removeListener('soap:request-progress', handler)
      }
    },
    /** SERVER MODE: start hosting this request as a local SOAP mock server.
     * Resolves once the mock route is listening (or fails to bind / collides). */
    listen: async (requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> => {
      const result: unknown = await ipcRenderer.invoke('soap:listen', requestId)
      return result as { success: boolean; listening: boolean; error?: string }
    },
    /** SERVER MODE: stop hosting this request's SOAP mock route. */
    stop: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('soap:stop', requestId)
      return result as boolean
    },
    /** SERVER MODE: whether this request is currently hosting a mock route. */
    isListening: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('soap:is-listening', requestId)
      return result as boolean
    },
    /** SERVER MODE: served-request count updates for the "served N" banner. */
    onServerServed: (callback: (data: { requestId: string; count: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; count: number }): void => {
        callback(data)
      }
      ipcRenderer.on('soap:server-served', handler)
      return () => {
        ipcRenderer.removeListener('soap:server-served', handler)
      }
    }
  },
  grpc: {
    /** Execute a gRPC request */
    execute: async (input: { requestId: string; timeout?: number }): Promise<{
      requestId: string
      success: boolean
      statusCode?: number
      statusMessage?: string
      responseMessage?: string
      metadata?: Record<string, string>
      error?: string
      timings: { startedAt: string; durationMs: number }
      requestUrl?: string
      requestMethod?: string
    }> => {
      const result: unknown = await ipcRenderer.invoke('grpc:execute', input)
      warnOnOutputMismatch('grpc:execute', grpcExecuteResultSchema, result)
      return result as {
        requestId: string
        success: boolean
        statusCode?: number
        statusMessage?: string
        responseMessage?: string
        metadata?: Record<string, string>
        error?: string
        timings: { startedAt: string; durationMs: number }
        requestUrl?: string
        requestMethod?: string
      }
    },
    /** Open a long-lived streaming gRPC call (server / client / bidi). Frames +
     * lifecycle arrive via `onMessage` / `onProgress`. */
    connect: async (input: { requestId: string; timeout?: number }): Promise<{ started: boolean }> => {
      const result: unknown = await ipcRenderer.invoke('grpc:connect', input)
      return result as { started: boolean }
    },
    /** Write a request message on an active streaming call (client / bidi). */
    send: async (requestId: string, message: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('grpc:send', requestId, message)
      return result as boolean
    },
    /** End an active streaming call (half-close for client / bidi). */
    disconnect: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('grpc:disconnect', requestId)
      return result as boolean
    },
    /** Cancel a gRPC request */
    cancel: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('grpc:cancel', requestId)
      return result as boolean
    },
    /** Check if a request is currently active */
    isActive: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('grpc:is-active', requestId)
      return result as boolean
    },
    /** Listen for request progress updates */
    onProgress: (callback: (data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }): void => {
        callback(data)
      }
      ipcRenderer.on('grpc:request-progress', handler)
      return () => {
        ipcRenderer.removeListener('grpc:request-progress', handler)
      }
    },
    /** Listen for streamed gRPC frames (sent + received). */
    onMessage: (callback: (data: { requestId: string; message: { direction: 'sent' | 'received'; data: string; timestamp: string } }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; message: { direction: 'sent' | 'received'; data: string; timestamp: string } }): void => {
        callback(data)
      }
      ipcRenderer.on('grpc:message', handler)
      return () => {
        ipcRenderer.removeListener('grpc:message', handler)
      }
    },
    /** SERVER MODE: start hosting this request as a local gRPC mock server.
     * Resolves once the server is bound (or fails to bind). */
    listen: async (requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> => {
      const result: unknown = await ipcRenderer.invoke('grpc:listen', requestId)
      return result as { success: boolean; listening: boolean; error?: string }
    },
    /** SERVER MODE: stop hosting this request's gRPC mock server. */
    stopServer: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('grpc:stop', requestId)
      return result as boolean
    },
    /** SERVER MODE: whether this request is currently hosting a gRPC mock server. */
    isServerListening: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('grpc:is-listening', requestId)
      return result as boolean
    },
    /** SERVER MODE: listening lifecycle on the DISTINCT server channel (not the
     * client `grpc:request-progress`). */
    onServerProgress: (callback: (data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }): void => {
        callback(data)
      }
      ipcRenderer.on('grpc:server-progress', handler)
      return () => {
        ipcRenderer.removeListener('grpc:server-progress', handler)
      }
    },
    /** SERVER MODE: served-call count updates for the "served N" banner. */
    onServerServed: (callback: (data: { requestId: string; count: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; count: number }): void => {
        callback(data)
      }
      ipcRenderer.on('grpc:server-served', handler)
      return () => {
        ipcRenderer.removeListener('grpc:server-served', handler)
      }
    }
  },
  odata: {
    /**
     * Execute an OData request. Reuses the HTTP dispatcher: the URL
     * (with system query options already appended by URLResolver) is
     * dispatched as a plain HTTP call. Action / batch kinds send a
     * POST with a caller-supplied body; entity-set and function kinds
     * send a GET. Response shape mirrors the HTTP envelope; OData
     * annotations are extracted downstream.
     */
    execute: async (input: { requestId: string; timeout?: number; requestPath?: string; method?: string; body?: string; bodyContentType?: string; urlOverride?: string; authRequest?: unknown }): Promise<{
      requestId: string
      success: boolean
      statusCode?: number
      statusText?: string
      headers?: Record<string, string | string[]>
      body?: string
      error?: string
      timings: { startedAt: string; durationMs: number }
      requestUrl?: string
    }> => {
      const result: unknown = await ipcRenderer.invoke('odata:execute', input)
      warnOnOutputMismatch('odata:execute', httpExecuteResultSchema, result)
      return result as {
        requestId: string
        success: boolean
        statusCode?: number
        statusText?: string
        headers?: Record<string, string | string[]>
        body?: string
        error?: string
        timings: { startedAt: string; durationMs: number }
        requestUrl?: string
      }
    },
    /** Cancel an in-flight OData request. */
    cancel: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('odata:cancel', requestId)
      return result as boolean
    },
    /** Check whether an OData request is currently in flight. */
    isActive: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('odata:is-active', requestId)
      return result as boolean
    }
  },
  auth: {
    /** One-shot auth prefetch for the import wizard — runs the
     * ephemeral auth request, resolves producedHeaders against the
     * response body, and returns the resolved header map. */
    prefetch: async (input: {
      method: string
      url: string
      headers: { key: string; value: string; enabled?: boolean }[]
      body?: {
        type: string
        content?: string
        fields?: { key: string; value: string; enabled?: boolean }[]
      }
      producedHeaders: { key: string; value: string; enabled?: boolean }[]
      expirationExpression?: string
    }): Promise<{
      success: boolean
      statusCode: number
      error?: string
      headers: Record<string, string>
      responseBody?: string
    }> => {
      const result: unknown = await ipcRenderer.invoke('auth:prefetch', input)
      warnOnOutputMismatch('auth:prefetch', authPrefetchResultSchema, result)
      return result as {
        success: boolean
        statusCode: number
        error?: string
        headers: Record<string, string>
        responseBody?: string
      }
    },
    /** Subscribe to `auth:running` broadcasts. Fires each time the
     * engine begins refreshing an auth request's cached headers and
     * on the subsequent success / failure transition. */
    onRunning: (callback: (payload: { authRequestId: string; phase: 'started' | 'succeeded' | 'failed'; reason?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { authRequestId: string; phase: 'started' | 'succeeded' | 'failed'; reason?: string }): void => {
        callback(data)
      }
      ipcRenderer.on('auth:running', handler)
      return () => { ipcRenderer.removeListener('auth:running', handler) }
    },
    /** Subscribe to `auth:failed` broadcasts — fired in addition to
     * the `auth:running` `phase: 'failed'` transition so listeners
     * that only care about errors can subscribe once. */
    onFailed: (callback: (payload: { authRequestId: string; reason?: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { authRequestId: string; reason?: string }): void => {
        callback(data)
      }
      ipcRenderer.on('auth:failed', handler)
      return () => { ipcRenderer.removeListener('auth:failed', handler) }
    }
  },
  websocket: {
    /** Connect to a WebSocket endpoint */
    connect: async (input: { requestId: string; timeout?: number }): Promise<{
      requestId: string
      success: boolean
      connected: boolean
      messages: { direction: 'sent' | 'received'; data: string; event?: string; timestamp: string }[]
      error?: string
      timings: { startedAt: string; durationMs: number }
      requestUrl?: string
    }> => {
      const result: unknown = await ipcRenderer.invoke('websocket:connect', input)
      warnOnOutputMismatch('websocket:connect', websocketConnectResultSchema, result)
      return result as {
        requestId: string
        success: boolean
        connected: boolean
        messages: { direction: 'sent' | 'received'; data: string; event?: string; timestamp: string }[]
        error?: string
        timings: { startedAt: string; durationMs: number }
        requestUrl?: string
      }
    },
    /** Disconnect from WebSocket */
    disconnect: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('websocket:disconnect', requestId)
      return result as boolean
    },
    /** Send a message on an active WebSocket connection */
    send: async (requestId: string, message: string, event?: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('websocket:send', requestId, message, event)
      return result as boolean
    },
    /** Check if a connection is currently active */
    isActive: async (requestId: string): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('websocket:is-active', requestId)
      return result as boolean
    },
    /** Listen for connection progress updates */
    onProgress: (callback: (data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }): void => {
        callback(data)
      }
      ipcRenderer.on('websocket:connection-progress', handler)
      return () => {
        ipcRenderer.removeListener('websocket:connection-progress', handler)
      }
    },
    /** Listen for incoming messages */
    onMessage: (callback: (data: { requestId: string; message: { direction: 'sent' | 'received'; data: string; event?: string; timestamp: string } }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; message: { direction: 'sent' | 'received'; data: string; event?: string; timestamp: string } }): void => {
        callback(data)
      }
      ipcRenderer.on('websocket:message', handler)
      return () => {
        ipcRenderer.removeListener('websocket:message', handler)
      }
    },
    /** Listen for a hosted server's live connected-client count (server mode). */
    onServerClients: (callback: (data: { requestId: string; count: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { requestId: string; count: number }): void => {
        callback(data)
      }
      ipcRenderer.on('websocket:server-clients', handler)
      return () => {
        ipcRenderer.removeListener('websocket:server-clients', handler)
      }
    }
  },
  responsesHistory: {
    list: async (requestId: string): Promise<unknown> => {
      const result: unknown = await ipcRenderer.invoke('responses:history:list', requestId)
      return result
    },
    get: async (guid: string): Promise<unknown> => {
      const result: unknown = await ipcRenderer.invoke('responses:history:get', guid)
      return result
    },
    togglePin: async (guid: string, pinned: boolean): Promise<boolean> => {
      const result: unknown = await ipcRenderer.invoke('responses:history:toggle-pin', guid, pinned)
      return result as boolean
    }
  },
  requestUsage: {
    /** Fetch the full per-request usage map: count + lastSentAt + last
     * 10 send timestamps, keyed by request id. The EmptyBench ApiCard
     * + RecentActivityCard filter this against the open project's
     * tree to render per-API "Top played" / "Recent" lists. */
    get: async (): Promise<Record<string, { count: number; lastSentAt: string; history: string[] }>> => {
      const result: unknown = await ipcRenderer.invoke('request-usage:get')
      return result as Record<string, { count: number; lastSentAt: string; history: string[] }>
    },
    /** Subscribe to push events fired every time the map mutates
     * (new send recorded, or a request deleted invalidated its
     * entry). The callback receives the fresh full snapshot — no
     * diffing required on the renderer side. */
    onChanged: (
      callback: (map: Record<string, { count: number; lastSentAt: string; history: string[] }>) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        map: Record<string, { count: number; lastSentAt: string; history: string[] }>
      ): void => {
        callback(map)
      }
      ipcRenderer.on('request-usage:changed', handler)
      return () => { ipcRenderer.removeListener('request-usage:changed', handler) }
    }
  },
  scenarioUsage: {
    /** Fetch the full per-scenario usage map: count + lastRunAt + last
     * 10 run timestamps, keyed by scenario id. The EmptyBench recent-activity
     * lists merge this with `requestUsage` so recently-run scenarios show up
     * next to recently-sent requests. */
    get: async (): Promise<Record<string, { count: number; lastRunAt: string; history: string[] }>> => {
      const result: unknown = await ipcRenderer.invoke('scenario-usage:get')
      return result as Record<string, { count: number; lastRunAt: string; history: string[] }>
    },
    /** Subscribe to push events fired every time the map mutates (a new run
     * recorded). The callback receives the fresh full snapshot. */
    onChanged: (
      callback: (map: Record<string, { count: number; lastRunAt: string; history: string[] }>) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        map: Record<string, { count: number; lastRunAt: string; history: string[] }>
      ): void => {
        callback(map)
      }
      ipcRenderer.on('scenario-usage:changed', handler)
      return () => { ipcRenderer.removeListener('scenario-usage:changed', handler) }
    }
  },
  runtime: {
    /** Per-boot runtime config (MCP + GraphQL endpoint). Both ports
     * are picked at startup — the renderer reads them once and caches
     * them for the lifetime of the window. */
    getConfig: async (): Promise<{
      mcp: { enabled: boolean; port: number | null; sessionName: string; running: boolean }
      graphql: { endpoint: string }
    }> => {
      const result: unknown = await ipcRenderer.invoke('runtime:get-config')
      return result as {
        mcp: { enabled: boolean; port: number | null; sessionName: string; running: boolean }
        graphql: { endpoint: string }
      }
    },
    /** Toggle the MCP server on or off at runtime (without restarting).
     * Returns the new state (and the freshly-bound port on resume, `null`
     * when stopped). The user-facing choice is persisted to settings so a
     * restart honours it. */
    toggleServer: async (): Promise<{ running: boolean; port: number | null }> => {
      const result: unknown = await ipcRenderer.invoke('mcp:toggle-server')
      return result as { running: boolean; port: number | null }
    },
    /** Subscribe to MCP server state changes (started / stopped at runtime
     * via the toggle button). The payload carries the freshly-bound port on
     * resume (`null` when stopped) so the indicator can restore its label.
     * Returns an unsubscribe function. */
    onMcpServerStateChanged: (
      callback: (state: { running: boolean; port: number | null }) => void
    ): (() => void) => {
      const handler = (_event: unknown, state: { running: boolean; port: number | null }): void => { callback(state) }
      ipcRenderer.on('mcp:server-state-changed', handler)
      return () => { ipcRenderer.off('mcp:server-state-changed', handler) }
    },
    /** Subscribe to a "ping" emitted on every incoming MCP request
     * (no payload — pure activity signal). Drives the ripple
     * animation on the statusbar MCP indicator. Returns an
     * unsubscribe function. */
    onMcpRequestReceived: (callback: () => void): (() => void) => {
      const handler = (): void => { callback() }
      ipcRenderer.on('mcp:request-received', handler)
      return () => { ipcRenderer.off('mcp:request-received', handler) }
    },
    /** Fetch the served-MCP-call buffer (newest-first) for the logs
     * viewer. Each entry carries the tool name, timestamp, payload and
     * any inline capture. */
    getMcpLogs: async (): Promise<unknown[]> => {
      const result: unknown = await ipcRenderer.invoke('mcp:get-logs')
      return Array.isArray(result) ? (result as unknown[]) : []
    },
    /** Subscribe to served-call buffer changes (a call recorded, the
     * buffer cleared, or trimmed by a cap change) so the viewer can
     * refresh live. Returns an unsubscribe function. */
    onMcpLogsChanged: (callback: () => void): (() => void) => {
      const handler = (): void => { callback() }
      ipcRenderer.on('mcp:logs-changed', handler)
      return () => { ipcRenderer.off('mcp:logs-changed', handler) }
    },
    /** Clear the served-call buffer (the viewer's "clear" action). */
    clearMcpLogs: async (): Promise<void> => {
      await ipcRenderer.invoke('mcp:clear-logs')
    },
    /** Push the active workbench tab to main so MCP tools (`get_current_tab`,
     * `restorm://active-tab`) can read it without a renderer round-trip.
     * Renderer fires this on every active-tab change; main caches it. */
    pushMcpActiveTab: (payload: { tabId: string | null; itemId: string | null; kind: 'request' | 'folder' | 'env-folder' | 'scenario' | null }): void => {
      ipcRenderer.send('mcp:active-tab-changed', payload)
    },
    /** Push a per-env-folder selected-env id. `envId: null` clears the
     * selection — the MCP `get_active_env` tool then falls back to the
     * folder's first env. */
    pushMcpActiveEnv: (payload: { envFolderId: string; envId: string | null }): void => {
      ipcRenderer.send('mcp:active-env-changed', payload)
    },
    /** Push the resolved item-favorites for the active project so the MCP
     * `list_favorites` tool can read them (the favorites store lives in the
     * renderer). Called on mount + whenever favorites change. */
    pushMcpFavorites: (payload: { projectUuid: string | null; favorites: { id: string; name: string; type: string }[] }): void => {
      ipcRenderer.send('mcp:favorites-changed', payload)
    },
    /** Push an open scenario editor's React-Flow-measured node rects (position
     * + size) to main, so the scenario MCP read tools can report box sizes
     * (size isn't persisted in the model). Lets an agent lay out a scenario
     * without overlap, no screenshots needed. */
    pushScenarioLayout: (payload: { scenarioId: string; rects: Record<string, { x: number; y: number; width: number; height: number }> }): void => {
      ipcRenderer.send('scenario:layout', payload)
    },
    /** Run a scenario box (request / wait) through the main-process engine —
     * the same path the MCP `run_scenario_node` tool uses. Resolves with the
     * run summary; rejects (the thrown engine error) on failure / cancel. */
    runScenarioNode: (scenarioId: string, nodeId: string): Promise<unknown> =>
      ipcRenderer.invoke('scenario:run-node', scenarioId, nodeId),
    /** Cancel a box's in-flight run. The awaiting `runScenarioNode` promise
     * then rejects (`wait`) or settles (`request` abort), clearing the run. */
    cancelScenarioNode: (scenarioId: string, nodeId: string): Promise<{ cancelled: boolean; reason?: string }> =>
      ipcRenderer.invoke('scenario:cancel-node', scenarioId, nodeId) as Promise<{ cancelled: boolean; reason?: string }>,
    /** A box's last run result as its output context (resolved request, raw
     * request, response). Null if it hasn't run yet. Feeds the JSON-path
     * selector popover on a data link's receiving input. */
    getScenarioNodeResult: (scenarioId: string, nodeId: string): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke('scenario:node-result', scenarioId, nodeId) as Promise<Record<string, unknown> | null>,
    /** Full-scenario engine (Phase 2): start a run end-to-end. Returns
     * a runId the caller uses for subsequent pause / step / abort. */
    scenarioEngineStart: (scenarioId: string, params?: Record<string, unknown>, startPaused?: boolean, breakpoints?: string[], debug?: boolean): Promise<{ runId: string }> =>
      ipcRenderer.invoke('scenario:engine:start', scenarioId, params, startPaused, breakpoints, debug) as Promise<{ runId: string }>,
    scenarioEnginePause: (runId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('scenario:engine:pause', runId) as Promise<{ ok: boolean }>,
    scenarioEngineResume: (runId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('scenario:engine:resume', runId) as Promise<{ ok: boolean }>,
    scenarioEngineStep: (runId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('scenario:engine:step', runId) as Promise<{ ok: boolean }>,
    scenarioEngineSetDebug: (runId: string, enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('scenario:engine:set-debug', runId, enabled) as Promise<{ ok: boolean }>,
    scenarioEngineSetBreakpoints: (runId: string, ids: string[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('scenario:engine:set-breakpoints', runId, ids) as Promise<{ ok: boolean }>,
    scenarioEngineAbort: (runId: string, reason?: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('scenario:engine:abort', runId, reason) as Promise<{ ok: boolean }>,
    scenarioEngineReadLog: (runId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('scenario:engine:read-log', runId) as Promise<unknown[]>,
    /** The run + every sub-run it launched, each with metadata + log —
     * powers the inspector's run-logs panel (incl. sub-scenario logs). */
    scenarioEngineRunTree: (runId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('scenario:engine:run-tree', runId) as Promise<unknown[]>,
    scenarioEngineResolveUserInput: (runId: string, requestId: string, value: unknown): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('scenario:engine:resolve-user-input', runId, requestId, value) as Promise<{ ok: boolean }>,
    scenarioEngineCancelUserInput: (runId: string, requestId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('scenario:engine:cancel-user-input', runId, requestId) as Promise<{ ok: boolean }>,
    /** Persisted run history (disk archive). `list` returns lightweight
     * entries for a scenario; `detail` the full logs + scenario snapshots;
     * `togglePin` pins/unpins a run so it survives retention pruning. */
    scenarioRunHistoryList: (scenarioId: string): Promise<unknown[]> =>
      ipcRenderer.invoke('scenario:history:list', scenarioId) as Promise<unknown[]>,
    scenarioRunHistoryDetail: (guid: string): Promise<unknown> =>
      ipcRenderer.invoke('scenario:history:detail', guid) as Promise<unknown>,
    scenarioRunHistoryTogglePin: (guid: string, pinned: boolean): Promise<boolean> =>
      ipcRenderer.invoke('scenario:history:toggle-pin', guid, pinned) as Promise<boolean>,
    /** Subscribe to `scenario:toast` broadcasts emitted by the `toast` executor.
     * Each payload carries `{ title, message, level, durationMs?, nodeId }`
     * (`durationMs` omitted → the toast persists until dismissed).
     * Returns an unsubscribe function. */
    onScenarioToast: (callback: (payload: { title: string; message: string; level: string; durationMs?: number; nodeId: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { title: string; message: string; level: string; durationMs?: number; nodeId: string }) }
      ipcRenderer.on('scenario:toast', handler)
      return () => { ipcRenderer.off('scenario:toast', handler) }
    },
    /** Subscribe to engine events (node-started/-completed/data-flow/run-…).
     * Returns an unsubscribe function. The renderer animates the graph
     * + edge beams off these events. */
    onScenarioEngineEvent: (cb: (event: unknown) => void): (() => void) => {
      const handler = (_e: unknown, ev: unknown): void => { cb(ev) }
      ipcRenderer.on('scenario:engine:event', handler)
      return () => { ipcRenderer.off('scenario:engine:event', handler) }
    },
    /** Full-snapshot push fired on renderer (re)load — useful after an
     * HMR cycle so main's cache is always consistent with the renderer. */
    pushMcpActiveStateBootstrap: (payload: {
      tab: { tabId: string | null; itemId: string | null; kind: 'request' | 'folder' | 'env-folder' | 'scenario' | null }
      envByFolder: Record<string, string | null>
    }): void => {
      ipcRenderer.send('mcp:active-state-bootstrap', payload)
    },
    /** Subscribe to MCP `open_tab` requests. Payload `{itemId, kind}`. */
    onMcpOpenTab: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) }
      ipcRenderer.on('mcp:open-tab', handler)
      return () => { ipcRenderer.off('mcp:open-tab', handler) }
    },
    /** Subscribe to MCP `reveal_in_tree` requests. */
    onMcpRevealInTree: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) }
      ipcRenderer.on('mcp:reveal-in-tree', handler)
      return () => { ipcRenderer.off('mcp:reveal-in-tree', handler) }
    },
    /** Subscribe to MCP-driven tree mutations. Payload is the full
     * project tree as plain JSON. The renderer replaces its rootItems
     * after reifying via `makeReactive*`. Used by import / create /
     * rename / delete tools so the user sees mutations immediately
     * without waiting for a save+reload cycle. */
    onMcpTreeReplace: (callback: (payload: unknown) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload) }
      ipcRenderer.on('mcp:tree-replace', handler)
      return () => { ipcRenderer.off('mcp:tree-replace', handler) }
    },
    /** Subscribe to MCP `close_tab` requests. Payload `{itemId, kind}`. */
    onMcpCloseTab: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) }
      ipcRenderer.on('mcp:close-tab', handler)
      return () => { ipcRenderer.off('mcp:close-tab', handler) }
    },
    /** Subscribe to MCP `run_request`. Payload `{itemId}`. The renderer
     * is expected to ensure the request's tab is open + active, then
     * dispatch the same code path the user's Send-button click would
     * (so the response panel + URL bar update naturally + history is
     * stored). Main waits for the history entry to land via polling. */
    onMcpRunRequest: (callback: (payload: { itemId: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string }) }
      ipcRenderer.on('mcp:run-request', handler)
      return () => { ipcRenderer.off('mcp:run-request', handler) }
    },
    /** Subscribe to MCP `update_request`. Payload `{itemId, patch}`. The
     * renderer applies the patch through the reactive request proxy so
     * any open workbench tab repaints in place (caching the request
     * reference at tab mount time means a wholesale tree replacement
     * doesn't update the open editor — direct property assignment via
     * the proxy fires the regular REQUEST_UPDATED chain). */
    onMcpRequestUpdated: (callback: (payload: { itemId: string; patch: Record<string, unknown> }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; patch: Record<string, unknown> }) }
      ipcRenderer.on('mcp:request-updated', handler)
      return () => { ipcRenderer.off('mcp:request-updated', handler) }
    },
    /** Subscribe to MCP scenario mutations (create/update/move/delete node,
     * connect/disconnect). Carries the full nodes + edges so an open editor
     * re-seeds its React Flow state in place (the seed effect otherwise
     * guards against same-id re-seeds to protect in-progress edits). */
    onMcpScenarioUpdated: (callback: (payload: { scenarioId: string; nodes: unknown[]; edges: unknown[]; name?: string; params?: unknown[] }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { scenarioId: string; nodes: unknown[]; edges: unknown[]; name?: string; params?: unknown[] }) }
      ipcRenderer.on('mcp:scenario-updated', handler)
      return () => { ipcRenderer.off('mcp:scenario-updated', handler) }
    },
    /** Subscribe to MCP `update_folder`. Same shape as request-updated
     * but for Folder / EnvironmentFolder. Renderer applies the patch
     * via the reactive folder proxy + bumps the open folder tab's
     * contentVersion so the panel re-derives every field. */
    onMcpFolderUpdated: (callback: (payload: { itemId: string; patch: Record<string, unknown> }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; patch: Record<string, unknown> }) }
      ipcRenderer.on('mcp:folder-updated', handler)
      return () => { ipcRenderer.off('mcp:folder-updated', handler) }
    },
    /** Subscribe to MCP `set_favorite`. Payload `{itemId, favorite|null}`.
     * Renderer toggles the per-project favorites store and bumps the
     * tab content version so the H1 star repaints. */
    onMcpSetFavorite: (callback: (payload: { itemId: string; favorite: boolean | null }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; favorite: boolean | null }) }
      ipcRenderer.on('mcp:set-favorite', handler)
      return () => { ipcRenderer.off('mcp:set-favorite', handler) }
    },
    /** Subscribe to MCP `open_mini_browser`. Payload optionally carries
     * `{ url }` to navigate the Mini browser webview to once the
     * singleton tab is mounted. */
    onMcpOpenMiniBrowser: (callback: (payload: { url?: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback((payload ?? {}) as { url?: string }) }
      ipcRenderer.on(MINI_BROWSER_OPEN_CHANNEL, handler)
      return () => { ipcRenderer.off(MINI_BROWSER_OPEN_CHANNEL, handler) }
    },
    /** Subscribe to MCP `mini_browser_execute`. Payload
     * `{ requestId, code }`. The renderer is expected to run the
     * script inside the Mini browser webview's guest context (via
     * `webview.executeJavaScript`) and reply via
     * `restorm.runtime.replyMiniBrowserExecute({ requestId, result, error })`. */
    onMcpMiniBrowserExecute: (callback: (payload: { requestId: string; code: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { requestId: string; code: string }) }
      ipcRenderer.on(MINI_BROWSER_EXECUTE_CHANNEL, handler)
      return () => { ipcRenderer.off(MINI_BROWSER_EXECUTE_CHANNEL, handler) }
    },
    /** Send the result of a `mini_browser_execute` script back to main.
     * `error` is set when the script threw or the webview wasn't ready. */
    replyMiniBrowserExecute: (payload: { requestId: string; result?: unknown; error?: string }): void => {
      ipcRenderer.send(MINI_BROWSER_EXECUTE_REPLY_CHANNEL, payload)
    },
    /** Subscribe to MCP `open_console` — open / focus the singleton Console tab. */
    onMcpOpenConsole: (callback: () => void): (() => void) => {
      const handler = (): void => { callback() }
      ipcRenderer.on(CONSOLE_OPEN_CHANNEL, handler)
      return () => { ipcRenderer.off(CONSOLE_OPEN_CHANNEL, handler) }
    },
    /** Subscribe to MCP `console_clear` — wipe the renderer-side feed. */
    onMcpConsoleClear: (callback: () => void): (() => void) => {
      const handler = (): void => { callback() }
      ipcRenderer.on(CONSOLE_CLEAR_CHANNEL, handler)
      return () => { ipcRenderer.off(CONSOLE_CLEAR_CHANNEL, handler) }
    },
    /** Subscribe to MCP `open_firewall` — open / focus the singleton Firewall tab. */
    onMcpOpenFirewall: (callback: () => void): (() => void) => {
      const handler = (): void => { callback() }
      ipcRenderer.on('mcp:open-firewall', handler)
      return () => { ipcRenderer.off('mcp:open-firewall', handler) }
    },
    /** Subscribe to MCP `set_tab_maximized` — maximize a workbench tab
     * by id, or restore the maximized tab when `maximized` is false
     * (`tabId` is then `null`). */
    onMcpSetTabMaximized: (callback: (payload: { tabId: string | null; maximized: boolean }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => {
        callback((payload ?? { tabId: null, maximized: false }) as { tabId: string | null; maximized: boolean })
      }
      ipcRenderer.on(SET_TAB_MAXIMIZED_CHANNEL, handler)
      return () => { ipcRenderer.off(SET_TAB_MAXIMIZED_CHANNEL, handler) }
    },
    /** Push the serialized workbench layout to main so the MCP
     * `get_workbench_layout` tool can read it (the live tree is
     * renderer-only). Fired on every tree / focus / maximize change. */
    pushWorkbenchLayout: (layout: unknown): void => {
      ipcRenderer.send('mcp:workbench-layout-changed', layout)
    },
    /** Subscribe to MCP `set_workbench_layout` — reconstruct the editor
     * layout (groups / splits / sashes / tabs) from the broadcast spec. */
    onMcpSetWorkbenchLayout: (callback: (layout: unknown) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload) }
      ipcRenderer.on('mcp:set-workbench-layout', handler)
      return () => { ipcRenderer.off('mcp:set-workbench-layout', handler) }
    }
  },
  import: {
    /** Preview import from file path or URL (dry-run) */
    preview: async (
      input: string,
      options?: { extraHeaders?: Record<string, string> }
    ): Promise<{
      success: boolean
      items: unknown[]
      source: string
      format?: string
      error?: string
      statusCode?: number
      isAuthError?: boolean
    }> => {
      const result: unknown = await ipcRenderer.invoke('import:preview', input, options)
      warnOnOutputMismatch('import:preview', importPreviewResultSchema, result)
      return result as {
        success: boolean
        items: unknown[]
        source: string
        format?: string
        error?: string
        statusCode?: number
        isAuthError?: boolean
      }
    },
    /** Actually import from file path or URL */
    import: async (input: string): Promise<{
      success: boolean
      items: unknown[]
      source: string
      format?: string
      error?: string
    }> => {
      const result: unknown = await ipcRenderer.invoke('import:import', input)
      warnOnOutputMismatch('import:import', importImportResultSchema, result)
      return result as {
        success: boolean
        items: unknown[]
        source: string
        format?: string
        error?: string
      }
    }
  },
  apiUpdate: {
    /** Persist a partial `ApiUpdateConfig` patch onto the folder.
     * The main process writes through CollectionStore + the
     * persistence layer. */
    setSettings: async (folderId: string, config: unknown): Promise<void> => {
      await ipcRenderer.invoke('apiUpdate:set-settings', folderId, config)
    },
    /** Apply the available update against the folder. Resolves
     * once the pipeline has run; rejects on failure so the
     * renderer can surface the toast. Returns a snapshot of the
     * updated env folder so the renderer can swap its own copy
     * (the GraphQL folderUpdated subscription only carries a
     * partial payload — id/name/tags but not the items array). */
    apply: async (folderId: string, selection?: { include: string[]; skip: string[] }): Promise<{ updatedFolder: unknown }> => {
      const result: unknown = await ipcRenderer.invoke('apiUpdate:apply', folderId, selection)
      return result as { updatedFolder: unknown }
    },
    /** Fetch the folder's source URL with `${VAR}`-expanded headers
     * and the resolved auth headers, then return a payload checksum
     * + the raw payload. The renderer's Refresh button compares the
     * checksum against the stored `apiUpdate.payloadChecksum`:
     * equal ⇒ "up to date" modal; different (or fetch errored) ⇒
     * open the Import modal in refresh mode. */
    refreshFetch: async (folderId: string): Promise<
      | { ok: true; checksum: string; payload: string; items: unknown[]; format: string | null }
      | { ok: false; error: string }
    > => {
      const result: unknown = await ipcRenderer.invoke('apiUpdate:refresh-fetch', folderId)
      warnOnOutputMismatch('apiUpdate:refresh-fetch', apiUpdateRefreshFetchResultSchema, result)
      return result as
        | { ok: true; checksum: string; payload: string; items: unknown[]; format: string | null }
        | { ok: false; error: string }
    },
    /** Mirror the renderer's collection tree onto the main-side
     * CollectionStore. The main-side apply / refresh-fetch
     * orchestrators look up folders by id; without this sync they
     * would always fail with "folder not found". Fire-and-forget;
     * the handler doesn't return anything. */
    syncCollections: async (collections: unknown[]): Promise<void> => {
      await ipcRenderer.invoke('collections:sync', collections)
    },
    /** Persist an env-folder's custom value lists onto the main-side
     * CollectionStore. Unlike `syncCollections` (full-tree replace),
     * this targets one folder and routes through `updateFolder`, which
     * re-fires `ENVIRONMENT_UPDATED` so the dispatch resolver re-runs
     * for the folder's open requests — the panel's reactive edits
     * otherwise never reach main (in-place mutation skips the sync
     * memo). */
    updateFolderCustomValueLists: async (folderId: string, lists: unknown[]): Promise<void> => {
      await ipcRenderer.invoke('collections:update-folder-custom-value-lists', folderId, lists)
    }
  }
})
