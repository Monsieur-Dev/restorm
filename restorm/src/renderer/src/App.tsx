import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Titlebar,
  MenuBar,
  MenuBarItem,
  MenuItem,
  MenuItemSeparator,
  Statusbar,
  ListView,
  type ListViewItemData,
  Sash,
  type IVerticalSashLayoutProvider,
  type SashEvent,
  SplitView,
  Pane,
  Button,
  useSettingsModal,
  isTabGroupNode,
  navigationService
} from 'electron-core-ui/renderer'
import type { WorkbenchTree, NavigationEvent } from 'electron-core-ui/renderer'
import { Workbench } from './components/Workbench'
import { Welcome } from './components/Welcome'
import { HttpMethodBadge } from './components/HttpMethodBadge'
import { importSwaggerFromJson } from './services/SwaggerImportService'
import { folderAsRootListViewItem, collectAllFolderIds } from './services/FolderToListView'
import swaggerPetstoreJson from './resources/swagger-petstore.json'
import type { Folder, FolderItem, HTTPRequest } from './types/collections'
import { isFolder, isRequest, isHTTPRequest } from './types/collections'
import type { FolderTab, HTTPRequestTab, BreadcrumbItem } from './types/editor'

const MIN_LEFT_WIDTH = 180
const RIGHT_MIN_WIDTH = 240

interface SidebarContextMenuItem {
  id: string
  label: string
  icon?: string
  isSeparator?: boolean
  onClick?: () => void
}

type TranslateFunction = (key: string) => string

/** Context menu action handler type */
type ContextMenuActionHandler = (itemId: string) => void

const buildContextMenuForItem = (
  item: ListViewItemData,
  t: TranslateFunction,
  onDefineVariables: ContextMenuActionHandler
): SidebarContextMenuItem[] => {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0
  const isItemFolder = item.isExpandable ?? hasChildren
  const itemId = item.id

  if (isItemFolder) {
    return [
      {
        id: 'create-child-folder',
        label: t('sidebar.contextMenu.createSubfolder'),
        icon: 'new-folder'
      },
      {
        id: 'define-variables',
        label: t('sidebar.contextMenu.defineVariables'),
        icon: 'symbol-variable',
        onClick: () => {
          onDefineVariables(itemId)
        }
      },
      { id: 'sep-folder', isSeparator: true, label: '' },
      {
        id: 'delete-folder',
        label: t('sidebar.contextMenu.delete'),
        icon: 'trash'
      }
    ]
  }

  return [
    {
      id: 'clone-item',
      label: t('sidebar.contextMenu.clone'),
      icon: 'copy'
    },
    { id: 'sep-item', isSeparator: true, label: '' },
    {
      id: 'delete-item',
      label: t('sidebar.contextMenu.delete'),
      icon: 'trash'
    }
  ]
}

const attachContextMenus = (
  items: ListViewItemData[],
  t: TranslateFunction,
  onDefineVariables: ContextMenuActionHandler
): ListViewItemData[] =>
  items.map((item) => {
    const withMenu = {
      ...item,
      contextMenuItems: buildContextMenuForItem(item, t, onDefineVariables)
    } as ListViewItemData
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus(item.children, t, onDefineVariables)
    }
    return withMenu
  })

// Import and convert swagger to Folder structure (initial data)
const initialSwaggerFolder = importSwaggerFromJson(JSON.stringify(swaggerPetstoreJson))
const allFolderIds = collectAllFolderIds(initialSwaggerFolder)

/** Find a folder by ID in the folder tree */
function findFolderById(folder: Folder, id: string): Folder | null {
  if (folder.id === id) return folder
  for (const item of folder.items) {
    if (isFolder(item)) {
      const found = findFolderById(item, id)
      if (found) return found
    }
  }
  return null
}

/** Find an item (folder or request) by ID and build breadcrumbs including the item itself */
function findItemWithBreadcrumbs(
  folder: Folder,
  id: string,
  path: BreadcrumbItem[] = []
): { item: FolderItem | null; breadcrumbs: BreadcrumbItem[] } {
  const currentPath = [...path, { id: folder.id, label: folder.name }]

  for (const item of folder.items) {
    if (isFolder(item)) {
      if (item.id === id) {
        // Include the folder itself as the last breadcrumb
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name }] }
      }
      const found = findItemWithBreadcrumbs(item, id, currentPath)
      if (found.item) return found
    } else if (isRequest(item) && isHTTPRequest(item)) {
      if (item.id === id) {
        // Include the request itself as the last breadcrumb
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name }] }
      }
    }
  }

  return { item: null, breadcrumbs: [] }
}

const App: React.FC = () => {
  const { t } = useTranslation()
  const { showSettingsModal } = useSettingsModal()

  const handleMenuExit = useCallback(() => {
    void window.api.closeWindow()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()

      if (isCtrlOrCmd && key === 'q') {
        event.preventDefault()
        event.stopPropagation()
        handleMenuExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleMenuExit])

  // Swagger folder data (mutable for renaming)
  const [swaggerFolder, setSwaggerFolder] = useState<Folder>(initialSwaggerFolder)

  // Initialize with all folders expanded
  const [expandedIds, setExpandedIds] = useState<string[]>(allFolderIds)

  // Selected item in the sidebar
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  // Workbench tree state (starts with no groups)
  const [workbenchTree, setWorkbenchTree] = useState<WorkbenchTree>({
    orientation: 'vertical',
    groups: []
  })

  // Open a folder tab in the workbench
  const openFolderTab = useCallback((folder: Folder, breadcrumbs: BreadcrumbItem[]) => {
    const tabId = `folder-${folder.id}`

    setWorkbenchTree((prev) => {
      // Create new folder tab
      const newTab: FolderTab = {
        id: tabId,
        tabType: 'folder',
        title: folder.name,
        titleString: folder.name,
        folder,
        breadcrumbs,
        allowFullscreen: true
      }

      const group = prev.groups[0]

      // If no group exists, create one with the new tab
      if (!group || !isTabGroupNode(group)) {
        return {
          ...prev,
          groups: [
            {
              id: 'restorm-main-group',
              tabs: [newTab],
              activeTabId: tabId
            }
          ]
        }
      }

      // Check if tab already exists
      const existingTab = group.tabs.find((tab) => tab.id === tabId)
      if (existingTab) {
        return {
          ...prev,
          groups: [{ ...group, activeTabId: tabId }]
        }
      }

      // Add tab to existing group
      return {
        ...prev,
        groups: [
          {
            ...group,
            tabs: [...group.tabs, newTab],
            activeTabId: tabId
          }
        ]
      }
    })
  }, [])

  // Open an HTTP request tab in the workbench
  const openRequestTab = useCallback((request: HTTPRequest, breadcrumbs: BreadcrumbItem[]) => {
    const tabId = `request-${request.id}`

    setWorkbenchTree((prev) => {
      // Create new request tab
      const newTab: HTTPRequestTab = {
        id: tabId,
        tabType: 'http-request',
        title: `${request.method} ${request.name}`,
        titleString: `${request.method} ${request.name}`,
        request,
        breadcrumbs,
        allowFullscreen: true
      }

      const group = prev.groups[0]

      // If no group exists, create one with the new tab
      if (!group || !isTabGroupNode(group)) {
        return {
          ...prev,
          groups: [
            {
              id: 'restorm-main-group',
              tabs: [newTab],
              activeTabId: tabId
            }
          ]
        }
      }

      // Check if tab already exists
      const existingTab = group.tabs.find((tab) => tab.id === tabId)
      if (existingTab) {
        return {
          ...prev,
          groups: [{ ...group, activeTabId: tabId }]
        }
      }

      // Add tab to existing group
      return {
        ...prev,
        groups: [
          {
            ...group,
            tabs: [...group.tabs, newTab],
            activeTabId: tabId
          }
        ]
      }
    })
  }, [])

  // Handle navigation events from NavigationService
  useEffect(() => {
    const unsubscribe = navigationService.onNavigate((event: NavigationEvent) => {
      const { key, params } = event

      // Update sidebar selection
      setSelectedItemId(key)

      // Open appropriate tab based on navigation type
      if (params.type === 'folder') {
        const folder = findFolderById(swaggerFolder, key)
        if (folder) {
          const { breadcrumbs } = findItemWithBreadcrumbs(swaggerFolder, key)
          openFolderTab(folder, breadcrumbs)
        }
      } else if (params.type === 'http-request') {
        const { item, breadcrumbs } = findItemWithBreadcrumbs(swaggerFolder, key)
        if (item && isRequest(item) && isHTTPRequest(item)) {
          openRequestTab(item, breadcrumbs)
        }
      }
    })

    return unsubscribe
  }, [openFolderTab, openRequestTab, swaggerFolder])

  // Handle item click in the sidebar - use navigation service
  const handleItemClick = useCallback((itemId: string) => {
    const { item } = findItemWithBreadcrumbs(swaggerFolder, itemId)
    if (!item) return

    if (isFolder(item)) {
      // Don't navigate on folder click, just toggle expansion
      return
    }

    if (isRequest(item) && isHTTPRequest(item)) {
      // Navigate to request - this will trigger the onNavigate listener
      navigationService.navigateTo(itemId, 'sidebar', { type: 'http-request' })
    }
  }, [swaggerFolder])

  // Handle "Define variables" context menu action
  const handleDefineVariables = useCallback((itemId: string) => {
    // Navigate to folder - this will trigger the onNavigate listener
    navigationService.navigateTo(itemId, 'context-menu', { type: 'folder' })
  }, [])

  // Convert swagger folder to ListView items
  const sidebarItems: ListViewItemData[] = useMemo(() => {
    const expandedSet = new Set(expandedIds)
    const rootItem = folderAsRootListViewItem(swaggerFolder, {
      expandedIds: expandedSet,
      renderMethodBadge: (method: string, name: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <HttpMethodBadge method={method} />
          <span>{name}</span>
        </span>
      )
    })
    return [rootItem]
  }, [expandedIds, swaggerFolder])

  const sidebarItemsWithContextMenu: ListViewItemData[] = useMemo(
    () => attachContextMenus(sidebarItems, t, handleDefineVariables),
    [sidebarItems, t, handleDefineVariables]
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftWidth, setLeftWidth] = useState<number>(260)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const sashStartLeftRef = useRef<number>(leftWidth)

  const layoutProvider: IVerticalSashLayoutProvider = useMemo(
    () => ({
      getVerticalSashLeft: () => leftWidth,
      getVerticalSashTop: () => 0,
      getVerticalSashHeight: () => containerHeight
    }),
    [leftWidth, containerHeight]
  )

  const handleSashStart = useCallback(
    (_event: SashEvent): void => {
      sashStartLeftRef.current = leftWidth
    },
    [leftWidth]
  )

  const handleSashChange = useCallback((event: SashEvent): void => {
      if (!containerRef.current) return

      const delta = event.currentX - event.startX
      const containerWidth = containerRef.current.clientWidth
      const min = MIN_LEFT_WIDTH
      const max = Math.max(min, containerWidth - RIGHT_MIN_WIDTH)
      const start = sashStartLeftRef.current
      const next = Math.min(max, Math.max(min, start + delta))

      setLeftWidth(next)
  }, [])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const observer = new ResizeObserver(() => {
      const el = containerRef.current
      if (el) {
        setContainerHeight(el.clientHeight)
      }
    })
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
    }
  }, [])

  // Handle tree changes from workbench
  const handleTreeChange = useCallback((newTree: WorkbenchTree) => {
    setWorkbenchTree(newTree)
  }, [])

  // Handle tab activation in workbench - navigate to sync sidebar selection
  const handleTabActivate = useCallback((tabId: string) => {
    // Extract the item ID from the tab ID
    let itemId: string | null = null
    let itemType: string | null = null

    if (tabId.startsWith('folder-')) {
      itemId = tabId.replace('folder-', '')
      itemType = 'folder'
    } else if (tabId.startsWith('request-')) {
      itemId = tabId.replace('request-', '')
      itemType = 'http-request'
    }

    if (itemId && itemType) {
      // Navigate to sync sidebar selection
      navigationService.navigateTo(itemId, 'workbench', { type: itemType })
    }
  }, [])

  // Handle breadcrumb item click - navigate to the clicked item
  const handleBreadcrumbClick = useCallback(
    (item: BreadcrumbItem, _index: number, isLast: boolean) => {
      // Skip navigation for last item (current page)
      if (isLast) return

      // Determine item type by looking up in the swagger folder
      const foundItem = findFolderById(swaggerFolder, item.id)
      if (foundItem) {
        navigationService.navigateTo(item.id, 'breadcrumb', { type: 'folder' })
      } else {
        // It might be a request
        const { item: requestItem } = findItemWithBreadcrumbs(swaggerFolder, item.id)
        if (requestItem && isRequest(requestItem) && isHTTPRequest(requestItem)) {
          navigationService.navigateTo(item.id, 'breadcrumb', { type: 'http-request' })
        }
      }
    },
    [swaggerFolder]
  )

  // Handle item rename from breadcrumb
  const handleItemRename = useCallback(
    (item: BreadcrumbItem, newName: string) => {
      setSwaggerFolder((prevFolder) => {
        // Deep clone and update the folder structure
        const updateFolderItems = (folder: Folder): Folder => {
          const updatedItems = folder.items.map((folderItem): FolderItem => {
            if (isFolder(folderItem)) {
              if (folderItem.id === item.id) {
                return { ...folderItem, name: newName }
              }
              return updateFolderItems(folderItem)
            } else if (isRequest(folderItem) && isHTTPRequest(folderItem)) {
              if (folderItem.id === item.id) {
                return { ...folderItem, name: newName }
              }
            }
            return folderItem
          })
          return { ...folder, items: updatedItems }
        }

        // Check if root folder is being renamed
        if (prevFolder.id === item.id) {
          return { ...prevFolder, name: newName }
        }

        return updateFolderItems(prevFolder)
      })

      // Also update the workbench tab title and breadcrumbs
      setWorkbenchTree((prevTree) => {
        const group = prevTree.groups[0]
        if (!group || !isTabGroupNode(group)) return prevTree

        const updatedTabs = group.tabs.map((tab) => {
          const restormTab = tab as FolderTab | HTTPRequestTab

          // Update tab title if it's the renamed item
          if (restormTab.tabType === 'folder' && restormTab.folder.id === item.id) {
            return {
              ...restormTab,
              title: newName,
              titleString: newName,
              folder: { ...restormTab.folder, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === item.id ? { ...bc, label: newName } : bc
              )
            }
          }

          if (restormTab.tabType === 'http-request' && restormTab.request.id === item.id) {
            const newTitle = `${restormTab.request.method} ${newName}`
            return {
              ...restormTab,
              title: newTitle,
              titleString: newTitle,
              request: { ...restormTab.request, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === item.id ? { ...bc, label: newName } : bc
              )
            }
          }

          // Update breadcrumbs for other tabs that might reference this item
          if (restormTab.breadcrumbs) {
            const updatedBreadcrumbs = restormTab.breadcrumbs.map((bc) =>
              bc.id === item.id ? { ...bc, label: newName } : bc
            )
            return { ...restormTab, breadcrumbs: updatedBreadcrumbs }
          }

          return tab
        })

        return {
          ...prevTree,
          groups: [{ ...group, tabs: updatedTabs }]
        }
      })
    },
    []
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--vscode-editor-background, #1e1e1e)',
        color: 'var(--vscode-editor-foreground, #d4d4d4)'
      }}
    >
      <Titlebar
        title={t('app.title')}
        leftContent={
          <MenuBar>
            <MenuBarItem title={t('menuBar.file')}>
              <MenuItem title={t('menuBar.open')} shortcut="Ctrl+O" />
              <MenuItemSeparator />
              <MenuItem title={t('menuBar.exit')} shortcut="Ctrl+Q" onClick={handleMenuExit} />
            </MenuBarItem>
          </MenuBar>
        }
        rightContent={
          <Button
            small
            secondary
            onClick={() => {
              showSettingsModal()
            }}
            options={{
              ariaLabel: t('app.openSettings'),
              title: t('app.openSettings')
            }}
          >
            <i className="codicon codicon-gear"></i>
          </Button>
        }
      />

      <div
        ref={containerRef}
        style={{
          display: 'flex',
          position: 'relative',
          flex: 1,
          minHeight: 0
        }}
      >
        <div
          style={{
            width: leftWidth,
            minWidth: MIN_LEFT_WIDTH,
            maxWidth: '70%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRight: '1px solid var(--vscode-sideBar-border, var(--vscode-panel-border))',
            backgroundColor: 'var(--vscode-sideBar-background)'
          }}
        >
          <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
            <Pane
              title="Requests"
              collapsible={false}
              minSize={MIN_LEFT_WIDTH}
              headerActions={
                <>
                  <Button
                    secondary
                    small
                    options={{ ariaLabel: t('sidebar.addRequest'), title: t('sidebar.addRequest') }}
                    onClick={() => {
                      // TODO: hook this to real "add request" behavior
                    }}
                  >
                    <i className="codicon codicon-add" />
                  </Button>
                  <Button
                    secondary
                    small
                    options={{ ariaLabel: t('sidebar.collapseAll'), title: t('sidebar.collapseAll') }}
                    onClick={() => {
                      setExpandedIds([])
                    }}
                  >
                    <i className="codicon codicon-collapse-all" />
                  </Button>
                </>
              }
            >
              <ListView
                items={sidebarItemsWithContextMenu}
                rootRole="tree"
                ariaLabel="Requests"
                selectedIds={selectedItemId ? [selectedItemId] : []}
                onItemToggle={(payload, expanded) => {
                  const id = payload.item.id
                  if (!id) return
                  setExpandedIds((prev) =>
                    expanded
                      ? Array.from(new Set([...prev, id]))
                      : prev.filter((existingId) => existingId !== id)
                  )
                }}
                onItemClick={(payload) => {
                  const id = payload.item.id
                  if (id) {
                    handleItemClick(id)
                  }
                }}
              />
            </Pane>
          </SplitView>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: RIGHT_MIN_WIDTH,
            minHeight: 0,
            display: 'flex'
          }}
        >
          <Workbench
            tree={workbenchTree}
            onTreeChange={handleTreeChange}
            onTabActivate={handleTabActivate}
            onBreadcrumbClick={handleBreadcrumbClick}
            onItemRename={handleItemRename}
            emptyFallback={<Welcome />}
            style={{ flex: 1 }}
          />
        </div>

        <Sash
          orientation="vertical"
          layoutProvider={layoutProvider}
          onStart={handleSashStart}
          onChange={handleSashChange}
          size={4}
        />
      </div>

      <Statusbar />
    </div>
  )
}

export default App
