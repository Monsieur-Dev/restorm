import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'

const resources = {
  en: {
    translation: enTranslation
  },
  fr: {
    translation: frTranslation
  }
}

// Initialize with default language first
i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false // React already escapes values
    }
  })
  .then(() => {
    // Load language from settings after initialization
    window.settingsAPI
      .getSetting<string>('workbench.appearance.language')
      .then((language) => {
        if (language && (language === 'en' || language === 'fr')) {
          i18n.changeLanguage(language).catch((error) => {
            console.error('Failed to change language from settings:', error)
          })
        }
      })
      .catch((error) => {
        console.error('Failed to load language setting:', error)
      })

    // Listen for language changes from the main process
    window.settingsAPI.onLanguageChanged((language: string) => {
      console.log('Language changed to:', language)
      if (language === 'en' || language === 'fr') {
        i18n.changeLanguage(language).catch((error) => {
          console.error('Failed to change language:', error)
        })
      }
    })
  })
  .catch((error) => {
    console.error('Failed to initialize i18n:', error)
  })

export default i18n

