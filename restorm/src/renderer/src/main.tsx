import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import type { i18n as I18nType } from 'i18next'
import * as ElectronCoreUi from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import './httpMethods.css'

const { initializeI18n, logger, i18n } = ElectronCoreUi

type ElectronCoreUiProviderComponent = React.ComponentType<{
  children: React.ReactNode
  fontAliasing?: 'auto' | 'antialiased' | 'none'
}>

const { ElectronCoreUiProvider } = ElectronCoreUi as unknown as { ElectronCoreUiProvider: ElectronCoreUiProviderComponent }

// Import translations
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'

// Filter harmless Monaco cancellations so they don't spam the console
const isMonacoCancellation = (reason: unknown): boolean => {
  if (!reason) return false
  const asString = String((reason as { message?: unknown }).message ?? reason)
  return asString.includes('Canceled')
}

window.addEventListener('unhandledrejection', (event) => {
  if (isMonacoCancellation(event.reason)) {
    event.preventDefault()
    return
  }
})

// Filter noisy React warnings coming from third-party libraries (e.g. jsoncrack-react)
// about keys being spread into JSX or defaultProps deprecation on function components.
// These are harmless in our context and clutter the console.
const originalConsoleError = window.console.error.bind(window.console)
window.console.error = (...args: unknown[]): void => {
  const first = args[0]
  if (typeof first === 'string') {
    if (first.includes('A props object containing a "key" prop is being spread into JSX')) {
      return
    }
    if (first.includes('Support for defaultProps will be removed from function components in a future major release')) {
      return
    }
  }
  originalConsoleError(...args)
}

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
        <ElectronCoreUiProvider fontAliasing="auto">
          <App />
        </ElectronCoreUiProvider>
      </React.StrictMode>
    )
  })
  .catch((error: unknown) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
  })

