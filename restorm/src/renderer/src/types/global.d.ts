import type { ThemeInfo, ThemeDefinition, ThemeVariables } from 'electron-core-ui/types'
import type { SettingValue, ResolvedSetting, SettingsGroup } from 'electron-core-ui/types'
import type { PersistenceFormat } from 'electron-core-ui/main'
import type { AppIconMenuLabels, AppIconAction } from 'electron-core-ui/types'
import type {
  GitStatus,
  GitCommitResult,
  GitPushResult,
  GitResetResult,
  GitPullResult,
  GitFetchCompareResult,
  GitLogEntry,
  GitConflictVersions,
  GitConflictCommitTimestamps,
  GitState
} from 'electron-core-ui/types'
import type { ResponseHistoryDetail, ResponseHistoryEntry } from '../../../shared/types/collections'
import type { AuthState, CheckoutResult, PortalResult } from '../../../shared/auth/authState'
import type { UpdateState, UpdateSettings, ReleaseNoteSection } from '../../../shared/update/updateTypes'
import type {
  CliTokenResult,
  CliTokenSummary,
  CreatedCliToken
} from '../../../shared/cliTokens/cliTokenTypes'
import type { CrashArmedState, CrashConsentState, CrashRecoveryNotice, CrashReviewRequest } from '../../../shared/crash/crashTypes'
import type { CookieInput, CookieRow, CookiePair } from '../../../shared/cookies/cookieTypes'

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
      /** Toggle the window's fullscreen state; resolves to the new state. */
      toggleFullscreen: () => Promise<boolean>
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
      /**
       * OS application-icon menu (the Dock menu on macOS). Main builds the
       * entries from the file state; the renderer only names the static ones,
       * being the process that holds every shipped locale.
       */
      appIconMenu: {
        setLabels: (labels: AppIconMenuLabels) => void
        onInvoke: (callback: (action: AppIconAction) => void) => () => void
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
      /** Account / login. Distinct from the `restorm.auth` namespace (HTTP
       * request authentication) — this is the user's cloud session +
       * entitlement. Exposed on the `api` world by the preload. */
      account: {
        login: () => Promise<AuthState>
        logout: () => Promise<AuthState>
        getState: () => Promise<AuthState>
        onStateChanged: (callback: (state: AuthState) => void) => (() => void)
        subscribe: () => Promise<CheckoutResult>
        manageSubscription: () => Promise<PortalResult>
      }
      /** App-level metadata bridged from the main process. */
      app: {
        /** The running app version (e.g. `0.1.12-preview`). */
        getVersion: () => Promise<string>
        /** True when the app runs in documentation-capture mode: decorative
         * surfaces (welcome wallpaper, wordmark animation, vignette frame)
         * render a fixed, static variant so screenshots are reproducible. */
        docCaptureMode: boolean
      }
      /** The signed-in user's own CLI/CI tokens. Every call is authenticated in
       * the MAIN process — no session credential ever reaches this side. */
      cliTokens: {
        list: () => Promise<CliTokenResult<CliTokenSummary[]>>
        /** The plaintext is in this reply and nowhere else, ever. */
        create: (name: string, expiresInDays: number | null) => Promise<CliTokenResult<CreatedCliToken>>
        revoke: (id: string) => Promise<CliTokenResult<{ ok: true }>>
      }
      /** Per-environment session cookie jar (Cookie Manager). `envKey` = the
       * active environment's id, or '' for the default jar. */
      cookies: {
        list: (envKey: string) => Promise<CookieRow[]>
        add: (envKey: string, input: CookieInput) => Promise<CookieRow[]>
        remove: (envKey: string, domain: string, path: string, key: string) => Promise<CookieRow[]>
        clearDomain: (envKey: string, domain: string) => Promise<CookieRow[]>
        clear: (envKey?: string) => Promise<CookieRow[]>
        /** Subscribe to main-process jar mutations (live-refresh); returns an unsubscribe. */
        onChanged: (callback: () => void) => () => void
      }
      /** Silent auto-update surface (see `src/main/services/UpdateService.ts`). */
      update: {
        getState: () => Promise<UpdateState>
        getSettings: () => Promise<UpdateSettings>
        checkNow: () => Promise<UpdateState>
        quitAndInstall: () => Promise<void>
        setAutoCheckEnabled: (enabled: boolean) => Promise<UpdateSettings>
        getChangelogSince: (fromVersion: string, locale?: string) => Promise<string>
        getReleaseNotes: (locale?: string) => Promise<ReleaseNoteSection[]>
        getLastSeenVersion: () => Promise<string | null>
        markVersionSeen: (version: string) => Promise<void>
        onStateChanged: (callback: (state: UpdateState) => void) => (() => void)
      }
      /** Crash reporting, read-only (see `src/main/services/crash/`). The
       * renderer follows the main process's armed state; it cannot change it. */
      crash: {
        getArmedState: () => Promise<CrashArmedState>
        onArmedStateChanged: (callback: (state: CrashArmedState) => void) => (() => void)
        getConsentState: () => Promise<CrashConsentState>
        onConsentStateChanged: (callback: (state: CrashConsentState) => void) => (() => void)
        setConsent: (granted: boolean) => Promise<CrashConsentState>
        onReviewRequested: (callback: (request: CrashReviewRequest) => void) => (() => void)
        resolveReview: (id: string, send: boolean) => void
        /** Restart, reopening the last file. Never settles — do not await. */
        recoverRelaunch: () => Promise<void>
        getRecoveryNotice: () => Promise<CrashRecoveryNotice>
        onRecoveryNotice: (callback: (notice: CrashRecoveryNotice) => void) => (() => void)
      }
      /** electron-core-ui's Git plumbing — see `electron-core-ui/docs/Git/README.md`.
       * Mirrors `WindowApiGit` in electron-core-ui's own `global.d.ts`; restorm
       * re-declares it here (rather than importing `WindowApi` wholesale) to stay
       * consistent with the rest of this file's per-namespace declarations. */
      git: {
        isRepo: (folder: string) => Promise<boolean>
        getStatus: (folder: string) => Promise<GitStatus>
        log: (folder: string) => Promise<GitLogEntry[]>
        stage: (folder: string, paths: string[]) => Promise<void>
        commit: (folder: string, message: string, paths?: string[]) => Promise<GitCommitResult>
        push: (folder: string) => Promise<GitPushResult>
        pull: (folder: string) => Promise<GitPullResult>
        refreshState: () => Promise<void>
        fetchAndCompare: (folder: string) => Promise<GitFetchCompareResult>
        getConflictVersions: (folder: string, filePath: string) => Promise<GitConflictVersions>
        getFileAtHead: (folder: string, filePath: string) => Promise<string | null>
        getFileAtRemote: (folder: string, filePath: string) => Promise<string | null>
        getFileAtMergeBase: (folder: string, filePath: string) => Promise<string | null>
        getWorkingTreeFile: (folder: string, filePath: string) => Promise<string | null>
        resetToRemoteKeepingWorkingTree: (folder: string) => Promise<GitResetResult>
        resetHardToRemote: (folder: string) => Promise<GitResetResult>
        writeResolvedConflict: (folder: string, filePath: string, content: string) => Promise<void>
        recoverFileAtRevision: (folder: string, filePath: string, revision: string) => Promise<string>
        abortMerge: (folder: string) => Promise<void>
        getConflictCommitTimestamps: (folder: string) => Promise<GitConflictCommitTimestamps>
        setActiveFolder: (folder: string | null) => Promise<void>
        getState: () => Promise<GitState>
        onStateChanged: (callback: (state: GitState) => void) => () => void
        onCliMissing: (callback: () => void) => () => void
        onPullAvailable: (callback: () => void) => () => void
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
        openPath: (path: string) => Promise<{ success: boolean; content?: unknown; path?: string; format?: PersistenceFormat }>
        revealInFolder: (path: string) => Promise<{ success: boolean; error?: string }>
        clearDrafts: () => Promise<{ success: boolean; error?: string }>
        getPathForFile: (file: File) => string
      }
      secrets: {
        read: (filePath: string) => Promise<string | null>
        write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
        invalidate: (args: { source: string; params: Record<string, unknown>; scopeId?: string }) => Promise<{ success: boolean }>
        resolve: (args: { source: string; params: Record<string, unknown> }) => Promise<{ value?: string; error?: string }>
        refresh: (args: { source: string; params: Record<string, unknown> }) => Promise<{ success: boolean }>
        onExternallyChanged: (callback: (payload: { path: string }) => void) => (() => void)
      }
      forceClose: () => Promise<void>
      onSaveAndClose: (callback: () => void) => (() => void)
      git: {
        onSaveFlushRequest: (callback: (token: string) => void) => (() => void)
        notifySaveFlushComplete: (token: string) => void
      }
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
        getItemSecretStatuses: () => Promise<{ itemId: string; resolving: boolean; error: boolean; errorVars?: string[] }[]>
        onItemSecretsStatus: (callback: (result: { itemId: string; resolving: boolean; error: boolean; errorVars?: string[] }) => void) => (() => void)
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
        /** SERVER MODE: start hosting this request as a local GraphQL mock server. */
        listen: (requestId: string) => Promise<{ success: boolean; listening: boolean; error?: string }>
        /** SERVER MODE: stop hosting this request's GraphQL mock route. */
        stop: (requestId: string) => Promise<boolean>
        /** SERVER MODE: whether this request is currently hosting a mock route. */
        isListening: (requestId: string) => Promise<boolean>
        /** SERVER MODE: served-operation count updates for the "served N" banner. */
        onServerServed: (callback: (data: { requestId: string; count: number }) => void) => (() => void)
        /** SUBSCRIPTION CLIENT: open a long-lived GraphQL subscription over SSE. */
        subscribe: (input: GraphQLExecutionInput) => Promise<{ started: boolean }>
        /** SUBSCRIPTION CLIENT: stop / unsubscribe an active subscription. */
        unsubscribe: (requestId: string) => Promise<boolean>
        /** SUBSCRIPTION CLIENT: whether a subscription is currently streaming. */
        isSubscribing: (requestId: string) => Promise<boolean>
        /** SUBSCRIPTION CLIENT: each pushed subscription payload, in arrival order. */
        onEvent: (callback: (data: { requestId: string; event: { data: string; timestamp: string } }) => void) => (() => void)
        /** SUBSCRIPTION CLIENT: lifecycle updates (drives the listening badge beam). */
        onSubscriptionProgress: (callback: (data: RequestProgressData) => void) => (() => void)
      }
      graphqlApi: {
        query: (query: string, variables?: Record<string, unknown>) => Promise<unknown>
      }
      soap: {
        execute: (input: SOAPExecutionInput) => Promise<SOAPExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        listen: (requestId: string) => Promise<{ success: boolean; listening: boolean; error?: string }>
        stop: (requestId: string) => Promise<boolean>
        isListening: (requestId: string) => Promise<boolean>
        onServerServed: (callback: (data: { requestId: string; count: number }) => void) => (() => void)
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
        listen: (requestId: string) => Promise<{ success: boolean; listening: boolean; error?: string }>
        stopServer: (requestId: string) => Promise<boolean>
        isServerListening: (requestId: string) => Promise<boolean>
        onServerProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        onServerServed: (callback: (data: { requestId: string; count: number }) => void) => (() => void)
        reflectImport: (input: {
          address: string
          tls?: boolean
          metadata?: { key: string; value: string }[]
          name?: string
        }) => Promise<{
          success: boolean
          folder?: unknown
          merged?: boolean
          folderId?: string
          diff?: { added: number; removed: number; merged: number; deprecated: number }
          unsupported?: boolean
          error?: string
        }>
        reflectQuery: (input: {
          address: string
          tls?: boolean
          metadata?: { key: string; value: string }[]
        }) => Promise<{ success: boolean; services?: string[]; protoDescriptorSet?: string; unsupported?: boolean; error?: string }>
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
      sse: {
        connect: (input: SseExecutionInput) => Promise<SseExecutionResult>
        disconnect: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        onMessage: (callback: (data: SseMessageData) => void) => (() => void)
      }
      amqp: {
        execute: (input: AmqpExecutionInput) => Promise<AmqpExecutionResult>
        connect: (input: AmqpExecutionInput) => Promise<{ started: boolean }>
        send: (requestId: string, payload: string) => Promise<boolean>
        disconnect: (requestId: string) => Promise<boolean>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        onMessage: (callback: (data: AmqpMessageData) => void) => (() => void)
      }
      redis: {
        subscribe: (input: RedisExecutionInput) => Promise<RedisExecutionResult>
        command: (input: RedisExecutionInput) => Promise<RedisExecutionResult>
        disconnect: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        onMessage: (callback: (data: RedisMessageData) => void) => (() => void)
      }
      stomp: {
        connect: (input: StompExecutionInput) => Promise<StompExecutionResult>
        disconnect: (requestId: string) => Promise<boolean>
        send: (requestId: string, body: string) => Promise<boolean>
        ack: (requestId: string, messageId: string, subscriptionId: string) => Promise<boolean>
        nack: (requestId: string, messageId: string, subscriptionId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: RequestProgressData) => void) => (() => void)
        onMessage: (callback: (data: StompMessageData) => void) => (() => void)
      }
      kafka: {
        /** Produce: one-shot connect -> send -> disconnect. */
        produce: (input: KafkaExecutionInput) => Promise<KafkaProduceResult>
        /** Browse: one-shot peek via an ephemeral consumer group. */
        browse: (input: KafkaExecutionInput) => Promise<KafkaBrowseResult>
        /** Consume: start the long-lived subscribe; messages stream over `onMessage`. */
        consumeStart: (requestId: string) => Promise<{ started: boolean }>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (data: KafkaProgressData) => void) => (() => void)
        onMessage: (callback: (data: KafkaMessageData) => void) => (() => void)
      }
      odata: {
        execute: (input: ODataExecutionInput) => Promise<HTTPExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
        onProgress: (callback: (event: { requestId: string; status: 'started' | 'completed' | 'cancelled' | 'error' }) => void) => (() => void)
        listen: (requestId: string) => Promise<{ success: boolean; listening: boolean; error?: string }>
        stop: (requestId: string) => Promise<boolean>
        isListening: (requestId: string) => Promise<boolean>
        onServerServed: (callback: (data: { requestId: string; count: number }) => void) => (() => void)
      }
      designServer: {
        start: (design: unknown) => Promise<{ success: boolean; listening: boolean; port: number; error?: string }>
        stop: (designId: string) => Promise<boolean>
        status: (designId: string) => Promise<{ listening: boolean; port?: number; counters?: DesignServerCounters }>
        setForced: (designId: string, routeId: string, forced: { code: string; body?: string } | null) => Promise<boolean>
        update: (design: unknown) => Promise<boolean>
        onProgress: (callback: (event: { designId: string; status: 'started' | 'completed' | 'error' }) => void) => (() => void)
        onServed: (callback: (data: { designId: string; routeId: string; code: string; counters: DesignServerCounters }) => void) => (() => void)
        exportDescriptor: (fileName: string, content: string, extension: string) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>
      }
      jsonrpc: {
        execute: (input: { requestId: string; timeout?: number }) => Promise<JsonRpcExecutionResult>
        executeBatch: (input: { requestId: string; timeout?: number }) => Promise<JsonRpcBatchExecutionResult>
        cancel: (requestId: string) => Promise<boolean>
        isActive: (requestId: string) => Promise<boolean>
      }
      trpc: {
        execute: (input: TrpcExecutionInput) => Promise<TrpcExecutionResult>
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
          /** Named identity of `error` when the failure is one the app
           * can name — the renderer localises from this, not from
           * `error`, which stays English diagnostic text. */
          errorCode?: string
          errorParams?: Record<string, string>
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
        postImportSeed: (payload: {
          source: string
          format: string
          idMap: Record<string, string>
          extraHeaders?: Record<string, string>
          expectedChecksum?: string
        }) => Promise<{ success: boolean; error?: string }>
      }
      responsesHistory: {
        list: (requestId: string) => Promise<ResponseHistoryEntry[]>
        get: (guid: string) => Promise<ResponseHistoryDetail | null>
        togglePin: (guid: string, pinned: boolean) => Promise<boolean>
        onChanged: (callback: (requestId: string) => void) => () => void
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
        syncCollections: (collections: unknown[], mcpVersion?: number) => Promise<void>
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
        onMcpOpenTab: (callback: (payload: { requestId?: string; itemId: string; kind: 'request' | 'folder' | 'env-folder' | 'scenario' }) => void) => () => void
        replyMcpOpenTab: (payload: { requestId: string; opened: boolean }) => void
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
  /** Reactive request path the executor uses to look up live state. */
  requestPath?: string
  /** Attached AuthenticationRequest as a plain object (re-hydrated main-side). */
  authRequest?: unknown
  /** Follow 3xx redirects (defaults to true when omitted). */
  followRedirects?: boolean
}

/** HTTP execution result from backend */
export interface HTTPExecutionResult {
  requestId: string
  success: boolean
  statusCode?: number
  statusText?: string
  headers?: Record<string, string | string[]>
  body?: string
  /** When true, `body` is base64-encoded binary (download, don't text-render). */
  bodyIsBase64?: boolean
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  /** Headers actually sent (includes any auth injection). */
  requestHeaders?: Record<string, string>
  /** Cookies sent with the request / received across the redirect chain. */
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
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

/** Kafka progress data — carries the consumer's error message on the `error`
 * status so the panel can show WHY a consume ended instead of blanking to idle. */
export interface KafkaProgressData {
  requestId: string
  status: 'started' | 'completed' | 'cancelled' | 'error'
  error?: string
}

/** GraphQL execution input */
export interface GraphQLExecutionInput {
  requestId: string
  timeout?: number
}

/** GraphQL execution result */
export interface GraphQLExecutionResult {
  /** Cookies sent with the request / received in the response (Cookies tab). */
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
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

/** One JSON-RPC 2.0 error object, per spec section 5.1. */
export interface JsonRpcErrorShape {
  code: number
  message: string
  data?: unknown
}

/** JSON-RPC execution result — `result` on success, `error` when the
 * envelope reports a JSON-RPC-level failure (still a successful HTTP call). */
export interface JsonRpcExecutionResult {
  /** Cookies sent with the request / received in the response (Cookies tab). */
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
  requestId: string
  success: boolean
  statusCode?: number
  statusText?: string
  notificationSent?: boolean
  result?: unknown
  error?: JsonRpcErrorShape
  transportError?: string
  rawBody?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  requestHeaders?: Record<string, string>
}

/** One child result inside a `jsonrpc-batch` response, matched back to its
 * originating call by `rpcId`. */
export interface JsonRpcBatchChildResult {
  childId: string
  rpcId: string
  result?: unknown
  error?: JsonRpcErrorShape
  unmatched?: boolean
}

/** JSON-RPC batch execution result. */
export interface JsonRpcBatchExecutionResult {
  /** Cookies sent with the request / received in the response (Cookies tab). */
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
  requestId: string
  success: boolean
  statusCode?: number
  transportError?: string
  rawBody?: string
  children: JsonRpcBatchChildResult[]
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** tRPC execution input */
export interface TrpcExecutionInput {
  requestId: string
  timeout?: number
  /** Attached AuthenticationRequest as a plain object (re-hydrated main-side). */
  authRequest?: unknown
}

/** tRPC execution result. `data` is the UNWRAPPED `result.data` payload the
 * response panel shows by default; `rawBody` is the full `[{ result: { data
 * } }]` wire envelope, for the "Show raw envelope" toggle. */
export interface TrpcExecutionResult {
  /** Cookies sent with the request / received in the response (Cookies tab). */
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
  requestId: string
  success: boolean
  statusCode?: number
  statusText?: string
  headers?: Record<string, string | string[]>
  data?: unknown
  rawBody?: string
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
  requestHeaders?: Record<string, string>
}

/** SOAP execution input */
export interface SOAPExecutionInput {
  requestId: string
  timeout?: number
}

/** SOAP execution result */
export interface SOAPExecutionResult {
  /** Cookies sent with the request / received in the response (Cookies tab). */
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
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
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
}

/** WebSocket message data for streaming */
export interface WebSocketMessageData {
  requestId: string
  message: WebSocketMessageItem
}

/** SSE execution input */
export interface SseExecutionInput {
  requestId: string
  timeout?: number
}

/** STOMP execution input */
export interface StompExecutionInput {
  requestId: string
  timeout?: number
}

/** Kafka execution input — shared shape for `produce` / `browse`. */
export interface KafkaExecutionInput {
  requestId: string
  timeout?: number
}

/** Redis request execution input */
export interface RedisExecutionInput {
  requestId: string
  timeout?: number
}

/** One parsed SSE frame (`event:`/`data:`/`id:` per the W3C EventSource spec). */
export interface SseFrameItem {
  event: string
  data: string
  id?: string
  timestamp: string
}

/** SSE execution result */
export interface SseExecutionResult {
  /** Cookies sent with the request / received in the response (Cookies tab). */
  sentCookies?: CookiePair[]
  receivedCookies?: CookiePair[]
  requestId: string
  success: boolean
  connected: boolean
  frames: SseFrameItem[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** One Redis pub/sub message (subscribe mode) */
export interface RedisMessageItem {
  direction: 'sent' | 'received'
  channel?: string | undefined
  data: string
  timestamp: string
}

/** Redis execution result — covers BOTH modes; `mode` discriminates which
 * fields apply. */
export interface RedisExecutionResult {
  requestId: string
  success: boolean
  mode: 'subscribe' | 'command'
  connected?: boolean
  channels?: string[]
  messages?: RedisMessageItem[]
  command?: string
  args?: string[]
  reply?: string
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** One STOMP frame exchanged on the connection (sent or received). */
export interface StompMessageItem {
  direction: 'sent' | 'received'
  command: string
  subscription?: string
  destination?: string
  headers: Record<string, string>
  body: string
  timestamp: string
}

/** STOMP execution result */
export interface StompExecutionResult {
  requestId: string
  success: boolean
  connected: boolean
  messages: StompMessageItem[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** SSE frame data for streaming */
export interface SseMessageData {
  requestId: string
  message: SseFrameItem
}

/** Redis message data for streaming */
export interface RedisMessageData {
  requestId: string
  message: RedisMessageItem
}

/** Payload of the `stomp:message` broadcast (one streamed frame for a request). */
export interface StompMessageData {
  requestId: string
  message: StompMessageItem
}

/** One produced/consumed/browsed Kafka record. */
export interface KafkaMessageItem {
  direction: 'received'
  topic: string
  partition: number
  offset: string
  key?: string
  value: string
  headers?: Record<string, string>
  timestamp: string
}

export interface KafkaProduceResult {
  requestId: string
  success: boolean
  kafkaMode: 'produce'
  requestTopic: string
  requestUrl: string
  partition?: number
  offset?: string
  error?: string
  timings: { startedAt: string; durationMs: number }
}

export interface KafkaBrowseResult {
  requestId: string
  success: boolean
  kafkaMode: 'browse'
  requestTopic: string
  requestUrl: string
  messages: KafkaMessageItem[]
  error?: string
  timings: { startedAt: string; durationMs: number }
}

export interface KafkaConsumeResult {
  requestId: string
  success: boolean
  kafkaMode: 'consume'
  requestTopic: string
  requestUrl: string
  connected: boolean
  messages: KafkaMessageItem[]
  error?: string
  timings: { startedAt: string; durationMs: number }
}

/** Payload of the `kafka:message` broadcast (a streamed/peeked frame). */
export interface KafkaMessageData {
  requestId: string
  message: KafkaMessageItem
}

/** Full request data for backend processing */
export interface FullRequestData {
  id: string
  requestType: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' | 'sse' | 'stomp' | 'odata' | 'auth' | 'jsonrpc' | 'jsonrpcBatch' | 'trpc' | 'amqp' | 'redis' | 'kafka'
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
  /** GraphQL mock server (server === true): SDL schema served. */
  schema?: string | undefined
  /** GraphQL mock server: per-field canned response values (JSON keyed by `Type.field`). */
  mockResolvers?: string | undefined
  /** GraphQL mock server: optional scripted resolver body. */
  resolverScript?: string | undefined
  service?: string | undefined
  grpcMethod?: string | undefined
  callType?: string | undefined
  /** Wire transport ('grpc' | 'grpc-web' | 'connect'); absent means native gRPC. */
  transport?: string | undefined
  requestMessage?: string | undefined
  /** gRPC: the request's own proto, used to build the dynamic client (falls back
   * to the bundled grpcbin proto when absent). */
  protoContent?: string | undefined
  protoPath?: string | undefined
  /** gRPC: base64 FileDescriptorSet fetched via server reflection; takes
   * precedence over protoContent/protoPath (see grpcProtoLoader.ts). */
  protoDescriptorSet?: string | undefined
  metadata?: KeyValueData[] | undefined
  soapAction?: string | undefined
  soapService?: string | undefined
  operation?: string | undefined
  soapBody?: string | undefined
  /** SOAP mock server (server === true): the operations the hosted mock answers. */
  soapMockOperations?: { name: string; soapAction?: string | undefined; responseBody: string; isFault?: boolean | undefined }[] | undefined
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
  // SSE specific (requestType === 'sse'): seed for the `Last-Event-ID`
  // header on the first connect. Mirrors the main-side ContextServiceTypes shape.
  lastEventId?: string | undefined
  // STOMP specific (requestType === 'stomp'). `connectHeaders` + `sendHeaders`
  // are ALSO merged into the top-level `headers` field above (so
  // `collectRequestSecrets` sees both for pre-hydration) — these two carry the
  // same rows split by which frame they belong to, for `StompExecutionService`
  // to read separately.
  stompVersion?: '1.1' | '1.2' | undefined
  connectHeaders?: KeyValueData[] | undefined
  subscriptions?: { id?: string; destination?: string; ackMode?: string }[] | undefined
  sendDestination?: string | undefined
  sendBody?: string | undefined
  sendHeaders?: KeyValueData[] | undefined
  // OData specific (requestType === 'odata'). The main ContextService
  // appends the system query options ($filter / $select / …) to the
  // resolved URL. Mirrors the main-side ContextServiceTypes shape.
  odataVersion?: 'v2' | 'v3' | 'v4' | 'v4.01' | undefined
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
  mockMetadata?: string | undefined
  mockData?: Record<string, Record<string, unknown>[]> | undefined
  // JSON-RPC specific (requestType === 'jsonrpc' / 'jsonrpcBatch').
  // Mirrors the main-side ContextServiceTypes shape.
  jsonRpcMethod?: string | undefined
  jsonRpcParams?: string | undefined
  jsonRpcId?: string | undefined
  jsonRpcNotificationMode?: boolean | undefined
  jsonRpcChildren?: {
    childId: string
    method: string
    params: string
    rpcId: string
    notificationMode?: boolean | undefined
  }[] | undefined
  // tRPC specific (requestType === 'trpc') — mirrors the main-side
  // ContextServiceTypes shape; `url` carries the BASE server url, the
  // procedure path (+ `?input=` for a query) is appended by URLResolver.
  trpcProcedure?: string | undefined
  trpcInput?: string | undefined
  trpcKind?: 'query' | 'mutation' | undefined
  // AMQP specific (requestType === 'amqp'; `username`/`password` above are
  // shared with MQTT)
  vhost?: string | undefined
  mode?: 'publish' | 'subscribe' | 'browse' | undefined
  exchange?: string | undefined
  routingKey?: string | undefined
  payload?: string | undefined
  queue?: string | undefined
  autoAck?: boolean | undefined
  prefetch?: number | undefined
  browsePeekCount?: number | undefined
  // Redis specific (`password` above doubles as the Redis auth password)
  redisMode?: 'subscribe' | 'command' | undefined
  channels?: string[] | undefined
  command?: string | undefined
  args?: string[] | undefined
  freeformCommand?: string | undefined
}

/** AMQP execution input */
export interface AmqpExecutionInput {
  requestId: string
  timeout?: number
}

/** One AMQP frame — a sent publish or a received/peeked delivery. */
export interface AmqpMessageItem {
  direction: 'sent' | 'received'
  data: string
  exchange?: string | undefined
  routingKey?: string | undefined
  deliveryTag?: number | undefined
  /** Set on a `browse`-mode frame: peeked without acking, the queue is unchanged. */
  peek?: boolean | undefined
  timestamp: string
}

/** AMQP execution result */
export interface AmqpExecutionResult {
  requestId: string
  success: boolean
  connected: boolean
  mode: 'publish' | 'subscribe' | 'browse'
  messages: AmqpMessageItem[]
  error?: string
  timings: {
    startedAt: string
    durationMs: number
  }
  requestUrl?: string
}

/** AMQP message data for streaming */
/** Per-run design-server call counters (mirrors the main-side shape in
 * `DesignServerService`). */
export interface DesignServerCounters {
  total: number
  routes: Record<string, { total: number; byCode: Record<string, number> }>
}

export interface AmqpMessageData {
  requestId: string
  message: AmqpMessageItem
  // Kafka specific (requestType === 'kafka'). Mirrors the main-side
  // ContextServiceTypes shape. `url` (common field above) carries the
  // comma-separated broker list.
  kafkaMode?: 'produce' | 'consume' | 'browse' | undefined
  kafkaTopic?: string | undefined
  kafkaKey?: string | undefined
  kafkaValue?: string | undefined
  kafkaPartition?: number | undefined
  kafkaGroupId?: string | undefined
  kafkaFromOffset?: 'earliest' | 'latest' | 'specific' | undefined
  kafkaSpecificOffset?: string | undefined
  kafkaPartitions?: number[] | undefined
  kafkaBrowsePeekCount?: number | undefined
  kafkaClientId?: string | undefined
  kafkaSaslMechanism?: 'none' | 'plain' | 'scram-sha-256' | 'scram-sha-512' | undefined
  kafkaSaslUsername?: string | undefined
  kafkaSaslPassword?: string | undefined
  kafkaTlsEnabled?: boolean | undefined
}

export {}
