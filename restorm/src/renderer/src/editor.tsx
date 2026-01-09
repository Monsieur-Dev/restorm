import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { RestormWorkbench } from './components/MainView/Workbench/RestormWorkbench'
import type { WorkbenchTree, GroupNode } from 'electron-core-ui/renderer'
import * as ElectronCoreUi from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import './httpMethods.css'
import './app.css'
import './components/common/Badge.css'

const { isTabGroupNode, isContainerNode, initializeI18n, logger, Titlebar } = ElectronCoreUi

type ElectronCoreUiProviderComponent = React.ComponentType<{
  children: React.ReactNode
  fontAliasing?: 'auto' | 'antialiased' | 'none'
}>

const { ElectronCoreUiProvider } = ElectronCoreUi as unknown as { ElectronCoreUiProvider: ElectronCoreUiProviderComponent }

// Import translations
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'

import type { RestormEditorTab } from './types/editor'

// Initialize i18n using core-ui's initializeI18n function
type InitializeI18nFn = (
  resources: Record<string, { translation: unknown }>,
  defaultLanguage: string
) => Promise<unknown>

const initI18n = (): Promise<unknown> => {
  const safeInitializeI18n = initializeI18n as InitializeI18nFn
  return safeInitializeI18n(
    {
      en: { translation: enTranslation },
      fr: { translation: frTranslation }
    },
    'en'
  )
}

// Wait for i18n to be initialized before rendering
void initI18n().then(() => {
    
    // Render app only after i18n is initialized
    const rootElement = document.getElementById('root')

    if (!rootElement) {
      throw new Error('Failed to find the root element')
    }

    // Editor component that receives the detached tab from main window
    const EditorApp: React.FC = () => {
      const [tree, setTree] = useState<WorkbenchTree>({
        orientation: 'vertical',
        groups: []
      })
      const [tabContentMap, setTabContentMap] = useState<Record<string, string>>({})
      const [fileLoaded, setFileLoaded] = useState(false)
      const [windowTitle, setWindowTitle] = useState('Restorm')
      const isClosingRef = useRef(false)

      // Helper function to count all tabs in a WorkbenchTree
      const countAllTabs = React.useCallback((workbenchTree: WorkbenchTree): number => {
        const countTabsInNode = (node: GroupNode): number => {
          if (isTabGroupNode(node)) {
            return node.tabs.length
          }
          if (isContainerNode(node)) {
            return node.groups.reduce((total, child) => total + countTabsInNode(child), 0)
          }
          return 0
        }

        return workbenchTree.groups.reduce((total, node) => total + countTabsInNode(node), 0)
      }, [])

      // Get file parameters from main process when component mounts
      useEffect(() => {
        // Request file parameters from main process
        void window.restorm?.getEditorFile().then((file) => {
          if (!file) {
            logger.warn('No file parameters received from main process')
            return
          }

          // Set window title
          if (file.title) {
            setWindowTitle(`Restorm - ${file.title}`)
          }

          // Parse the complete tab from content
          if (!file.content) {
            logger.warn('No tab content received, skipping editor initialization')
            return
          }

          let tab: RestormEditorTab | null = null
          try {
            tab = JSON.parse(file.content) as RestormEditorTab
          } catch (error) {
            logger.error('Failed to parse tab data from content', {
              content: file.content,
              error: String(error)
            })
            return
          }

          // Create workbench tree with the received tab
          const newTree: WorkbenchTree = {
            orientation: 'vertical',
            groups: [
              {
                id: 'restorm-editor-group',
                tabs: [tab],
                activeTabId: tab.id
              }
            ]
          }

          setTree(newTree)
          setTabContentMap({})
          setFileLoaded(true)
        }).catch((error: unknown) => {
          logger.error('Failed to get file parameters', { error: String(error) })
        })
      }, [])

      // Handle tree changes from Workbench
      const handleTreeChange = React.useCallback((newTree: WorkbenchTree): void => {
        setTree(newTree)
      }, [])

      // Close window when workbench has no tabs (only after file has been loaded)
      useEffect(() => {
        if (!fileLoaded || isClosingRef.current) {
          return
        }

        const tabCount = countAllTabs(tree)
        const isEmpty = tabCount === 0 && tree.groups.length === 0

        if (isEmpty) {
          isClosingRef.current = true
          
          window.api.closeWindow()
            .catch((error: unknown) => {
              logger.error('EditorApp: Error closing window', { error: String(error) })
              isClosingRef.current = false
            })
        }
      }, [tree, fileLoaded, countAllTabs])

      const renderBody = (): React.ReactNode => {
        if (!fileLoaded && tree.groups.length === 0) {
          return (
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ opacity: 0.5 }}>Waiting for file...</span>
            </div>
          )
        }

        return (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex'
            }}
          >
            <RestormWorkbench
              tree={tree}
              initialTabContentMap={tabContentMap}
              onTreeChange={handleTreeChange}
              style={{ flex: 1 }}
            />
          </div>
        )
      }

      return (
        <ElectronCoreUiProvider fontAliasing="auto">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100vh',
              backgroundColor: 'var(--editor-background)',
              color: 'var(--editor-foreground)'
            }}
          >
            <Titlebar title={windowTitle} />
            {renderBody()}
          </div>
        </ElectronCoreUiProvider>
      )
    }

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <EditorApp />
      </React.StrictMode>
    )
  })
  .catch((error: unknown) => {
    logger.error('Failed to initialize i18n', { error: String(error) })
  })
