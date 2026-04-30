import { readFileSync, existsSync, promises as fsp } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import yaml from 'js-yaml'
import MiniSearch from 'minisearch'
import type {
  SettingValue,
  SettingDefinition,
  SettingsGroup,
  SettingsYamlConfig,
  ResolvedSetting,
  ResolvedSettingValue
} from '../../types/settings'
import { isSettingItem, isGroupItem } from '../../types/settings'
import { settingsYamlConfigSchema } from '../schemas/configSchemas'
import { logger } from './LoggerService'
import { getStorageService } from './StorageService'
import { isFeatureServiceInitialized, getFeatureService } from './FeatureFlippingService'
import { atomicWriteFile } from './PersistenceService'
import { FileSystemError, errorMeta } from '../../errors'
import { i18nService } from './I18nService'

/**
 * Subdirectory + filename used inside a workspace path for the
 * project-scoped settings overlay. Hosted apps don't change this —
 * the convention is shared across consumers so a `.restorm/`
 * directory is recognisable on disk regardless of which app produced
 * it.
 */
const WORKSPACE_DIR = '.restorm'
const WORKSPACE_FILE = 'settings.json'

/** Debounce window for sparse workspace-file writes (ms). */
const WORKSPACE_WRITE_DEBOUNCE_MS = 200

// ==========================================================================
// SettingsService
// ==========================================================================

/**
 * Callback shape for in-process listeners on a single setting key.
 * The IPC `'settings:changed'` broadcast goes to renderer windows;
 * main-process services that need to react to live changes (e.g. the
 * autosave controller) use the in-process subscription below to avoid
 * a round-trip through `ipcMain`.
 */
export type SettingChangedListener = (value: SettingValue) => void

export class SettingsService {
  private groups: SettingsGroup[] = []
  private listeners = new Map<string, Set<SettingChangedListener>>()
  private searchIndex = new MiniSearch<{ id: string; title: string; description: string }>({
    fields: ['title', 'description', 'id'],
    storeFields: ['id', 'title', 'description'],
    searchOptions: {
      boost: { title: 2 },
      fuzzy: 0.2,
      prefix: true
    }
  })
  /**
   * Active workspace path (an absolute directory, e.g. the directory
   * containing a `.restorm` file or folder). When set, the service
   * loads `<path>/.restorm/settings.json` as a sparse override on
   * top of the user-level values. `null` means no project is open
   * and the workspace layer is empty.
   */
  private workspacePath: string | null = null
  /** In-memory copy of the workspace file (only the keys it explicitly carries). */
  private workspaceValues = new Map<string, SettingValue>()
  /** Pending debounced write timer for the workspace file. */
  private workspaceWriteTimer: ReturnType<typeof setTimeout> | null = null
  /** Unique id for an active workspace load — guards against stale loads after rapid path swaps. */
  private workspaceLoadGeneration = 0

  constructor(defaultConfigPath: string, appConfigPath?: string) {
    // Load defaults
    if (existsSync(defaultConfigPath)) {
      this.loadConfigInternal(defaultConfigPath, false)
    } else {
      logger.warn('[SettingsService] Default config not found', { path: defaultConfigPath })
    }

    // Load app config if provided
    if (appConfigPath && existsSync(appConfigPath)) {
      this.loadConfig(appConfigPath)
    }

    this.reindexSearch()
    logger.info('[SettingsService] Initialized', {
      groups: this.groups.length
    })
  }

  // ==========================================================================
  // Config Loading
  // ==========================================================================

  /**
   * Load and merge an additional YAML configuration.
   * Handles overrideDefaultGroups flag.
   */
  public loadConfig(configPath: string): void {
    if (!existsSync(configPath)) {
      logger.warn('[SettingsService] Config file not found', { path: configPath })
      return
    }
    this.loadConfigInternal(configPath, true)
    this.reindexSearch()

    // Broadcast to all windows so the renderer can reload groups
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings:config-loaded')
      }
    }
  }

  private loadConfigInternal(
    configPath: string,
    handleOverrideGroups: boolean
  ): void {
    try {
      const content = readFileSync(configPath, 'utf-8')
      const raw = yaml.load(content)
      const parsed = settingsYamlConfigSchema.safeParse(raw)

      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        logger.warn('[SettingsService] Invalid settings config', { path: configPath, issues })
        return
      }

      const config = parsed.data as SettingsYamlConfig

      // Handle groups
      if (handleOverrideGroups && config.overrideDefaultGroups === true) {
        this.groups = config.groups
      } else {
        this.groups = [...this.groups, ...config.groups]
      }
    } catch (error) {
      const wrappedError = new FileSystemError('Failed to load settings config', 'FS_READ_FAILED', { cause: error })
      logger.error('[SettingsService] Failed to load config', errorMeta(wrappedError))
    }
  }

  // ==========================================================================
  // Get / Set
  // ==========================================================================

  /**
   * Returns the effective value of a setting using the canonical
   * priority `workspace > user > default`. Hosting code should use
   * this for any read that drives behaviour — controllers, hooks,
   * effects. UI inspectors that need to know which layer a value
   * came from should call `getResolvedValue()` instead.
   *
   * Workspace overrides are skipped silently when the setting has
   * `userOnly: true` (the load step already drops those keys with a
   * warning, so this is a belt-and-braces safety net).
   *
   * Returns `featureDisabledDefault` when the setting's feature is
   * disabled (existing behaviour preserved).
   */
  public get(storageKey: string): SettingValue {
    const setting = this.findSettingByStorageKey(storageKey)
    if (setting?.feature && !this.isSettingFeatureEnabled(setting)) {
      return setting.featureDisabledDefault ?? setting.default
    }

    const ws = this.getWorkspaceValue(storageKey)
    if (ws !== undefined && setting?.userOnly !== true) {
      return ws
    }
    const user = this.getUserValue(storageKey)
    if (user !== undefined) {
      return user
    }
    return setting ? setting.default : ''
  }

  /** User-level value or `undefined` if the user hasn't customised the setting. */
  public getUserValue(storageKey: string): SettingValue | undefined {
    const stored = getStorageService().get(`settings:${storageKey}`)
    return stored === undefined ? undefined : (stored as SettingValue)
  }

  /** Workspace-level value or `undefined` if the workspace doesn't override the setting. */
  public getWorkspaceValue(storageKey: string): SettingValue | undefined {
    return this.workspaceValues.get(storageKey)
  }

  /**
   * Inspect both layers and report the effective value alongside its
   * source. Useful for the Settings UI's "Also modified in workspace"
   * badge and for debugging.
   */
  public getResolvedValue(storageKey: string): ResolvedSettingValue {
    const setting = this.findSettingByStorageKey(storageKey)
    if (setting?.feature && !this.isSettingFeatureEnabled(setting)) {
      return { storageKey, effective: setting.featureDisabledDefault ?? setting.default, source: 'default' }
    }
    const ws = this.getWorkspaceValue(storageKey)
    const user = this.getUserValue(storageKey)
    if (ws !== undefined && setting?.userOnly !== true) {
      return {
        storageKey,
        effective: ws,
        source: 'workspace',
        ...(user !== undefined ? { overriddenBy: 'workspace' as const } : {})
      }
    }
    if (user !== undefined) {
      return { storageKey, effective: user, source: 'user' }
    }
    return { storageKey, effective: setting ? setting.default : '', source: 'default' }
  }

  /**
   * Set a setting value and persist it.
   * Broadcasts 'settings:changed' to all renderer windows and notifies
   * in-process listeners registered via `onSettingChanged`.
   */
  public set(storageKey: string, value: SettingValue): void {
    const storage = getStorageService()
    storage.set(`settings:${storageKey}`, value)

    // Broadcast to all windows
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings:changed', storageKey, value)
      }
    }

    this.notifyListeners(storageKey, value)
    logger.debug('[SettingsService] Setting changed', { storageKey, value: String(value) })
  }

  /**
   * Reset a setting to its default value.
   */
  public resetSetting(storageKey: string): void {
    const storage = getStorageService()
    storage.delete(`settings:${storageKey}`)

    const setting = this.findSettingByStorageKey(storageKey)
    const defaultValue = setting ? setting.default : ''

    // Broadcast reset
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings:changed', storageKey, defaultValue)
      }
    }

    this.notifyListeners(storageKey, defaultValue)
    logger.debug('[SettingsService] Setting reset', { storageKey })
  }

  /**
   * Subscribe to in-process changes for a single setting key. The
   * listener fires from `set()` and `resetSetting()` on the main
   * process — same source of truth as the IPC `'settings:changed'`
   * broadcast that renderers receive. Returns an unsubscribe function.
   */
  public onSettingChanged(storageKey: string, listener: SettingChangedListener): () => void {
    let bucket = this.listeners.get(storageKey)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(storageKey, bucket)
    }
    bucket.add(listener)
    return () => {
      const set = this.listeners.get(storageKey)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(storageKey)
    }
  }

  private notifyListeners(storageKey: string, value: SettingValue): void {
    const bucket = this.listeners.get(storageKey)
    if (!bucket) return
    // Snapshot to defend against listeners that unsubscribe themselves.
    for (const listener of Array.from(bucket)) {
      try {
        listener(value)
      } catch (error) {
        logger.warn('[SettingsService] Listener threw', { storageKey, error: String(error) })
      }
    }
  }

  // ==========================================================================
  // Workspace overlay
  // ==========================================================================

  /**
   * Activate a workspace overlay rooted at `absoluteDir`. Loads
   * `<absoluteDir>/.restorm/settings.json` synchronously if present;
   * keys flagged `userOnly` are dropped with a warning. Re-calling
   * with the same path is a no-op (idempotent). Renderers receive
   * `'settings:workspace-changed'` so they can re-resolve every
   * affected key.
   */
  public setWorkspacePath(absoluteDir: string): void {
    if (this.workspacePath === absoluteDir) return
    this.workspacePath = absoluteDir
    this.workspaceLoadGeneration += 1
    const generation = this.workspaceLoadGeneration
    const file = this.workspaceFilePath()
    const previousKeys = new Set(this.workspaceValues.keys())
    this.workspaceValues = new Map()
    if (file && existsSync(file)) {
      try {
        const raw = readFileSync(file, 'utf-8')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        if (generation !== this.workspaceLoadGeneration) return
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            logger.warn('[SettingsService] Skipping non-primitive value in workspace file', { key })
            continue
          }
          const setting = this.findSettingByStorageKey(key)
          if (setting?.userOnly === true) {
            logger.warn('[SettingsService] Workspace cannot override userOnly setting; ignoring', { key, file })
            continue
          }
          this.workspaceValues.set(key, value as SettingValue)
        }
      } catch (error) {
        const wrapped = new FileSystemError('Failed to load workspace settings', 'FS_READ_FAILED', { cause: error })
        logger.warn('[SettingsService] Workspace file unreadable, ignoring', errorMeta(wrapped))
      }
    }
    this.broadcastWorkspaceChanged()
    this.notifyEffectiveValueChanges(previousKeys)
    logger.info('[SettingsService] Workspace path activated', {
      path: absoluteDir,
      keys: this.workspaceValues.size
    })
  }

  /**
   * Drop the workspace overlay. Renderers re-resolve to user / default.
   * Any debounced write that hasn't landed yet is forced through first
   * — without this, picking a workspace value and immediately closing
   * the project loses the change (the timer would just be cancelled).
   */
  public unsetWorkspacePath(): void {
    if (this.workspacePath === null) return
    const previousKeys = new Set(this.workspaceValues.keys())
    if (this.workspaceWriteTimer) {
      clearTimeout(this.workspaceWriteTimer)
      this.workspaceWriteTimer = null
      // Capture file + values before clearing so the flush has data to
      // write. Fire-and-forget — callers can't easily await a sync
      // method, and the broadcast still fires synchronously below.
      const file = this.workspaceFilePath()
      const snapshot = new Map(this.workspaceValues)
      void this.writeWorkspaceFile(file, snapshot)
    }
    this.workspacePath = null
    this.workspaceValues = new Map()
    this.workspaceLoadGeneration += 1
    this.broadcastWorkspaceChanged()
    this.notifyEffectiveValueChanges(previousKeys)
    logger.info('[SettingsService] Workspace path cleared')
  }

  /** Currently-active workspace directory or `null` if none is open. */
  public getWorkspacePath(): string | null {
    return this.workspacePath
  }

  /**
   * Upsert a workspace-scoped value. `userOnly` settings are rejected
   * with a warning (they live on the user layer only). The write is
   * debounced + atomic; the method itself is synchronous because the
   * disk flush is intentionally deferred so rapid edits collapse
   * into one write. Callers that need a write fence should await the
   * next debounce tick or call `flushWorkspaceFile` (private).
   */
  public setWorkspaceValue(storageKey: string, value: SettingValue): void {
    if (this.workspacePath === null) {
      logger.warn('[SettingsService] setWorkspaceValue called with no active workspace; ignoring', { storageKey })
      return
    }
    const setting = this.findSettingByStorageKey(storageKey)
    if (setting?.userOnly === true) {
      logger.warn('[SettingsService] Cannot set userOnly setting at workspace scope', { storageKey })
      return
    }
    this.workspaceValues.set(storageKey, value)
    this.scheduleWorkspaceFlush()
    // Always broadcast on workspace writes — listeners (theme swap,
    // locale swap, …) may have drifted away from the settings layer's
    // computed effective value (e.g. ThemeService falling back to a
    // different theme on init). Skipping the broadcast when previous
    // and next effective values happen to coincide leaves the UI
    // wedged in those cases. Downstream IPCs are idempotent.
    this.broadcastEffectiveValueChange(storageKey, this.getResolvedValue(storageKey).effective)
    this.broadcastWorkspaceChanged()
  }

  /** Drop a key from the workspace overlay. */
  public resetWorkspaceValue(storageKey: string): void {
    if (this.workspacePath === null) return
    if (!this.workspaceValues.has(storageKey)) return
    this.workspaceValues.delete(storageKey)
    this.scheduleWorkspaceFlush()
    this.broadcastEffectiveValueChange(storageKey, this.getResolvedValue(storageKey).effective)
    this.broadcastWorkspaceChanged()
  }

  /** All workspace overrides as a snapshot — useful for the renderer's UI. */
  public getWorkspaceValues(): Record<string, SettingValue> {
    return Object.fromEntries(this.workspaceValues)
  }

  // ── Workspace internals ─────────────────────────────────────────────

  private workspaceFilePath(): string | null {
    return this.workspacePath ? join(this.workspacePath, WORKSPACE_DIR, WORKSPACE_FILE) : null
  }

  private scheduleWorkspaceFlush(): void {
    if (this.workspaceWriteTimer) {
      clearTimeout(this.workspaceWriteTimer)
    }
    this.workspaceWriteTimer = setTimeout(() => {
      this.workspaceWriteTimer = null
      void this.flushWorkspaceFile()
    }, WORKSPACE_WRITE_DEBOUNCE_MS)
  }

  private async flushWorkspaceFile(): Promise<void> {
    await this.writeWorkspaceFile(this.workspaceFilePath(), this.workspaceValues)
  }

  /**
   * Write a snapshot of the workspace overlay to disk. Parametrised so
   * `unsetWorkspacePath` can flush a captured snapshot AFTER it has
   * cleared `this.workspacePath` / `this.workspaceValues` — the path
   * and values must be preserved by the caller in that case.
   */
  private async writeWorkspaceFile(file: string | null, values: ReadonlyMap<string, SettingValue>): Promise<void> {
    if (!file) return
    try {
      if (values.size === 0) {
        // Empty overlay → keep the directory clean (auto-delete an
        // empty file). `unlink` is the right primitive; ignore "no
        // such file" to stay idempotent.
        try {
          await fsp.unlink(file)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        return
      }
      const json = JSON.stringify(Object.fromEntries(values), null, 2)
      await atomicWriteFile(file, json)
    } catch (error) {
      const wrapped = new FileSystemError('Failed to write workspace settings', 'FS_WRITE_FAILED', { cause: error })
      logger.error('[SettingsService] Workspace flush failed', errorMeta(wrapped))
    }
  }

  private broadcastWorkspaceChanged(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings:workspace-changed', this.workspacePath)
      }
    }
  }

  /**
   * After a workspace path swap, every key whose effective value
   * changed needs a `'settings:changed'` broadcast + an in-process
   * notification so consumers (autosave controller, UI) re-read.
   * `previousKeys` is the set of workspace-overridden keys *before*
   * the swap so we can union with the current set and notify only
   * the affected ones.
   */
  private notifyEffectiveValueChanges(previousKeys: Set<string>): void {
    const affected = new Set<string>(previousKeys)
    for (const k of this.workspaceValues.keys()) affected.add(k)
    for (const key of affected) {
      const value = this.get(key)
      this.broadcastEffectiveValueChange(key, value)
    }
  }

  private broadcastEffectiveValueChange(storageKey: string, value: SettingValue): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('settings:changed', storageKey, value)
      }
    }
    this.notifyListeners(storageKey, value)
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  /** Get all settings as flattened resolved list */
  public getAll(): ResolvedSetting[] {
    return this.flattenSettings(this.groups, [])
  }

  /** Get the raw group hierarchy */
  public getGroups(): SettingsGroup[] {
    return this.groups
  }

  /** Get the group hierarchy with feature-gated settings removed */
  public getFilteredGroups(): SettingsGroup[] {
    return this.filterGroupsByFeature(this.groups)
  }

  // ==========================================================================
  // Runtime Mutations
  // ==========================================================================

  /** Add a group at root or under a parent group */
  public addGroup(parentGroupId: string | null, group: SettingsGroup): void {
    if (parentGroupId === null) {
      this.groups.push(group)
    } else {
      const parent = this.findGroupById(this.groups, parentGroupId)
      if (parent) {
        parent.items.push({ group })
      }
    }
    this.reindexSearch()
  }

  /** Remove a group by ID */
  public removeGroup(groupId: string): void {
    this.removeGroupRecursive(this.groups, groupId)
    this.reindexSearch()
  }

  /** Add a setting to a group */
  public addSetting(groupId: string, setting: SettingDefinition): void {
    const group = this.findGroupById(this.groups, groupId)
    if (group) {
      group.items.push({ setting })
      this.reindexSearch()
    }
  }

  /** Update a setting definition */
  public updateSetting(storageKey: string, updates: Partial<SettingDefinition>): void {
    const allSettings = this.flattenSettings(this.groups, [])
    const found = allSettings.find((s) => s.storageKey === storageKey)
    if (found) {
      const setting = this.findSettingByStorageKey(storageKey)
      if (setting) {
        Object.assign(setting, updates)
        this.reindexSearch()
      }
    }
  }

  /** Remove a setting by storage key */
  public removeSetting(storageKey: string): void {
    this.removeSettingRecursive(this.groups, storageKey, [])
    this.reindexSearch()
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  /** Search settings by query */
  public search(query: string): ResolvedSetting[] {
    if (!query.trim()) {
      return this.getAll()
    }

    const results = this.searchIndex.search(query)
    const matchingIds = new Set(results.map((r) => r.id as string))
    return this.getAll().filter((s) => matchingIds.has(s.storageKey))
  }

  /** Rebuild search index (call on language change) */
  public reindexSearch(): void {
    this.searchIndex.removeAll()

    const allSettings = this.flattenSettings(this.groups, [])
    const docs = allSettings.map((s) => ({
      id: s.storageKey,
      title: i18nService.t(s.titleKey) || s.titleKey,
      description: s.descriptionKey ? (i18nService.t(s.descriptionKey) || s.descriptionKey) : ''
    }))

    if (docs.length > 0) {
      this.searchIndex.addAll(docs)
    }

    logger.debug('[SettingsService] Search index rebuilt', { count: docs.length })
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /** Build storage key from group path and setting ID */
  private buildStorageKey(groupPath: string[], settingId: string): string {
    return groupPath.length > 0 ? `${groupPath.join('.')}:${settingId}` : settingId
  }

  /** Flatten all settings with their group paths and current values */
  private flattenSettings(groups: SettingsGroup[], path: string[]): ResolvedSetting[] {
    const result: ResolvedSetting[] = []
    const storage = getStorageService()

    for (const group of groups) {
      const currentPath = [...path, group.id]

      for (const item of group.items) {
        if (isSettingItem(item)) {
          const storageKey = this.buildStorageKey(currentPath, item.setting.id)
          const featureDisabled = item.setting.feature != null && !this.isSettingFeatureEnabled(item.setting)
          let currentValue: SettingValue
          let isModified: boolean

          if (featureDisabled) {
            currentValue = item.setting.featureDisabledDefault ?? item.setting.default
            isModified = false
          } else {
            const stored = storage.get(`settings:${storageKey}`)
            currentValue = stored !== undefined ? (stored as SettingValue) : item.setting.default
            isModified = stored !== undefined && stored !== item.setting.default
          }

          result.push({
            ...item.setting,
            groupPath: currentPath,
            storageKey,
            currentValue,
            isModified
          })
        } else if (isGroupItem(item)) {
          result.push(...this.flattenSettings([item.group], currentPath))
        }
      }
    }

    return result
  }

  /** Find a setting definition by its storage key */
  private findSettingByStorageKey(storageKey: string): SettingDefinition | null {
    const allSettings = this.flattenSettings(this.groups, [])
    const found = allSettings.find((s) => s.storageKey === storageKey)
    return found ?? null
  }

  /** Find a group by ID recursively */
  private findGroupById(groups: SettingsGroup[], groupId: string): SettingsGroup | null {
    for (const group of groups) {
      if (group.id === groupId) return group
      for (const item of group.items) {
        if (isGroupItem(item)) {
          const found = this.findGroupById([item.group], groupId)
          if (found) return found
        }
      }
    }
    return null
  }

  /** Remove a group by ID recursively */
  private removeGroupRecursive(groups: SettingsGroup[], groupId: string): boolean {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i]?.id === groupId) {
        groups.splice(i, 1)
        return true
      }
      const group = groups[i]
      if (group) {
        for (let j = 0; j < group.items.length; j++) {
          const item = group.items[j]
          if (item && isGroupItem(item) && item.group.id === groupId) {
            group.items.splice(j, 1)
            return true
          }
          if (item && isGroupItem(item)) {
            if (this.removeGroupRecursive([item.group], groupId)) return true
          }
        }
      }
    }
    return false
  }

  /** Check whether a setting's associated feature is enabled */
  private isSettingFeatureEnabled(setting: SettingDefinition): boolean {
    if (!setting.feature) return true
    if (!isFeatureServiceInitialized()) return false
    return getFeatureService().isEnabled(setting.feature)
  }

  /** Return a deep copy of the group tree with feature-gated settings removed */
  private filterGroupsByFeature(groups: SettingsGroup[]): SettingsGroup[] {
    const filtered: SettingsGroup[] = []

    for (const group of groups) {
      const filteredItems = group.items
        .map((item) => {
          if (isSettingItem(item)) {
            return this.isSettingFeatureEnabled(item.setting) ? item : null
          }
          // Nested group — recurse
          const childGroups = this.filterGroupsByFeature([item.group])
          const firstChild = childGroups[0]
          return firstChild ? { group: firstChild } : null
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)

      // Only include groups that still have items after filtering
      if (filteredItems.length > 0) {
        filtered.push({ ...group, items: filteredItems })
      }
    }

    return filtered
  }

  /** Remove a setting by storage key recursively */
  private removeSettingRecursive(groups: SettingsGroup[], storageKey: string, path: string[]): boolean {
    for (const group of groups) {
      const currentPath = [...path, group.id]
      for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i]
        if (item && isSettingItem(item)) {
          const key = this.buildStorageKey(currentPath, item.setting.id)
          if (key === storageKey) {
            group.items.splice(i, 1)
            return true
          }
        }
        if (item && isGroupItem(item)) {
          if (this.removeSettingRecursive([item.group], storageKey, currentPath)) return true
        }
      }
    }
    return false
  }
}

// ==========================================================================
// Singleton
// ==========================================================================

let settingsServiceInstance: SettingsService | null = null

export function initSettingsService(defaultConfigPath: string, appConfigPath?: string): SettingsService {
  if (settingsServiceInstance) {
    logger.warn('[SettingsService] Already initialized, returning existing instance')
    return settingsServiceInstance
  }

  settingsServiceInstance = new SettingsService(defaultConfigPath, appConfigPath)
  return settingsServiceInstance
}

export function getSettingsService(): SettingsService {
  if (!settingsServiceInstance) {
    throw new Error('SettingsService not initialized. Call initSettingsService() first.')
  }
  return settingsServiceInstance
}

export function isSettingsServiceInitialized(): boolean {
  return settingsServiceInstance !== null
}
