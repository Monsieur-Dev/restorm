import { contextBridge, ipcRenderer } from 'electron'
// Import from core-ui preload modules using relative paths
// This works in both dev and prod because:
// - In dev: Vite resolves these imports via aliases in electron.vite.config.ts
// - In prod: These are bundled into the preload script
import { createCoreUIAPI } from '../../../../electron-core-ui/src/preload/api'
import { createElectronAPI } from '../../../../electron-core-ui/src/preload/electronAPI'
import type { PersistenceFormat } from '../../../../electron-core-ui/src/main/services/PersistenceService'

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
}

/** Code snippets result from context service */
interface CodeSnippetsResult {
  requestId: string
  markdown: string
}

/** Available variables for autocompletion (per field) */
interface AvailableVariablesResult {
  variableId: string
  variables: { name: string; value: string }[]
}

/** Full request data for backend processing */
interface FullRequestData {
  id: string
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
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
  context: {
    /** Get all variable transformation results */
    getAllTransformResults: async (): Promise<Record<string, VariableTransformResult>> => {
      const result: unknown = await ipcRenderer.invoke('context:get-all-transform-results')
      return result as Record<string, VariableTransformResult>
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
    /** Update KeyValues for a request (headers, params, etc.) */
    updateRequestKeyValues: async (
      requestId: string,
      groupName: string,
      keyValues: { id?: string; key: string; value: string; enabled?: boolean }[]
    ): Promise<void> => {
      await ipcRenderer.invoke('context:update-request-keyvalues', requestId, groupName, keyValues)
    },
    /** Update full request data for URL resolution and code snippet generation */
    updateFullRequestData: async (requestId: string, data: FullRequestData): Promise<void> => {
      await ipcRenderer.invoke('context:update-full-request-data', requestId, data)
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
    execute: async (input: { requestId: string; method: string; timeout?: number }): Promise<{
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
  import: {
    /** Preview import from file path or URL (dry-run) */
    preview: async (input: string): Promise<{
      success: boolean
      items: unknown[]
      source: string
      format?: string
      error?: string
    }> => {
      const result: unknown = await ipcRenderer.invoke('import:preview', input)
      return result as {
        success: boolean
        items: unknown[]
        source: string
        format?: string
        error?: string
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
  }
})
