import i18n from 'i18next'
import type { Resource, i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { logger } from './services/logger'
import coreEnTranslation from './locales/en/translation.json'
import coreFrTranslation from './locales/fr/translation.json'

// Track if i18n has been initialized
let isInitialized = false

// Core UI default resources (can be overridden by application resources)
const coreResources: Resource = {
  en: { translation: coreEnTranslation as unknown as Record<string, unknown> },
  fr: { translation: coreFrTranslation as unknown as Record<string, unknown> }
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key]
    if (
      baseValue && overrideValue &&
      typeof baseValue === 'object' && !Array.isArray(baseValue) &&
      typeof overrideValue === 'object' && !Array.isArray(overrideValue)
    ) {
      result[key] = deepMerge(baseValue as Record<string, unknown>, overrideValue as Record<string, unknown>)
    } else {
      result[key] = overrideValue
    }
  }
  return result
}

function mergeResources(base: Resource, override: Resource): Resource {
  const result: Resource = { ...base }

  for (const [lang, overrideNamespaces] of Object.entries(override)) {
    const baseNamespaces = (result[lang] ?? {}) as Record<string, unknown>
    const nextNamespaces: Record<string, unknown> = { ...baseNamespaces }

    for (const [nsKey, overrideNsValue] of Object.entries(overrideNamespaces as Record<string, unknown>)) {
      const baseNs = (baseNamespaces[nsKey] ?? {}) as Record<string, unknown>
      nextNamespaces[nsKey] = deepMerge(baseNs, overrideNsValue as Record<string, unknown>)
    }

    result[lang] = nextNamespaces as Resource[string]
  }

  return result
}

// Generic i18n setup - applications can provide their own translations
export function initializeI18n(resources: Resource, defaultLanguage = 'en'): Promise<I18nInstance> {
  // Prevent double initialization
  if (isInitialized) {
    logger.warn('i18n already initialized, skipping')
    return Promise.resolve(i18n)
  }

  // Initialize i18n
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next)
  }

  // Merge core resources with application resources (app overrides core)
  const mergedResources = mergeResources(coreResources, resources)

  const availableLanguages = new Set(Object.keys(mergedResources))

  const resolveInitialLanguage = async (): Promise<string> => {
    try {
      const api = (window as unknown as { api?: { i18n?: { getLanguage?: () => Promise<string> } } }).api
      const getLanguage = api?.i18n?.getLanguage
      if (!getLanguage) {
        return defaultLanguage
      }
      const stored = await getLanguage()
      if (stored && availableLanguages.has(stored)) {
        return stored
      }
      return defaultLanguage
    } catch (error) {
      logger.warn('Failed to resolve persisted language, falling back to default', { error: String(error) })
      return defaultLanguage
    }
  }

  return resolveInitialLanguage()
    .then((initialLanguage) => {
      return i18n.init({
        resources: mergedResources,
        lng: initialLanguage,
        fallbackLng: defaultLanguage,
        interpolation: {
          escapeValue: false // React already escapes values
        }
      })
    })
    .then(() => {
      isInitialized = true

      const api = (window as unknown as { api?: { i18n?: { setLanguage?: (lng: string) => Promise<boolean> } } }).api
      const setLanguage = api?.i18n?.setLanguage

      if (setLanguage) {
        void setLanguage(i18n.language)
        i18n.on('languageChanged', (lng: string) => {
          void setLanguage(lng)
        })
      }

      return i18n
    })
    .catch((error: unknown) => {
      logger.error('Failed to initialize i18n', { error: String(error) })
      throw error
    })
}

// Export the i18n instance for direct use
export default i18n
