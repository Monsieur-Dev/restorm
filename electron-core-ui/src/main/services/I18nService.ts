/**
 * I18nService - Simple internationalization service for main process
 * 
 * Provides translation capabilities for Electron main process dialogs and messages.
 * Translations are loaded from the same JSON files used by the renderer.
 * Language preference is persisted using StorageService.
 */
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { logger } from './LoggerService'
import { FileSystemError, errorMeta } from '../../errors'
import { getStorageService } from './StorageService'

// Import translations from renderer locales (shared with renderer)
import coreEnTranslation from '../../renderer/locales/en/translation.json'
import coreFrTranslation from '../../renderer/locales/fr/translation.json'

// Translation resources type
type TranslationResources = Record<string, Record<string, unknown>>

/**
 * I18nService class for main process translations
 */
class I18nService {
  private resources: TranslationResources = {}
  private currentLanguage = 'en'
  private fallbackLanguage = 'en'
  private initialized = false

  /**
   * Initialize the i18n service with resources
   * @param resourcesPath Path to additional locales directory (optional)
   * @param defaultLanguage Default language code
   */
  public initialize(resourcesPath: string, defaultLanguage = 'en'): void {
    if (this.initialized) {
      logger.warn('[I18nService] Already initialized, skipping')
      return
    }

    // Load built-in translations from electron-core-ui (from JSON files)
    this.loadBuiltInTranslations()

    // Load application translations if path provided
    if (resourcesPath && existsSync(resourcesPath)) {
      this.loadTranslationsFromPath(resourcesPath)
    }

    // Restore saved language preference or use default
    const storageService = getStorageService()
    const savedLanguage = storageService.get('language') as string | undefined
    this.currentLanguage = savedLanguage ?? defaultLanguage
    this.fallbackLanguage = 'en'

    this.initialized = true
    logger.info('[I18nService] Initialized', { language: this.currentLanguage, savedLanguage })
  }

  /**
   * Load built-in translations from electron-core-ui JSON files
   */
  private loadBuiltInTranslations(): void {
    this.resources['en'] = coreEnTranslation as unknown as Record<string, unknown>
    this.resources['fr'] = coreFrTranslation as unknown as Record<string, unknown>
  }

  /**
   * Load translations from a directory path (for application overrides)
   */
  private loadTranslationsFromPath(localesPath: string): void {
    const languages = ['en', 'fr']
    
    for (const lang of languages) {
      const filePath = join(localesPath, lang, 'translation.json')
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, 'utf-8')
          const translations = JSON.parse(content) as Record<string, unknown>
          // Merge with existing resources (app overrides built-in)
          this.resources[lang] = this.deepMerge(this.resources[lang] ?? {}, translations)
          logger.debug(`[I18nService] Loaded translations for ${lang}`, { path: filePath })
        } catch (error) {
          const wrappedError = new FileSystemError(`Failed to load translations for ${lang}`, 'FS_READ_FAILED', { cause: error })
          logger.error(`[I18nService] Failed to load translations for ${lang}`, errorMeta(wrappedError))
        }
      }
    }
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base }
    
    for (const [key, value] of Object.entries(override)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.deepMerge(
          (result[key] ?? {}) as Record<string, unknown>,
          value as Record<string, unknown>
        )
      } else {
        result[key] = value
      }
    }
    
    return result
  }

  /**
   * Set the current language and persist it
   */
  public setLanguage(language: string): void {
    this.currentLanguage = language
    const storageService = getStorageService()
    storageService.set('language', language)
    logger.debug('[I18nService] Language changed and persisted', { language })
  }

  /**
   * Get the current language
   */
  public getLanguage(): string {
    return this.currentLanguage
  }

  /**
   * Get a translation by key path (e.g., "file.unsavedChanges.title")
   * @param key Dot-separated key path
   * @param params Optional interpolation parameters
   */
  public t(key: string, params?: Record<string, string | number>): string {
    // Try current language first, then fallback
    let value = this.getValue(key, this.currentLanguage)
    value ??= this.getValue(key, this.fallbackLanguage)
    
    if (value === undefined) {
      logger.warn(`[I18nService] Missing translation for key: ${key}`)
      return key
    }

    // Apply interpolation if params provided
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        value = value.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(paramValue))
      }
    }

    return value
  }

  /**
   * Get a value from resources by dot-separated key path
   */
  private getValue(keyPath: string, language: string): string | undefined {
    const keys = keyPath.split('.')
    let current: unknown = this.resources[language]

    for (const key of keys) {
      if (current === undefined || current === null || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[key]
    }

    return typeof current === 'string' ? current : undefined
  }
}

// Singleton instance
export const i18nService = new I18nService()
