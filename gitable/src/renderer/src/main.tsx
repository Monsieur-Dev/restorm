import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import i18n from 'i18next'
import type { i18n as I18nType } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { logger } from 'electron-vscodelike-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'

// Import translations
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'

// Initialize i18n directly (not using the core-ui version)
const initI18n = async (): Promise<void> => {
  await i18n
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: enTranslation },
        fr: { translation: frTranslation }
      },
      lng: 'en',
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false
      }
    })
}

void initI18n()
  .then(() => {
    logger.info('i18n initialized successfully with language', { language: i18n.language })
    
    // Make i18n available globally for debugging
    interface WindowWithI18n extends Window {
      i18n: I18nType;
    }
    (window as unknown as WindowWithI18n).i18n = i18n
    
    // Render app only after i18n is initialized
    const rootElement = document.getElementById('root')

    if (!rootElement) {
      throw new Error('Failed to find the root element')
    }

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  })
  .catch((error: unknown) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
  })

