import { dialog, BrowserWindow } from 'electron'
import { readFileSync, existsSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { basename, extname } from 'path'
import { atomicWriteFile, serialize as serializePersisted, type PersistenceFormat } from './PersistenceService'
import {
  SaveUnitRegistry,
  DraftStore,
  sweepOrphanedDrafts,
  isTombstone,
  ensureFileUuid,
  type DirtyReason
} from './saveUnit'
import yaml from 'js-yaml'
import type {
  SerializationFormat,
  FileMetadata,
  CurrentFileState,
  FileServiceConfig,
  SaveDialogResult,
  OpenDialogResult,
  FileServiceState,
  OpenValidationResult,
  OpenRejectedPayload
} from '../../types/file'
import type { RuntimeId } from '../../types/runtime'
import { logger } from './LoggerService'
import { FileSystemError, errorMeta } from '../../errors'
import { getStorageService } from './StorageService'
import { i18nService } from './I18nService'

/**
 * FileService manages file operations with serialization support
 *
 * Features:
 * - JSON and YAML serialization
 * - Recent files tracking
 * - Favorites management
 * - Dirty flag for unsaved changes
 * - Native file dialogs (desktop)
 */
export class FileService {
  private config: FileServiceConfig
  private currentFile: CurrentFileState
  private recentFiles: FileMetadata[] = []
  private stateChangeCallbacks = new Set<(state: FileServiceState) => void>()
  private dirtyChangeCallbacks = new Set<(isDirty: boolean) => void>()
  private _isLoading = false

  private readonly RECENT_FILES_KEY: string
  private readonly FAVORITES_KEY: string

  /**
   * Save-unit registry — single source of truth for dirty state.
   * Per-unit events bridge to IPC so renderer hooks can scope to a
   * single unit, and the global `currentFile.isDirty` cache is kept
   * in sync with "any unit dirty" by the same bridge.
   */
  private readonly saveUnitRegistry: SaveUnitRegistry = new SaveUnitRegistry()

  /**
   * Active draft store for the currently-open project, or null when
   * no project is open. Wired into the registry so every dirty
   * transition persists a draft file (debounced), and commits /
   * reverts remove it.
   */
  private draftStore: DraftStore | null = null

  /**
   * The active attach: which project (`rootDir` + `uuid`) the current
   * `draftStore` belongs to, and the promise of its restored-draft
   * count. Lets `attachDraftStore` recognize a redundant re-attach for
   * the SAME project — see its doc comment for why that happens
   * routinely — and hand back the first call's result instead of
   * re-reading drafts from disk / re-broadcasting `file:drafts-restored`.
   * Holding the PROMISE rather than a settled count matters: the
   * redundant call typically arrives while the first one is still
   * awaiting the disk read, so a plain cached number would hand it a
   * count that isn't this project's yet.
   */
  private draftStoreAttach: { identity: string; restored: Promise<number> } | null = null

  constructor(config: Partial<FileServiceConfig> = {}) {
    this.config = {
      extension: config.extension ?? '.json',
      defaultFormat: config.defaultFormat ?? 'json',
      maxRecentFiles: config.maxRecentFiles ?? 10,
      storagePrefix: config.storagePrefix ?? 'file_',
      // `uuidKey` stays undefined unless the host app opts in. When set,
      // `open()` stamps the UUID before broadcasting `file:opened`, and
      // `save()`/`saveAs()` preserve it across writes. When unset the
      // whole feature is a no-op — FileService stays non-opinionated
      // about file metadata for apps that don't use the save-unit /
      // draft-store system.
      ...(config.uuidKey !== undefined && { uuidKey: config.uuidKey }),
      // Absent by default: with no validator installed, `open()` accepts
      // whatever it can parse, exactly as it always has.
      ...(config.validateOnOpen !== undefined && { validateOnOpen: config.validateOnOpen })
    }

    this.RECENT_FILES_KEY = `${this.config.storagePrefix}recent`
    this.FAVORITES_KEY = `${this.config.storagePrefix}favorites`

    this.currentFile = {
      path: null,
      name: null,
      isDirty: false,
      content: null,
      format: this.config.defaultFormat,
      contentChecksum: null
    }

    this.loadPersistedData()
    this.bridgeSaveUnitEvents()
  }

  /**
   * Bridge the SaveUnitRegistry's `onUnitChange` notifications to:
   *   1. Per-unit IPC broadcasts (renderer hooks scope dirty dots
   *      via `useUnitDirtyState(id)` / `useDirtyUnitsSet()`).
   *   2. The cached `currentFile.isDirty` flag (source of truth for
   *      close-dialog guards and `file:dirty-changed` listeners).
   *   3. The active draft store, so dirty transitions land as a
   *      debounced atomic write under `userData/drafts/…` and clean
   *      transitions remove the draft.
   */
  private bridgeSaveUnitEvents(): void {
    this.saveUnitRegistry.onUnitChange((snapshot) => {
      this.broadcastEvent('file:unit-dirty-changed', snapshot)
      this.refreshGlobalDirtyFromRegistry()
      // Persist / delete the draft file for crash recovery.
      if (this.draftStore) {
        if (snapshot.isDirty) {
          const unit = this.saveUnitRegistry.get(snapshot.runtimeId)
          if (unit?.draft !== undefined) {
            void this.draftStore.writeDraft(snapshot.runtimeId, unit.draft).catch((err: unknown) => {
              logger.warn('[FileService] Draft write failed', { runtimeId: snapshot.runtimeId, error: String(err) })
            })
          }
        } else {
          void this.draftStore.deleteDraft(snapshot.runtimeId).catch((err: unknown) => {
            logger.warn('[FileService] Draft delete failed', { runtimeId: snapshot.runtimeId, error: String(err) })
          })
        }
      }
    })
  }

  /**
   * Recompute `currentFile.isDirty` from the registry and fire the
   * `dirty-changed` / `state-changed` notifications if the flag
   * flipped. The registry is the only writer of this field — direct
   * mutations elsewhere in the class are deliberately absent so the
   * two views never diverge.
   */
  private refreshGlobalDirtyFromRegistry(): void {
    const nowDirty = this.saveUnitRegistry.listDirty().length > 0
    if (this.currentFile.isDirty !== nowDirty) {
      this.currentFile.isDirty = nowDirty
      this.notifyDirtyChange()
    }
    this.notifyStateChange()
  }

  // ==========================================================================
  // Crash Recovery (draft store)
  // ==========================================================================

  /**
   * Attach a draft store to the currently-open project. Should be
   * called right after a project is loaded and the registry has been
   * hydrated with its on-disk state. Existing drafts are read back
   * and re-applied to the registry — each restored unit transitions
   * to `dirty` and emits the usual per-unit event. Returns the number
   * of drafts restored so callers can surface a toast.
   *
   * Idempotent per project (`rootDir` + `uuid`): a host app's `open()`
   * routinely triggers TWO independent callers of this method for the
   * same file-mode open — a reactive `onStateChanged` listener (fired
   * synchronously as soon as the new path is visible) and the explicit
   * caller that awaits the open's result — both racing to attach the
   * same draft store. Re-reading drafts from disk and re-broadcasting
   * `file:drafts-restored` on the second call would restore the same
   * units twice and show the recovery toast twice. Whichever call
   * reaches here first does the real work; a second call for the SAME
   * identity joins it and resolves to the same count, whether the first
   * has already settled or is still reading from disk. A call for a
   * genuinely different project (switching files without an explicit
   * `close()`/`detachDraftStore()` in between) still drops the old store
   * and attaches the new one as before.
   */
  public async attachDraftStore(params: {
    rootDir: string
    /** Stable UUID used as the per-project sub-directory under `rootDir`. */
    uuid: string
    extension: string
    serialize: (value: unknown) => string
    deserialize: (raw: string) => unknown
    debounceMs?: number
  }): Promise<number> {
    // The project — `rootDir` + `uuid` — is the identity; the
    // serialization params are how the SAME project's drafts are read
    // and written, so callers must agree on them and they deliberately
    // don't turn a repeat call into a different attach. NUL-separated
    // so no pair can collide with another by straddling the separator
    // the way a path join would allow.
    const identity = `${params.rootDir}\u0000${params.uuid}`
    if (this.draftStore && this.draftStoreAttach?.identity === identity) {
      return this.draftStoreAttach.restored
    }
    const restored = this.openDraftStore(params)
    this.draftStoreAttach = { identity, restored }
    // A failed attach must not pin the identity to a rejected promise —
    // every later call for the same project would inherit the failure
    // instead of retrying the restore.
    restored.catch(() => {
      if (this.draftStoreAttach?.restored === restored) {
        this.draftStoreAttach = null
      }
    })
    return restored
  }

  /**
   * The real attach: swap in a fresh `DraftStore`, replay whatever it
   * finds on disk into the registry, and announce the result once.
   * Always go through {@link attachDraftStore}, which owns the
   * per-project de-duplication.
   *
   * Every step works off the local `store`, never the `draftStore`
   * field, and abandons the attach as soon as the field no longer
   * points at it. An attach can be superseded mid-flight — a project
   * switch or a `close()` while this one is awaiting the disk — and
   * reading the field back after an await would make the stale call
   * finish someone else's attach: restoring the new project's drafts a
   * second time and re-broadcasting `file:drafts-restored` behind the
   * de-duplication's back, or dereferencing a null store after a close.
   */
  private async openDraftStore(params: {
    rootDir: string
    uuid: string
    extension: string
    serialize: (value: unknown) => string
    deserialize: (raw: string) => unknown
    debounceMs?: number
  }): Promise<number> {
    const store = new DraftStore(params)
    this.draftStore = store
    // Refresh the per-project `.last-opened` timestamp so the
    // age-based orphan sweep at next boot doesn't reap this project's
    // drafts. `markOpened` creates the directory if it doesn't exist
    // yet, so opening a project without mutating anything still keeps
    // the UUID alive (important for the "I opened it, crashed, reopen
    // next week" recovery story).
    await store.markOpened()
    if (this.draftStore !== store) return 0
    const drafts = await store.loadAllDrafts()
    if (this.draftStore !== store) return 0
    let restored = 0
    for (const draft of drafts) {
      const unit = this.saveUnitRegistry.get(draft.runtimeId)
      if (isTombstone(draft.payload)) {
        if (unit) {
          this.saveUnitRegistry.markDeleted(draft.runtimeId)
          restored += 1
        }
        continue
      }
      if (unit) {
        this.saveUnitRegistry.mutate(draft.runtimeId, draft.payload, 'modify')
      } else {
        // The reference file was lost but the draft survived — treat
        // it as a pending-create so the user can still recover the
        // work, then save it.
        this.saveUnitRegistry.create({
          runtimeId: draft.runtimeId,
          kind: 'file',
          draft: draft.payload
        })
      }
      restored += 1
    }
    if (restored > 0) {
      this.broadcastEvent('file:drafts-restored', { count: restored })
      logger.info('[FileService] Drafts restored', { count: restored })
    }
    return restored
  }

  /**
   * Detach the active draft store. Called when closing a project.
   * Clearing the recorded attach is what lets the SAME project be
   * opened again later in the session and restore its drafts afresh —
   * only a repeat attach with no `close()` in between is de-duplicated.
   */
  public detachDraftStore(): void {
    this.draftStore = null
    this.draftStoreAttach = null
  }

  /**
   * Bulk-clear every draft on disk + in memory for the active
   * project. Host apps call this at the end of a successful save-all
   * (and from the quit-without-save path) so orphan drafts —
   * runtime ids that no longer correspond to a unit in the in-memory
   * tree, or pending writes that flushed after the registry was
   * already hydrated — can't trigger a spurious "Save changes?"
   * prompt on close or a bogus "drafts restored" toast on relaunch.
   * Per-unit `deleteDraft` covers the registry's clean transitions
   * but can miss orphans; this is the defense-in-depth invariant.
   *
   * Also force-cleans the registry: any unit whose draft survived a
   * `mutate()` revert because of serialization asymmetry (the in-memory
   * tree got a clone whose key order or numeric encoding doesn't match
   * the original reference) is reset to its reference state. The bridge
   * picks the per-unit clean events up and would normally trigger a
   * `deleteDraft`, but the bulk clear runs first so the disk side is
   * already consistent.
   */
  public async clearAllDrafts(): Promise<void> {
    // Order matters: bulk-clear the disk side first, then mark every
    // unit clean. The opposite order would synchronously emit N clean
    // events, each triggering a fire-and-forget `deleteDraft` from the
    // bridge that races with the bulk directory walk. Both writers
    // are ENOENT-tolerant `fs.unlink`s so the race is currently safe,
    // but doing the disk-side first means the bridge's per-unit
    // deletes hit `.draft.*` paths the bulk-clear has already removed
    // — trivial no-ops, and the invariant doesn't hinge on unlink
    // idempotency in either implementation.
    if (this.draftStore) await this.draftStore.clearAllDrafts()
    this.saveUnitRegistry.markAllClean()
  }

  /**
   * Remove draft directories belonging to projects that no longer
   * exist on disk. Meant to be called once at app boot from the
   * host app's main process.
   */
  public static async cleanupOrphanedDrafts(rootDir: string): Promise<number> {
    return sweepOrphanedDrafts(rootDir)
  }

  // ==========================================================================
  // Save Unit API (v2 dirty-state model)
  // ==========================================================================

  /**
   * The save-unit registry. Main-process callers (IPC handlers, file
   * service internals) mutate it directly — no wrapper methods on the
   * service. The registry is still read-only to the outside world in
   * the sense that `FileService` owns its lifetime.
   */
  public getSaveUnitRegistry(): SaveUnitRegistry {
    return this.saveUnitRegistry
  }

  /**
   * Persist a single save unit to disk:
   *   1. Serialize the caller-supplied content (current in-memory tree
   *      slice for the unit) to `absolutePath` atomically (temp+rename).
   *   2. Commit the unit **only if the registry's draft still matches**
   *      the content we just wrote. A mutation that arrived between the
   *      caller's snapshot and this method call leaves the unit dirty
   *      and the (newer) draft intact — the next save picks it up.
   *   3. Delete the unit's draft file only when the commit proceeded.
   *      The bridge's `clean → deleteDraft` transition handles it.
   *
   * Called from a `file:save-unit` IPC. The renderer owns the tree and
   * therefore owns the path resolution for the unit.
   *
   * Note: unit writes deliberately bypass `preserveUuidMetadata` — a
   * save-unit targets a caller-supplied absolute path (a child document,
   * not the project root), so there's no "previous root content" to
   * merge the UUID from. If a future refactor ever lets `saveUnit` land
   * on the root index, add the merge back in at that site.
   */
  public async saveUnit(params: {
    runtimeId: RuntimeId
    content: unknown
    absolutePath: string
    format: PersistenceFormat
  }): Promise<boolean> {
    try {
      const serialized = serializePersisted(params.content, params.format)
      await atomicWriteFile(params.absolutePath, serialized)
      const committed = this.saveUnitRegistry.commitIfDraftMatches(params.runtimeId, params.content)
      if (!committed) {
        logger.info('[FileService] Save completed but draft advanced — unit remains dirty', {
          runtimeId: params.runtimeId
        })
      }
      return true
    } catch (err: unknown) {
      logger.error('[FileService] Failed to save unit', { runtimeId: params.runtimeId, error: String(err) })
      return false
    }
  }

  /**
   * Persist a batch of save units in one pass. Each unit is saved
   * independently — a single failure doesn't short-circuit the rest.
   * Returns per-unit outcomes so the caller can surface partial
   * failures to the user.
   */
  public async saveUnitsBatch(
    units: { runtimeId: RuntimeId; content: unknown; absolutePath: string; format: PersistenceFormat }[]
  ): Promise<{ runtimeId: RuntimeId; success: boolean }[]> {
    const results: { runtimeId: RuntimeId; success: boolean }[] = []
    for (const unit of units) {
      const success = await this.saveUnit(unit)
      results.push({ runtimeId: unit.runtimeId, success })
    }
    return results
  }

  /** Whole-registry dirty snapshot (global + per-unit). */
  public getSaveUnitsSnapshot(): {
    isDirty: boolean
    dirtyCount: number
    dirtyUnits: { runtimeId: RuntimeId; reason: DirtyReason | undefined }[]
  } {
    const dirty = this.saveUnitRegistry.listDirty()
    return {
      isDirty: dirty.length > 0,
      dirtyCount: dirty.length,
      dirtyUnits: dirty.map((u) => ({ runtimeId: u.runtimeId, reason: u.lastDirtyReason }))
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Load persisted recent files and favorites from storage
   */
  private loadPersistedData(): void {
    const storage = getStorageService()

    // Load recent files
    const savedRecent = storage.get(this.RECENT_FILES_KEY) as FileMetadata[] | undefined
    if (savedRecent && Array.isArray(savedRecent)) {
      // Filter out files that no longer exist
      this.recentFiles = savedRecent.filter((file: FileMetadata) => this.fileExists(file.path))
      // Update storage if some files were removed
      if (this.recentFiles.length !== savedRecent.length) {
        this.saveRecentFiles()
      }
    }

    // Load favorites from recent files
    const savedFavorites = storage.get(this.FAVORITES_KEY) as string[] | undefined
    if (savedFavorites && Array.isArray(savedFavorites)) {
      // Update favorite flags in recent files
      for (const file of this.recentFiles) {
        file.isFavorite = savedFavorites.includes(file.path)
      }
    }

    logger.info('FileService: Loaded persisted data', {
      recentCount: this.recentFiles.length,
      favoriteCount: this.getFavorites().length
    })
  }

  /**
   * Check if a file exists (desktop only)
   */
  private fileExists(path: string): boolean {
    try {
      return existsSync(path)
    } catch (error) {
      logger.warn('FileService: fileExists check failed', errorMeta(error))
      return false
    }
  }

  /**
   * Save recent files to storage
   */
  private saveRecentFiles(): void {
    const storage = getStorageService()
    storage.set(this.RECENT_FILES_KEY, this.recentFiles)
  }

  /**
   * Save favorites to storage
   */
  private saveFavorites(): void {
    const storage = getStorageService()
    const favorites = this.recentFiles.filter((f) => f.isFavorite).map((f) => f.path)
    storage.set(this.FAVORITES_KEY, favorites)
  }

  /**
   * Add or update a file in recent files
   */
  private addToRecentFiles(path: string, name: string): void {
    // Remove if already exists
    this.recentFiles = this.recentFiles.filter((f) => f.path !== path)

    // Check if it was a favorite
    const storage = getStorageService()
    const favorites = (storage.get(this.FAVORITES_KEY) ?? []) as string[]
    const isFavorite = favorites.includes(path)

    // Add to beginning
    this.recentFiles.unshift({
      path,
      name,
      lastOpened: Date.now(),
      isFavorite
    })

    // Trim to max size (but keep favorites)
    const nonFavorites = this.recentFiles.filter((f) => !f.isFavorite)
    const favoritesInList = this.recentFiles.filter((f) => f.isFavorite)

    if (nonFavorites.length > this.config.maxRecentFiles) {
      const trimmed = nonFavorites.slice(0, this.config.maxRecentFiles)
      this.recentFiles = [...favoritesInList, ...trimmed].sort(
        (a, b) => b.lastOpened - a.lastOpened
      )
    }

    this.saveRecentFiles()
  }

  /**
   * Serialize content to string
   */
  private serialize(content: unknown, format: SerializationFormat): string {
    switch (format) {
      case 'yaml':
        return yaml.dump(content, { indent: 2, lineWidth: -1 })
      case 'json':
      default:
        return JSON.stringify(content, null, 2)
    }
  }

  /**
   * Deserialize string to content
   */
  private deserialize(data: string, format: SerializationFormat): unknown {
    switch (format) {
      case 'yaml':
        return yaml.load(data)
      case 'json':
      default:
        return JSON.parse(data)
    }
  }

  /**
   * Get file name without path and extension
   */
  private getDisplayName(path: string): string {
    const base = basename(path)
    const ext = extname(base)
    return ext ? base.slice(0, -ext.length) : base
  }

  /**
   * Detect format from file extension
   */
  private detectFormat(path: string): SerializationFormat {
    const ext = extname(path).toLowerCase()
    if (ext === '.yaml' || ext === '.yml') {
      return 'yaml'
    }
    return this.config.defaultFormat
  }

  /**
   * Notify state change listeners (local and via IPC)
   */
  private notifyStateChange(): void {
    const state = this.getState()
    // Notify local callbacks
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback(state)
      } catch (error) {
        logger.error('FileService: Error in state change callback', errorMeta(error))
      }
    }
    // Broadcast to all renderer windows via IPC
    this.broadcastEvent('file:state-changed', state)
  }

  /**
   * Notify dirty change listeners (local and via IPC)
   */
  private notifyDirtyChange(): void {
    logger.debug('FileService: notifyDirtyChange called', { isDirty: this.currentFile.isDirty })
    // Notify local callbacks
    for (const callback of this.dirtyChangeCallbacks) {
      try {
        callback(this.currentFile.isDirty)
      } catch (error) {
        logger.error('FileService: Error in dirty change callback', errorMeta(error))
      }
    }
    // Broadcast to all renderer windows via IPC
    this.broadcastEvent('file:dirty-changed', this.currentFile.isDirty)
    logger.debug('FileService: Broadcasted file:dirty-changed', { isDirty: this.currentFile.isDirty })
  }

  /**
   * Broadcast an event to all windows via IPC
   */
  private broadcastEvent(channel: string, ...args: unknown[]): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args)
      }
    }
  }

  /**
   * Create a new file - shows SaveAs dialog first
   * Returns true if file was created, false if user cancelled
   */
  public async newFile(): Promise<boolean> {
    // Show SaveAs dialog to get the new file path
    const result = await this.showSaveDialog()
    if (result.canceled || !result.filePath) {
      return false
    }

    let filePath = result.filePath
    // Ensure correct extension
    if (!filePath.endsWith(this.config.extension)) {
      filePath += this.config.extension
    }

    const name = this.getDisplayName(filePath)

    // Create empty file
    try {
      // Seed the file with just the UUID (when configured) so "File → New"
      // behaves symmetrically to "File → Open": the very first
      // `file:opened` broadcast the renderer receives carries the UUID
      // that host-app preferences (sidebar expansion, env selections, …)
      // will key off. Without this seed, within-session preferences would
      // never persist until the user reopened the freshly-created file.
      const uuidKey = this.config.uuidKey
      const emptyContent: Record<string, unknown> = {}
      if (uuidKey) {
        const data = this.serialize(emptyContent, this.config.defaultFormat)
        await atomicWriteFile(filePath, data)
        await ensureFileUuid({
          filePath,
          format: this.config.defaultFormat,
          uuidKey
        })
        const stamped = this.deserialize(readFileSync(filePath, 'utf-8'), this.config.defaultFormat)
        this.currentFile = {
          path: filePath,
          name,
          isDirty: false,
          content: stamped,
          format: this.config.defaultFormat,
          contentChecksum: JSON.stringify(stamped)
        }
      } else {
        const data = this.serialize(emptyContent, this.config.defaultFormat)
        await atomicWriteFile(filePath, data)
        this.currentFile = {
          path: filePath,
          name,
          isDirty: false,
          content: emptyContent,
          format: this.config.defaultFormat,
          contentChecksum: JSON.stringify(emptyContent)
        }
      }

      this.addToRecentFiles(filePath, name)
      this.notifyStateChange()
      this.notifyDirtyChange()
      
      // Broadcast file opened event
      this.broadcastEvent('file:opened', this.getState())
      
      logger.info('FileService: New file created', { path: filePath })
      return true
    } catch (error) {
      const wrappedError = new FileSystemError('Failed to create new file', 'FS_WRITE_FAILED', { cause: error })
      logger.error('FileService: Failed to create new file', errorMeta(wrappedError))
      return false
    }
  }

  /**
   * Open a file (or folder if folderLoader callback is provided)
   *
   * `rejected: true` distinguishes "the host's `validateOnOpen` gate
   * refused this document" from a plain failure: the caller must not
   * report a read error, because the renderer has already been told why
   * via `file:open-rejected` and is showing that message.
   */
  public async open(path?: string, folderLoader?: (folderPath: string) => Promise<unknown>): Promise<{ success: boolean; content?: unknown; isDirectory?: boolean; rejected?: boolean }> {
    let filePath = ''

    // Mark as loading to prevent dirty state during initialization. A single
    // try/finally guarantees the flag is cleared on EVERY exit path (folder
    // success, cancel, error) — it was previously left `true` on the
    // folder-success and exception paths, wedging the service in "loading".
    this._isLoading = true

    try {
      // Show dialog if no path provided
      if (path) {
        filePath = path
      } else {
        const result = await this.showOpenDialog()
        const selectedPath = result.filePaths[0]
        if (result.canceled || !selectedPath) {
          return { success: false }
        }
        filePath = selectedPath
      }

      // Check if path is a directory
      const stats = statSync(filePath)
      if (stats.isDirectory()) {
        if (folderLoader) {
          // Use the provided folder loader callback
          const content = await folderLoader(filePath)
          if (content) {
            this.setOpenedFolder(filePath, content)
            return { success: true, content, isDirectory: true }
          }
        }
        // No folder loader or loading failed - return indication that it's a directory
        return { success: false, isDirectory: true }
      }

      const format = this.detectFormat(filePath)

      // READ FIRST, WRITE LAST. The host's `validateOnOpen` gate has to
      // see the content before we touch the file, so that refusing a
      // document leaves it byte-for-byte as it was. Stamping the UUID
      // before this point would mutate a file the app then declines to
      // open — an unrequested write to someone's data, and on a
      // read-only file an outright error where a clean refusal belongs.
      let data = readFileSync(filePath, 'utf-8')
      let content = this.deserialize(data, format)

      if (this.config.validateOnOpen) {
        let verdict: OpenValidationResult
        try {
          verdict = this.config.validateOnOpen(content, filePath)
        } catch (validationError) {
          // A validator that throws has not said "this is fine", so the
          // safe reading is refusal — loading a document whose
          // acceptability is unknown is the outcome the gate exists to
          // prevent.
          logger.error('FileService: validateOnOpen threw — refusing the document', {
            path: filePath,
            error: validationError instanceof Error ? validationError.message : String(validationError)
          })
          verdict = { ok: false }
        }

        if (!verdict.ok) {
          logger.warn('FileService: open refused by validateOnOpen', { path: filePath, code: verdict.code })
          const payload: OpenRejectedPayload = { path: filePath }
          if (verdict.code !== undefined) payload.code = verdict.code
          if (verdict.detail !== undefined) payload.detail = verdict.detail
          this.broadcastEvent('file:open-rejected', payload)
          // No state mutated, no file written, no recent-files entry: the
          // previously open document (if any) is still the current one.
          return { success: false, rejected: true }
        }
      }

      // Opt-in stamp of the stable UUID. Doing it here — rather than at
      // every call site that reaches us (`file:open` IPC, host-app CLI
      // wrappers, welcome flows, etc.) — means the `file:opened` event the
      // renderer consumes always carries the UUID on the very first open,
      // without the host having to remember to stamp it. No-op when
      // `uuidKey` isn't configured.
      if (this.config.uuidKey) {
        try {
          const { generated } = await ensureFileUuid({ filePath, format, uuidKey: this.config.uuidKey })
          if (generated) {
            // The stamp rewrote the file, so the bytes we read above are
            // stale. Re-read rather than patch the parsed object: the
            // digest must match what is actually on disk or the
            // external-change guard fires on the next check. Only the
            // first-ever open of a UUID-less file pays this second read.
            data = readFileSync(filePath, 'utf-8')
            content = this.deserialize(data, format)
          }
        } catch (uuidError) {
          logger.warn('FileService: ensureFileUuid failed on open', {
            path: filePath,
            error: uuidError instanceof Error ? uuidError.message : String(uuidError)
          })
        }
      }

      const name = this.getDisplayName(filePath)
      this.diskDigest = FileService.digestOf(data)
      this.externalChangePending = false

      this.currentFile = {
        path: filePath,
        name,
        isDirty: false,
        content,
        format,
        contentChecksum: JSON.stringify(content)
      }

      this.addToRecentFiles(filePath, name)
      this.notifyStateChange()
      this.notifyDirtyChange()
      
      // Broadcast file opened event
      this.broadcastEvent('file:opened', this.getState())

      logger.info('FileService: File opened', { path: filePath, format })
      return { success: true, content }
    } catch (error) {
      const wrappedError = new FileSystemError('Failed to open file', 'FS_READ_FAILED', { cause: error })
      logger.error('FileService: Failed to open file', { path: filePath, ...errorMeta(wrappedError) })
      return { success: false }
    } finally {
      this._isLoading = false
    }
  }

  /**
   * Set file state after loading a folder (bypasses file reading)
   * Used when content is already loaded from a folder structure
   * @param folderPath The path to the folder
   * @param content The loaded content
   * @param format Optional format to use (from config file or default)
   */
  public setOpenedFolder(folderPath: string, content: unknown, format?: SerializationFormat): void {
    const name = this.getDisplayName(folderPath)
    // Folder mode has no single file whose bytes we can digest, so the
    // external-change guard stays inert here.
    this.diskDigest = null
    this.externalChangePending = false
    
    this.currentFile = {
      path: folderPath,
      name,
      isDirty: false,
      content,
      format: format ?? this.config.defaultFormat,
      contentChecksum: JSON.stringify(content)
    }

    this.addToRecentFiles(folderPath, name)
    this.notifyStateChange()
    this.notifyDirtyChange()
    
    // Broadcast file opened event
    this.broadcastEvent('file:opened', this.getState())

    logger.info('FileService: Folder opened', { path: folderPath, format: format ?? this.config.defaultFormat })
  }

  /**
   * Preserve the stable UUID across saves. When `uuidKey` is configured,
   * `open()` stamps the UUID on disk before broadcasting `file:opened`;
   * once the renderer starts sending us `{ ...payload }` snapshots that
   * drop top-level metadata, we merge the UUID back in so subsequent
   * reopens see the same identity (otherwise each save would regenerate
   * a fresh UUID on next open and invalidate every per-project
   * preference keyed by it — sidebar expansion, env selections, etc.).
   *
   * A no-op when the host app didn't configure `uuidKey`. Renderers
   * that already include the UUID in their payload are a no-op too
   * (same value, same write).
   */
  private preserveUuidMetadata(content: unknown): unknown {
    const uuidKey = this.config.uuidKey
    if (!uuidKey) return content
    if (content === null || typeof content !== 'object' || Array.isArray(content)) return content
    const prev = this.currentFile.content
    if (prev === null || typeof prev !== 'object' || Array.isArray(prev)) return content
    const prevUuid = (prev as Record<string, unknown>)[uuidKey]
    if (typeof prevUuid !== 'string' || prevUuid.length === 0) return content
    const next = content as Record<string, unknown>
    const incoming = next[uuidKey]
    if (typeof incoming === 'string' && incoming.length > 0) {
      return content
    }
    return { ...next, [uuidKey]: prevUuid }
  }

  /**
   * Digest of the bytes we last read from — or wrote to — disk. Anything
   * else on disk means a third party (a terminal `git checkout`, a `git
   * pull`, another editor) rewrote the file under us.
   */
  private diskDigest: string | null = null

  /** Set once an external rewrite is detected, so a per-second autosave
   * can't re-broadcast the same prompt every tick. Cleared when the user
   * resolves it — by reloading, or by force-saving over it. */
  private externalChangePending = false

  private static digestOf(data: string): string {
    return createHash('sha1').update(data).digest('hex')
  }

  /**
   * Whether the open file's bytes on disk differ from what we last read
   * or wrote. False when there is no open file, when the path is gone
   * (deletion is a different problem), or when we can't read it.
   */
  public hasExternalChange(): boolean {
    const path = this.currentFile.path
    if (path === null || this.diskDigest === null) return false
    try {
      if (!existsSync(path)) return false
      return FileService.digestOf(readFileSync(path, 'utf-8')) !== this.diskDigest
    } catch (error: unknown) {
      logger.warn('FileService: Failed to probe the file for external changes', { path, error: String(error) })
      return false
    }
  }

  /**
   * The user chose to keep their in-memory version over the one a third
   * party wrote. Re-baselines on the current disk bytes, so the next
   * ordinary save goes through (overwriting them, as asked) and a LATER
   * external rewrite still prompts.
   */
  public acceptExternalChange(): void {
    const path = this.currentFile.path
    this.externalChangePending = false
    if (path === null) return
    try {
      if (existsSync(path)) {
        this.diskDigest = FileService.digestOf(readFileSync(path, 'utf-8'))
      }
    } catch (error: unknown) {
      logger.warn('FileService: Failed to re-baseline after an external change', { path, error: String(error) })
    }
  }

  /**
   * Save current file.
   *
   * Refuses to overwrite a file a third party rewrote under us — the
   * common case being a `git checkout` / `git pull` run from a terminal
   * while the project is open. The in-memory tree still holds the OLD
   * branch's content, and autosave fires a second later, so without this
   * guard the checkout is silently undone on disk. `force` is the user
   * answering "keep my version" to that prompt — see also
   * `acceptExternalChange()`, which the renderer uses to re-baseline
   * before running its ordinary save-all.
   */
  public async save(content: unknown, options?: { force?: boolean }): Promise<boolean> {
    if (options?.force === true) {
      this.externalChangePending = false
    } else if (this.hasExternalChange()) {
      if (!this.externalChangePending) {
        this.externalChangePending = true
        this.broadcastEvent('file:externally-changed', { path: this.currentFile.path })
        logger.warn('FileService: Refusing to overwrite a file changed outside the app', { path: this.currentFile.path })
      }
      return false
    }

    // If no current file, use SaveAs
    if (!this.currentFile.path) {
      return this.saveAs(content)
    }

    try {
      const preserved = this.preserveUuidMetadata(content)
      const data = this.serialize(preserved, this.currentFile.format)
      await atomicWriteFile(this.currentFile.path, data)
      this.diskDigest = FileService.digestOf(data)

      this.currentFile.content = preserved
      this.currentFile.contentChecksum = JSON.stringify(preserved)
      // `currentFile.isDirty` is owned by the save-unit registry: the
      // caller re-hydrates (or commits) units post-save and the bridge
      // flips the cached flag. We don't touch it here.
      this.notifyStateChange()

      // A successful whole-file save committed the in-memory tree
      // to disk. Bulk-clear the drafts directory so any draft files
      // that survived the per-unit clean-transition path — orphans
      // whose runtime id is no longer in the tree, pending writes
      // that flushed after registry hydration — can't trick the
      // close-file dialog into popping the "Save changes?" prompt
      // or trigger a bogus "drafts restored" toast on next launch.
      // `clearAllDrafts` awaits in-flight flushes so this is safe
      // against the debounced-write race.
      if (this.draftStore) {
        try {
          await this.draftStore.clearAllDrafts()
        } catch (err: unknown) {
          logger.warn('FileService: Failed to clear drafts after save', { error: String(err) })
        }
      }

      logger.info('FileService: File saved', { path: this.currentFile.path })
      return true
    } catch (error) {
      const wrappedError = new FileSystemError('Failed to save file', 'FS_WRITE_FAILED', { cause: error })
      logger.error('FileService: Failed to save file', errorMeta(wrappedError))
      return false
    }
  }

  /**
   * Save file with a new name/path
   */
  public async saveAs(
    content: unknown,
    filename?: string,
    format?: SerializationFormat
  ): Promise<boolean> {
    let filePath = filename

    // Show dialog if no filename provided
    if (!filePath) {
      const result = await this.showSaveDialog()
      if (result.canceled || !result.filePath) {
        return false
      }
      filePath = result.filePath
    }

    // Ensure correct extension
    if (!filePath.endsWith(this.config.extension)) {
      filePath += this.config.extension
    }

    const fileFormat = format ?? this.detectFormat(filePath)

    try {
      const preserved = this.preserveUuidMetadata(content)
      const data = this.serialize(preserved, fileFormat)
      await atomicWriteFile(filePath, data)
      this.diskDigest = FileService.digestOf(data)
      this.externalChangePending = false

      const name = this.getDisplayName(filePath)
      this.currentFile = {
        path: filePath,
        name,
        isDirty: false,
        content: preserved,
        format: fileFormat,
        contentChecksum: JSON.stringify(preserved)
      }

      this.addToRecentFiles(filePath, name)
      this.notifyStateChange()
      this.notifyDirtyChange()

      // Same invariant as `save` — bulk-clear drafts so orphans
      // can't trick the close-file dialog or the next launch's
      // recovery scan. See `save` above for the full rationale.
      if (this.draftStore) {
        try {
          await this.draftStore.clearAllDrafts()
        } catch (err: unknown) {
          logger.warn('FileService: Failed to clear drafts after save-as', { error: String(err) })
        }
      }

      logger.info('FileService: File saved as', { path: filePath, format: fileFormat })
      return true
    } catch (error) {
      const wrappedError = new FileSystemError('Failed to save file', 'FS_WRITE_FAILED', { cause: error })
      logger.error('FileService: Failed to save file', errorMeta(wrappedError))
      return false
    }
  }

  /**
   * Close current file
   */
  public close(): boolean {
    // Drop registry state — clearing the registry emits no per-unit
    // events (by design), so we reset the cached dirty flag manually.
    this.saveUnitRegistry.clear()
    this.detachDraftStore()
    this.diskDigest = null
    this.externalChangePending = false

    this.currentFile = {
      path: null,
      name: null,
      isDirty: false,
      content: null,
      format: this.config.defaultFormat,
      contentChecksum: null
    }
    this.notifyStateChange()
    this.notifyDirtyChange()

    // Broadcast file closed event so apps can clean up (e.g., clear workbench)
    this.broadcastEvent('file:closed')
    
    logger.info('FileService: File closed')
    return true
  }

  /**
   * Show native open dialog
   */
  public async showOpenDialog(): Promise<OpenDialogResult> {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const dialogOptions = {
      properties: ['openFile' as const],
      filters: [
        { name: 'Files', extensions: [this.config.extension.replace('.', '')] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }

    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    return {
      canceled: result.canceled,
      filePaths: result.filePaths
    }
  }

  /**
   * Show native save dialog
   */
  public async showSaveDialog(defaultName?: string): Promise<SaveDialogResult> {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const filters = [
      { name: 'Files', extensions: [this.config.extension.replace('.', '')] },
      { name: 'All Files', extensions: ['*'] }
    ]

    const result = focusedWindow
      ? await dialog.showSaveDialog(focusedWindow, defaultName ? { defaultPath: defaultName, filters } : { filters })
      : await dialog.showSaveDialog(defaultName ? { defaultPath: defaultName, filters } : { filters })

    return {
      canceled: result.canceled,
      filePath: result.filePath
    }
  }

  /**
   * Show unsaved changes confirmation dialog
   * Returns: 'save' | 'discard' | 'cancel'
   * @param labels Optional labels for i18n support
   */
  /**
   * Ask what to do about a file a third party rewrote under us. Native
   * message box rather than an in-app modal, deliberately: the app may be
   * mid-autosave and this decides whether someone's work survives, so it
   * must be impossible to miss or click past.
   */
  public async showExternalChangeDialog(): Promise<'reload' | 'keepMine'> {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const fileName = this.currentFile.name ?? i18nService.t('file.untitled')

    const options = {
      type: 'warning' as const,
      buttons: [
        i18nService.t('file.externalChange.reload'),
        i18nService.t('file.externalChange.keepMine')
      ],
      defaultId: 0,
      cancelId: 0,
      title: i18nService.t('file.externalChange.title'),
      message: i18nService.t('file.externalChange.message', { fileName }),
      detail: i18nService.t('file.externalChange.detail')
    }

    const result = focusedWindow
      ? await dialog.showMessageBox(focusedWindow, options)
      : await dialog.showMessageBox(options)

    return result.response === 1 ? 'keepMine' : 'reload'
  }

  public async showUnsavedChangesDialog(labels?: {
    title?: string
    message?: string
    detail?: string
    save?: string
    dontSave?: string
    cancel?: string
  }): Promise<'save' | 'discard' | 'cancel'> {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const fileName = this.currentFile.name ?? i18nService.t('file.untitled')
    
    const options = {
      type: 'warning' as const,
      buttons: [
        labels?.save ?? i18nService.t('file.unsavedChanges.save'),
        labels?.dontSave ?? i18nService.t('file.unsavedChanges.dontSave'),
        labels?.cancel ?? i18nService.t('file.unsavedChanges.cancel')
      ],
      defaultId: 0,
      cancelId: 2,
      title: labels?.title ?? i18nService.t('file.unsavedChanges.title'),
      message: labels?.message ?? i18nService.t('file.unsavedChanges.message', { fileName }),
      detail: labels?.detail ?? i18nService.t('file.unsavedChanges.detail')
    }

    const result = focusedWindow
      ? await dialog.showMessageBox(focusedWindow, options)
      : await dialog.showMessageBox(options)

    switch (result.response) {
      case 0:
        return 'save'
      case 1:
        return 'discard'
      default:
        return 'cancel'
    }
  }

  /**
   * Check for unsaved changes before performing an action.
   * This is a reusable pattern for window close, file operations, etc.
   * 
   * @param onSaveRequired Callback when user chooses to save - should trigger save and return true if save was successful
   * @param onDiscard Callback when user chooses to discard changes
   * @returns true if the action can proceed, false if cancelled
   */
  public async checkUnsavedBeforeAction(
    onSaveRequired?: () => Promise<boolean> | boolean | undefined,
    onDiscard?: () => void
  ): Promise<boolean> {
    // If not dirty, action can proceed
    if (!this.currentFile.isDirty) {
      return true
    }

    const result = await this.showUnsavedChangesDialog()

    switch (result) {
      case 'save':
        if (onSaveRequired) {
          const saved = await onSaveRequired()
          return saved === true
        }
        return false // No save handler, can't proceed

      case 'discard':
        if (onDiscard) {
          onDiscard()
        }
        return true

      case 'cancel':
      default:
        return false
    }
  }

  /**
   * Get current file state
   */
  public getState(): FileServiceState {
    return {
      currentFile: { ...this.currentFile },
      recentFiles: [...this.recentFiles],
      favorites: this.getFavorites(),
      platform: 'desktop'
    }
  }

  /**
   * Get current file name
   */
  public getFileName(): string | null {
    return this.currentFile.name
  }

  /**
   * Get current file path
   */
  public getFilePath(): string | null {
    return this.currentFile.path
  }

  /**
   * True when any save-unit in the registry is dirty. The cached
   * value on `currentFile.isDirty` is refreshed by
   * `refreshGlobalDirtyFromRegistry` whenever the registry emits a
   * change — no direct setter.
   */
  public isDirty(): boolean {
    return this.currentFile.isDirty
  }

  /**
   * Check if file is currently being loaded (initialization phase)
   */
  public isLoading(): boolean {
    return this._isLoading
  }

  /**
   * Mark loading as finished (call after renderer initialization is complete)
   */
  public finishLoading(): void {
    this._isLoading = false
    logger.debug('FileService: Loading finished')
  }

  /**
   * Get the content checksum (JSON stringified content at last save/open)
   */
  public getContentChecksum(): string | null {
    return this.currentFile.contentChecksum
  }

  /**
   * Update the content checksum
   * Called by renderer when content is modified to track the initial state
   */
  public setContentChecksum(checksum: string): void {
    const preview = checksum.length > 100 
      ? `${checksum.slice(0, 50)}...${checksum.slice(-50)} (len=${checksum.length})`
      : checksum
    logger.debug('[FileService] setContentChecksum', { preview, len: checksum.length })
    this.currentFile.contentChecksum = checksum
  }

  /**
   * Check if content has changed from the saved/opened state
   * @param currentChecksum JSON stringified current content
   * @returns true if content has changed
   */
  public hasContentChanged(currentChecksum: string): boolean {
    // If no checksum stored, consider no changes (file not yet opened)
    if (this.currentFile.contentChecksum === null) {
      logger.debug('[FileService] hasContentChanged: no stored checksum')
      return false
    }
    const stored = this.currentFile.contentChecksum
    const storedPreview = stored.length > 100 
      ? `${stored.slice(0, 50)}...${stored.slice(-50)} (len=${stored.length})`
      : stored
    const currentPreview = currentChecksum.length > 100 
      ? `${currentChecksum.slice(0, 50)}...${currentChecksum.slice(-50)} (len=${currentChecksum.length})`
      : currentChecksum
    const changed = stored !== currentChecksum
    logger.debug('[FileService] hasContentChanged', { 
      changed, 
      storedPreview, 
      currentPreview,
      storedLen: stored.length,
      currentLen: currentChecksum.length
    })
    return changed
  }

  /**
   * Get recent files
   */
  public getRecentFiles(): FileMetadata[] {
    // Filter and validate that files still exist
    const validFiles = this.recentFiles.filter((file) => this.fileExists(file.path))
    if (validFiles.length !== this.recentFiles.length) {
      this.recentFiles = validFiles
      this.saveRecentFiles()
    }
    return [...this.recentFiles]
  }

  /**
   * Get favorite files
   */
  public getFavorites(): FileMetadata[] {
    return this.recentFiles.filter((f) => f.isFavorite && this.fileExists(f.path))
  }

  /**
   * Toggle favorite status for a file
   */
  public toggleFavorite(path: string): boolean {
    const file = this.recentFiles.find((f) => f.path === path)
    if (file) {
      file.isFavorite = !file.isFavorite
      this.saveFavorites()
      this.notifyStateChange()
      return file.isFavorite
    }
    return false
  }

  /**
   * Remove a file from recent files
   */
  public removeFromRecent(path: string): void {
    this.recentFiles = this.recentFiles.filter((f) => f.path !== path)
    this.saveRecentFiles()
    this.saveFavorites()
    this.notifyStateChange()
  }

  /**
   * Subscribe to state changes
   */
  public onStateChanged(callback: (state: FileServiceState) => void): () => void {
    this.stateChangeCallbacks.add(callback)
    return () => {
      this.stateChangeCallbacks.delete(callback)
    }
  }

  /**
   * Subscribe to dirty state changes
   */
  public onDirtyChanged(callback: (isDirty: boolean) => void): () => void {
    this.dirtyChangeCallbacks.add(callback)
    return () => {
      this.dirtyChangeCallbacks.delete(callback)
    }
  }

  /**
   * Get the file extension
   */
  public getExtension(): string {
    return this.config.extension
  }

  /**
   * Update content without triggering save
   */
  public setContent(content: unknown): void {
    this.currentFile.content = content
  }

  /**
   * Get current content
   */
  public getContent(): unknown {
    return this.currentFile.content
  }
}

// Singleton instance
let fileServiceInstance: FileService | null = null

/**
 * Initialize the singleton instance of FileService
 */
export function initFileService(config?: Partial<FileServiceConfig>): FileService {
  if (fileServiceInstance) {
    logger.warn('FileService already initialized, returning existing instance')
    return fileServiceInstance
  }

  logger.info('FileService: Creating singleton instance...')
  fileServiceInstance = new FileService(config)
  return fileServiceInstance
}

/**
 * Get the singleton instance of FileService
 */
export function getFileService(): FileService {
  if (!fileServiceInstance) {
    throw new Error('FileService not initialized. Call initFileService() first.')
  }
  return fileServiceInstance
}

/**
 * Check if the service has been initialized
 */
export function isFileServiceInitialized(): boolean {
  return fileServiceInstance !== null
}
