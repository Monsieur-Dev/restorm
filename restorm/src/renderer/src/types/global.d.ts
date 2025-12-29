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
        updateFullRequestData: (requestId: string, data: Partial<FullRequestData>) => Promise<void>
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
      graphql: {
        execute: (input: GraphQLExecutionInput) => Promise<GraphQLExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
      }
      soap: {
        execute: (input: SOAPExecutionInput) => Promise<SOAPExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
      }
      grpc: {
        execute: (input: GRPCExecutionInput) => Promise<GRPCExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
      }
      websocket: {
        connect: (input: WebSocketExecutionInput) => Promise<WebSocketExecutionResult>
        disconnect: (requestId: string) => Promise<boolean>
        send: (requestId: string, message: string, event?: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        onMessage: (callback: (data: WebSocketMessageData) => void) => (() => void)
      }
    }
  }
}

/** KeyValue data for context service */
export interface KeyValueData {
  id?: string | undefined
  key: string
  value: string
  /** Whether this key-value is enabled (default: true) */
  enabled?: boolean
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
  variables: { name: string; value: string }[]
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

/** Generic request progress data */
export interface RequestProgressData {
  requestId: string
  status: 'started' | 'completed' | 'cancelled' | 'error'
}

/** GraphQL execution input */
export interface GraphQLExecutionInput {
  requestId: string
  timeout?: number
}

/** GraphQL execution result */
export interface GraphQLExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  data?: unknown
  errors?: { message: string; locations?: { line: number; column: number }[]; path?: string[] }[]
  headers?: Record<string, string | string[]>
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** SOAP execution input */
export interface SOAPExecutionInput {
  requestId: string
  timeout?: number
}

/** SOAP execution result */
export interface SOAPExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  responseBody?: string
  headers?: Record<string, string | string[]>
  fault?: { code: string; message: string }
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** gRPC execution input */
export interface GRPCExecutionInput {
  requestId: string
  timeout?: number
}

/** gRPC execution result */
export interface GRPCExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  statusMessage?: string
  responseMessage?: string
  metadata?: Record<string, string>
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  requestMethod?: string
}

/** WebSocket execution input */
export interface WebSocketExecutionInput {
  requestId: string
  timeout?: number
}

/** WebSocket message */
export interface WebSocketMessageItem {
  direction: 'sent' | 'received'
  data: string
  event?: string
  timestamp: string
}

/** WebSocket execution result */
export interface WebSocketExecutionResult {
  requestId: string
  success: boolean
  connected: boolean
  messages: WebSocketMessageItem[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** WebSocket message data for streaming */
export interface WebSocketMessageData {
  requestId: string
  message: WebSocketMessageItem
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
