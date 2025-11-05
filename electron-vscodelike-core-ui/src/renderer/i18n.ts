import i18n from 'i18next'
import type { Resource, i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { logger } from './services/logger'

// Track if i18n has been initialized
let isInitialized = false

// Generic i18n setup - applications can provide their own translations
export function initializeI18n(resources: Resource, defaultLanguage = 'en'): I18nInstance {
  // Prevent double initialization
  if (isInitialized) {
    logger.warn('i18n already initialized, skipping')
    return i18n
  }

  // Initialize i18n
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next)
  }
  
  // Init with resources - use void to handle promise without awaiting
  void i18n.init({
    resources,
    lng: defaultLanguage,
    fallbackLng: defaultLanguage,
    interpolation: {
      escapeValue: false // React already escapes values
    }
  }).then(() => {
    isInitialized = true
    logger.info('i18n initialized successfully', { language: i18n.language })
  }).catch((error) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
  })

  return i18n
}

// Export the i18n instance for direct use
export default i18n
