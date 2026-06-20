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
// traffic (a `tools/call` forwarded to a peer `--mcp` instance over
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
import { initializeApp, logger, initFileService, getFileService, isFileServiceInitialized, i18nService, initPersistenceService, isPersistenceServiceInitialized, FileService, getSettingsService, isSettingsServiceInitialized, getStorageService, initAutoSaveController, McpService, resolveMcpDiscoveryDir, writeMcpDiscoveryFile, cleanupMcpDiscoveryFile, firewallService, permissionService, registerFirewallIpc, installWorkerPatcher } from 'electron-core-ui'
import { REOPEN_LAST_FILE_SETTING_KEY, REOPEN_LAST_FILE_STORAGE_KEY } from '../shared/config/reopenLastFile'
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
import { searchIndexService, contextService, responseHistoryService, requestUsageService, scenarioUsageService, authenticationCacheService } from './services'
import { registerRestormMcp } from './mcp'
import { registerActiveStateBridge } from './mcp/tools/activeState'
import { RESTORM_MCP_INSTRUCTIONS } from './mcp/instructions'
import { graphQLService } from 'electron-core-ui/main'
import { clearUserSettings, parseCliArgs } from './cli/args'
import { setupGraphQL } from './GraphQLSetup'
import { registerRestormIPC } from './IPCHandlers'
import { installScenarioEngineIPC } from './scenarioEngine/ipcBridge'
import { registerBuiltinSources } from './services/secrets/mainSourceRegistry'
import { secretHydrationService } from './services/secrets/SecretHydrationService'
import { websocketExecutionService } from './services/WebSocketExecutionService'
import { registerApiUpdateIPC } from './services/apiUpdate/registerApiUpdateIPC'
import { runApiUpdateApply } from './services/apiUpdate/orchestrateApply'
import { loadFolderStructure, loadProjectIntoStore, attachDraftStoreForFolder, attachDraftStoreForFile, getDraftsRootDir } from './FileOperations'
import { runScenarioHeadless } from './cli/headlessRunner'
import { DEFAULT_UI_DELAY_MS } from '../shared/config/constants'
import { applyUserDataOverride } from './userDataOverride'
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

// Set the app name for proper taskbar icon on Linux
// Without this, Electron 38+ may use the default "Electron" identity
app.name = 'restorm'

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
              const format = (result as { format?: string }).format ?? 'yaml'
              await attachDraftStoreForFile(targetPath, format as PersistenceFormat)
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
// content. Folder mode wires the draft store through the dedicated
// `restorm:open-path` / command-line paths above; this listener covers
// the regular `file:open` IPC which goes straight to FileService.
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
// and the MCP server (when launched with `--mcp`) bypass the
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
  // but this flushes history + closes clients cleanly).
  websocketExecutionService.closeAll()
})

// Initialize Search Index Service (listens to document events from renderer)
searchIndexService.initialize()
logger.info('Search Index Service initialized')

// Initialize Context Service (manages Handlebars context and resolved values)
contextService.initialize()
logger.info('Context Service initialized')

// Mirror the renderer's per-env-folder active-environment selection into the
// main process — unconditionally, NOT only under --mcp. ContextService needs it
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

// Embedded MCP server. Off by default; the user opts in via `--mcp`
// on the CLI (or `ECUI_MCP=1` env var). When enabled, AI tooling
// (Claude Code & friends) can drive the running app — taking
// screenshots, listing collections, etc. — over a loopback port the
// OS picks for us. Restorm announces the chosen port via the
// discovery lockfile so the MCP launcher can find us.
// Per-process bearer token for the MCP HTTP endpoint. Generated once
// at module load (microsecond cost, fine even when MCP stays off) and
// regenerated on every restorm restart. The launcher reads it from the
// discovery file and injects `Authorization: Bearer <token>` on every
// forwarded request — totally transparent for Claude Code / Cursor.
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
void app.whenReady().then(async () => {
  if (!cliArgs.mcpEnabled) return
  try {
    // Register restorm-domain tools + resources before `start()` so the
    // first incoming request sees the full registry. Order matters: the
    // active-state IPC bridge is wired here too (idempotent), so the
    // renderer's bootstrap push lands in a ready listener.
    registerRestormMcp(mcpService)

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
    await writeMcpDiscoveryFile(MCP_DISCOVERY_DIR, {
      port,
      projectPath: null,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: mcpAuthToken,
      name: cliArgs.mcpSessionName
    }, cliArgs.mcpDiscoveryFile)

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
    // launchers that route by project path see the up-to-date value.
    // First-live-wins routing doesn't need this today, but it's cheap
    // to keep accurate.
    getFileService().onStateChanged((state) => {
      const livePort = mcpService.getPort()
      if (livePort === null) return
      void writeMcpDiscoveryFile(MCP_DISCOVERY_DIR, {
        port: livePort,
        projectPath: state.currentFile.path,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        token: mcpAuthToken,
        name: cliArgs.mcpSessionName
      }, cliArgs.mcpDiscoveryFile)
    })
  } catch (error) {
    logger.error('Failed to start MCP service', { error: String(error) })
  }
})
app.on('before-quit', () => {
  if (cliArgs.mcpEnabled) {
    void cleanupMcpDiscoveryFile(MCP_DISCOVERY_DIR, process.pid, cliArgs.mcpDiscoveryFile)
  }
  void mcpService.stop()
})

// Renderer-facing read of runtime config — MCP state + GraphQL
// endpoint. Both can change between restorm boots (free ports), so the
// renderer fetches them once at startup instead of hardcoding.
ipcMain.handle('runtime:get-config', () => ({
  mcp: {
    enabled: cliArgs.mcpEnabled,
    port: mcpService.getPort(),
    sessionName: cliArgs.mcpSessionName
  },
  graphql: {
    endpoint: graphQLService.getEndpoint()
  }
}))

// MCP call-logs viewer bridge: the buffer lives in the main process (ECUI
// McpService). The renderer pulls a snapshot, refreshes on `mcp:logs-changed`
// (broadcast from the served-call listener wired in `whenReady`), and clears
// it on demand.
ipcMain.handle('mcp:get-logs', () => mcpService.getServedCalls())
ipcMain.handle('mcp:clear-logs', () => { mcpService.clearServedCalls() })

// Register all restorm-specific IPC handlers
registerRestormIPC({ editorWindows, closeAllWindows })

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
