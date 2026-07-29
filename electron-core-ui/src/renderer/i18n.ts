import i18n from 'i18next'
import type { Resource, i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { logger } from './services/logger'
import { matchSupportedLocale } from '../shared/localeMatch'
import coreEnTranslation from './locales/en/translation.json'
import coreFrTranslation from './locales/fr/translation.json'
import coreEsTranslation from './locales/es/translation.json'
import coreDeTranslation from './locales/de/translation.json'
import coreItTranslation from './locales/it/translation.json'
import corePtTranslation from './locales/pt/translation.json'
import coreSqTranslation from './locales/sq/translation.json'
import coreHrTranslation from './locales/hr/translation.json'
import coreFiTranslation from './locales/fi/translation.json'
import coreNlTranslation from './locales/nl/translation.json'
import coreElTranslation from './locales/el/translation.json'
import corePlTranslation from './locales/pl/translation.json'
import coreSrTranslation from './locales/sr/translation.json'
import coreSvTranslation from './locales/sv/translation.json'
import coreUkTranslation from './locales/uk/translation.json'
import coreZhCnTranslation from './locales/zh-CN/translation.json'
import coreZhTwTranslation from './locales/zh-TW/translation.json'
import coreJaTranslation from './locales/ja/translation.json'
import coreKoTranslation from './locales/ko/translation.json'
import coreTrTranslation from './locales/tr/translation.json'
import coreIdTranslation from './locales/id/translation.json'
import coreViTranslation from './locales/vi/translation.json'
import coreCsTranslation from './locales/cs/translation.json'
import coreDaTranslation from './locales/da/translation.json'
import coreNbTranslation from './locales/nb/translation.json'
import coreHuTranslation from './locales/hu/translation.json'
import coreRoTranslation from './locales/ro/translation.json'

// Track if i18n has been initialized
let isInitialized = false

// Core UI default resources (can be overridden by application resources)
const coreResources: Resource = {
  en: { translation: coreEnTranslation as unknown as Record<string, unknown> },
  fr: { translation: coreFrTranslation as unknown as Record<string, unknown> },
  es: { translation: coreEsTranslation as unknown as Record<string, unknown> },
  de: { translation: coreDeTranslation as unknown as Record<string, unknown> },
  it: { translation: coreItTranslation as unknown as Record<string, unknown> },
  pt: { translation: corePtTranslation as unknown as Record<string, unknown> },
  sq: { translation: coreSqTranslation as unknown as Record<string, unknown> },
  hr: { translation: coreHrTranslation as unknown as Record<string, unknown> },
  fi: { translation: coreFiTranslation as unknown as Record<string, unknown> },
  nl: { translation: coreNlTranslation as unknown as Record<string, unknown> },
  el: { translation: coreElTranslation as unknown as Record<string, unknown> },
  pl: { translation: corePlTranslation as unknown as Record<string, unknown> },
  sr: { translation: coreSrTranslation as unknown as Record<string, unknown> },
  sv: { translation: coreSvTranslation as unknown as Record<string, unknown> },
  uk: { translation: coreUkTranslation as unknown as Record<string, unknown> },
  'zh-CN': { translation: coreZhCnTranslation as unknown as Record<string, unknown> },
  'zh-TW': { translation: coreZhTwTranslation as unknown as Record<string, unknown> },
  ja: { translation: coreJaTranslation as unknown as Record<string, unknown> },
  ko: { translation: coreKoTranslation as unknown as Record<string, unknown> },
  tr: { translation: coreTrTranslation as unknown as Record<string, unknown> },
  id: { translation: coreIdTranslation as unknown as Record<string, unknown> },
  vi: { translation: coreViTranslation as unknown as Record<string, unknown> },
  cs: { translation: coreCsTranslation as unknown as Record<string, unknown> },
  da: { translation: coreDaTranslation as unknown as Record<string, unknown> },
  nb: { translation: coreNbTranslation as unknown as Record<string, unknown> },
  hu: { translation: coreHuTranslation as unknown as Record<string, unknown> },
  ro: { translation: coreRoTranslation as unknown as Record<string, unknown> }
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

  // OS/browser-locale fallback used whenever the user hasn't explicitly
  // chosen a language yet. `navigator.languages` (ordered, most-preferred
  // first) is tried before the single `navigator.language`, each matched
  // against whatever this app actually ships (`availableLanguages`) —
  // resolving all the way down to the caller's `defaultLanguage` ('en' by
  // convention) only when nothing in the OS preference list is shipped.
  const resolveOsLocale = (): string => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator
    const candidates = [...(nav?.languages ?? []), nav?.language].filter(
      (candidate): candidate is string => Boolean(candidate)
    )
    return matchSupportedLocale(candidates, [...availableLanguages], defaultLanguage)
  }

  const resolveInitialLanguage = async (): Promise<string> => {
    try {
      const api = (window as unknown as { api?: { i18n?: { getLanguage?: () => Promise<string> } } }).api
      const getLanguage = api?.i18n?.getLanguage
      // An empty/missing result means "nothing explicitly chosen yet" — NOT
      // "use English" — so it falls through to the OS-locale guess below
      // rather than short-circuiting to defaultLanguage here.
      const stored = getLanguage ? await getLanguage() : ''
      if (stored && availableLanguages.has(stored)) {
        return stored
      }
    } catch (error) {
      logger.warn('Failed to resolve persisted language, falling back to OS locale', { error: String(error) })
    }

    return resolveOsLocale()
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
