import { readFileSync, existsSync } from 'fs'
import { BrowserWindow } from 'electron'
import yaml from 'js-yaml'
import MiniSearch from 'minisearch'
import type {
  SettingValue,
  SettingDefinition,
  SettingsGroup,
  SettingsYamlConfig,
  ResolvedSetting
} from '../../types/settings'
import { isSettingItem, isGroupItem } from '../../types/settings'
import { settingsYamlConfigSchema } from '../schemas/configSchemas'
import { logger } from './LoggerService'
import { getStorageService } from './StorageService'
import { FileSystemError, errorMeta } from '../../errors'
import { i18nService } from './I18nService'

// ==========================================================================
// SettingsService
// ==========================================================================

export class SettingsService {
  private groups: SettingsGroup[] = []
  private searchIndex = new MiniSearch<{ id: string; title: string; description: string }>({
    fields: ['title', 'description', 'id'],
    storeFields: ['id', 'title', 'description'],
    searchOptions: {
      boost: { title: 2 },
      fuzzy: 0.2,
      prefix: true
    }
  })

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
   * Get the current value of a setting by its storage key.
   * Falls back to default if not persisted.
   */
  public get(storageKey: string): SettingValue {
    const storage = getStorageService()
    const stored = storage.get(`settings:${storageKey}`)
    if (stored !== undefined) {
      return stored as SettingValue
    }
    // Find default
    const setting = this.findSettingByStorageKey(storageKey)
    return setting ? setting.default : ''
  }

  /**
   * Set a setting value and persist it.
   * Broadcasts 'settings:changed' to all renderer windows.
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

    logger.debug('[SettingsService] Setting reset', { storageKey })
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
          const stored = storage.get(`settings:${storageKey}`)
          const currentValue = stored !== undefined ? (stored as SettingValue) : item.setting.default
          const isModified = stored !== undefined && stored !== item.setting.default

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
