import { app, Menu, type MenuItemConstructorOptions, type JumpListCategory, type JumpListItem } from 'electron'
import { logger } from './LoggerService'
import type { FileService } from './FileService'
import type { FileMetadata } from '../../types/file'
import type { AppIconMenuLabels, AppIconAction } from '../../types/appIconMenu'
import { NEW_FILE_ENTRY_ID, FAVORITES_ENTRY_ID, RECENT_FILES_ENTRY_ID } from '../../types/appIconMenu'
import { LinuxRecentDocumentsAdapter } from './appIconMenu/LinuxRecentDocumentsAdapter'
import { LinuxDesktopActionsAdapter } from './appIconMenu/LinuxDesktopActionsAdapter'

export type { AppIconMenuLabels, AppIconAction }

/**
 * One entry of the platform-neutral menu model.
 *
 * The model exists so the menu can be described once and rendered by whichever
 * OS integration the platform offers (a Dock menu, a jump list, a desktop
 * action list). Only the adapters know Electron's menu vocabulary.
 */
export interface AppIconMenuEntry {
  id: string
  label: string
  enabled: boolean
  action?: AppIconAction
  submenu?: AppIconMenuEntry[]
}

/** The whole menu, as an ordered list of top-level entries. */
export interface AppIconMenuModel {
  entries: AppIconMenuEntry[]
}

/**
 * Renders an {@link AppIconMenuModel} onto one platform's app-icon surface.
 *
 * `dispatch` is passed per `apply` rather than held by the adapter: the model
 * is rebuilt whenever the file state changes, and the callback must always
 * reach the service that produced the entries it is attached to.
 */
export interface AppIconMenuAdapter {
  apply(model: AppIconMenuModel, dispatch: (action: AppIconAction) => void): void
  clear(): void
}

/** Translate the neutral model into an Electron menu template. */
const toMenuTemplate = (
  entries: AppIconMenuEntry[],
  dispatch: (action: AppIconAction) => void
): MenuItemConstructorOptions[] =>
  entries.map((entry): MenuItemConstructorOptions => {
    const item: MenuItemConstructorOptions = { label: entry.label, enabled: entry.enabled }
    if (entry.submenu) {
      item.submenu = toMenuTemplate(entry.submenu, dispatch)
      return item
    }
    const action = entry.action
    if (action) {
      item.click = (): void => {
        dispatch(action)
      }
    }
    return item
  })

/** Turn a file list into leaf entries that reopen the file when activated. */
const toFileEntries = (files: FileMetadata[], idPrefix: string): AppIconMenuEntry[] =>
  files.map((file) => ({
    id: `${idPrefix}:${file.path}`,
    label: file.name,
    enabled: true,
    action: { kind: 'open-file', path: file.path } as const
  }))

/**
 * macOS Dock integration.
 *
 * The Dock icon outlives every window, which is why the menu is built here in
 * main rather than derived from renderer state.
 */
export class MacDockAdapter implements AppIconMenuAdapter {
  public apply(model: AppIconMenuModel, dispatch: (action: AppIconAction) => void): void {
    // `app.dock` is undefined off macOS and before the app is ready.
    if (!app.dock) return
    app.dock.setMenu(Menu.buildFromTemplate(toMenuTemplate(model.entries, dispatch)))
  }

  public clear(): void {
    app.dock?.setMenu(Menu.buildFromTemplate([]))
  }
}

/** The flag a relaunch carries to mean "start on a new file". */
const NEW_FILE_LAUNCH_ARG = '--new'

/**
 * Turn one entry's action into the launch arguments that reproduce it.
 *
 * The path is quoted so a file name containing spaces survives the OS
 * splitting the command line back into argv.
 */
const toLaunchArgs = (action: AppIconAction): string =>
  action.kind === 'new-file' ? NEW_FILE_LAUNCH_ARG : `"${action.path}"`

/** One jump-list entry: relaunch this program with the action's arguments. */
const toJumpListItem = (label: string, action: AppIconAction): JumpListItem => ({
  type: 'task',
  program: process.execPath,
  args: toLaunchArgs(action),
  title: label,
  description: action.kind === 'open-file' ? action.path : label
})

/**
 * Translate the neutral model into the jump list's categories.
 *
 * A submenu has no equivalent in a jump list, so each one becomes a custom
 * category titled with its label; the top-level actions share the shell's
 * built-in tasks category.
 */
const toJumpListCategories = (entries: AppIconMenuEntry[]): JumpListCategory[] => {
  const tasks: JumpListItem[] = []
  const custom: JumpListCategory[] = []

  for (const entry of entries) {
    if (entry.submenu) {
      custom.push({
        type: 'custom',
        name: entry.label,
        items: entry.submenu.flatMap((child) => (child.action ? [toJumpListItem(child.label, child.action)] : []))
      })
      continue
    }
    if (entry.action) tasks.push(toJumpListItem(entry.label, entry.action))
  }

  return tasks.length > 0 ? [{ type: 'tasks', items: tasks }, ...custom] : custom
}

/**
 * Windows jump-list integration.
 *
 * Unlike the Dock, a jump list is not a live menu: Windows stores it with the
 * shell and, when the user picks an item, **starts the program again** with the
 * arguments recorded on that item. Nothing calls back into the running process,
 * so this adapter ignores `dispatch` entirely and serializes each entry's
 * action into argv instead.
 *
 * The host therefore has to honour one convention for the entries to work: a
 * bare file-path positional opens that file, and a `--new` flag starts on a new
 * file. A host with a single-instance lock sees those arguments on its
 * `second-instance` event rather than in a fresh process.
 */
export class WindowsJumpListAdapter implements AppIconMenuAdapter {
  public apply(model: AppIconMenuModel, _dispatch: (action: AppIconAction) => void): void {
    if (process.platform !== 'win32') return
    this.setJumpList(toJumpListCategories(model.entries))
  }

  public clear(): void {
    if (process.platform !== 'win32') return
    this.setJumpList(null)
  }

  /**
   * Windows rejects a jump list it dislikes — a category referring to a file
   * type the app is not registered for, or a shell that is simply unavailable
   * — by throwing or returning an error string. A menu that cannot be rendered
   * must not take the app down with it.
   */
  private setJumpList(categories: JumpListCategory[] | null): void {
    try {
      app.setJumpList(categories)
    } catch (error) {
      logger.error('Failed to set the Windows jump list', { error: String(error) })
    }
  }
}

/**
 * Fallback for platforms with no app-icon menu integration.
 *
 * The service runs unconditionally so the host needs no platform branch of its
 * own; the platform difference is confined to which adapter is selected.
 */
export class NoopAppIconMenuAdapter implements AppIconMenuAdapter {
  public apply(): void {
    // No app-icon surface on this platform.
  }

  public clear(): void {
    // Nothing was ever applied.
  }
}

/**
 * Fans one model out to several adapters.
 *
 * Some platforms need more than one OS surface to cover the model — on Linux
 * recents go to the freedesktop recent-documents store while favorites and
 * "new" go to `.desktop` actions — so the platform "adapter" is really a set.
 */
export class CompositeAppIconMenuAdapter implements AppIconMenuAdapter {
  constructor(private readonly adapters: AppIconMenuAdapter[]) {}

  public apply(model: AppIconMenuModel, dispatch: (action: AppIconAction) => void): void {
    for (const adapter of this.adapters) adapter.apply(model, dispatch)
  }

  public clear(): void {
    for (const adapter of this.adapters) adapter.clear()
  }
}

/** Cross-platform knobs the default adapter selection understands. */
export interface DefaultAdapterOptions {
  /**
   * The installed `.desktop` file id (e.g. `myapp.desktop`) whose actions the
   * Linux integration extends with the current favorites.
   */
  linuxDesktopFileId?: string | undefined
  /**
   * MIME type stamped on the Linux recent-documents entries (e.g.
   * `application/x-myapp`), so the launcher can tie a recent file to this app.
   */
  linuxRecentDocumentMimeType?: string | undefined
}

/** Pick the adapter matching the running platform. */
export function createDefaultAdapter(options: DefaultAdapterOptions = {}): AppIconMenuAdapter {
  if (process.platform === 'darwin') return new MacDockAdapter()
  if (process.platform === 'win32') return new WindowsJumpListAdapter()
  if (process.platform === 'linux') {
    return new CompositeAppIconMenuAdapter([
      new LinuxRecentDocumentsAdapter({
        mimeType: options.linuxRecentDocumentMimeType,
        desktopFileId: options.linuxDesktopFileId
      }),
      new LinuxDesktopActionsAdapter({ desktopFileId: options.linuxDesktopFileId })
    ])
  }
  return new NoopAppIconMenuAdapter()
}

/** Default delay before a burst of file-state changes is rendered once. */
const DEFAULT_REBUILD_DEBOUNCE_MS = 150

/** Construction options for {@link AppIconMenuService}. */
export interface AppIconMenuServiceOptions {
  /** Source of truth for the recent + favorite file lists. */
  fileService: FileService
  /** Platform integration; defaults to {@link createDefaultAdapter}. */
  adapter?: AppIconMenuAdapter
  /**
   * The installed `.desktop` file id (e.g. `myapp.desktop`) whose actions the
   * Linux integration extends with the current favorites. Passed to the default
   * adapter; ignored when `adapter` is given.
   */
  linuxDesktopFileId?: string
  /**
   * MIME type stamped on the Linux recent-documents entries (e.g.
   * `application/x-myapp`) so the launcher ties recents to this app. Passed to
   * the default adapter; ignored when `adapter` is given.
   */
  linuxRecentDocumentMimeType?: string
  /** Coalescing window for file-state driven rebuilds. */
  rebuildDebounceMs?: number
  /**
   * How an activated entry is carried out. Defaults to acting straight on the
   * file service — correct for a headless host, but a windowed host should
   * inject its own so the action runs through the same unsaved-work guard its
   * in-app menus use, and brings a window forward, rather than replacing the
   * open document silently.
   */
  dispatch?: (action: AppIconAction) => void
}

/**
 * Keeps the OS application-icon menu in step with the file state.
 *
 * The menu offers "new file" plus the recent and favorite files, so a user can
 * reopen their work straight from the Dock without the app having a window —
 * hence a main-process service reading the main-side `FileService` directly.
 *
 * The three static labels are *not* resolved here. The main-process translator
 * only carries the locales its host chose to load into it, whereas the
 * renderer loads every locale the app ships; resolving them in main would show
 * English to everyone outside that subset. The host pushes them in instead,
 * and until it does the menu is left cleared rather than rendered untranslated.
 */
export class AppIconMenuService {
  private readonly fileService: FileService
  private readonly adapter: AppIconMenuAdapter
  private readonly rebuildDebounceMs: number
  private readonly hostDispatch: ((action: AppIconAction) => void) | undefined
  private labels: AppIconMenuLabels | null = null
  private unsubscribe: (() => void) | null = null
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private disposed = false

  constructor(options: AppIconMenuServiceOptions) {
    this.fileService = options.fileService
    this.adapter =
      options.adapter ??
      createDefaultAdapter({
        linuxDesktopFileId: options.linuxDesktopFileId,
        linuxRecentDocumentMimeType: options.linuxRecentDocumentMimeType
      })
    this.rebuildDebounceMs = options.rebuildDebounceMs ?? DEFAULT_REBUILD_DEBOUNCE_MS
    this.hostDispatch = options.dispatch
  }

  /** Subscribe to file-state changes and render the current menu. Idempotent. */
  public start(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.unsubscribe = this.fileService.onStateChanged(() => {
      this.scheduleRebuild()
    })
    this.rebuild()
  }

  /** Publish the host's translated labels and render immediately. */
  public setLabels(labels: AppIconMenuLabels): void {
    this.labels = labels
    this.rebuild()
  }

  /**
   * Describe the menu as it should currently appear, or `null` while the host
   * has not pushed its labels yet.
   *
   * An empty recent or favorites list omits its whole entry rather than
   * rendering an empty submenu, which reads as a broken menu.
   */
  public buildModel(): AppIconMenuModel | null {
    const labels = this.labels
    if (!labels) return null

    const entries: AppIconMenuEntry[] = [
      { id: NEW_FILE_ENTRY_ID, label: labels.newFile, enabled: true, action: { kind: 'new-file' } }
    ]

    const favorites = toFileEntries(this.fileService.getFavorites(), 'favorite')
    if (favorites.length > 0) {
      entries.push({ id: FAVORITES_ENTRY_ID, label: labels.favorites, enabled: true, submenu: favorites })
    }

    const recent = toFileEntries(this.fileService.getRecentFiles(), 'recent')
    if (recent.length > 0) {
      entries.push({ id: RECENT_FILES_ENTRY_ID, label: labels.recentFiles, enabled: true, submenu: recent })
    }

    return { entries }
  }

  /** Render the current model through the adapter. */
  public rebuild(): void {
    if (this.disposed) return
    const model = this.buildModel()
    if (!model) {
      this.adapter.clear()
      return
    }
    this.adapter.apply(model, (action) => {
      this.dispatch(action)
    })
  }

  /**
   * Run the action carried by an activated entry.
   *
   * A host that injected a dispatch owns the behaviour — it routes the action
   * through its own guarded file flow. Otherwise the action acts straight on
   * the file service.
   */
  public dispatch(action: AppIconAction): void {
    if (this.hostDispatch) {
      this.hostDispatch(action)
      return
    }
    this.dispatchDirect(action)
  }

  /**
   * Act straight on the file service — the behaviour when no dispatch was
   * injected, and the escape hatch an injected dispatch calls for its
   * no-window case, where routing through {@link dispatch} would loop back
   * into itself.
   */
  public dispatchDirect(action: AppIconAction): void {
    // The click arrives from the OS with nothing to await it, so a rejected
    // file operation would otherwise surface as an unhandled rejection.
    if (action.kind === 'new-file') {
      void this.fileService.newFile().catch((error: unknown) => {
        logger.error('App icon menu failed to create a new file', { error: String(error) })
      })
      return
    }
    void this.fileService.open(action.path).catch((error: unknown) => {
      logger.error('App icon menu failed to open a file', { error: String(error), path: action.path })
    })
  }

  /** Stop listening and clear the rendered menu. */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTimer()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.adapter.clear()
  }

  /**
   * Coalesce a burst of file-state changes into one render.
   *
   * Opening a file emits several state changes in a row (recent list, current
   * file, dirty flag); rebuilding a native menu on each one is visible churn.
   */
  private scheduleRebuild(): void {
    if (this.disposed) return
    this.clearTimer()
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null
      this.rebuild()
    }, this.rebuildDebounceMs)
  }

  private clearTimer(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer)
      this.rebuildTimer = null
    }
  }
}

let appIconMenuService: AppIconMenuService | null = null

/** Create the singleton, replacing any previous instance. */
export function initAppIconMenuService(options: AppIconMenuServiceOptions): AppIconMenuService {
  appIconMenuService?.dispose()
  appIconMenuService = new AppIconMenuService(options)
  return appIconMenuService
}

/** Access the singleton; throws when the host never initialized it. */
export function getAppIconMenuService(): AppIconMenuService {
  if (!appIconMenuService) {
    throw new Error('AppIconMenuService not initialized. Call initAppIconMenuService() first.')
  }
  return appIconMenuService
}

/** Whether a singleton exists — lets IPC arriving early be ignored, not thrown. */
export function isAppIconMenuServiceInitialized(): boolean {
  return appIconMenuService !== null
}

/** Dispose and drop the singleton. */
export function resetAppIconMenuService(): void {
  appIconMenuService?.dispose()
  appIconMenuService = null
}
