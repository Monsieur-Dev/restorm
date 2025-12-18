import React, { useState, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { Workbench } from './components/Workbench'
import type { WorkbenchTree, GroupNode } from 'electron-core-ui/renderer'
import { isTabGroupNode, isContainerNode, initializeI18n, logger, MonacoWorkbench, Titlebar } from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import './httpMethods.css'
import './app.css'
import './components/Badge.css'

// Import translations
import enTranslation from '../locales/en/translation.json'
import frTranslation from '../locales/fr/translation.json'

import { importSwaggerFromJson } from './services/SwaggerImportService'
import swaggerPetstoreJson from './resources/swagger-petstore.json'
import type { Folder, FolderItem, Environment, EnvironmentFolder } from './types/collections'
import { isRequest, isHTTPRequest, isEnvironmentFolder, isAnyFolder } from './types/collections'
import type { FolderTab, EnvironmentFolderTab, HTTPRequestTab, BreadcrumbItem } from './types/editor'

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

// Import and convert swagger to Folder structure (initial data)
const initialSwaggerFolder = importSwaggerFromJson(JSON.stringify(swaggerPetstoreJson))

/** Folder icon for breadcrumbs */
const FOLDER_ICON = { type: 'codicon' as const, value: 'folder' }
/** Environment folder icon for breadcrumbs */
const ENV_FOLDER_ICON = { type: 'codicon' as const, value: 'folder-library' }

/** Get the appropriate icon for a folder */
function getFolderIcon(item: Folder | EnvironmentFolder): { type: 'codicon'; value: string } {
  return isEnvironmentFolder(item as FolderItem) ? ENV_FOLDER_ICON : FOLDER_ICON
}

/** Find a folder by ID in the folder tree */
function findFolderById(folder: Folder | EnvironmentFolder, id: string): Folder | EnvironmentFolder | null {
  if (folder.id === id) return folder
  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      const found = findFolderById(item, id)
      if (found) return found
    }
  }
  return null
}

/** Find an item (folder or request) by ID and build breadcrumbs including the item itself */
function findItemWithBreadcrumbs(
  folder: Folder | EnvironmentFolder,
  id: string,
  path: BreadcrumbItem[] = []
): { item: FolderItem | null; breadcrumbs: BreadcrumbItem[] } {
  // Check if the root folder itself matches the ID
  if (folder.id === id) {
    return { item: folder, breadcrumbs: [...path, { id: folder.id, label: folder.name, icon: getFolderIcon(folder) }] }
  }

  const currentPath = [...path, { id: folder.id, label: folder.name, icon: getFolderIcon(folder) }]

  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      if (item.id === id) {
        // Include the folder itself as the last breadcrumb (with appropriate icon)
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name, icon: getFolderIcon(item) }] }
      }
      const found = findItemWithBreadcrumbs(item, id, currentPath)
      if (found.item) return found
    } else if (isRequest(item) && isHTTPRequest(item)) {
      if (item.id === id) {
        // Include the request itself as the last breadcrumb (no folder icon)
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name }] }
      }
    }
  }

  return { item: null, breadcrumbs: [] }
}

/** Get environments from the nearest ancestor EnvironmentFolder */
function getNearestEnvironmentsForBreadcrumbs(
  rootFolder: Folder | EnvironmentFolder,
  breadcrumbs: BreadcrumbItem[]
): Environment[] {
  if (breadcrumbs.length === 0) {
    return []
  }

  // The last breadcrumb is the item itself (request or folder),
  // so we start from its parent and go up
  for (let i = breadcrumbs.length - 2; i >= 0; i -= 1) {
    const folderId = breadcrumbs[i]?.id
    if (!folderId) {
      continue
    }
    const folder = findFolderById(rootFolder, folderId)
    if (folder && isEnvironmentFolder(folder as FolderItem)) {
      const envFolder = folder as EnvironmentFolder
      if (envFolder.environments.length > 0) {
        return envFolder.environments
      }
    }
  }

  return []
}

type DetachedTabMetadata =
  | { kind: 'folder'; itemId: string }
  | { kind: 'environment-folder'; itemId: string }
  | { kind: 'http-request'; itemId: string }

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

      // Local, read-only swagger folder used to rebuild detached tabs
      const swaggerFolderRef = useRef<EnvironmentFolder>(initialSwaggerFolder)

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

          let metadata: DetachedTabMetadata | null = null
          if (file.content) {
            try {
              metadata = JSON.parse(file.content) as DetachedTabMetadata
            } catch (error) {
              logger.warn('Failed to parse detached tab metadata from content', {
                content: file.content,
                error: String(error)
              })
            }
          }

          if (!metadata) {
            logger.warn('No detached tab metadata received, skipping editor initialization')
            return
          }

          const rootFolder = swaggerFolderRef.current

          if (metadata.kind === 'environment-folder') {
            const folder = findFolderById(rootFolder, metadata.itemId)
            if (!folder || !isEnvironmentFolder(folder as FolderItem)) {
              logger.warn('Environment folder not found for detached tab', { itemId: metadata.itemId })
              return
            }

            const { breadcrumbs } = findItemWithBreadcrumbs(rootFolder, metadata.itemId)
            const tabId = `env-folder-${folder.id}`

            const newTab: EnvironmentFolderTab = {
              id: tabId,
              tabType: 'environment-folder',
              title: folder.name,
              titleString: folder.name,
              folder: folder as EnvironmentFolder,
              breadcrumbs,
              allowFullscreen: true
            }

            const newTree: WorkbenchTree = {
              orientation: 'vertical',
              groups: [
                {
                  id: 'restorm-editor-group',
                  tabs: [newTab],
                  activeTabId: tabId
                }
              ]
            }

            setTree(newTree)
            setTabContentMap({})
            setFileLoaded(true)
            return
          }

          if (metadata.kind === 'folder') {
            const folder = findFolderById(rootFolder, metadata.itemId)
            if (!folder || isEnvironmentFolder(folder as FolderItem)) {
              logger.warn('Folder not found for detached tab', { itemId: metadata.itemId })
              return
            }

            const { breadcrumbs } = findItemWithBreadcrumbs(rootFolder, metadata.itemId)
            const tabId = `folder-${folder.id}`

            const newTab: FolderTab = {
              id: tabId,
              tabType: 'folder',
              title: folder.name,
              titleString: folder.name,
              folder,
              breadcrumbs,
              allowFullscreen: true
            }

            const newTree: WorkbenchTree = {
              orientation: 'vertical',
              groups: [
                {
                  id: 'restorm-editor-group',
                  tabs: [newTab],
                  activeTabId: tabId
                }
              ]
            }

            setTree(newTree)
            setTabContentMap({})
            setFileLoaded(true)
            return
          }

          // The only other supported metadata kind is the HTTP request case
          {
            const { item, breadcrumbs } = findItemWithBreadcrumbs(rootFolder, metadata.itemId)
            if (!item || !isRequest(item) || !isHTTPRequest(item)) {
              logger.warn('Request not found for detached tab', { itemId: metadata.itemId })
              return
            }

            const environments = getNearestEnvironmentsForBreadcrumbs(rootFolder, breadcrumbs)
            const tabId = `request-${item.id}`

            const newTab: HTTPRequestTab = {
              id: tabId,
              tabType: 'http-request',
              title: `${item.method} ${item.name}`,
              titleString: `${item.method} ${item.name}`,
              request: item,
              breadcrumbs,
              environments,
              allowFullscreen: true
            }

            const newTree: WorkbenchTree = {
              orientation: 'vertical',
              groups: [
                {
                  id: 'restorm-editor-group',
                  tabs: [newTab],
                  activeTabId: tabId
                }
              ]
            }

            setTree(newTree)
            setTabContentMap({})
            setFileLoaded(true)
            return
          }
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
            <Workbench
              tree={tree}
              initialTabContentMap={tabContentMap}
              onTreeChange={handleTreeChange}
              style={{ flex: 1 }}
            />
          </div>
        )
      }

      return (
        <MonacoWorkbench fontAliasing="auto">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100vh',
              backgroundColor: 'var(--editor-background)',
              color: 'var(--editor-foreground)'
            }}
          >
            <Titlebar title="restorm" />
            {renderBody()}
          </div>
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
