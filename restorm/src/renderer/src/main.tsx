import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import type { i18n as I18nType } from 'i18next'
import * as ElectronCoreUi from 'electron-core-ui/renderer'
import type { CapabilityGate } from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import '../assets/fonts/restorm-brand.css'
import '../assets/fonts/restorm-wordmark.css'
import './httpMethods.css'
import './app.css'
import './components/common/registryBadge.css'
import LoadingScreen from './components/Welcome/LoadingScreen'
import { GitCapabilityGateHost } from './components/GitCapabilityGateHost'
import { initializeGraphQL } from './services/GraphQLIntegration'
import { registerRendererSources } from './secrets/registerRendererSources'
import { UpdateActionsRenderer } from './components/Settings/UpdateActionsRenderer'
import { DEFAULT_UI_DELAY_MS } from '../../shared/config/constants'

// Populate the renderer's copy of the value-source registry (descriptors only;
// resolvers stay main-side). Synchronous + idempotent — done once at module
// load so the type-pick menu can enumerate secret sources before first render.
registerRendererSources()

// Custom settings renderer for the "Updates" group (version + live status +
// "Check now"), bound to the `update-actions` setting type in settings.yaml.
ElectronCoreUi.registerSettingRenderer('update-actions', UpdateActionsRenderer)

const App = lazy(() => import('./App'))

const { initializeI18n, logger, i18n } = ElectronCoreUi

// Initialize GraphQL client (connects to main process GraphQL server).
// Async because the endpoint URL is read from a runtime IPC — the
// main process picks a free port at boot, so the renderer can't
// hardcode it. We fire-and-await here; if it fails the client falls
// back to a no-op endpoint and subscriptions are skipped.
const graphqlReady = initializeGraphQL().catch((error: unknown) => {
  logger.warn('[main] Failed to initialize GraphQL client - will retry when server is ready', { error: String(error) })
})

type ElectronCoreUiProviderComponent = React.ComponentType<{
  children: React.ReactNode
  fontAliasing?: 'auto' | 'antialiased' | 'none'
  capabilityGate?: CapabilityGate
}>

const { ElectronCoreUiProvider } = ElectronCoreUi as unknown as { ElectronCoreUiProvider: ElectronCoreUiProviderComponent }

// Import translations
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'
import esTranslation from '../locales/es/translation.json'
import deTranslation from '../locales/de/translation.json'
import itTranslation from '../locales/it/translation.json'
import ptTranslation from '../locales/pt/translation.json'
import sqTranslation from '../locales/sq/translation.json'
import hrTranslation from '../locales/hr/translation.json'
import fiTranslation from '../locales/fi/translation.json'
import nlTranslation from '../locales/nl/translation.json'
import elTranslation from '../locales/el/translation.json'
import plTranslation from '../locales/pl/translation.json'
import srTranslation from '../locales/sr/translation.json'
import svTranslation from '../locales/sv/translation.json'
import ukTranslation from '../locales/uk/translation.json'
import zhCnTranslation from '../locales/zh-CN/translation.json'
import zhTwTranslation from '../locales/zh-TW/translation.json'
import jaTranslation from '../locales/ja/translation.json'
import koTranslation from '../locales/ko/translation.json'
import trTranslation from '../locales/tr/translation.json'
import idTranslation from '../locales/id/translation.json'
import viTranslation from '../locales/vi/translation.json'
import csTranslation from '../locales/cs/translation.json'
import daTranslation from '../locales/da/translation.json'
import nbTranslation from '../locales/nb/translation.json'
import huTranslation from '../locales/hu/translation.json'
import roTranslation from '../locales/ro/translation.json'

// Filter harmless Monaco cancellations so they don't spam the console
const isMonacoCancellation = (reason: unknown): boolean => {
  if (!reason) return false
  const message = (reason as { message?: unknown }).message ?? reason
  const asString = typeof message === 'string' ? message : ''
  return asString.includes('Canceled')
}

window.addEventListener('unhandledrejection', (event) => {
  if (isMonacoCancellation(event.reason)) {
    event.preventDefault()
    return
  }
})

// Filter noisy React warnings coming from third-party libraries about
// keys being spread into JSX or defaultProps deprecation on function
// components. These are harmless in our context and clutter the
// console.
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
      fr: { translation: frTranslation },
      es: { translation: esTranslation },
      de: { translation: deTranslation },
      it: { translation: itTranslation },
      pt: { translation: ptTranslation },
      sq: { translation: sqTranslation },
      hr: { translation: hrTranslation },
      fi: { translation: fiTranslation },
      nl: { translation: nlTranslation },
      el: { translation: elTranslation },
      pl: { translation: plTranslation },
      sr: { translation: srTranslation },
      sv: { translation: svTranslation },
      uk: { translation: ukTranslation },
      'zh-CN': { translation: zhCnTranslation },
      'zh-TW': { translation: zhTwTranslation },
      ja: { translation: jaTranslation },
      ko: { translation: koTranslation },
      tr: { translation: trTranslation },
      id: { translation: idTranslation },
      vi: { translation: viTranslation },
      cs: { translation: csTranslation },
      da: { translation: daTranslation },
      nb: { translation: nbTranslation },
      hu: { translation: huTranslation },
      ro: { translation: roTranslation }
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

// Web shim for window.restorm APIs (when not in Electron)
function ensureRestormWebShim(): void {
  if (typeof window === 'undefined') {
    return
  }

  // If Electron preload already injected window.restorm, do nothing
  if (window.restorm) {
    return
  }

  // Create web shim for window.restorm
  const saveAndCloseCallbacks = new Set<() => void>()
  
  // Listen to beforeunload to trigger save-and-close callbacks
  window.addEventListener('beforeunload', () => {
    if (saveAndCloseCallbacks.size > 0) {
      // Trigger all registered callbacks
      for (const callback of saveAndCloseCallbacks) {
        try {
          callback()
        } catch {
          // Ignore errors in callbacks
        }
      }
    }
  })

  // Type assertion needed because window.restorm is optional in types but we're creating it here
  // Define the restorm shim object
  const restormShim = {
    openEditor: () => Promise.resolve(),
    getEditorFile: () => Promise.resolve(undefined),
    forceClose: () => {
      window.close()
      return Promise.resolve()
    },
    onSaveAndClose: (callback: () => void) => {
      saveAndCloseCallbacks.add(callback)
      return () => {
        saveAndCloseCallbacks.delete(callback)
      }
    },
    secrets: {
      read: () => Promise.resolve(null),
      write: () => Promise.resolve({ success: true }),
      invalidate: () => Promise.resolve({ success: true })
    },
    context: {
      getAllTransformResults: () => Promise.resolve({}),
      onVariableTransformed: () => () => { /* No-op unsubscribe */ },
      registerRequest: () => Promise.resolve(),
      unregisterRequest: () => Promise.resolve(),
      setRequestEnvironment: () => Promise.resolve(),
      setAvailableEnvironments: () => Promise.resolve(),
      updateRequestKeyValues: () => Promise.resolve(),
      updateFullRequestData: () => Promise.resolve(),
      getResolvedUrl: () => Promise.resolve(undefined),
      getCodeSnippets: () => Promise.resolve(undefined),
      onUrlResolved: () => () => { /* No-op unsubscribe */ },
      onCodeSnippetsUpdated: () => () => { /* No-op unsubscribe */ },
      onAvailableVariables: () => () => { /* No-op unsubscribe */ },
      clearAll: () => Promise.resolve()
    },
    http: {
      execute: () => Promise.reject(new Error('HTTP execution not available in web mode')),
      cancel: () => Promise.resolve(false),
      isActive: () => Promise.resolve(false),
      onProgress: () => () => { /* No-op unsubscribe */ }
    },
    graphql: {
      execute: () => Promise.reject(new Error('GraphQL execution not available in web mode')),
      cancel: () => Promise.resolve(false),
      isActive: () => Promise.resolve(false),
      onProgress: () => () => { /* No-op unsubscribe */ }
    },
    soap: {
      execute: () => Promise.reject(new Error('SOAP execution not available in web mode')),
      cancel: () => Promise.resolve(false),
      isActive: () => Promise.resolve(false),
      onProgress: () => () => { /* No-op unsubscribe */ }
    },
    grpc: {
      execute: () => Promise.reject(new Error('gRPC execution not available in web mode')),
      cancel: () => Promise.resolve(false),
      isActive: () => Promise.resolve(false),
      onProgress: () => () => { /* No-op unsubscribe */ }
    },
    websocket: {
      connect: () => Promise.reject(new Error('WebSocket execution not available in web mode')),
      disconnect: () => Promise.resolve(false),
      send: () => Promise.resolve(false),
      isActive: () => Promise.resolve(false),
      onProgress: () => () => { /* No-op unsubscribe */ },
      onMessage: () => () => { /* No-op unsubscribe */ }
    }
  }
  
  // Assign the shim to window.restorm
  Object.defineProperty(window, 'restorm', {
    value: restormShim,
    writable: true,
    configurable: true
  })
}

// Ensure web shim is set up before rendering
ensureRestormWebShim()

// Expose test helpers on window for E2E tests
if (typeof window !== 'undefined') {
  // Always expose in dev mode or when explicitly enabled (for E2E tests)
  // In production, this will be tree-shaken out
   
  const isDev = (import.meta as { env?: { DEV?: boolean; MODE?: string; VITE_ENABLE_TEST_HELPERS?: string } }).env?.DEV ?? false
   
  const mode = (import.meta as { env?: { MODE?: string } }).env?.MODE
   
  const enableTestHelpers = (import.meta as { env?: { VITE_ENABLE_TEST_HELPERS?: string } }).env?.VITE_ENABLE_TEST_HELPERS === 'true'
  const shouldExpose = isDev || mode === 'test' || enableTestHelpers
  
  if (shouldExpose) {
    // Load test helpers asynchronously to avoid blocking app initialization
    void Promise.all([
      import('./types/reactive'),
      import('./services/SearchIndexService'),
      import('./utils/serialization'),
      import('electron-core-ui/renderer')
    ]).then(([reactiveModule, searchModule, serializationModule, electronCoreUiModule]) => {
      ;(window as unknown as {
        __testHelpers?: {
          loadRestormData: (data: { collections: unknown[] }) => Promise<void>
        }
      }).__testHelpers = {
        loadRestormData: async (data: { collections: unknown[] }) => {
          // Process collections to generate runtime IDs
          const collectionsWithIds = serializationModule.processAfterDeserialization(data.collections)
          
          // Make folders reactive — leave requests at the root as-is
          // since `makeReactiveFolder` expects an `items` array.
          type FolderLike = import('../../shared/types/collections').Folder
          const reactiveFolders = collectionsWithIds.map((item) => {
            if (typeof item === 'object' && item !== null && 'items' in item) {
              return reactiveModule.makeReactiveFolder(item as FolderLike)
            }
            return item
          })
          
          // Create file state to simulate file opened event
          const fileState = {
            currentFile: {
              path: 'test-data.restorm',
              name: 'test-data.restorm',
              content: { collections: reactiveFolders },
              format: 'json' as const,
              isDirty: false
            },
            recentFiles: [],
            favorites: []
          }
          
          // Wait for App to register its callback and expose test helpers
          // Try multiple times with increasing delays
          for (let attempt = 0; attempt < 10; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 500))
            
            // Try Approach 1: Use App's setRootFolders helper (most direct)
            const windowWithRestormHelpers = window as unknown as {
              __restormTestHelpers?: { 
                loadFile: (state: typeof fileState) => void
                setRootFolders: (folders: typeof reactiveFolders) => void
              }
            }
            
            if (windowWithRestormHelpers.__restormTestHelpers?.setRootFolders) {
              windowWithRestormHelpers.__restormTestHelpers.setRootFolders(reactiveFolders)
              break
            }
            
            // Try Approach 2: Use App's loadFile helper
            if (windowWithRestormHelpers.__restormTestHelpers?.loadFile) {
              windowWithRestormHelpers.__restormTestHelpers.loadFile(fileState)
              break
            }
            
            // Try Approach 3: Use web shim test helper
            const windowWithTestHelpers = window as unknown as {
              __webFileTestHelpers?: { triggerFileOpened: (state: typeof fileState) => void }
            }
            
            if (windowWithTestHelpers.__webFileTestHelpers) {
              windowWithTestHelpers.__webFileTestHelpers.triggerFileOpened(fileState)
              break
            }
            
            // Try Approach 4: Use eventBus emitLocal
            try {
              await electronCoreUiModule.eventBus.emitLocal('restorm:test:file-opened', fileState)
              break
            } catch {
              // Continue trying
            }
          }
          
          // Index folders for search (will be done again by App, but do it here too for safety)
          for (const folder of reactiveFolders) {
            if (typeof folder === 'object' && folder !== null && 'items' in folder) {
              await searchModule.searchIndexService.indexFolderTree(folder as unknown as FolderLike)
            }
          }
          
          // Wait longer for App to process the event and render
          await new Promise(resolve => setTimeout(resolve, DEFAULT_UI_DELAY_MS))
        }
      }
    }).catch(() => {
      // Failed to load test helpers - this is expected in production
    })
  }
}

void Promise.all([initI18n(), graphqlReady])
  .then(() => {

    // Render app only after i18n is initialized
    const rootElement = document.getElementById('root')

    if (!rootElement) {
      throw new Error('Failed to find the root element')
    }

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <GitCapabilityGateHost>
          {(capabilityGate) => (
            <ElectronCoreUiProvider fontAliasing="auto" data-testid="electron-core-ui-provider" capabilityGate={capabilityGate}>
              <Suspense fallback={<LoadingScreen />}>
                <App />
              </Suspense>
            </ElectronCoreUiProvider>
          )}
        </GitCapabilityGateHost>
      </React.StrictMode>
    )
  })
  .catch((error: unknown) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
  })
