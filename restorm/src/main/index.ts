// LOAD-ORDER CRITICAL (logger): inject ECUI's `--quiet` in headless CLI-run
// mode BEFORE any module can create the logger, so stdout stays clean for the
// run-log. Pure argv mutation — no network — so it's safe ahead of the firewall.
import './cli/earlyQuiet'

// LOAD-ORDER CRITICAL: install the main-process firewall
// interceptor (Layer B) BEFORE any other module that might trigger
// an outgoing HTTP / HTTPS / fetch call. The monkey-patches replace
// `http.request` / `https.request` / `globalThis.fetch` in-place,
// so every subsequent `import` / `require` inherits the patched
// versions. Putting this at the very top means a malicious
// dependency that phones home from its module-init code is
// captured too.
//
// `installHardenInterceptor` (the deeper net.Socket / dns / dgram
// patches + the lockdown) extends Layer B beyond the http/https/fetch
// chokepoints so the non-HTTP protocol clients (`ws`, `mqtt`,
// `socket.io-client`) — which open raw sockets, not `http.request` —
// are gated too. It runs immediately after the http interceptor, in
// the same pre-import window, so the http/fetch slots are patched
// before `lockdownPatchedGlobals()` freezes them and no dependency can
// load a raw-socket consumer ahead of the patch. The unbound-`this`
// connect wrap (`Reflect.get` + `original.call(this, …)`) restores the
// per-instance socket so Node's Duplex timer internals stay intact.
//
// `configureFirewall` injects restorm's app-specific decisions into
// the generic engine BEFORE the interceptor arms: the internal-bridge
// endpoint to skip from the audit feed (the in-process GraphQL
// bridge), the worker-bootstrap temp-file prefix, the e2e bypass
// (set by the Playwright fixture via `RESTORM_USER_DATA_OVERRIDE` so
// tests against ephemeral mock servers don't deadlock on a toast), and
// the internal-request predicate that exempts cross-instance MCP-bridge
// traffic (a `tools/call` forwarded to a peer MCP-enabled instance over
// loopback, tagged with `MCP_FORWARDED_HEADER`) — never user-facing
// API traffic, so it must skip the firewall or `__session` routing
// breaks and the bridging instance piles up "blocked" prompts.
import { app as firewallApp } from 'electron'
import { installMainProcessInterceptor, installHardenInterceptor, configureFirewall, MCP_FORWARDED_HEADER } from 'electron-core-ui'
import { graphQLService as firewallGraphQLService } from 'electron-core-ui/main'
configureFirewall({
  internalEndpointProvider: () => firewallGraphQLService.getEndpoint(),
  workerBootstrapPrefix: 'restorm-firewall-bootstrap',
  e2eBypass: ((): boolean => {
    const v = process.env['RESTORM_USER_DATA_OVERRIDE']
    return typeof v === 'string' && v.length > 0
  })(),
  // Dev-only: run the harden lockdown's interceptor-first ordering
  // assertion (logs a warning if a slot it's about to freeze is no longer
  // the firewall's own wrapper). Off in packaged builds.
  devAssertOrdering: process.env['NODE_ENV'] === 'development' || !firewallApp.isPackaged,
  // The header key match is case-insensitive — Node lowercases outgoing
  // header names, but be defensive against a caller that set it raw.
  internalRequestPredicate: (args: unknown[]): boolean => {
    for (const arg of args) {
      if (typeof arg !== 'object' || arg === null || arg instanceof URL || typeof arg === 'function') continue
      const headers = (arg as { headers?: Record<string, unknown> | null }).headers
      if (headers === undefined || headers === null) continue
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === MCP_FORWARDED_HEADER) return true
      }
    }
    return false
  }
})
installMainProcessInterceptor()
installHardenInterceptor()

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { MainWindow } from './windows/MainWindow'
import { initializeApp, logger, initFileService, getFileService, isFileServiceInitialized, i18nService, initPersistenceService, isPersistenceServiceInitialized, FileService, getSettingsService, isSettingsServiceInitialized, getStorageService, initAutoSaveController, McpService, resolveMcpDiscoveryDir, writeMcpDiscoveryFile, cleanupMcpDiscoveryFile, firewallService, permissionService, registerFirewallIpc, installWorkerPatcher, getGitService, initGitSemiPullController, getGitSemiPullController } from 'electron-core-ui'
import { REOPEN_LAST_FILE_SETTING_KEY, REOPEN_LAST_FILE_STORAGE_KEY } from '../shared/config/reopenLastFile'
import { resolveChannel, endpointUrl } from '../shared/config/backend'
import { entitlementPublicKeyPem, isEntitlementPublicKeyConfigured } from './services/entitlement/keys'
import { pricingUrl } from '../shared/config/site'
// Restorm-specific renderer translations (notably the `behavior.*`
// keys referenced by `restorm/resources/settings.yaml`). The main
// process needs them so `SettingsService.reindexSearch()` and any
// other main-side `i18nService.t(...)` lookup resolves the right
// label / description string. Vite bundles these JSONs at build
// time so they ship with the main bundle.
import restormEnTranslation from '../renderer/locales/en/translation.json'
import restormFrTranslation from '../renderer/locales/fr/translation.json'
import { PROJECT_UUID_KEY } from '../shared/config/projectUuid'
import type { PersistenceFormat } from 'electron-core-ui'
import { dirname, join } from 'path'
import { existsSync, statSync } from 'fs'
import { spawn } from 'node:child_process'
import { searchIndexService, contextService, responseHistoryService, requestUsageService, scenarioUsageService, authenticationCacheService, updateService } from './services'
import { registerUpdateIpc } from './ipc/updateHandlers'
import { registerRestormMcp } from './mcp'
import { isHeadlessHost as isHeadlessHostPure, isMcpEnabledForLaunch, shouldLaunchInactive } from './mcp/mcpEnablement'
import { readAutoSaveOn, type InstanceLifecycleHost } from './mcp/tools/instances'
import { registerActiveStateBridge } from './mcp/tools/activeState'
import { RESTORM_MCP_INSTRUCTIONS } from './mcp/instructions'
import { graphQLService, getFeatureService, isFeatureServiceInitialized } from 'electron-core-ui/main'
import { clearUserSettings, parseCliArgs } from './cli/args'
import { checkHeadlessEntitlement } from './cli/headlessEntitlementFetch'
import { setupGraphQL } from './GraphQLSetup'
import { registerRestormIPC } from './IPCHandlers'
import { initEntitlementService, stopEntitlementAutoRefresh, makeBackendFetch, resolveBackendVersion } from './services/auth/authComposition'
import { createEntitlementEvaluator } from './services/entitlement/entitlementStrategy'
import { installScenarioEngineIPC } from './scenarioEngine/ipcBridge'
import { registerBuiltinSources } from './services/secrets/mainSourceRegistry'
import { secretHydrationService } from './services/secrets/SecretHydrationService'
import { websocketExecutionService } from './services/WebSocketExecutionService'
import { sseExecutionService } from './services/SseExecutionService'
import { amqpExecutionService } from './services/AMQPExecutionService'
import { redisExecutionService } from './services/RedisExecutionService'
import { grpcMockServerService } from './services/GRPCMockServerService'
import { odataMockServerService } from './services/ODataMockServerService'
import { stompExecutionService } from './services/StompExecutionService'
import { kafkaExecutionService } from './services/KafkaExecutionService'
import { registerApiUpdateIPC } from './services/apiUpdate/registerApiUpdateIPC'
import { runApiUpdateApply } from './services/apiUpdate/orchestrateApply'
import { loadFolderStructure, loadProjectIntoStore, attachDraftStoreForFolder, attachDraftStoreForFile, getDraftsRootDir } from './FileOperations'
import { runScenarioHeadless } from './cli/headlessRunner'
import { DEFAULT_UI_DELAY_MS } from '../shared/config/constants'
import { applyUserDataOverride } from './userDataOverride'
import { registerDeepLinkSchemes, handleDeepLinkUrl, isDeepLinkUrl } from './deepLink'
// DocumentEvents are handled by FileService internally for dirty state tracking

// Test-isolation hook. When `RESTORM_USER_DATA_OVERRIDE` is set,
// redirect Electron's `userData` to a per-run repo-local dir so
// parallel agents / tests don't share drafts, config.json, recent
// files, etc. Must run before any code path that touches userData
// (parseCliArgs's storage-aware `clearUserSettings`, FileService
// construction, draft boot — all run later down this file). Unset →
// production / dev behaviour is unchanged.
applyUserDataOverride(app)

// Allow WebGL via SwiftShader when the host GPU is blocked / unavailable.
// Without this, Chromium silently disables WebGL on machines where VA-API
// or hardware compositing fails to initialise, breaking decorative
// canvas-based effects (Globe / NeuroNoise wallpaper, etc.). With
// `enable-unsafe-swiftshader` Chromium falls back to software rendering
// only when hardware acceleration cannot start — hosts with working GPUs
// keep their accelerated path.
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

// Linux launch flags applied by the app itself so they hold however it is
// started — double-click, the auto-updater's relaunch (which passes NO args),
// or a terminal:
//   --no-sandbox: distros that restrict unprivileged user namespaces
//     (Ubuntu 24.04+/Kubuntu, AppArmor) SIGTRAP Chromium's sandbox at startup.
//     The .deb wrapper already passes this; setting it here also covers the
//     AppImage relaunch/double-click, where no wrapper intervenes.
//   --ozone-platform-hint=auto: run natively on the session's display server
//     (Wayland on Wayland, X11 otherwise) instead of forcing XWayland.
// Linux-only so the Windows/macOS sandbox stays on.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
}

// Set the app name for proper taskbar icon on Linux
// Without this, Electron 38+ may use the default "Electron" identity
app.name = 'restorm'

// ── Deep-link scheme registration (packaged OAuth callback) ─────────────────
//
// Register restorm:// (and restorm-preview:// for preview builds) as the OS
// default protocol client so the system browser can route the WorkOS callback
// back to the running packaged app. Must run before app.whenReady().
registerDeepLinkSchemes(app, app.getVersion())

// Single-instance lock for Windows/Linux protocol-handler routing.
// On those platforms the OS launches a NEW process with the deep-link URL in
// argv; `requestSingleInstanceLock` ensures the existing instance gets a
// `second-instance` event, handles the URL, and the OS-launched process exits.
//
// Multi-instance caveat: restorm supports concurrent windows (the MCP
// `create_instance` tool spawns additional processes). Spawned instances that
// fail the lock check are NOT exited — they continue without the lock unless
// their argv contains a deep-link URL (which identifies them as OS-launched
// protocol handlers, not user-requested new windows).
const deepLinkArgvUrl = process.argv.find((a) => isDeepLinkUrl(a))
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock && deepLinkArgvUrl !== undefined) {
  // This process was launched by the OS to handle a deep-link URL. The primary
  // instance received the `second-instance` event and will dispatch the URL —
  // nothing more for this process to do.
  app.exit(0)
}

// macOS: `open-url` fires on the ALREADY RUNNING instance; no single-instance
// lock is required.
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (isDeepLinkUrl(url)) {
    handleDeepLinkUrl(url)
  }
})

// Windows / Linux: the OS launches a second process with the deep-link URL in
// argv. That process exits early (see above); the primary instance receives the
// `second-instance` event carrying the second instance's argv.
app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => isDeepLinkUrl(a))
  if (url !== undefined) {
    handleDeepLinkUrl(url)
  }
})

const cliArgs = parseCliArgs()
if (cliArgs.clearSettings) {
  clearUserSettings()
}

// Headless CLI-run mode: keep restorm's own diagnostics off the console (only
// the scenario run-log should reach stdout) by raising the logger to `error`
// before anything else logs. `--run` requires `--open` to know which project
// to load — fail fast with a clear message otherwise.
if (cliArgs.cliRun) {
  logger.setLevel('error')
  if (cliArgs.open === undefined) {
    process.stderr.write('--run requires --open <project> (the .restorm file/folder containing the scenario)\n')
    app.exit(2)
  }
}

const fileToOpenOnStart = cliArgs.open
if (fileToOpenOnStart) {
  logger.info('File to open on start:', { path: fileToOpenOnStart })
}

// Keep track of main window and editor windows
let mainWindow: BrowserWindow | null = null
const editorWindows = new Set<BrowserWindow>()

function createWindow(): MainWindow | undefined {
  logger.info('Creating main window...')
  try {
    // Create main window (instance is stored in WindowManager singleton).
    // Returned to `initializeApp` so the splash handoff can hook the
    // window's ready-to-show (close the splash right before it appears).
    const mainWin = new MainWindow({ revealInactive: cliArgs.inactiveWindow })
    mainWindow = mainWin.getWindow()

    if (mainWindow) {
      // Route every `window.open()` from the renderer (and any
      // `target="_blank"` anchor click that bubbles up to it) through
      // the OS default browser instead of spawning a new Electron
      // window. The documentation viewer surfaces links from API
      // specs (externalDocs, contact URLs, content-license URLs, …)
      // — opening them in a stray Electron BrowserWindow would
      // confuse the user and lose history/bookmarks/extensions.
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) {
          void shell.openExternal(url)
        }
        return { action: 'deny' }
      })

      // Handle main window close event - check for unsaved changes
      mainWindow.on('close', (event) => {
        // Check if file is dirty and ask for confirmation
        if (isFileServiceInitialized() && getFileService().isDirty()) {
          event.preventDefault()

          // Show confirmation dialog
          void getFileService().showUnsavedChangesDialog().then((result) => {
            if (result === 'cancel') {
              // User cancelled - don't close
              return
            }

            if (result === 'save') {
              // User wants to save - send message to renderer to save
              // The renderer will handle saving and then close
              mainWindow?.webContents.send('app:save-and-close')
            } else {
              // User chose to discard - close all windows
              closeAllWindows()
            }
          })
        } else {
          // No unsaved changes - close all windows
          closeAllWindows()
        }
      })

      mainWindow.on('closed', () => {
        mainWindow = null
      })

      // Open a file or folder on startup. Handles both files and folders; the
      // caller decides WHICH path (command line, or the reopen-last-file path).
      const openPathOnStart = (targetPath: string): void => {
        const isDirectory = existsSync(targetPath) && statSync(targetPath).isDirectory()

        if (isDirectory) {
          logger.info('Opening folder...', { path: targetPath })
          if (!isPersistenceServiceInitialized()) {
            logger.warn('PersistenceService not initialized, cannot load folder')
            return
          }
          void loadFolderStructure(targetPath).then(async (result) => {
            if (result && mainWindow && isFileServiceInitialized()) {
              logger.info('Folder loaded, sending to renderer', {
                collectionsCount: (result.data as { collections?: unknown[] }).collections?.length,
                format: result.format
              })
              // Set the file state in FileService so the UI knows a file is open
              const fileService = getFileService() as { setOpenedFolder: (path: string, content: unknown, format?: string) => void }
              fileService.setOpenedFolder(targetPath, result.data, result.format)
              await attachDraftStoreForFolder(targetPath, result.format)
            } else {
              logger.error('Failed to load folder on startup', { result })
            }
          })
        } else if (isFileServiceInitialized()) {
          // FileService stamps `_projectUuid` before broadcasting `file:opened`
          // (configured via `uuidKey` on init), so this stays a simple open +
          // draft-store attach.
          logger.info('Opening file...', { path: targetPath })
          void getFileService().open(targetPath).then(async (result) => {
            if (result.success) {
              logger.info('File opened successfully on startup')
              // A `.restorm` project file is YAML on disk, and `open()`
              // reports no format of its own, so the draft store reads and
              // writes YAML too. Give it a different serializer only once
              // single-file projects can be something else.
              await attachDraftStoreForFile(targetPath, 'yaml')
            } else {
              logger.error('Failed to open file on startup:', { path: targetPath })
            }
          })
        } else {
          logger.warn('FileService not initialized, cannot open file')
        }
      }

      // The "reopen last file" path: only when the `files:reopenLastFile` user
      // setting is on AND the renderer-recorded path still exists on disk.
      const resolveReopenLastFilePath = (): string | null => {
        if (!isSettingsServiceInitialized()) return null
        if (getSettingsService().get(REOPEN_LAST_FILE_SETTING_KEY) !== true) return null
        const stored = getStorageService().get(REOPEN_LAST_FILE_STORAGE_KEY)
        if (typeof stored !== 'string' || stored.length === 0) return null
        return existsSync(stored) ? stored : null
      }

      // Open on startup via dom-ready (fires reliably with the app:// protocol).
      // Command-line path wins; otherwise honour the reopen-last-file setting.
      mainWindow.webContents.on('dom-ready', () => {
        // Wait for the renderer React app to be fully initialized and hooks mounted.
        setTimeout(() => {
          if (fileToOpenOnStart) {
            logger.info('Opening from command line', { path: fileToOpenOnStart })
            openPathOnStart(fileToOpenOnStart)
            return
          }
          const reopenPath = resolveReopenLastFilePath()
          if (reopenPath) {
            logger.info('Reopening last opened file', { path: reopenPath })
            openPathOnStart(reopenPath)
          }
        }, DEFAULT_UI_DELAY_MS)
      })
    }

    logger.info('Main window created successfully')
    return mainWin
  } catch (error) {
    logger.error('Failed to create main window:', { error: String(error) })
    throw error
  }
}

// Close all editor windows and then the main window
function closeAllWindows(): void {
  logger.info('Closing all windows...', { editorWindowCount: editorWindows.size })

  // Close all editor windows first
  for (const editorWin of editorWindows) {
    if (!editorWin.isDestroyed()) {
      editorWin.destroy() // Use destroy() to force close without triggering close event
    }
  }
  editorWindows.clear()

  // Then close main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy() // Use destroy() to force close
  }
}

// Get resources path from the core-ui package
function getResourcesPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    // In development, point directly to the monorepo's electron-core-ui resources
    // so that changes to YAML/JSON themes are picked up without reinstalling.
    // __dirname is restorm/dist/main, so we go up 3 levels to reach monorepo root
    return join(__dirname, '../../../electron-core-ui/resources')
  }

  // In production, resources are bundled under process.resourcesPath/resources
  return join(process.resourcesPath, 'resources')
}

// Get renderer path for static assets (images, etc.)
function getRendererPath(): string {
  // __dirname is dist/main in compiled code
  // In both dev and production, renderer is at ../renderer relative to main
  return join(__dirname, '../renderer')
}

// Get features configuration path for restorm
function getFeaturesConfigPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    // __dirname is dist/main in compiled code, go up two levels to project root
    return join(__dirname, '../../resources/features.yaml')
  }
  return join(process.resourcesPath, 'restorm-resources/features.yaml')
}

// Get settings configuration path for restorm
function getSettingsConfigPath(): string {
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  if (isDev) {
    const appPath = app.getAppPath()
    return join(appPath, 'resources/settings.yaml')
  }
  return join(process.resourcesPath, 'restorm-resources/settings.yaml')
}

// Initialize I18n Service for main process translations
// Default to system locale or 'en', will be synchronized with renderer via IPC
const systemLocale = app.getLocale().split('-')[0] ?? 'en'
const supportedLocales = ['en', 'fr']
const defaultLocale = supportedLocales.includes(systemLocale) ? systemLocale : 'en'
i18nService.initialize('', defaultLocale)
// Layer Restorm's renderer translations onto ECUI's built-ins so
// settings-yaml `titleKey` / `descriptionKey` lookups (e.g.
// `behavior.dateTimeFormat`, `behavior.syncSidebarWithTabs`) resolve
// during the SettingsService search-index rebuild that runs
// immediately after.
i18nService.addTranslations('en', restormEnTranslation as Record<string, unknown>)
i18nService.addTranslations('fr', restormFrTranslation as Record<string, unknown>)
logger.info('I18n Service initialized', { locale: defaultLocale })

// Initialize File Service for .restorm files with YAML serialization.
// `uuidKey` tells FileService which top-level field to preserve across
// saves — without this the renderer's `{ collections }` snapshots would
// strip the stamped UUID and each reopen would regenerate a fresh one.
initFileService({
  extension: '.restorm',
  defaultFormat: 'yaml',
  maxRecentFiles: 10,
  storagePrefix: 'restorm_',
  uuidKey: PROJECT_UUID_KEY
})
logger.info('File Service initialized')

// Attach a crash-recovery draft store whenever a `.restorm` file is
// opened in file mode. File mode and folder mode must behave identically
// with respect to dirty-state tracking and draft recovery — the only
// difference between them is the on-disk layout of the user's saved
// content.
//
// This listener is a SAFETY NET, not the complement of the explicit
// callers: it fires for EVERY file-mode open, including the ones that
// already call `attachDraftStoreForFile` themselves (`restorm:open-path`,
// the command-line / reopen-last-file startup path). `FileService.open()`
// publishes the new path synchronously, so this runs before the awaiting
// caller's own call and the two overlap. That's fine, and deliberately
// so: `attachDraftStore` de-duplicates per project, so however many
// callers converge on one open, the drafts are read once and the
// "unsaved work restored" toast fires once. Its value is covering the
// paths that DON'T attach explicitly — the plain `file:open` IPC — without
// each new call site having to remember to.
//
// Folder-mode opens never reach here (the path is a directory, filtered
// out below); they attach through `attachDraftStoreForFolder` only.
{
  let lastFilePath: string | null = null
  getFileService().onStateChanged((state) => {
    const path = state.currentFile.path
    if (path === lastFilePath) return
    lastFilePath = path

    // Workspace overlay path: a `.restorm` file lives alongside its
    // workspace dir, a folder mode opens its own dir. Both flows
    // converge here. SettingsService may not be ready yet on the
    // very first event; gate accordingly.
    if (isSettingsServiceInitialized()) {
      if (!path) {
        getSettingsService().unsetWorkspacePath()
      } else if (path.endsWith('.restorm')) {
        getSettingsService().setWorkspacePath(dirname(path))
      } else {
        getSettingsService().setWorkspacePath(path)
      }
    }

    if (!path) return
    // Folder-mode paths point to a directory; file-mode paths end in the
    // `.restorm` extension. Use the extension as the discriminator so we
    // don't have to hit the filesystem on every state change.
    if (!path.endsWith('.restorm')) return
    const format = (state.currentFile.format as PersistenceFormat | undefined) ?? 'yaml'
    void attachDraftStoreForFile(path, format).catch((err: unknown) => {
      logger.warn('attachDraftStoreForFile failed', { path, error: String(err) })
    })
  })
}

// Git wiring: GitService has no notion of "the open project file" — it
// only tracks a folder. Map the open file's containing folder the same
// way the workspace-path resolution above does (file mode: dirname of the
// `.restorm` path; folder mode: the path itself) and hand it to
// `setActiveFolder`, which starts (or stops) the repo status + watch.
{
  let lastGitFolder: string | null = null
  getFileService().onStateChanged((state) => {
    const path = state.currentFile.path
    const folder = !path ? null : path.endsWith('.restorm') ? dirname(path) : path
    if (folder === lastGitFolder) return
    lastGitFolder = folder
    void getGitService().setActiveFolder(folder).catch((err: unknown) => {
      logger.warn('GitService.setActiveFolder failed', { folder, error: String(err) })
    })
  })
}

// Initialize Persistence Service for folder mode support
initPersistenceService({
  extension: 'restorm',
  format: 'yaml',
  mode: 'single-file',
  indexFileName: 'index'
})
logger.info('Persistence Service initialized')

// Sweep drafts from projects that no longer exist on disk.
// `whenReady` ensures `app.getPath('userData')` is resolvable.
void app.whenReady().then(async () => {
  try {
    const removed = await FileService.cleanupOrphanedDrafts(getDraftsRootDir())
    if (removed > 0) {
      logger.info('Cleaned up orphaned draft directories', { removed })
    }
  } catch (error) {
    logger.warn('Orphaned drafts cleanup failed', { error: String(error) })
  }
})

// Dirty state is now handled by FileService via checksum comparison
// FileService subscribes to DocumentEvents internally and tracks per-object checksums
logger.info('Dirty state managed by FileService checksum system')

// Firewall wiring: Layer A listener + IPC bridge + restorm-internal
// auto-allow ports. The "infra ports" let restorm's own
// renderer ↔ main GraphQL bridge, the Vite dev server (in dev),
// and the embedded MCP server (when enabled) bypass the
// whitelist gate — only EXACTLY these `localhost:<port>` triples
// auto-allow; any other localhost port goes through the same
// whitelist / blacklist / project-origins checks as external
// hosts.
void app.whenReady().then(() => {
  firewallService.registerWebRequestListener()
  registerFirewallIpc()
  // Patch worker_threads.Worker + child_process.fork so spawned
  // contexts inherit a "deny everything outbound" posture. Restorm
  // doesn't currently use either, so this is a defensive measure
  // against a future npm dep that does.
  installWorkerPatcher()
  // GraphQL bridge port is always known by `whenReady`. Vite
  // dev port comes from electron-vite's env var (undefined in
  // prod). MCP port is registered later when `mcpService.start`
  // resolves (see below).
  const graphqlEndpoint = graphQLService.getEndpoint()
  let graphqlPort: number | null = null
  try { graphqlPort = Number(new URL(graphqlEndpoint).port) || null } catch { /* leave null */ }
  let viteDevPort: number | null = null
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (typeof rendererUrl === 'string' && rendererUrl !== '') {
    try { viteDevPort = Number(new URL(rendererUrl).port) || null } catch { /* leave null */ }
  }
  permissionService.setInfraPorts({ graphqlPort, viteDevPort })
})

// Auto-deny every outstanding firewall prompt on shutdown so
// Layer A's `onBeforeRequest` callbacks don't leave Chromium
// requests hanging while the app is being torn down.
app.on('before-quit', () => {
  permissionService.denyAllPending()
  // Drop every resolved credential so no plaintext lingers in memory
  // past the app's lifetime.
  secretHydrationService.clearAll()
  // Gracefully close every live connection + any hosted Socket.IO server so a
  // server route doesn't linger past quit (process exit would reclaim the port,
  // but this flushes history + closes clients cleanly). Fire-and-forget: the
  // process is exiting, so we don't await the OS socket release here.
  void websocketExecutionService.closeAll()
  // Same for any open SSE connections (no server/port to release — client-only).
  sseExecutionService.closeAll()
  // Same for any open AMQP subscribe connection.
  void amqpExecutionService.closeAll()
  // Same for any open Redis subscribe connection.
  void redisExecutionService.closeAll()
  // Same for any hosted gRPC mock server (its own grpc.Server / port).
  grpcMockServerService.closeAll()
  // Same for any hosted OData mock service (its routes on the shared HTTP host).
  odataMockServerService.closeAll()
  // Same for any live STOMP connection (no port to release, just DISCONNECT +
  // close the socket, and drop its outgoing heart-beat interval) — was only
  // wired on file-close, so it survived a quit that skipped that path (closing
  // the window directly rather than closing the file first).
  stompExecutionService.closeAll()
  // Same for any live Kafka browse peek / long-lived consumer — same gap as
  // STOMP above (file-close only, not app-quit).
  void kafkaExecutionService.closeAll()
  // Stop the git semi-pull CRON poll: clears its interval AND detaches its
  // settings-change subscription (see `GitSemiPullController` in
  // electron-core-ui), neither of which should outlive the process.
  getGitSemiPullController()?.stop()
})

// Initialize Search Index Service (listens to document events from renderer)
searchIndexService.initialize()
logger.info('Search Index Service initialized')

// Initialize Context Service (manages Handlebars context and resolved values)
contextService.initialize()
logger.info('Context Service initialized')

// Mirror the renderer's per-env-folder active-environment selection into the
// main process — unconditionally, NOT only when MCP is on. ContextService needs it
// to decide which environment an item inherits for its secret badge (the active
// env, not just the first one). Idempotent; the MCP path also calls it.
registerActiveStateBridge()

// Initialize Response History Service (stores executed responses)
responseHistoryService.initialize()
logger.info('Response History Service initialized')

// Initialize Request Usage Service (per-request send counter + recent
// history, powers the EmptyBench "Top played" / "Recent activity"
// surfaces). Persists to ECUI's user-level `StorageService`.
requestUsageService.initialize()
// Scenario run counts — the scenario counterpart, surfaced next to requests
// in the EmptyBench recent-activity lists.
scenarioUsageService.initialize()
logger.info('Request Usage Service initialized')

// Initialize Authentication Cache Service. We only need the subscription
// wiring (REQUEST_DELETED → invalidate) here — the cache itself is ready
// as soon as the module is imported.
authenticationCacheService.initialize()
logger.info('Authentication Cache Service initialized')

// Initialize GraphQL Service and register graphql:query IPC handler
setupGraphQL()

// Initialize Electron application
const resourcesPath = getResourcesPath()
const rendererPath = getRendererPath()
const settingsConfigPath = getSettingsConfigPath()
const featuresConfigPath = getFeaturesConfigPath()
// A CLI run with `--headless` suppresses the window entirely (the engine +
// collectionStore run window-free) while keeping all the service init
// initializeApp performs (SettingsService, IPC, …) that the run depends on.
// Without `--headless` the window is shown for visual feedback; the run still
// executes in the main process and exits when done.
const suppressWindow = cliArgs.cliRun?.headless === true
// Suppress the splash under the Playwright e2e harness. The fixtures grab the
// app's FIRST BrowserWindow (`electronApp.firstWindow()`); since the splash is
// created before the main window, it would otherwise become that first window
// and every test would drive the frameless logo splash instead of the app.
// `RESTORM_USER_DATA_OVERRIDE` is the harness's per-launch signal (set by the
// e2e launch helper, same gate the firewall's E2E bypass reads) — never set in
// real launches, so the splash stays intact for users.
const isE2E = typeof process.env['RESTORM_USER_DATA_OVERRIDE'] === 'string' && process.env['RESTORM_USER_DATA_OVERRIDE'].length > 0
const suppressSplash = suppressWindow || isE2E
// restorm's splash content: the static logo. The window + mechanics
// (centered, frameless, whole-surface drag, show-main-only-when-ready) live
// in electron-core-ui — restorm just points it at the asset. `__dirname` is
// `dist/main`, so `../../assets` reaches the project's `assets/` dir (same
// anchor as the window icon path). Suppressed in headless CLI runs (no UI) and
// under the e2e harness (keeps the main window as the first window).
initializeApp('restorm', {
  createWindow: suppressWindow ? () => { /* headless: no window */ } : createWindow,
  devResourcesPath: resourcesPath,
  rendererPath: rendererPath || undefined,
  appSettingsConfigPath: settingsConfigPath,
  appFeaturesConfigPath: featuresConfigPath,
  ...(suppressSplash ? {} : {
    splash: {
      logoPath: join(__dirname, '../../assets/imgs/logo_400.png'),
      background: '#1a1a2e'
    }
  })
})

// Wire the AutoSaveController once both SettingsService (initialized
// inside `initializeApp` → `setupIPC` on `app.whenReady`) and
// FileService are ready. The controller only decides *when* to fire
// — the actual save runs in the renderer in response to the
// `'file:autosave-trigger'` IPC, mapped to the existing
// `handleMenuSaveAll` flow. The `whenReady` indirection is required
// because `initializeApp` schedules `setupIPC` asynchronously.
void app.whenReady().then(() => {
  initAutoSaveController({
    settings: getSettingsService(),
    fileService: getFileService()
  })
  logger.info('AutoSave controller initialized')
})

// Wire the GitSemiPullController the same way — reads the `git:
// semiPullFrequency` setting (`resources/settings.yaml`'s `git` group)
// and calls `GitService.checkForRemoteUpdate()` on that schedule. The
// active-folder wiring above already covers check-on-open + the folder
// watch; this covers the unattended periodic check (AC#4/#5 of the
// semi-pull CRON ticket).
void app.whenReady().then(() => {
  initGitSemiPullController({
    settings: getSettingsService(),
    gitService: getGitService()
  })
  logger.info('Git semi-pull CRON controller initialized')
})

// Silent auto-update: check on launch + every 4 h + a manual button, download
// in the background, install on next quit. Inert in dev (no feed) unless the
// dev mock is enabled. Built after `whenReady` (queued after `initializeApp`'s
// own `setupIPC` callback) so the Settings + Storage services it reads are ready.
void app.whenReady().then(() => {
  updateService.initialize()
  logger.info('Update Service initialized')
})

// Auth + entitlement: the reactive capability source of truth
// (login loopback, offline entitlement cache, IPC). Built after `whenReady` so
// `app.getPath('userData')` (the encrypted token cache) and `safeStorage` are
// resolvable. Registers its own IPC and restores a cached session internally.
void app.whenReady().then(() => {
  const entitlementService = initEntitlementService()
  // Register the 'Entitlement' custom strategy so features.yaml entries that
  // declare `Type: Entitlement` / `RequiredCapabilities: [...]` are evaluated
  // against the live auth state. `setupIPC` (called inside `initializeApp`'s
  // own `whenReady` callback, which queued ahead of this one) has already
  // called `initFeatureService`, so the service is guaranteed to be ready here.
  if (isFeatureServiceInitialized()) {
    getFeatureService().registerStrategy(
      'Entitlement',
      createEntitlementEvaluator(() => entitlementService.getState())
    )
    logger.info('FeatureFlippingService: Entitlement strategy registered')
  }
})

// Tear down the entitlement auto-refresh triggers (poll timer + window-focus
// listener) on quit so neither outlives the process.
app.on('before-quit', () => {
  stopEntitlementAutoRefresh()
})

// Embedded MCP server. On by default — every normal launch exposes the
// MCP server so AI tooling (Claude Code & friends) can drive the running
// app without needing a special flag. Governed solely by the user-facing
// Settings toggle (mcp:enabled, default ON) plus the headless rule (never
// start with no usable display); there is no CLI flag / env var. Per-process
// bearer token + loopback-only bind preserved verbatim — zero change to the
// security model.
// Per-process bearer token for the MCP HTTP endpoint. Generated once
// at module load and regenerated on every restorm restart. The launcher
// reads it from the discovery file and injects `Authorization: Bearer <token>`
// on every forwarded request — totally transparent for Claude Code / Cursor.
const mcpAuthToken = randomBytes(16).toString('hex')
// Shared discovery dir where every live restorm instance drops its lockfile.
// MUST resolve identically to `DISCOVERY_DIR` in scripts/mcp-launcher.mjs
// (RESTORM_MCP_DIR pins it; unset → os.tmpdir()/restorm-mcp) so restorm and
// the standalone launcher rendezvous on the same path.
const MCP_DISCOVERY_DIR = resolveMcpDiscoveryDir('restorm-mcp', process.env.RESTORM_MCP_DIR)

/** Settings storage key (`<groupId>:<settingId>`) for the served-MCP-call
 * retention cap — see the `mcp` group in `resources/settings.yaml`. */
const MCP_LOGS_RETENTION_CAP_KEY = 'mcp:logsRetentionCap'
/** Settings key for how many recent entries keep their heavy capture payload
 * (image base64 / video temp file) — see the `mcp` group in settings.yaml. */
const MCP_CAPTURE_RETENTION_CAP_KEY = 'mcp:captureRetentionCap'
/** Settings key for the user-facing "enable MCP server" toggle. */
const MCP_ENABLED_KEY = 'mcp:enabled'

/** Read the MCP-enabled toggle. Returns `false` ONLY when the user has
 * explicitly turned it off (the toggle persists a real boolean); a cleared /
 * never-set value (undefined or the settings store's empty-string default)
 * counts as ON, since MCP is on by default. This is the ONE persistent control
 * (Preferences) — there is no CLI flag / env var to toggle MCP anymore. */
function getMcpEnabledSetting(): boolean {
  if (!isSettingsServiceInitialized()) return true
  return getSettingsService().get(MCP_ENABLED_KEY) !== false
}

/** True on a true headless host (no usable display). See `isHeadlessHost` in
 * `mcp/mcpEnablement.ts` — MCP must never start there. */
function isHeadlessHost(): boolean {
  return isHeadlessHostPure({ platform: process.platform, env: process.env })
}

/** Effective MCP-on decision for THIS launch: the user setting (default ON)
 * AND a usable display (never on a headless host). Computed at boot and on
 * each runtime toggle; mirrored to the renderer via `runtime:get-config`. */
function isMcpEnabledThisSession(): boolean {
  const settingValue = isSettingsServiceInitialized()
    ? getSettingsService().get(MCP_ENABLED_KEY)
    : undefined
  return isMcpEnabledForLaunch({ settingValue, platform: process.platform, env: process.env })
}

const mcpService = new McpService({
  serverInfo: { name: 'restorm', version: app.getVersion() },
  instructions: RESTORM_MCP_INSTRUCTIONS,
  authToken: mcpAuthToken,
  // Name this instance + point at the shared discovery dir so a `tools/call`
  // carrying `__session: "<other-name>"` is routed to the peer that owns that
  // name (ECUI resolves it in the lockfile dir + forwards). No `__session` /
  // our own name → runs locally, unchanged.
  sessionName: cliArgs.mcpSessionName,
  discoveryDir: MCP_DISCOVERY_DIR
  // No `ffmpegPath`: restorm deliberately does NOT bundle a static ffmpeg.
  // The screencast MP4 remux uses a system `ffmpeg` when one is on PATH and
  // degrades to serving the raw WebM otherwise. Bundling a per-OS binary would
  // add ~70-90 MB per installer and a libx264/GPL licensing burden that isn't
  // justified for a dev/agent-centric capture feature. Revisit only if a
  // user-facing video feature ever ships. (See McpServiceOptions.ffmpegPath —
  // the injection point exists so an app that DOES bundle ffmpeg can wire it.)
})

/** Broadcast the current MCP server state (running / stopped) to all renderer
 * windows so the statusbar indicator can reflect a runtime toggle immediately. */
function broadcastMcpServerState(): void {
  const port = mcpService.getPort()
  const payload = { running: port !== null, port }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mcp:server-state-changed', payload)
  }
}

/** Tracks whether the restorm-domain tools/resources + IPC bridges have been
 * registered. Registration is once-per-process: `registerRestormMcp` calls
 * `McpService.registerTool` (throws on a duplicate name) and `ipcMain.handle`
 * (throws on a second handler), so it MUST NOT run again on a runtime resume.
 * The tool registry + bridges survive `mcpService.stop()` (only the HTTP
 * listener is torn down), so a resume just re-listens + re-writes the lockfile. */
let restormMcpRegistered = false

/** Wire the long-lived McpService event subscriptions (request ripple, served-call
 * log refresh, retention caps, discovery-file project refresh). These are
 * subscriptions on the service, NOT the HTTP listener, so they survive a runtime
 * stop/resume and are wired exactly once — alongside tool registration — on the
 * first start, whether that's at boot or via the runtime toggle. */
function wireMcpServiceListeners(): void {
  // Forward every incoming MCP request as an IPC `mcp:request-received`
  // ping to all renderer windows. Drives the ripple animation on the
  // statusbar's MCP indicator. No payload — the event is just a
  // tick-of-activity, the renderer instantiates one ripple per
  // ping and lets each instance unmount on `onAnimationEnd`.
  mcpService.onRequest(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mcp:request-received')
    }
  })

  // Broadcast served-call buffer changes to every renderer so an open MCP
  // logs viewer refreshes live (a call recorded, the buffer cleared, or
  // trimmed by a cap change).
  mcpService.onServedCall(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mcp:logs-changed')
    }
  })

  // Apply the configurable retention cap from settings, and keep the buffer
  // sized as the user changes it. The setting is read defensively (number
  // only); a missing / non-numeric value leaves the service default (100).
  if (isSettingsServiceInitialized()) {
    const settings = getSettingsService()
    const applyCap = (value: unknown): void => {
      if (typeof value === 'number') mcpService.setLogRetentionCap(value)
    }
    applyCap(settings.get(MCP_LOGS_RETENTION_CAP_KEY))
    settings.onSettingChanged(MCP_LOGS_RETENTION_CAP_KEY, applyCap)
    // Same plumbing for the media-capture retention count (how many recent
    // entries keep their image base64 / video temp file).
    const applyCaptureCap = (value: unknown): void => {
      if (typeof value === 'number') mcpService.setCaptureRetentionCap(value)
    }
    applyCaptureCap(settings.get(MCP_CAPTURE_RETENTION_CAP_KEY))
    settings.onSettingChanged(MCP_CAPTURE_RETENTION_CAP_KEY, applyCaptureCap)
  }

  // Refresh the discovery file when the active project changes so
  // launchers that route by project path see the up-to-date value, and so
  // the create-instance uniqueness check (which keys on the open file) is
  // accurate. Refresh even while MCP is CUT: a cut instance keeps its
  // lockfile (mcpActive:false) so the internal "all instances" view still
  // blocks creating a second instance on the same file it has open.
  getFileService().onStateChanged((state) => {
    void writeDiscoveryLockfile(mcpService.getPort() !== null, state.currentFile.path)
  })
}

/** Resolve the path of the project this instance currently has open, for the
 * discovery lockfile. `null` when nothing is open / FileService isn't ready. */
function currentProjectPath(): string | null {
  return isFileServiceInitialized() ? getFileService().getFilePath() : null
}

/**
 * Write this instance's discovery lockfile. `active` reflects whether the
 * embedded MCP server is currently accepting commands:
 *   - `true`  → MCP-active entry (live port + bearer token), routable + listed.
 *   - `false` → CUT marker: port 0, mcpActive:false, and an EMPTY token. Kept so
 *     the internal create-uniqueness view sees the instance (name + open file),
 *     but never routed to nor listed in the AI-facing instance list. The token
 *     is blanked as defence-in-depth — a cut instance must never persist a
 *     usable bearer secret on disk (the endpoint is down anyway).
 */
async function writeDiscoveryLockfile(active: boolean, projectPath: string | null): Promise<void> {
  await writeMcpDiscoveryFile(MCP_DISCOVERY_DIR, {
    port: active ? (mcpService.getPort() ?? 0) : 0,
    projectPath,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: active ? mcpAuthToken : '',
    name: cliArgs.mcpSessionName,
    mcpActive: active
  }, cliArgs.mcpDiscoveryFile)
}

/**
 * Spawn a NEW detached restorm instance (the create-instance route's only
 * side-effect). MCP is on by default (governed by the setting), so no flag is
 * needed; we pass an optional `-o <file>` and an optional `--mcp-session-name`.
 *
 * Window focus: a create-instance is a USER-facing action — the user asked the
 * AI to open something and must SEE it — so the new window launches ACTIVE
 * (focused/raised) by default. The focus-stealing-suppression flag
 * (`--inactive-window`) is passed ONLY under the e2e/test marker
 * (`RESTORM_USER_DATA_OVERRIDE`, set by the Playwright fixture) so automated
 * launches don't steal the harness's focus; a real user always gets the new
 * window up front.
 *
 * Detached so it outlives this process. Dev vs packaged: in dev we go through
 * `pnpm dev:restorm`; packaged, we re-exec our own binary.
 */
function spawnRestormInstance(file: string | null, name: string | null): void {
  const inactive = shouldLaunchInactive(process.env)
  const passthrough: string[] = inactive ? ['--inactive-window'] : []
  if (file) passthrough.push('-o', file)
  if (name) passthrough.push(`--mcp-session-name=${name}`)
  const env = { ...process.env }
  // Only when launching INACTIVE (the e2e/test marker): strip the desktop
  // activation tokens so the new window can't grab focus / switch desktop on
  // Wayland. A real user launch is ACTIVE on purpose — keep the tokens so the
  // compositor actually grants it focus.
  if (inactive) {
    delete env['XDG_ACTIVATION_TOKEN']
    delete env['DESKTOP_STARTUP_ID']
  }
  const isDev = process.env['NODE_ENV'] === 'development' || !app.isPackaged
  const child = isDev
    ? spawn('pnpm', ['dev:restorm', '--', ...passthrough], {
        cwd: join(__dirname, '../../..'), // restorm/dist/main → monorepo root
        detached: true,
        stdio: 'ignore',
        env
      })
    : spawn(process.execPath, passthrough, { detached: true, stdio: 'ignore', env })
  child.unref()
  logger.info('Spawned new restorm instance', { file, name, isDev })
}

/** Host adapter the instance-lifecycle MCP tools (create/terminate) drive. The
 * Electron-specific side-effects live here so the tools + decision logic stay
 * testable + Electron-free. */
const instanceLifecycleHost: InstanceLifecycleHost = {
  discoveryDir: MCP_DISCOVERY_DIR,
  selfPid: process.pid,
  spawnInstance: (file, name) => { spawnRestormInstance(file, name) },
  isAutoSaveOn: () => readAutoSaveOn(),
  saveThenClose: () => { mainWindow?.webContents.send('app:save-and-close') },
  discardThenClose: () => { closeAllWindows() },
  closeNow: () => { closeAllWindows() },
  showSaveModal: () => {
    // File→Quit's confirmation modal. Non-blocking: fire the dialog and act on
    // the user's choice when it resolves; the route already returned
    // "awaiting user confirmation" without waiting on this.
    if (!isFileServiceInitialized()) { closeAllWindows(); return }
    void getFileService().showUnsavedChangesDialog().then((result) => {
      if (result === 'save') mainWindow?.webContents.send('app:save-and-close')
      else if (result === 'discard') closeAllWindows()
      // 'cancel' → leave the instance running.
    })
  }
}

/** Start the MCP server, write discovery lockfile, wire firewall port. Idempotent:
 * no-ops if already running. */
async function startMcpServer(): Promise<void> {
  if (mcpService.getPort() !== null) return
  // Register restorm-domain tools + resources ONCE, before the first
  // `start()`, so the first incoming request sees the full registry. Order
  // matters: the active-state IPC bridge is wired here too. Guarded so a
  // runtime resume (stop → start) doesn't re-register — re-registering would
  // throw on the first duplicate tool name / IPC handler and abort the resume.
  if (!restormMcpRegistered) {
    registerRestormMcp(mcpService, instanceLifecycleHost)
    wireMcpServiceListeners()
    restormMcpRegistered = true
  }

  await mcpService.start(0)
  const port = mcpService.getPort()
  if (port === null) {
    logger.error('MCP service started but reports no port')
    return
  }
  // Tell the firewall about the freshly-bound MCP port so
  // restorm's own MCP traffic to localhost auto-allows. Any
  // OTHER localhost port still goes through the regular
  // whitelist / blacklist gates.
  permissionService.setInfraPorts({ mcpPort: port })
  await writeDiscoveryLockfile(true, currentProjectPath())

  broadcastMcpServerState()
  logger.info('MCP server started', { port })
}

/**
 * Stop (CUT) the MCP server. Idempotent: no-ops if already stopped. The HTTP
 * endpoint is torn down so the instance REFUSES MCP commands (the hard
 * lockout) — but the discovery lockfile is REWRITTEN as a CUT marker
 * (mcpActive:false), NOT deleted, so the internal create-uniqueness view still
 * knows this pid + name + open file exists (a second instance must not be
 * created on the same file). Full lockfile removal happens only on quit.
 */
async function stopMcpServer(): Promise<void> {
  if (mcpService.getPort() === null) return
  await mcpService.stop()
  await writeDiscoveryLockfile(false, currentProjectPath())
  broadcastMcpServerState()
  logger.info('MCP server stopped by user (cut — instance now refuses MCP commands)')
}

void app.whenReady().then(async () => {
  // MCP starts iff the user setting is on (default ON; only an EXPLICIT false
  // disables it — a cleared/never-set value reads back as undefined or the
  // store's empty-string default, both of which keep MCP on) AND the host has a
  // usable display (never on a true headless box). There is no CLI flag / env
  // var anymore — the setting + the headless rule are the only inputs.
  if (!isMcpEnabledThisSession()) {
    logger.info('MCP server disabled', {
      settingEnabled: getMcpEnabledSetting(),
      headless: isHeadlessHost()
    })
    return
  }

  try {
    // Wires the long-lived McpService listeners (once) + starts the server.
    await startMcpServer()
  } catch (error) {
    logger.error('Failed to start MCP service', { error: String(error) })
  }
})

// Runtime stop/resume — called by the statusbar toggle button. SESSION-ONLY:
// it cuts/resumes the in-process MCP server for THIS run, but deliberately does
// NOT write the `mcp:enabled` setting. The setting (Preferences, default ON) is
// the one and only persistent control, so a runtime cut never carries over to
// the next launch — the user who hits "stop" to halt a misbehaving AI gets MCP
// back on a normal relaunch, and only an explicit preference change persists.
ipcMain.handle('mcp:toggle-server', async () => {
  const running = mcpService.getPort() !== null
  try {
    if (running) {
      await stopMcpServer()
    } else {
      await startMcpServer()
    }
    const port = mcpService.getPort()
    return { running: port !== null, port }
  } catch (error) {
    logger.error('mcp:toggle-server failed', { error: String(error) })
    const port = mcpService.getPort()
    return { running: port !== null, port, error: String(error) }
  }
})

app.on('before-quit', () => {
  // Always remove the lockfile on quit — the instance is going away, so neither
  // the AI-facing list nor the internal create-uniqueness view should keep
  // seeing it. This covers all three states: running (lockfile present), CUT
  // (mcpActive:false marker present), and toggled-on-from-a-disabled-launch.
  void cleanupMcpDiscoveryFile(MCP_DISCOVERY_DIR, process.pid, cliArgs.mcpDiscoveryFile)
  void mcpService.stop()
  updateService.dispose()
})

// Renderer-facing read of runtime config — MCP state + GraphQL
// endpoint. Both can change between restorm boots (free ports), so the
// renderer fetches them once at startup instead of hardcoding.
ipcMain.handle('runtime:get-config', () => ({
  mcp: {
    // Whether MCP is governed-on for this launch (setting ON + not headless).
    // The renderer enables its MCP-driven features + statusbar indicator on
    // this; the live `running` flag below reflects the runtime stop/resume.
    enabled: isMcpEnabledThisSession(),
    port: mcpService.getPort(),
    sessionName: cliArgs.mcpSessionName,
    running: mcpService.getPort() !== null
  },
  graphql: {
    endpoint: graphQLService.getEndpoint()
  },
  // Channel-resolved marketing-site pricing page (dev site on preview builds,
  // restorm.app on release). Surfaced so the MCP Pro upsell link in the renderer
  // and the MCP 402 refusal's upgradeUrl (resolved main-side via the same
  // `pricingUrl`) point at the same page — one source of truth, no drift.
  pricingUrl: pricingUrl(resolveChannel(app.getVersion()))
}))

// The running app version, surfaced to the renderer for the far-left
// statusbar version cell. `app.getVersion()` reads package.json's `version`,
// so the `-preview` suffix rides preview builds for free (the release strips
// it) — nothing channel-specific to compute here.
ipcMain.handle('app:get-version', () => app.getVersion())

// MCP call-logs viewer bridge: the buffer lives in the main process (ECUI
// McpService). The renderer pulls a snapshot, refreshes on `mcp:logs-changed`
// (broadcast from the served-call listener wired in `whenReady`), and clears
// it on demand.
ipcMain.handle('mcp:get-logs', () => mcpService.getServedCalls())
ipcMain.handle('mcp:clear-logs', () => { mcpService.clearServedCalls() })

// Register all restorm-specific IPC handlers
registerRestormIPC({ editorWindows, closeAllWindows })

// Auto-update IPC (window.api.update.*)
registerUpdateIpc()

// Wire the scenario execution engine's IPC bridge unconditionally — the Run /
// Debug / Step controls in the scenario editor drive it, so it must exist in
// every build, not only when the embedded MCP server is enabled. Idempotent:
// the MCP setup path calls it again as a no-op.
installScenarioEngineIPC()

// Register the built-in secret value sources (EnvVar, …) so the
// SecretHydrationService can resolve a request's SecretValues before
// dispatch. Idempotent — safe regardless of which startup path ran.
registerBuiltinSources()

// Headless CLI-run: load the --open project into the main-side store, run the
// named scenario through the real engine (no window), stream its run-log, and
// exit with a status reflecting the outcome. Runs after `initializeApp` has
// wired SettingsService (so the file-IO workspace path resolves) — we poll for
// readiness rather than assume an ordering between async `whenReady` callbacks.
if (cliArgs.cliRun && cliArgs.open !== undefined) {
  const project = cliArgs.open
  const cliRun = cliArgs.cliRun
  void app.whenReady().then(async () => {
    const settingsReady = async (): Promise<void> => {
      for (let i = 0; i < 250 && !isSettingsServiceInitialized(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    try {
      await settingsReady()

      // Gate: scenario.headless capability required.  The user must export
      // RESTORM_TOKEN (an org-scoped PAT with rstk_… prefix, minted on their
      // account) so CI runners can authenticate without a browser login.
      // Dev-only e2e bypass: RESTORM_E2E_ENTITLEMENT_PLAN seeds a Pro entitlement
      // for the interactive path (seedEntitlementForE2E); extend the same privilege
      // here so headless CLI e2e tests can run without a real token.  The
      // isPackaged guard ensures this is never reachable in a production build.
      // `resolveBackendVersion()` (not `app.getVersion()`) so a stage e2e can pin
      // the DEV/preview channel: an unpackaged build loses the `-preview` package
      // version and would otherwise resolve the PROD entitlement endpoint.
      const backendVersion = resolveBackendVersion()
      const channel = resolveChannel(backendVersion)
      const e2ePlan = process.env['RESTORM_E2E_ENTITLEMENT_PLAN']
      const skipGateForE2E = !app.isPackaged && (e2ePlan === 'pro' || e2ePlan === 'enterprise')
      const entResult = skipGateForE2E ? { granted: true as const } : await checkHeadlessEntitlement({
        entitlementUrl: endpointUrl(channel, 'entitlement'),
        publicKeyPem: entitlementPublicKeyPem(channel),
        publicKeyConfigured: isEntitlementPublicKeyConfigured(channel),
        fetchImpl: makeBackendFetch(backendVersion)
      })
      if (!entResult.granted) {
        const upgradeUrl = pricingUrl(channel)
        switch (entResult.reason) {
          case 'token-missing':
            process.stderr.write(
              'Headless scenario runs require a Restorm Pro plan and a CI token.\n' +
              `Set RESTORM_TOKEN to a token minted on your account.\n` +
              `Subscribe or get a token: ${upgradeUrl}\n`
            )
            break
          case 'plan-insufficient':
            process.stderr.write(
              'Headless scenario runs require a Pro or Enterprise plan.\n' +
              `Your CI token is valid but the org plan does not grant scenario.headless.\n` +
              `Upgrade: ${upgradeUrl}\n`
            )
            break
          case 'fetch-error':
            process.stderr.write(
              'Could not verify RESTORM_TOKEN: entitlement endpoint unreachable.\n' +
              'Check your network connection and try again.\n'
            )
            break
          default:
            // 'token-invalid': bad signature / expired / revoked
            process.stderr.write(
              'RESTORM_TOKEN is invalid or has been revoked.\n' +
              `Generate a new token on your account: ${upgradeUrl}\n`
            )
        }
        app.exit(3)
        return
      }

      await loadProjectIntoStore(project)
      const code = await runScenarioHeadless(cliRun)
      app.exit(code)
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      app.exit(1)
    }
  })
}

// Wire the periodic API-update flow. The CollectionStore + persistence
// hooks are passed in so this module stays unaware of where the data
// lives — bootstrap is the only place that knows both.
registerApiUpdateIPC({
  updateFolderConfig: (folderId, patch) => {
    // Lazy import to avoid pulling CollectionStore into the apiUpdate
    // service's compile-time graph; the runtime cycle is harmless.
    void import('./services/CollectionStore').then(({ collectionStore }) => {
      const folder = collectionStore.findById(folderId)
      if (!folder || !('folderType' in folder)) return
      const env = folder as unknown as { apiUpdate?: typeof patch }
      env.apiUpdate = { ...(env.apiUpdate ?? {}), ...patch } as typeof patch
    })
  },
  applyUpdate: async (folderId, selection) => runApiUpdateApply(folderId, selection)
})
