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
      miniBrowser: {
        create: (tabId: string, initialUrl?: string) => Promise<{ ok: boolean }>
        destroy: (tabId: string) => Promise<{ ok: boolean }>
        setBounds: (tabId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok: boolean }>
        navigate: (tabId: string, url: string) => Promise<{ ok: boolean }>
        reload: (tabId: string) => Promise<{ ok: boolean }>
        goBack: (tabId: string) => Promise<{ ok: boolean }>
        goForward: (tabId: string) => Promise<{ ok: boolean }>
        getState: (tabId: string) => Promise<{ url: string; canGoBack: boolean; canGoForward: boolean } | null>
        capture: (tabId: string) => Promise<string | null>
        onDidNavigate: (callback: (result: { tabId: string; url: string }) => void) => () => void
        onDidStopLoading: (callback: (result: { tabId: string; canGoBack: boolean; canGoForward: boolean }) => void) => () => void
        onUserInteraction: (callback: (result: { tabId: string }) => void) => () => void
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
        togglePin: (guid: string, pinned: boolean) => Promise<boolean>
      }
      requestUsage: {
        get: () => Promise<Record<string, { count: number; lastSentAt: string; history: string[] }>>
        onChanged: (
          callback: (map: Record<string, { count: number; lastSentAt: string; history: string[] }>) => void
        ) => () => void
      }
      runtime: {
        getConfig: () => Promise<{
          mcp: { enabled: boolean; port: number | null }
          graphql: { endpoint: string }
        }>
        onMcpRequestReceived: (callback: () => void) => () => void
        pushMcpActiveTab: (payload: { tabId: string | null; itemId: string | null; kind: 'request' | 'folder' | 'env-folder' | null }) => void
        pushMcpActiveEnv: (payload: { envFolderId: string; envId: string | null }) => void
        pushMcpFavorites: (payload: { projectUuid: string | null; favorites: { id: string; name: string; type: string }[] }) => void
        pushScenarioLayout: (payload: { scenarioId: string; rects: Record<string, { x: number; y: number; width: number; height: number }> }) => void
        runScenarioNode: (scenarioId: string, nodeId: string) => Promise<unknown>
        cancelScenarioNode: (scenarioId: string, nodeId: string) => Promise<{ cancelled: boolean; reason?: string }>
        getScenarioNodeResult: (scenarioId: string, nodeId: string) => Promise<Record<string, unknown> | null>
        pushMcpActiveStateBootstrap: (payload: {
          tab: { tabId: string | null; itemId: string | null; kind: 'request' | 'folder' | 'env-folder' | null }
          envByFolder: Record<string, string | null>
        }) => void
        onMcpOpenTab: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) => void) => () => void
        onMcpRevealInTree: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) => void) => () => void
        onMcpTreeReplace: (callback: (payload: unknown) => void) => () => void
        onMcpCloseTab: (callback: (payload: { itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) => void) => () => void
        onMcpRunRequest: (callback: (payload: { itemId: string }) => void) => () => void
        onMcpRequestUpdated: (callback: (payload: { itemId: string; patch: Record<string, unknown> }) => void) => () => void
        onMcpScenarioUpdated: (callback: (payload: { scenarioId: string; nodes: unknown[]; edges: unknown[]; name?: string; params?: unknown[] }) => void) => () => void
        onMcpFolderUpdated: (callback: (payload: { itemId: string; patch: Record<string, unknown> }) => void) => () => void
        onMcpSetFavorite: (callback: (payload: { itemId: string; favorite: boolean | null }) => void) => () => void
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
