import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { MainWindow } from './windows/MainWindow'
import { initializeApp, logger, initFileService, getFileService, isFileServiceInitialized, i18nService, initPersistenceService, isPersistenceServiceInitialized, FileService, getSettingsService, isSettingsServiceInitialized, initAutoSaveController, McpService } from 'electron-core-ui'
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
import { searchIndexService, contextService, responseHistoryService, authenticationCacheService } from './services'
import { writeMcpDiscoveryFile, cleanupMcpDiscoveryFile } from './services/mcpDiscovery'
import { registerRestormMcp } from './mcp'
import { graphQLService } from 'electron-core-ui/main'
import { clearUserSettings, parseCliArgs } from './cli/args'
import { setupGraphQL } from './GraphQLSetup'
import { registerRestormIPC } from './IPCHandlers'
import { registerApiUpdateIPC } from './services/apiUpdate/registerApiUpdateIPC'
import { apiUpdateScheduler } from './services/apiUpdate/ApiUpdateScheduler'
import { runApiUpdateApply } from './services/apiUpdate/orchestrateApply'
import { loadFolderStructure, attachDraftStoreForFolder, attachDraftStoreForFile, getDraftsRootDir } from './FileOperations'
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

const fileToOpenOnStart = cliArgs.open
if (fileToOpenOnStart) {
  logger.info('File to open on start:', { path: fileToOpenOnStart })
}

// Keep track of main window and editor windows
let mainWindow: BrowserWindow | null = null
const editorWindows = new Set<BrowserWindow>()

function createWindow(): void {
  logger.info('Creating main window...')
  try {
    // Create main window (instance is stored in WindowManager singleton)
    const mainWin = new MainWindow()
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

      // Open file or folder from command line argument if specified
      if (fileToOpenOnStart) {
        // Use dom-ready which fires reliably with app:// protocol
        mainWindow.webContents.on('dom-ready', () => {
          logger.info('DOM ready, will open from command line:', { path: fileToOpenOnStart })
          // Wait for the renderer React app to be fully initialized and hooks mounted
          setTimeout(() => {
            // Check if it's a file or directory
            const isDirectory = existsSync(fileToOpenOnStart) && statSync(fileToOpenOnStart).isDirectory()

            if (isDirectory) {
              // Open as folder
              logger.info('Opening folder...', { path: fileToOpenOnStart })
              if (!isPersistenceServiceInitialized()) {
                logger.warn('PersistenceService not initialized, cannot load folder')
                return
              }
              void loadFolderStructure(fileToOpenOnStart).then(async (result) => {
                if (result && mainWindow && isFileServiceInitialized()) {
                  logger.info('Folder loaded, sending to renderer', {
                    collectionsCount: (result.data as { collections?: unknown[] }).collections?.length,
                    format: result.format
                  })
                  // Set the file state in FileService so the UI knows a file is open
                  const fileService = getFileService() as { setOpenedFolder: (path: string, content: unknown, format?: string) => void }
                  fileService.setOpenedFolder(fileToOpenOnStart, result.data, result.format)
                  await attachDraftStoreForFolder(fileToOpenOnStart, result.format)
                } else {
                  logger.error('Failed to load folder from command line', { result })
                }
              })
            } else if (isFileServiceInitialized()) {
              // Open as file — FileService itself stamps `_projectUuid`
              // before broadcasting `file:opened` (configured via
              // `uuidKey` on init), so this path stays a simple
              // open + draft-store attach.
              logger.info('Opening file...', { path: fileToOpenOnStart })
              void getFileService().open(fileToOpenOnStart).then(async (result) => {
                if (result.success) {
                  logger.info('File opened successfully from command line')
                  const format = (result as { format?: string }).format ?? 'yaml'
                  await attachDraftStoreForFile(fileToOpenOnStart, format as PersistenceFormat)
                } else {
                  logger.error('Failed to open file from command line:', { path: fileToOpenOnStart })
                }
              })
            } else {
              logger.warn('FileService not initialized, cannot open file')
            }
          }, DEFAULT_UI_DELAY_MS)
        })
      }
    }

    logger.info('Main window created successfully')
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

// Initialize Search Index Service (listens to document events from renderer)
searchIndexService.initialize()
logger.info('Search Index Service initialized')

// Initialize Context Service (manages Handlebars context and resolved values)
contextService.initialize()
logger.info('Context Service initialized')

// Initialize Response History Service (stores executed responses)
responseHistoryService.initialize()
logger.info('Response History Service initialized')

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
initializeApp('restorm', createWindow, resourcesPath, undefined, rendererPath || undefined, settingsConfigPath, featuresConfigPath)

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
const mcpService = new McpService({
  serverInfo: { name: 'restorm', version: app.getVersion() },
  authToken: mcpAuthToken
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
    await writeMcpDiscoveryFile({
      port,
      projectPath: null,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: mcpAuthToken
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

    // Refresh the discovery file when the active project changes so
    // launchers that route by project path see the up-to-date value.
    // First-live-wins routing doesn't need this today, but it's cheap
    // to keep accurate.
    getFileService().onStateChanged((state) => {
      const livePort = mcpService.getPort()
      if (livePort === null) return
      void writeMcpDiscoveryFile({
        port: livePort,
        projectPath: state.currentFile.path,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        token: mcpAuthToken
      }, cliArgs.mcpDiscoveryFile)
    })
  } catch (error) {
    logger.error('Failed to start MCP service', { error: String(error) })
  }
})
app.on('before-quit', () => {
  if (cliArgs.mcpEnabled) {
    void cleanupMcpDiscoveryFile(process.pid, cliArgs.mcpDiscoveryFile)
  }
  void mcpService.stop()
})

// Renderer-facing read of runtime config — MCP state + GraphQL
// endpoint. Both can change between restorm boots (free ports), so the
// renderer fetches them once at startup instead of hardcoding.
ipcMain.handle('runtime:get-config', () => ({
  mcp: {
    enabled: cliArgs.mcpEnabled,
    port: mcpService.getPort()
  },
  graphql: {
    endpoint: graphQLService.getEndpoint()
  }
}))

// Register all restorm-specific IPC handlers
registerRestormIPC({ editorWindows, closeAllWindows })

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

apiUpdateScheduler.start()
