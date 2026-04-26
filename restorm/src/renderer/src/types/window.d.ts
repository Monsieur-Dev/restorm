/**
 * Type declarations for window.restorm API
 */

import type { ResponseHistoryDetail, ResponseHistoryEntry } from '../../../shared/types/collections'

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
        clearDrafts: () => Promise<{ success: boolean; error?: string }>
      }
      secrets: {
        read: (filePath: string) => Promise<string | null>
        write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
      }
      forceClose: () => Promise<void>
      onSaveAndClose: (callback: () => void) => () => void
      request: {
        resolveURL: (input: unknown) => Promise<unknown>
      }
      context: {
        getAllTransformResults: () => Promise<Record<string, unknown>>
        getEnvironmentContext: (environmentId: string) => Promise<Record<string, string>>
        onEnvironmentContextChanged: (callback: (result: { environmentId: string; context: Record<string, string> }) => void) => () => void
        onVariableTransformed: (callback: (result: unknown) => void) => () => void
        registerRequest: (requestId: string, environmentId: string | null, requestData: unknown) => Promise<void>
        unregisterRequest: (requestId: string) => Promise<void>
        setRequestEnvironment: (requestId: string, environmentId: string | null) => Promise<void>
        setAvailableEnvironments: (requestId: string, environmentIds: string[]) => Promise<void>
        updateRequestKeyValues: (requestId: string, groupName: string, keyValues: unknown[], sourceId?: string) => Promise<void>
        updateFullRequestData: (requestId: string, data: unknown, sourceId?: string) => Promise<void>
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
      graphqlApi: {
        query: (query: string, variables?: Record<string, unknown>) => Promise<unknown>
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
      responsesHistory: {
        list: (requestId: string) => Promise<ResponseHistoryEntry[]>
        get: (guid: string) => Promise<ResponseHistoryDetail | null>
        updatePath: (requestId: string, requestPath: string) => Promise<boolean>
        togglePin: (guid: string, pinned: boolean) => Promise<boolean>
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
      docs: {
        compileForRoute: (
          apiDoc: unknown,
          route: {
            type: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
            url?: string
            method?: string
            operationType?: string
            query?: string
            service?: string
            rpcMethod?: string
            soapAction?: string
            operation?: string
            event?: string
            protocol?: string
            tags?: string[]
          }
        ) => Promise<{ matched: boolean; markdown: string; operationId?: string; error?: string }>
        compileRoot: (apiDoc: unknown) => Promise<{ markdown: string; error?: string }>
      }
    }
  }
}

export {}
