import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import type { i18n as I18nType } from 'i18next'
import * as ElectronCoreUi from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import './httpMethods.css'
import './app.css'
import './components/Badge.css'
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
  window.addEventListener('beforeunload', (event) => {
    if (saveAndCloseCallbacks.size > 0) {
      // Trigger all registered callbacks
      for (const callback of saveAndCloseCallbacks) {
        try {
          callback()
        } catch (error) {
          console.error('Error in save-and-close callback:', error)
        }
      }
    }
  })

  // Type assertion needed because window.restorm is optional in types but we're creating it here
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  ;(window as any).restorm = {
    openEditor: async () => {
      // No-op in web mode
    },
    getEditorFile: async () => undefined,
    forceClose: async () => {
      // In web mode, we can't force close the window, but we can try
      window.close()
    },
    onSaveAndClose: (callback: () => void) => {
      saveAndCloseCallbacks.add(callback)
      return () => {
        saveAndCloseCallbacks.delete(callback)
      }
    },
    context: {
      getAllTransformResults: async () => ({}),
      onVariableTransformed: () => () => {
        // No-op unsubscribe
      },
      registerRequest: async () => {
        // No-op in web mode
      },
      unregisterRequest: async () => {
        // No-op in web mode
      },
      setRequestEnvironment: async () => {
        // No-op in web mode
      },
      updateRequestKeyValues: async () => {
        // No-op in web mode
      },
      updateFullRequestData: async () => {
        // No-op in web mode
      },
      getResolvedUrl: async () => undefined,
      getCodeSnippets: async () => undefined,
      onUrlResolved: () => () => {
        // No-op unsubscribe
      },
      onCodeSnippetsUpdated: () => () => {
        // No-op unsubscribe
      },
      onAvailableVariables: () => () => {
        // No-op unsubscribe
      },
      clearAll: async () => {
        // No-op in web mode
      }
    },
    http: {
      execute: async () => {
        throw new Error('HTTP execution not available in web mode')
      },
      cancel: async () => false,
      isActive: async () => false,
      onProgress: () => () => {
        // No-op unsubscribe
      }
    },
    graphql: {
      execute: async () => {
        throw new Error('GraphQL execution not available in web mode')
      },
      cancel: async () => false,
      isActive: async () => false,
      onProgress: () => () => {
        // No-op unsubscribe
      }
    },
    soap: {
      execute: async () => {
        throw new Error('SOAP execution not available in web mode')
      },
      cancel: async () => false,
      isActive: async () => false,
      onProgress: () => () => {
        // No-op unsubscribe
      }
    },
    grpc: {
      execute: async () => {
        throw new Error('gRPC execution not available in web mode')
      },
      cancel: async () => false,
      isActive: async () => false,
      onProgress: () => () => {
        // No-op unsubscribe
      }
    },
    websocket: {
      connect: async () => {
        throw new Error('WebSocket execution not available in web mode')
      },
      disconnect: async () => false,
      send: async () => false,
      isActive: async () => false,
      onProgress: () => () => {
        // No-op unsubscribe
      },
      onMessage: () => () => {
        // No-op unsubscribe
      }
    }
  }
}

// Ensure web shim is set up before rendering
ensureRestormWebShim()

// Expose test helpers on window for E2E tests
if (typeof window !== 'undefined') {
  // Always expose in dev mode or when explicitly enabled (for E2E tests)
  // In production, this will be tree-shaken out
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const isDev = (import.meta as { env?: { DEV?: boolean; MODE?: string; VITE_ENABLE_TEST_HELPERS?: string } }).env?.DEV ?? false
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const mode = (import.meta as { env?: { MODE?: string } }).env?.MODE
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const enableTestHelpers = (import.meta as { env?: { VITE_ENABLE_TEST_HELPERS?: string } }).env?.VITE_ENABLE_TEST_HELPERS === 'true'
  const shouldExpose = isDev || mode === 'test' || enableTestHelpers
  
  if (shouldExpose) {
    // Load test helpers asynchronously to avoid blocking app initialization
    void Promise.all([
      import('./services/import/SwaggerImportService'),
      import('./types/reactive'),
      import('./services/SearchIndexService'),
      import('./utils/serialization'),
      import('electron-core-ui/renderer')
    ]).then(([swaggerModule, reactiveModule, searchModule, serializationModule, electronCoreUiModule]) => {
      ;(window as unknown as {
        __testHelpers?: {
          importSwagger: (swaggerJson: string) => Promise<void>
          loadRestormData: (data: { collections: unknown[] }) => Promise<void>
        }
      }).__testHelpers = {
        importSwagger: async (swaggerJson: string) => {
          const folder = swaggerModule.importSwaggerFromJson(swaggerJson)
          const reactiveFolder = reactiveModule.makeReactiveFolder(folder)
          await searchModule.searchIndexService.indexFolderTree(reactiveFolder)
          
          // Also add to rootFolders so it appears in ListView
          const windowWithRestormHelpers = window as unknown as {
            __restormTestHelpers?: { 
              setRootFolders: (folders: unknown[]) => void
            }
          }
          if (windowWithRestormHelpers.__restormTestHelpers?.setRootFolders) {
            windowWithRestormHelpers.__restormTestHelpers.setRootFolders([reactiveFolder])
          }
        },
        loadRestormData: async (data: { collections: unknown[] }) => {
          // Process collections to generate runtime IDs
          const collectionsWithIds = serializationModule.processAfterDeserialization(data.collections)
          
          // Make folders reactive
          const reactiveFolders = collectionsWithIds.map(
            (folder) => reactiveModule.makeReactiveFolder(folder as import('./types/collections').Folder)
          )
          
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
          let helpersFound = false
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
              console.log('[Test Helper] Found __restormTestHelpers.setRootFolders, calling it')
              windowWithRestormHelpers.__restormTestHelpers.setRootFolders(reactiveFolders)
              helpersFound = true
              break
            }
            
            // Try Approach 2: Use App's loadFile helper
            if (windowWithRestormHelpers.__restormTestHelpers?.loadFile) {
              console.log('[Test Helper] Found __restormTestHelpers.loadFile, calling it')
              windowWithRestormHelpers.__restormTestHelpers.loadFile(fileState)
              helpersFound = true
              break
            }
            
            // Try Approach 3: Use web shim test helper
            const windowWithTestHelpers = window as unknown as {
              __webFileTestHelpers?: { triggerFileOpened: (state: typeof fileState) => void }
            }
            
            if (windowWithTestHelpers.__webFileTestHelpers) {
              console.log('[Test Helper] Found __webFileTestHelpers, calling triggerFileOpened')
              windowWithTestHelpers.__webFileTestHelpers.triggerFileOpened(fileState)
              helpersFound = true
              break
            }
            
            // Try Approach 4: Use eventBus emitLocal
            try {
              await electronCoreUiModule.eventBus.emitLocal('restorm:test:file-opened', fileState)
              console.log('[Test Helper] Emitted restorm:test:file-opened event')
              helpersFound = true
              break
            } catch (e) {
              // Continue trying
            }
          }
          
          if (!helpersFound) {
            console.warn('[Test Helper] Could not trigger file opened event after 5 seconds')
          }
          
          // Index folders for search (will be done again by App, but do it here too for safety)
          for (const folder of reactiveFolders) {
            await searchModule.searchIndexService.indexFolderTree(folder)
          }
          
          // Wait longer for App to process the event and render
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
      }
    }).catch((error) => {
      console.error('Failed to load test helpers:', error)
    })
  }
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
