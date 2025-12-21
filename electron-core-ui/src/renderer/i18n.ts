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

function mergeResources(base: Resource, override: Resource): Resource {
  const result: Resource = { ...base }

  for (const [lang, overrideNamespaces] of Object.entries(override)) {
    const baseNamespaces = (result[lang] ?? {}) as Record<string, unknown>
    const nextNamespaces: Record<string, unknown> = { ...baseNamespaces }

    for (const [nsKey, overrideNsValue] of Object.entries(overrideNamespaces as Record<string, unknown>)) {
      if (nsKey === 'translation') {
        const baseTranslation = (baseNamespaces['translation'] ?? {}) as Record<string, unknown>
        nextNamespaces['translation'] = {
          ...baseTranslation,
          ...(overrideNsValue as Record<string, unknown>)
        }
      } else {
        nextNamespaces[nsKey] = overrideNsValue
      }
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

  // Init with merged resources and return the promise
  return i18n
    .init({
    resources: mergedResources,
    lng: defaultLanguage,
    fallbackLng: defaultLanguage,
    interpolation: {
      escapeValue: false // React already escapes values
    }
  }).then(() => {
    isInitialized = true
    return i18n
  }).catch((error: unknown) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
    throw error
  })
}

// Export the i18n instance for direct use
export default i18n
