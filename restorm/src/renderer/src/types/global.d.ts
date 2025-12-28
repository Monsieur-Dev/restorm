import type { ThemeInfo, ThemeDefinition, ThemeVariables } from 'electron-core-ui/types'

declare global {
  interface Window {
    api: {
      platform: NodeJS.Platform
      theme: {
        list: () => Promise<ThemeInfo[]>
        load: (themeId: string) => Promise<{ theme: ThemeDefinition; variables: ThemeVariables } | null>
        getCurrent: () => Promise<string | undefined>
        set: (themeId: string) => Promise<boolean>
        updateWCO: (colors: { backgroundColor: string; symbolColor: string }) => Promise<boolean>
        onThemeChanged: (callback: (themeId: string) => void) => (() => void)
      }
      logger: {
        log: (level: string, message: string, meta?: Record<string, unknown>) => Promise<void>
      }
      minimizeWindow: () => Promise<void>
      maximizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>
      toggleDeveloperTools: () => Promise<void>
      setWindowTitle: (title: string) => Promise<void>
      getWindowIcon: () => Promise<string | undefined>
      // Tabs aux-window helpers
      getCursorScreenPoint: () => Promise<{ x: number; y: number; display?: { x: number; y: number; width: number; height: number } }>
      getActiveWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
      getCurrentWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number; windowId: number }>
      createAuxWindow: (payload: { editorId: string; title: string }, bounds: { x: number; y: number; width?: number; height?: number }) => Promise<void>
      getWindowUnderCursor: () => Promise<{ windowId: number; bounds: { x: number; y: number; width: number; height: number } } | null>
      sendWorkbenchTabToWindow: (targetWindowId: number, tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => Promise<boolean>
      onWorkbenchTabDropped: (callback: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => void) => (() => void)
      project: {
        listFiles: () => Promise<{ path: string; isDirectory: boolean }[]>
        readFile: (filePath: string) => Promise<string>
      }
    }
    restorm: {
      openEditor: (file?: { title: string; content?: string; x?: number; y?: number }) => Promise<void>
      getEditorFile: () => Promise<{ title: string; content?: string } | undefined>
      forceClose: () => Promise<void>
      onSaveAndClose: (callback: () => void) => (() => void)
      context: {
        getAllTransformResults: () => Promise<Record<string, VariableTransformResult>>
        onVariableTransformed: (callback: (result: VariableTransformResult) => void) => (() => void)
        registerRequest: (
          requestId: string,
          environmentId: string | null,
          requestData: {
            headers?: KeyValueData[]
            params?: KeyValueData[]
            pathParams?: KeyValueData[]
          }
        ) => Promise<void>
        unregisterRequest: (requestId: string) => Promise<void>
        setRequestEnvironment: (requestId: string, environmentId: string | null) => Promise<void>
        updateRequestKeyValues: (requestId: string, groupName: string, keyValues: KeyValueData[]) => Promise<void>
        updateFullRequestData: (requestId: string, data: FullRequestData) => Promise<void>
        getResolvedUrl: (requestId: string) => Promise<ResolvedUrlResult | undefined>
        getCodeSnippets: (requestId: string) => Promise<CodeSnippetsResult | undefined>
        onUrlResolved: (callback: (result: ResolvedUrlResult) => void) => (() => void)
        onCodeSnippetsUpdated: (callback: (result: CodeSnippetsResult) => void) => (() => void)
        onAvailableVariables: (callback: (result: AvailableVariablesResult) => void) => (() => void)
        clearAll: () => Promise<void>
      }
      http: {
        execute: (input: HTTPExecutionInput) => Promise<HTTPExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: HTTPProgressData) => void) => (() => void)
      }
    }
  }
}

/** KeyValue data for context service */
export interface KeyValueData {
  id?: string | undefined
  key: string
  value: string
}

/** Variable transformation result from context service */
export interface VariableTransformResult {
  variableId: string
  contextUsed: Record<string, string>
  transformedValue: string
  rawValue: string
  key: string
}

/** Resolved URL result from context service */
export interface ResolvedUrlResult {
  requestId: string
  resolvedUrl: string
  baseUrl: string
  queryString: string
}

/** Code snippets result from context service */
export interface CodeSnippetsResult {
  requestId: string
  markdown: string
}

/** Available variables result for autocompletion (per field) */
export interface AvailableVariablesResult {
  variableId: string
  variables: Array<{ name: string; value: string }>
}

/** HTTP execution input for backend */
export interface HTTPExecutionInput {
  requestId: string
  method: string
  timeout?: number
}

/** HTTP execution result from backend */
export interface HTTPExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  statusText?: string
  headers?: Record<string, string | string[]>
  body?: string
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** HTTP progress data */
export interface HTTPProgressData {
  requestId: string
  status: 'started' | 'completed' | 'cancelled' | 'error'
}

/** Full request data for backend processing */
export interface FullRequestData {
  id: string
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
  url: string
  headers: KeyValueData[]
  method?: string | undefined
  params?: KeyValueData[] | undefined
  pathParams?: KeyValueData[] | undefined
  body?: { type: string; content?: string | undefined; path?: string | undefined; fields?: KeyValueData[] | undefined } | undefined
  operationType?: string | undefined
  query?: string | undefined
  variables?: string | undefined
  service?: string | undefined
  grpcMethod?: string | undefined
  callType?: string | undefined
  requestMessage?: string | undefined
  metadata?: KeyValueData[] | undefined
  soapAction?: string | undefined
  soapService?: string | undefined
  operation?: string | undefined
  soapBody?: string | undefined
  protocol?: string | undefined
  event?: string | undefined
  message?: string | undefined
}

export {}
