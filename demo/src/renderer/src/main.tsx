import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import type { i18n as I18nType } from 'i18next'
import { initializeI18n, logger, i18n, ElectronCoreUiProvider } from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'

// Import translations
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'

// Log when script starts (after all imports)
const scriptStartTime = performance.now()
logger.info('Renderer script started', { timestamp: scriptStartTime.toFixed(2) })

// Initialize i18n using core-ui's initializeI18n function
// This prevents double initialization and sets up the plugin
type InitializeI18nFn = (
  resources: Record<string, { translation: unknown }>,
  defaultLanguage: string
) => Promise<unknown>

const initI18n = (): Promise<void> => {
  logger.info('initI18n starting', { elapsedMs: (performance.now() - scriptStartTime).toFixed(2) })
  const safeInitializeI18n = initializeI18n as InitializeI18nFn

  return safeInitializeI18n(
    {
      en: { translation: enTranslation },
      fr: { translation: frTranslation }
    },
    'en'
  ).then(() => {
    logger.info('i18n initialized successfully with language', { language: i18n.language, elapsedMs: (performance.now() - scriptStartTime).toFixed(2) })
    
    // Make i18n available globally for debugging
    interface WindowWithI18n extends Window {
      i18n: I18nType;
    }
    (window as unknown as WindowWithI18n).i18n = i18n
  })
}

logger.info('About to call initI18n', { elapsedMs: (performance.now() - scriptStartTime).toFixed(2) })
void initI18n()
  .then(() => {
    
    // Render app only after i18n is initialized
    const rootElement = document.getElementById('root')

    if (!rootElement) {
      throw new Error('Failed to find the root element')
    }

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ElectronCoreUiProvider fontAliasing="auto">
          <App />
        </ElectronCoreUiProvider>
      </React.StrictMode>
    )
  })
  .catch((error: unknown) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
  })

