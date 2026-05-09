import { contextBridge, ipcRenderer, webUtils } from 'electron'
// Import from core-ui preload modules using relative paths
// This works in both dev and prod because:
// - In dev: Vite resolves these imports via aliases in electron.vite.config.ts
// - In prod: These are bundled into the preload script
import { createCoreUIAPI } from '../../../../electron-core-ui/src/preload/api'
import { createElectronAPI } from '../../../../electron-core-ui/src/preload/electronAPI'
import type { PersistenceFormat } from '../../../../electron-core-ui/src/main/services/PersistenceService'
import {
  FIREWALL_IPC,
  FIREWALL_REQUEST_RECORD_CHANNEL,
  type FirewallMode,
  type FirewallPromptPayload,
  type RequestRecord
} from '../../shared/types/firewall'

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
    // Control-plane — Settings → Firewall reads + mutates the
    // PermissionService state through these calls. Persistence is
    // handled main-side; the renderer never touches the on-disk
    // file directly.
    getMode: async (): Promise<FirewallMode> => {
      const result: unknown = await ipcRenderer.invoke(FIREWALL_IPC.GET_MODE)
      return result as FirewallMode
    },
    setMode: async (mode: FirewallMode): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.SET_MODE, mode)
    },
    listAllowlist: async (): Promise<string[]> => {
      const result: unknown = await ipcRenderer.invoke(FIREWALL_IPC.LIST_ALLOWLIST)
      return Array.isArray(result) ? (result as string[]) : []
    },
    addToAllowlist: async (pattern: string): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.ADD_ALLOWLIST, pattern)
    },
    removeFromAllowlist: async (pattern: string): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.REMOVE_ALLOWLIST, pattern)
    },
    onPromptShow: (cb: (payload: FirewallPromptPayload) => void): (() => void) => {
      const handler = (_event: unknown, payload: FirewallPromptPayload): void => { cb(payload) }
      ipcRenderer.on(FIREWALL_IPC.PROMPT_SHOW, handler)
      return (): void => { ipcRenderer.off(FIREWALL_IPC.PROMPT_SHOW, handler) }
    },
    resolvePrompt: async (promptId: string, verdict: 'allow' | 'deny', persist: boolean): Promise<void> => {
      await ipcRenderer.invoke(FIREWALL_IPC.PROMPT_RESOLVE, { promptId, verdict, persist })
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
  protocol?: string
  event?: string
  message?: string
}

/** Save result type */
interface SaveResult {
  success: boolean
  path?: string
  error?: string
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
        headers?: { id?: string; key: string; value: string }[]
        params?: { id?: string; key: string; value: string }[]
        pathParams?: { id?: string; key: string; value: string }[]
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
  runtime: {
    /** Per-boot runtime config (MCP + GraphQL endpoint). Both ports
     * are picked at startup — the renderer reads them once and caches
     * them for the lifetime of the window. */
    getConfig: async (): Promise<{
      mcp: { enabled: boolean; port: number | null }
      graphql: { endpoint: string }
    }> => {
      const result: unknown = await ipcRenderer.invoke('runtime:get-config')
      return result as {
        mcp: { enabled: boolean; port: number | null }
        graphql: { endpoint: string }
      }
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
    /** Push the active workbench tab to main so MCP tools (`get_current_tab`,
     * `restorm://active-tab`) can read it without a renderer round-trip.
     * Renderer fires this on every active-tab change; main caches it. */
    pushMcpActiveTab: (payload: { tabId: string | null; itemId: string | null; kind: 'request' | 'folder' | 'env-folder' | null }): void => {
      ipcRenderer.send('mcp:active-tab-changed', payload)
    },
    /** Push a per-env-folder selected-env id. `envId: null` clears the
     * selection — the MCP `get_active_env` tool then falls back to the
     * folder's first env. */
    pushMcpActiveEnv: (payload: { envFolderId: string; envId: string | null }): void => {
      ipcRenderer.send('mcp:active-env-changed', payload)
    },
    /** Full-snapshot push fired on renderer (re)load — useful after an
     * HMR cycle so main's cache is always consistent with the renderer. */
    pushMcpActiveStateBootstrap: (payload: {
      tab: { tabId: string | null; itemId: string | null; kind: 'request' | 'folder' | 'env-folder' | null }
      envByFolder: Record<string, string | null>
    }): void => {
      ipcRenderer.send('mcp:active-state-bootstrap', payload)
    },
    /** Subscribe to MCP `open_tab` requests. Payload `{itemId, kind}`. */
    onMcpOpenTab: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; kind: 'request' | 'folder' | 'env-folder' }) }
      ipcRenderer.on('mcp:open-tab', handler)
      return () => { ipcRenderer.off('mcp:open-tab', handler) }
    },
    /** Subscribe to MCP `reveal_in_tree` requests. */
    onMcpRevealInTree: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; kind: 'request' | 'folder' | 'env-folder' }) }
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
    onMcpCloseTab: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' }) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown): void => { callback(payload as { itemId: string; kind: 'request' | 'folder' | 'env-folder' }) }
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
      return result as {
        success: boolean
        items: unknown[]
        source: string
        format?: string
        error?: string
      }
    }
  },
  find: {
    /**
     * Trigger Chromium's native in-page find. The Chromium engine
     * paints the yellow highlight directly on the rendered DOM,
     * including any `visibility: hidden` panels — the renderer is
     * responsible for only invoking this while the docs panel is
     * actually visible.
     */
    inPage: async (
      text: string,
      options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }
    ): Promise<{ requestId: number }> => {
      const result: unknown = await ipcRenderer.invoke('find:in-page', text, options)
      return result as { requestId: number }
    },
    /** Stop the active find session. `clearSelection` removes both
     * the search highlight and the selection; `keepSelection` keeps
     * the active match selected; `activateSelection` clicks through
     * (rarely useful in our use case). */
    stop: async (
      action: 'clearSelection' | 'keepSelection' | 'activateSelection'
    ): Promise<{ ok: boolean }> => {
      const result: unknown = await ipcRenderer.invoke('find:stop', action)
      return result as { ok: boolean }
    },
    /** Subscribe to `'found-in-page'` updates forwarded from main.
     * Returns an unsubscribe handle. */
    onResult: (
      callback: (result: {
        requestId: number
        activeMatchOrdinal: number
        matches: number
        finalUpdate: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: unknown,
        result: { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean }
      ): void => { callback(result) }
      ipcRenderer.on('find:result', listener)
      return (): void => { ipcRenderer.removeListener('find:result', listener) }
    }
  },
  apiUpdate: {
    /** Read the current ApiUpdateState for a single folder. */
    getState: async (folderId: string): Promise<unknown> => {
      const result: unknown = await ipcRenderer.invoke('apiUpdate:get-state', folderId)
      return result
    },
    /** One-shot read of every known folder's state. The renderer
     * uses this on mount to populate badges before the first
     * push event arrives. */
    getSnapshot: async (): Promise<Record<string, unknown>> => {
      const result: unknown = await ipcRenderer.invoke('apiUpdate:get-snapshot')
      return result as Record<string, unknown>
    },
    /** Persist a new ApiUpdateConfig onto the folder. The main
     * process writes through CollectionStore + the persistence
     * layer, then re-registers the scheduler so cadence changes
     * take effect immediately. */
    setSettings: async (folderId: string, config: unknown): Promise<void> => {
      await ipcRenderer.invoke('apiUpdate:set-settings', folderId, config)
    },
    /** Force a check ignoring schedule + autoCheckEnabled. Used by
     * the explicit "Check now" button. */
    checkNow: async (folderId: string): Promise<void> => {
      await ipcRenderer.invoke('apiUpdate:check-now', folderId)
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
    /** Compute the diff against the current folder content
     * without mutating it. Used by the "Refresh from source"
     * confirmation dialog to surface counters before commit. */
    preview: async (folderId: string): Promise<unknown> => {
      const result: unknown = await ipcRenderer.invoke('apiUpdate:preview', folderId)
      return result
    },
    /** Resolve the env folder's auth route + fetch the source URL +
     * run the format adapter, all main-side, and return the parsed
     * preview tree (same shape as `import.preview`). The refresh
     * variant of the import modal calls this instead of running
     * `auth.prefetch` + `import.preview` itself, so `{{var}}`
     * placeholders inside the saved auth route can be resolved
     * against the env folder's first environment. The optional
     * `lockedKeys` array marks leaves whose operation is already
     * present in the target folder; the modal pre-ticks them and
     * disables their checkbox so the user can't opt them out. */
    previewTree: async (folderId: string): Promise<{ success: boolean; items: unknown[]; lockedKeys?: string[]; error?: string }> => {
      const result: unknown = await ipcRenderer.invoke('apiUpdate:preview-tree', folderId)
      return result as { success: boolean; items: unknown[]; lockedKeys?: string[]; error?: string }
    },
    /** Acknowledge an "available" notification for the rest of the
     * session. The badge stays; only the toast suppression flips. */
    dismiss: async (folderId: string): Promise<void> => {
      await ipcRenderer.invoke('apiUpdate:dismiss', folderId)
    },
    /** Subscribe to state transitions for every folder. */
    onStateChanged: (callback: (data: { folderId: string; state: unknown }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { folderId: string; state: unknown }): void => {
        callback(data)
      }
      ipcRenderer.on('apiUpdate:state-changed', handler)
      return () => {
        ipcRenderer.removeListener('apiUpdate:state-changed', handler)
      }
    },
    /** Mirror the renderer's collection tree onto the main-side
     * CollectionStore. The main-side apply / preview orchestrators
     * look up folders by id; without this sync they would always
     * fail with "folder not found". Fire-and-forget; the handler
     * doesn't return anything. */
    syncCollections: async (collections: unknown[]): Promise<void> => {
      await ipcRenderer.invoke('collections:sync', collections)
    }
  }
})
