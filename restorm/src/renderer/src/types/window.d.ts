/**
 * Type declarations for window.restorm API
 */

declare global {
  interface Window {
    restorm?: {
      openEditor: (file?: { title: string; content?: string; x?: number; y?: number }) => Promise<void>
      getEditorFile: () => Promise<{ title: string; content?: string } | undefined>
      file: {
        saveAsFile: (data: unknown, format: unknown) => Promise<{ success: boolean; path?: string; error?: string }>
        saveAsFolder: (data: unknown, format: unknown, targetPath?: string) => Promise<{ success: boolean; path?: string; error?: string }>
        openFolder: () => Promise<{ success: boolean; content?: unknown; path?: string; format?: unknown }>
        showFolderDialog: () => Promise<{ canceled: boolean; filePath?: string }>
        openPath: (path: string) => Promise<{ success: boolean; isDirectory?: boolean; content?: unknown; path?: string; format?: unknown }>
      }
      forceClose: () => Promise<void>
      onSaveAndClose: (callback: () => void) => () => void
      request: {
        resolveURL: (input: unknown) => Promise<unknown>
      }
      context: {
        getAllTransformResults: () => Promise<Record<string, unknown>>
        onVariableTransformed: (callback: (result: unknown) => void) => () => void
        registerRequest: (requestId: string, environmentId: string | null, requestData: unknown) => Promise<void>
        unregisterRequest: (requestId: string) => Promise<void>
        setRequestEnvironment: (requestId: string, environmentId: string | null) => Promise<void>
        updateRequestKeyValues: (requestId: string, groupName: string, keyValues: unknown[]) => Promise<void>
        updateFullRequestData: (requestId: string, data: unknown) => Promise<void>
        getResolvedUrl: (requestId: string) => Promise<unknown>
        getCodeSnippets: (requestId: string) => Promise<unknown>
        onUrlResolved: (callback: (result: unknown) => void) => () => void
        onCodeSnippetsUpdated: (callback: (result: unknown) => void) => () => void
        onAvailableVariables: (callback: (result: unknown) => void) => () => void
        clearAll: () => Promise<void>
      }
      http: {
        execute: (input: unknown) => Promise<unknown>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: unknown) => void) => () => void
      }
      graphql: {
        execute: (input: unknown) => Promise<unknown>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: unknown) => void) => () => void
      }
      soap: {
        execute: (input: unknown) => Promise<unknown>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: unknown) => void) => () => void
      }
      grpc: {
        execute: (input: unknown) => Promise<unknown>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: unknown) => void) => () => void
      }
      websocket: {
        connect: (input: unknown) => Promise<unknown>
        disconnect: (requestId: string) => Promise<boolean>
        send: (requestId: string, message: string, event?: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: unknown) => void) => () => void
        onMessage: (callback: (data: unknown) => void) => () => void
      }
      import: {
        preview: (input: string) => Promise<{
          success: boolean
          items: unknown[]
          source: string
          format?: string
          error?: string
        }>
        import: (input: string) => Promise<{
          success: boolean
          items: unknown[]
          source: string
          format?: string
          error?: string
        }>
      }
    }
  }
}

export {}
