import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import type { i18n as I18nType } from 'i18next'
import * as ElectronCoreUi from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import './httpMethods.css'
import './protocolBadges.css'
import LoadingScreen from './components/LoadingScreen'

const App = lazy(() => import('./App'))

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

type InitializeI18nFn = (
  resources: Record<string, { translation: unknown }>,
  defaultLanguage: string
) => Promise<unknown>

// Initialize i18n using core-ui's initializeI18n function
// This prevents double initialization and sets up the plugin
const initI18n = (): Promise<void> => {
  const safeInitializeI18n = initializeI18n as InitializeI18nFn

  return safeInitializeI18n(
    {
      en: { translation: enTranslation },
      fr: { translation: frTranslation }
    },
    'en'
  ).then(() => {
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
          <Suspense fallback={<LoadingScreen />}>
            <App />
          </Suspense>
        </ElectronCoreUiProvider>
      </React.StrictMode>
    )
  })
  .catch((error: unknown) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
  })
