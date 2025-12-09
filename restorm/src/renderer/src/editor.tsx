import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { Workbench } from './components/Workbench'
import type { EditorTab, WorkbenchTree, GroupNode } from 'electron-core-ui/renderer'
import { isTabGroupNode, isContainerNode, initializeI18n, logger, MonacoWorkbench, Titlebar } from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'

// Import translations
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'

// Initialize i18n using core-ui's initializeI18n function
// This prevents double initialization and sets up the plugin
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

    // Editor component that receives file parameters
    const EditorApp: React.FC = () => {
      const [tree, setTree] = useState<WorkbenchTree>({
        orientation: 'vertical',
        groups: []
      })
      const [tabContentMap, setTabContentMap] = useState<Record<string, string>>({})
      const [fileLoaded, setFileLoaded] = useState(false)
      const isClosingRef = useRef(false)

      // Helper function to count all tabs in a WorkbenchTree
      const countAllTabs = React.useCallback((tree: WorkbenchTree): number => {
        const countTabsInNode = (node: GroupNode): number => {
          if (isTabGroupNode(node)) {
            return node.tabs.length
          }
          if (isContainerNode(node)) {
            return node.groups.reduce((total, child) => total + countTabsInNode(child), 0)
          }
          return 0
        }

        return tree.groups.reduce((total, node) => total + countTabsInNode(node), 0)
      }, [])

      // Get file parameters from main process when component mounts
      useEffect(() => {
        // Request file parameters from main process
        void window.restorm.getEditorFile().then((file) => {
          if (!file) {
            logger.warn('No file parameters received from main process')
            return
          }

          // Create tab with file parameters
          const tabId = crypto.randomUUID()
          const createTab = (id: string, title: string, dirty = false): EditorTab & { titleString?: string } => ({ 
            id, 
            title: title, 
            titleString: title,
            isDirty: dirty,
            allowFullscreen: true
          })
          
          const newTree: WorkbenchTree = {
            orientation: 'vertical',
            groups: [
              {
                id: 'group-1',
                tabs: [
                  createTab(tabId, file.title, false)
                ],
                activeTabId: tabId
              }
            ]
          }

          const newTabContentMap: Record<string, string> = {
            [tabId]: file.content ?? ''
          }

          setTree(newTree)
          setTabContentMap(newTabContentMap)
          setFileLoaded(true)
        }).catch((error) => {
          logger.error('Failed to get file parameters', { error: String(error) })
        })
      }, [])

      // Handle tree changes from Workbench
      const handleTreeChange = React.useCallback((newTree: WorkbenchTree): void => {
        // Update tree state - the useEffect will check if we should close
        setTree(newTree)
      }, [])

      // Close window when workbench has no tabs (only after file has been loaded)
      useEffect(() => {
        // Don't check if file hasn't loaded yet or we're already closing
        if (!fileLoaded) {
          return
        }
        
        if (isClosingRef.current) {
          return
        }

        const tabCount = countAllTabs(tree)
        const isEmpty = tabCount === 0 && tree.groups.length === 0

        if (isEmpty) {
          isClosingRef.current = true
          
          // Close immediately without delay
          window.api.closeWindow()
            .catch((error: unknown) => {
              logger.error('EditorApp: Error closing window', { error: String(error) })
              // Reset flag so we can try again
              isClosingRef.current = false
            })
        }
      }, [tree, fileLoaded, countAllTabs])

      // Render empty workbench if no file is loaded yet (before file is received)
      if (!fileLoaded && tree.groups.length === 0) {
        return (
          <MonacoWorkbench fontAliasing="auto">
            <Titlebar title="restorm" />
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ opacity: 0.5 }}>Waiting for file...</span>
            </div>
          </MonacoWorkbench>
        )
      }

      return (
        <MonacoWorkbench fontAliasing="auto">
          <Titlebar title="restorm" />
          <Workbench
            tree={tree}
            initialTabContentMap={tabContentMap}
            onTreeChange={handleTreeChange}
          />
        </MonacoWorkbench>
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

