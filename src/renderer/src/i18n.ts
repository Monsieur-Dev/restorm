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
  .catch((error) => {
    console.error('Failed to initialize i18n:', error)
  })

export default i18n

