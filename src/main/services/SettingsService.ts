import { readFileSync } from 'fs'
import {
  SettingsSchema,
  SettingDefinition,
  FlattenedSetting,
  SettingCategory,
  SettingType
} from '../types/settings.types'
import { getStorageService } from './StorageService'

/**
 * Callback function type for setting change listeners
 */
export type SettingChangeListener = (key: string, newValue: unknown, oldValue: unknown) => void

/**
 * SettingsService manages application settings, loading schema from JSON
 * and persisting user values using StorageService
 */
export class SettingsService {
  private schema: SettingsSchema
  private flattenedSettings: Map<string, FlattenedSetting>
  private storageService = getStorageService()
  private readonly SETTINGS_KEY_PREFIX = 'settings.'
  private listeners: Map<string, Set<SettingChangeListener>> = new Map()

  constructor(schemaPath: string) {
    this.schema = this.loadSchema(schemaPath)
    this.flattenedSettings = this.flattenSettings(this.schema)
  }

  /**
   * Load settings schema from JSON file
   */
  private loadSchema(schemaPath: string): SettingsSchema {
    try {
      const content = readFileSync(schemaPath, 'utf-8')
      return JSON.parse(content) as SettingsSchema
    } catch (error) {
      console.error('Failed to load settings schema:', error)
      return { categories: {} }
    }
  }

  /**
   * Flatten settings hierarchy into a map for easy access
   */
  private flattenSettings(schema: SettingsSchema): Map<string, FlattenedSetting> {
    const flattened = new Map<string, FlattenedSetting>()

    const traverse = (
      category: SettingCategory,
      pathPrefix: string[],
      keyPrefix: string
    ): void => {
      // Process settings in this category
      if (category.settings) {
        Object.values(category.settings).forEach((setting) => {
          const fullPath = keyPrefix ? `${keyPrefix}.${setting.key}` : setting.key
          flattened.set(fullPath, {
            ...setting,
            fullPath,
            categoryPath: pathPrefix
          })
        })
      }

      // Process subcategories
      if (category.categories) {
        Object.values(category.categories).forEach((subCategory) => {
          const newPath = [...pathPrefix, subCategory.name]
          const newKeyPrefix = keyPrefix ? `${keyPrefix}.${subCategory.key}` : subCategory.key
          traverse(subCategory, newPath, newKeyPrefix)
        })
      }
    }

    // Start traversal from root categories
    Object.values(schema.categories).forEach((category) => {
      traverse(category, [category.name], category.key)
    })

    return flattened
  }

  /**
   * Get the complete settings schema
   */
  getSchema(): SettingsSchema {
    return this.schema
  }

  /**
   * Get a setting value by key
   * Returns user value if set, otherwise returns default value
   */
  getSetting<T>(key: string): T | undefined {
    const setting = this.flattenedSettings.get(key)
    if (!setting) {
      console.warn(`Setting not found: ${key}`)
      return undefined
    }

    // Try to get user value from storage
    const storageKey = `${this.SETTINGS_KEY_PREFIX}${key}`
    const userValue = this.storageService.get<T>(storageKey)

    // Return user value if exists, otherwise return default
    return userValue ?? (setting.defaultValue as T)
  }

  /**
   * Set a setting value
   */
  setSetting(key: string, value: unknown): boolean {
    const setting = this.flattenedSettings.get(key)
    if (!setting) {
      console.warn(`Setting not found: ${key}`)
      return false
    }

    // Validate value type
    if (!this.validateSettingValue(setting, value)) {
      console.warn(`Invalid value for setting ${key}:`, value)
      return false
    }

    // Get old value before changing
    const oldValue = this.getSetting(key)

    // Save to storage
    const storageKey = `${this.SETTINGS_KEY_PREFIX}${key}`
    this.storageService.set(storageKey, value)

    // Notify listeners
    this.notifyListeners(key, value, oldValue)

    return true
  }

  /**
   * Subscribe to changes on a specific setting key
   */
  subscribe(key: string, listener: SettingChangeListener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }

    const keyListeners = this.listeners.get(key)!
    keyListeners.add(listener)

    // Return unsubscribe function
    return () => {
      keyListeners.delete(listener)
      if (keyListeners.size === 0) {
        this.listeners.delete(key)
      }
    }
  }

  /**
   * Notify all listeners for a specific key
   */
  private notifyListeners(key: string, newValue: unknown, oldValue: unknown): void {
    const keyListeners = this.listeners.get(key)
    if (keyListeners) {
      keyListeners.forEach((listener) => {
        try {
          listener(key, newValue, oldValue)
        } catch (error) {
          console.error(`Error in setting listener for key ${key}:`, error)
        }
      })
    }
  }

  /**
   * Reset a setting to its default value
   */
  resetSetting(key: string): boolean {
    const setting = this.flattenedSettings.get(key)
    if (!setting) {
      console.warn(`Setting not found: ${key}`)
      return false
    }

    const storageKey = `${this.SETTINGS_KEY_PREFIX}${key}`
    this.storageService.delete(storageKey)
    return true
  }

  /**
   * Get all settings as key-value pairs
   */
  getAllSettings(): Record<string, unknown> {
    const settings: Record<string, unknown> = {}

    this.flattenedSettings.forEach((setting, key) => {
      settings[key] = this.getSetting(key)
    })

    return settings
  }

  /**
   * Search settings by query string
   * Searches in name, description, and key
   */
  searchSettings(query: string): FlattenedSetting[] {
    if (!query || query.trim() === '') {
      return Array.from(this.flattenedSettings.values())
    }

    const lowerQuery = query.toLowerCase()
    const results: FlattenedSetting[] = []

    this.flattenedSettings.forEach((setting) => {
      const matchesKey = String(setting.key).toLowerCase().includes(lowerQuery)
      const matchesName = String(setting.name).toLowerCase().includes(lowerQuery)
      const matchesDescription = String(setting.description).toLowerCase().includes(lowerQuery)

      if (matchesKey || matchesName || matchesDescription) {
        results.push(setting)
      }
    })

    return results
  }

  /**
   * Validate that a value matches the setting definition
   */
  private validateSettingValue(setting: SettingDefinition, value: unknown): boolean {
    switch (setting.type) {
      case SettingType.BOOLEAN:
        return typeof value === 'boolean'

      case SettingType.NUMBER:
        return typeof value === 'number' && !isNaN(value)

      case SettingType.STRING:
        return typeof value === 'string'

      case SettingType.ENUM:
        if ('options' in setting) {
          return typeof value === 'string' && setting.options.includes(value)
        }
        return false

      case SettingType.RANGE:
        if ('min' in setting && 'max' in setting) {
          return (
            typeof value === 'number' &&
            !isNaN(value) &&
            value >= setting.min &&
            value <= setting.max
          )
        }
        return false

      default:
        return false
    }
  }

  /**
   * Get a setting definition by key
   */
  getSettingDefinition(key: string): FlattenedSetting | undefined {
    return this.flattenedSettings.get(key)
  }
}

// Singleton instance
let settingsServiceInstance: SettingsService | null = null

/**
 * Get the singleton instance of SettingsService
 */
export function getSettingsService(schemaPath?: string): SettingsService {
  if (!settingsServiceInstance) {
    if (!schemaPath) {
      throw new Error('SettingsService must be initialized with a schema path')
    }
    settingsServiceInstance = new SettingsService(schemaPath)
  }
  return settingsServiceInstance
}

