import type { ThemeInfo, ThemeDefinition, ThemeVariables } from 'electron-core-ui/types'
import type { SettingValue, ResolvedSetting, SettingsGroup } from 'electron-core-ui/types'
import type { PersistenceFormat } from 'electron-core-ui/main'
import type { ResponseHistoryDetail, ResponseHistoryEntry } from '../../../shared/types/collections'

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
      storage: {
        get: (key: string) => Promise<unknown>
        set: (key: string, value: unknown) => Promise<boolean>
        delete: (key: string) => Promise<boolean>
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
      settings: {
        get: (storageKey: string) => Promise<SettingValue | null>
        set: (storageKey: string, value: SettingValue) => Promise<boolean>
        getAll: () => Promise<ResolvedSetting[]>
        getGroups: () => Promise<SettingsGroup[]>
        getRenderers: () => Promise<Record<string, string>>
        search: (query: string) => Promise<ResolvedSetting[]>
        reset: (storageKey: string) => Promise<boolean>
        reindex: () => Promise<void>
        onSettingChanged: (callback: (storageKey: string, value: SettingValue) => void) => () => void
      }
      project: {
        listFiles: () => Promise<{ path: string; isDirectory: boolean }[]>
        readFile: (filePath: string) => Promise<string>
      }
      file: {
        onAutoSaveTrigger: (callback: () => void) => () => void
      }
      firewall: {
        onRecord: (cb: (record: unknown) => void) => () => void
        listWhitelist: () => Promise<unknown[]>
        addToWhitelist: (origin: unknown) => Promise<void>
        removeFromWhitelist: (origin: unknown) => Promise<void>
        listBlacklist: () => Promise<unknown[]>
        addToBlacklist: (origin: unknown) => Promise<void>
        removeFromBlacklist: (origin: unknown) => Promise<void>
        setProjectOrigins: (origins: unknown[]) => Promise<void>
        onPromptShow: (cb: (payload: unknown) => void) => () => void
        resolvePrompt: (promptId: string, verdict: 'allow' | 'deny') => Promise<void>
      }
    }
    // Mirrors the preload's createElectronAPI() surface. Keep in sync with
    // electron-core-ui/src/preload/electronAPI.ts.
    electronAPI?: {
      onPlatform: (callback: (platform: string) => void) => () => void
      onWindowState: (callback: (state: string) => void) => () => void
      sendAction: (action: string) => void
      onKeyboardShortcut: (callback: (shortcut: string) => void) => () => void
      registerInterceptedShortcuts: (shortcuts: string[]) => void
      isDevMode: () => Promise<boolean>
      notifyReady: () => void
    }
    restorm?: {
      openEditor: (file?: { title: string; content?: string; x?: number; y?: number }) => Promise<void>
      getEditorFile: () => Promise<{ title: string; content?: string } | undefined>
      file: {
        saveAsFile: (data: unknown, format: PersistenceFormat) => Promise<SaveResult>
        saveAsFolder: (data: unknown, format: PersistenceFormat, targetPath?: string) => Promise<SaveResult>
        openFolder: () => Promise<{ success: boolean; content?: unknown; path?: string; format?: PersistenceFormat }>
        showFolderDialog: () => Promise<{ canceled: boolean; filePath?: string }>
        openPath: (path: string) => Promise<{ success: boolean; isDirectory?: boolean; content?: unknown; path?: string; format?: PersistenceFormat }>
        clearDrafts: () => Promise<{ success: boolean; error?: string }>
        getPathForFile: (file: File) => string
      }
      secrets: {
        read: (filePath: string) => Promise<string | null>
        write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
        invalidate: (args: { source: string; params: Record<string, unknown>; scopeId?: string }) => Promise<{ success: boolean }>
        resolve: (args: { source: string; params: Record<string, unknown> }) => Promise<{ value?: string; error?: string }>
        refresh: (args: { source: string; params: Record<string, unknown> }) => Promise<{ success: boolean }>
      }
      forceClose: () => Promise<void>
      onSaveAndClose: (callback: () => void) => (() => void)
      request: {
        resolveURL: (input: unknown) => Promise<unknown>
      }
      context: {
        getAllTransformResults: () => Promise<Record<string, VariableTransformResult>>
        getEnvironmentContext: (environmentId: string) => Promise<Record<string, string>>
        onEnvironmentContextChanged: (callback: (result: { environmentId: string; context: Record<string, string> }) => void) => (() => void)
        getResolvingEnvironments: () => Promise<string[]>
        onEnvSecretsResolving: (callback: (result: { environmentId: string; resolving: boolean }) => void) => (() => void)
        getErroredEnvironments: () => Promise<string[]>
        onEnvSecretsError: (callback: (result: { environmentId: string; hasError: boolean }) => void) => (() => void)
        getItemSecretStatuses: () => Promise<{ itemId: string; resolving: boolean; error: boolean }[]>
        onItemSecretsStatus: (callback: (result: { itemId: string; resolving: boolean; error: boolean }) => void) => (() => void)
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
        setAvailableEnvironments: (requestId: string, environmentIds: string[]) => Promise<void>
        updateRequestKeyValues: (requestId: string, groupName: string, keyValues: KeyValueData[], sourceId?: string) => Promise<void>
        updateFullRequestData: (requestId: string, data: Partial<FullRequestData>, sourceId?: string) => Promise<void>
        getResolvedUrl: (requestId: string) => Promise<ResolvedUrlResult | undefined>
        getCodeSnippets: (requestId: string) => Promise<CodeSnippetsResult | undefined>
        onUrlResolved: (callback: (result: ResolvedUrlResult) => void) => (() => void)
        onCodeSnippetsUpdated: (callback: (result: CodeSnippetsResult) => void) => (() => void)
        onAvailableVariables: (callback: (result: AvailableVariablesResult) => void) => (() => void)
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
        onDidNavigate: (callback: (result: { tabId: string; url: string }) => void) => (() => void)
        onDidStopLoading: (callback: (result: { tabId: string; canGoBack: boolean; canGoForward: boolean }) => void) => (() => void)
        onUserInteraction: (callback: (result: { tabId: string }) => void) => (() => void)
      }
      http: {
        execute: (input: HTTPExecutionInput) => Promise<HTTPExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: HTTPProgressData) => void) => (() => void)
        /** SERVER MODE: start hosting this request as a local HTTP mock server. */
        listen: (requestId: string) => Promise<{ success: boolean; listening: boolean; error?: string }>
        /** SERVER MODE: stop hosting this request's HTTP mock route. */
        stop: (requestId: string) => Promise<boolean>
        /** SERVER MODE: whether this request is currently hosting a mock route. */
        isListening: (requestId: string) => Promise<boolean>
        /** SERVER MODE: served-request count updates for the "served N" banner. */
        onServerServed: (callback: (data: { requestId: string; count: number }) => void) => (() => void)
      }
      graphql: {
        execute: (input: GraphQLExecutionInput) => Promise<GraphQLExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
      }
      graphqlApi: {
        query: (query: string, variables?: Record<string, unknown>) => Promise<unknown>
      }
      soap: {
        execute: (input: SOAPExecutionInput) => Promise<SOAPExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
      }
      grpc: {
        execute: (input: GRPCExecutionInput) => Promise<GRPCExecutionResult>
        connect: (input: GRPCExecutionInput) => Promise<{ started: boolean }>
        send: (requestId: string, message: string) => Promise<boolean>
        disconnect: (requestId: string) => Promise<boolean>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        onMessage: (callback: (data: GrpcMessageData) => void) => (() => void)
      }
      websocket: {
        connect: (input: WebSocketExecutionInput) => Promise<WebSocketExecutionResult>
        disconnect: (requestId: string) => Promise<boolean>
        send: (requestId: string, message: string, event?: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        onMessage: (callback: (data: WebSocketMessageData) => void) => (() => void)
        onServerClients: (callback: (data: { requestId: string; count: number }) => void) => (() => void)
      }
      odata: {
        execute: (input: ODataExecutionInput) => Promise<HTTPExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
      }
      auth: {
        prefetch: (input: {
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
        }) => Promise<{
          success: boolean
          statusCode: number
          error?: string
          headers: Record<string, string>
          responseBody?: string
        }>
        onRunning: (callback: (payload: { authRequestId: string; phase: 'started' | 'succeeded' | 'failed'; reason?: string }) => void) => (() => void)
        onFailed: (callback: (payload: { authRequestId: string; reason?: string }) => void) => (() => void)
      }
      import: {
        preview: (input: string, options?: { extraHeaders?: Record<string, string> }) => Promise<{
          success: boolean
          items: unknown[]
          source: string
          format?: string
          error?: string
          statusCode?: number
          isAuthError?: boolean
        }>
        import: (input: string) => Promise<{
          success: boolean
          items: unknown[]
          source: string
          format?: string
          error?: string
        }>
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
      scenarioUsage: {
        get: () => Promise<Record<string, { count: number; lastRunAt: string; history: string[] }>>
        onChanged: (
          callback: (map: Record<string, { count: number; lastRunAt: string; history: string[] }>) => void
        ) => () => void
      }
      // API-update / refresh pipeline (mirrors the preload `apiUpdate` surface).
      // Keep in sync with src/main/preload/index.ts.
      apiUpdate: {
        setSettings: (folderId: string, config: unknown) => Promise<void>
        apply: (folderId: string, selection?: { include: string[]; skip: string[] }) => Promise<{ updatedFolder: unknown }>
        refreshFetch: (folderId: string) => Promise<
          | { ok: true; checksum: string; payload: string; items: unknown[]; format: string | null }
          | { ok: false; error: string }
        >
        syncCollections: (collections: unknown[]) => Promise<void>
        updateFolderCustomValueLists: (folderId: string, lists: unknown[]) => Promise<void>
      }
      runtime: {
        getConfig: () => Promise<{
          mcp: { enabled: boolean; port: number | null; sessionName: string }
          graphql: { endpoint: string }
        }>
        onMcpRequestReceived: (callback: () => void) => () => void
        getMcpLogs: () => Promise<unknown[]>
        onMcpLogsChanged: (callback: () => void) => () => void
        clearMcpLogs: () => Promise<void>
        pushMcpActiveTab: (payload: { tabId: string | null; itemId: string | null; kind: 'request' | 'folder' | 'env-folder' | 'scenario' | null }) => void
        pushMcpActiveEnv: (payload: { envFolderId: string; envId: string | null }) => void
        pushMcpFavorites: (payload: { projectUuid: string | null; favorites: { id: string; name: string; type: string }[] }) => void
        pushScenarioLayout: (payload: { scenarioId: string; rects: Record<string, { x: number; y: number; width: number; height: number }> }) => void
        runScenarioNode: (scenarioId: string, nodeId: string) => Promise<unknown>
        cancelScenarioNode: (scenarioId: string, nodeId: string) => Promise<{ cancelled: boolean; reason?: string }>
        getScenarioNodeResult: (scenarioId: string, nodeId: string) => Promise<Record<string, unknown> | null>
        scenarioEngineStart: (scenarioId: string, params?: Record<string, unknown>, startPaused?: boolean, breakpoints?: string[], debug?: boolean) => Promise<{ runId: string }>
        scenarioEnginePause: (runId: string) => Promise<{ ok: boolean }>
        scenarioEngineResume: (runId: string) => Promise<{ ok: boolean }>
        scenarioEngineStep: (runId: string) => Promise<{ ok: boolean }>
        scenarioEngineSetDebug: (runId: string, enabled: boolean) => Promise<{ ok: boolean }>
        scenarioEngineSetBreakpoints: (runId: string, ids: string[]) => Promise<{ ok: boolean }>
        scenarioEngineAbort: (runId: string, reason?: string) => Promise<{ ok: boolean }>
        scenarioEngineReadLog: (runId: string) => Promise<unknown[]>
        scenarioEngineRunTree: (runId: string) => Promise<unknown[]>
        scenarioEngineResolveUserInput: (runId: string, requestId: string, value: unknown) => Promise<{ ok: boolean }>
        scenarioEngineCancelUserInput: (runId: string, requestId: string) => Promise<{ ok: boolean }>
        scenarioRunHistoryList: (scenarioId: string) => Promise<unknown[]>
        scenarioRunHistoryDetail: (guid: string) => Promise<unknown>
        scenarioRunHistoryTogglePin: (guid: string, pinned: boolean) => Promise<boolean>
        onScenarioToast: (callback: (payload: { title: string; message: string; level: string; durationMs?: number; nodeId: string }) => void) => () => void
        onScenarioEngineEvent: (cb: (event: unknown) => void) => () => void
        pushMcpActiveStateBootstrap: (payload: {
          tab: { tabId: string | null; itemId: string | null; kind: 'request' | 'folder' | 'env-folder' | 'scenario' | null }
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
        onMcpOpenMiniBrowser: (callback: (payload: { url?: string }) => void) => () => void
        onMcpMiniBrowserExecute: (callback: (payload: { requestId: string; code: string }) => void) => () => void
        replyMiniBrowserExecute: (payload: { requestId: string; result?: unknown; error?: string }) => void
        onMcpOpenConsole: (callback: () => void) => () => void
        onMcpConsoleClear: (callback: () => void) => () => void
        onMcpOpenFirewall: (callback: () => void) => () => void
        onMcpSetTabMaximized: (callback: (payload: { tabId: string | null; maximized: boolean }) => void) => () => void
        pushWorkbenchLayout: (layout: unknown) => void
        onMcpSetWorkbenchLayout: (callback: (layout: unknown) => void) => () => void
      }
    }
  }
}

/** Save result from file operations */
export interface SaveResult {
  success: boolean
  path?: string
  error?: string
}

/** KeyValue data for context service */
export interface KeyValueData {
  id?: string | undefined
  key: string
  value: string
  /** Whether this key-value is enabled (default: true) */
  enabled?: boolean | undefined
  /**
   * Whether the value is an `ExpressionValue` and should be run
   * through handlebars at request time. Defaults to `false` —
   * `StringValue` is sent verbatim. Source-of-truth lives in the
   * renderer's persisted `KeyValue.value` (`isExpressionValue`
   * predicate); main reconstructs the matching `ValueType` instance
   * on receipt.
   */
  isExpression?: boolean | undefined
  /**
   * Set when the value is a `CustomListValue`. `value` carries only the
   * label (its `toString()`); main needs the list id + label to look up
   * the entry's current value and substitute it at dispatch.
   */
  customList?: { listId: string; label: string } | undefined
  /** Multi-select counterpart — a `CustomListMultiValue`. */
  customListMulti?: { listId: string; labels: string[] } | undefined
  /**
   * Set when the value is a `SecretValue`. `value` is always the empty
   * string (the resolved plaintext is never serialised to the renderer
   * bridge); main reconstructs the `SecretValue` from `source` + `params`
   * and the SecretHydrationService resolves it before dispatch.
   */
  secret?: { source: string; params: Record<string, unknown> } | undefined
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
  sourceId?: string
}

/** Code snippets result from context service */
export interface CodeSnippetsResult {
  requestId: string
  markdown: string
  sourceId?: string
}

/** Available variables result for autocompletion (per field) */
export interface AvailableVariablesResult {
  variableId: string
  variables: { name: string; value: string }[]
  /** Echo of the sourceId of the renderer call that triggered this update (if any). */
  sourceId?: string
}

/** OData execution input */
export interface ODataExecutionInput {
  requestId: string
  timeout?: number
  requestPath?: string
  /** HTTP method override — defaults to GET. POST is used for OData
   * action and $batch invocations. */
  method?: string
  /** Request body — raw string. JSON for actions, multipart/mixed
   * envelope for $batch. Env-templated by the engine. */
  body?: string
  /** Content-Type override — required for $batch to carry the
   * multipart boundary. Defaults to `application/json`. */
  bodyContentType?: string
  /** Absolute URL override. When set, the engine dispatches to this
   * URL as-is instead of composing one from the registered request.
   * Used by `@odata.nextLink` pagination and clickable navigation
   * links. */
  urlOverride?: string
}

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
  /** Headers actually sent (includes any auth injection). */
  requestHeaders?: Record<string, string>
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
  connected?: boolean
  statusCode?: number
  statusMessage?: string
  responseMessage?: string
  messages?: GrpcMessageItem[]
  metadata?: Record<string, string>
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  requestMethod?: string
}

/** A single streamed gRPC frame (sent or received). */
export interface GrpcMessageItem {
  direction: 'sent' | 'received'
  data: string
  timestamp: string
}

/** Payload of the `grpc:message` broadcast (a streamed frame for a request). */
export interface GrpcMessageData {
  requestId: string
  message: GrpcMessageItem
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
  event?: string | undefined
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
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'odata' | 'auth'
  url: string
  headers: KeyValueData[]
  method?: string | undefined
  params?: KeyValueData[] | undefined
  pathParams?: KeyValueData[] | undefined
  body?: { type: string; content?: string | undefined; path?: string | undefined; fields?: KeyValueData[] | undefined } | undefined
  /** HTTP mock server (server === true): status code the mock serves (defaults to 200). */
  mockStatus?: number | undefined
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
  /** WebSocket/Socket.IO: when true, restorm HOSTS a server instead of connecting. */
  server?: boolean | undefined
  // MQTT specific (protocol === 'mqtt'; `event` carries the topic)
  qos?: number | undefined
  retain?: boolean | undefined
  clientId?: string | undefined
  username?: string | undefined
  password?: string | undefined
  keepalive?: number | undefined
  mqttSubscribe?: boolean | undefined
  lwtTopic?: string | undefined
  lwtPayload?: string | undefined
  lwtQos?: number | undefined
  lwtRetain?: boolean | undefined
  // OData specific (requestType === 'odata'). The main ContextService
  // appends the system query options ($filter / $select / …) to the
  // resolved URL. Mirrors the main-side ContextServiceTypes shape.
  odataVersion?: 'v2' | 'v3' | 'v4' | undefined
  odataOperationKind?: 'entity-set' | 'function' | 'action' | 'batch' | undefined
  odataQueryOptions?: {
    filter?: string | undefined
    select?: string[] | undefined
    top?: string | undefined
    skip?: string | undefined
    count?: boolean | undefined
    expand?: string | undefined
    orderby?: string | undefined
    search?: string | undefined
    format?: string | undefined
    apply?: string | undefined
  } | undefined
}

export {}
