import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import type { i18n as I18nType } from 'i18next'
import { initializeI18n, logger, MonacoWorkbench, i18n } from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'

// Import translations
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'

// Initialize i18n using core-ui's initializeI18n function
// This prevents double initialization and sets up the plugin
const initI18n = (): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
  const promise: Promise<unknown> = initializeI18n({
    en: { translation: enTranslation },
    fr: { translation: frTranslation }
  }, 'en')
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return promise.then(() => {
    logger.info('i18n initialized successfully with language', { language: i18n.language })
    
    // Make i18n available globally for debugging
    interface WindowWithI18n extends Window {
      i18n: I18nType;
    }
    (window as unknown as WindowWithI18n).i18n = i18n
  })
}

void initI18n()
  .then(() => {
    
    // Render app only after i18n is initialized
    const rootElement = document.getElementById('root')

    if (!rootElement) {
      throw new Error('Failed to find the root element')
    }

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <MonacoWorkbench fontAliasing="auto">
          <App />
        </MonacoWorkbench>
      </React.StrictMode>
    )
  })
  .catch((error: unknown) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
  })

