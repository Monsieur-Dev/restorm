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
  isContainerNode,
  navigationService
} from 'electron-core-ui/renderer'
import type { WorkbenchTree, NavigationEvent, GroupNode, TabGroupNode, EditorTab, SearchResult } from 'electron-core-ui/renderer'
import { Workbench } from './components/Workbench'
import { Welcome } from './components/Welcome'
import { HttpMethodBadge } from './components/HttpMethodBadge'
import { renderSearchTooltipContent } from './components/renderSearchTooltipContent'
import { EnvironmentValuesProvider } from './contexts/EnvironmentValuesContext'
import { importSwaggerFromJson } from './services/SwaggerImportService'
import { searchIndexService } from './services/SearchIndexService'
import { makeReactiveFolder } from './types/reactive'
import { folderAsRootListViewItem, collectAllFolderIds } from './services/FolderToListView'
import swaggerPetstoreJson from './resources/swagger-petstore.json'
import type { Folder, FolderItem, HTTPRequest, Environment } from './types/collections'
import { isFolder, isRequest, isHTTPRequest } from './types/collections'
import type { FolderTab, HTTPRequestTab, BreadcrumbItem } from './types/editor'

const MIN_LEFT_WIDTH = 180
const RIGHT_MIN_WIDTH = 240

/** Workbench ID for persistence */
const WORKBENCH_ID = 'restorm-main-workbench'

interface SidebarContextMenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
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
    {
      id: 'rename-item',
      label: t('sidebar.contextMenu.rename'),
      icon: 'edit',
      shortcut: 'F2'
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
const rawSwaggerFolder = importSwaggerFromJson(JSON.stringify(swaggerPetstoreJson))
const initialSwaggerFolder = makeReactiveFolder(rawSwaggerFolder)
const allFolderIds = collectAllFolderIds(initialSwaggerFolder)

/** Find a folder by ID in the folder tree */
function findFolderById(folder: Folder, id: string): Folder | undefined {
  if (folder.id === id) return folder
  for (const item of folder.items) {
    if (isFolder(item)) {
      const found = findFolderById(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find an HTTP request by ID in the folder tree */
function findRequestById(folder: Folder, id: string): HTTPRequest | undefined {
  for (const item of folder.items) {
    if (!isFolder(item) && item.id === id) return item
    if (isFolder(item)) {
      const found = findRequestById(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find any item (folder or request) by ID in the folder tree */
function findItemById(folder: Folder, id: string): FolderItem | null {
  if (folder.id === id) return folder
  for (const item of folder.items) {
    if (item.id === id) return item
    if (isFolder(item)) {
      const found = findItemById(item, id)
      if (found) return found
    }
  }
  return null
}

/** Folder icon for breadcrumbs */
const FOLDER_ICON = { type: 'codicon' as const, value: 'folder' }

/** Find an item (folder or request) by ID and build breadcrumbs including the item itself */
function findItemWithBreadcrumbs(
  folder: Folder,
  id: string,
  path: BreadcrumbItem[] = []
): { item: FolderItem | null; breadcrumbs: BreadcrumbItem[] } {
  // Check if the root folder itself matches the ID
  if (folder.id === id) {
    return { item: folder, breadcrumbs: [...path, { id: folder.id, label: folder.name, icon: FOLDER_ICON }] }
  }

  const currentPath = [...path, { id: folder.id, label: folder.name, icon: FOLDER_ICON }]

  for (const item of folder.items) {
    if (isFolder(item)) {
      if (item.id === id) {
        // Include the folder itself as the last breadcrumb (with folder icon)
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name, icon: FOLDER_ICON }] }
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

/** Get environments from the nearest ancestor folder that defines them */
function getNearestEnvironmentsForBreadcrumbs(
  rootFolder: Folder,
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
    if (folder && folder.configuration.environments.length > 0) {
      return folder.configuration.environments
    }
  }

  return []
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

  // Counter to force re-render without breaking reactive proxies
  const [, forceUpdate] = useState(0)

  // Ref to track if search index has been initialized
  const searchIndexInitializedRef = useRef(false)

  // Initialize search index service and index folder on initial load
  useEffect(() => {
    if (searchIndexInitializedRef.current) return
    searchIndexInitializedRef.current = true
    
    searchIndexService.initialize()
    searchIndexService.indexFolderTree(swaggerFolder)
    
    // Note: No cleanup needed - the service is a singleton that should persist
    // for the lifetime of the application. StrictMode would otherwise destroy
    // subscriptions before re-rendering.
  }, [swaggerFolder])

  // Initialize with all folders expanded
  const [expandedIds, setExpandedIds] = useState<string[]>(allFolderIds)

  // Selected item in the sidebar
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  // Focused group ID in the workbench
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null)

  // Workbench tree state (starts with no groups)
  const [workbenchTree, setWorkbenchTree] = useState<WorkbenchTree>({
    orientation: 'vertical',
    groups: []
  })

  // ===========================================================================
  // Workbench helpers
  // ===========================================================================

  /** Find the ID of the first tab group in a potentially nested workbench tree */
  const findFirstTabGroupId = useCallback((nodes: GroupNode[]): string | null => {
    for (const node of nodes) {
      if (isTabGroupNode(node)) {
        return node.id
      }
      if (isContainerNode(node)) {
        const childId = findFirstTabGroupId(node.groups)
        if (childId) return childId
      }
    }
    return null
  }, [])

  /** Check if a group with the given ID exists anywhere in the tree */
  const hasGroupWithId = useCallback((nodes: GroupNode[], groupId: string): boolean => {
    for (const node of nodes) {
      if (isTabGroupNode(node)) {
        if (node.id === groupId) return true
      } else if (isContainerNode(node)) {
        if (hasGroupWithId(node.groups, groupId)) return true
      }
    }
    return false
  }, [])

  /** Find the ID of the group containing a tab with the given ID */
  const findGroupIdForTab = useCallback((nodes: GroupNode[], tabId: string): string | null => {
    for (const node of nodes) {
      if (isTabGroupNode(node)) {
        if (node.tabs.some((tab) => tab.id === tabId)) {
          return node.id
        }
      } else if (isContainerNode(node)) {
        const childId = findGroupIdForTab(node.groups, tabId)
        if (childId) return childId
      }
    }
    return null
  }, [])

  /** Update a specific tab group by ID anywhere in the tree */
  const updateGroupById = useCallback(
    (nodes: GroupNode[], groupId: string, updater: (group: TabGroupNode) => TabGroupNode): GroupNode[] => {
      return nodes.map((node) => {
        if (isTabGroupNode(node)) {
          if (node.id === groupId) {
            return updater(node)
          }
          return node
        }
        if (isContainerNode(node)) {
          return {
            ...node,
            groups: updateGroupById(node.groups, groupId, updater)
          }
        }
        return node
      })
    },
    []
  )

  // Open a folder tab in the workbench
  const openFolderTab = useCallback((folder: Folder, breadcrumbs: BreadcrumbItem[]) => {
    const tabId = `folder-${folder.id}`

    setWorkbenchTree((prev) => {
      const newTab: FolderTab = {
        id: tabId,
        tabType: 'folder',
        title: folder.name,
        titleString: folder.name,
        folder,
        breadcrumbs,
        allowFullscreen: true
      }

      // No groups yet: create the main group with this tab
      if (prev.groups.length === 0) {
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

      // If tab already exists anywhere, just activate it in its group
      const existingGroupId = findGroupIdForTab(prev.groups, tabId)
      if (existingGroupId) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, existingGroupId, (group) => ({
            ...group,
            activeTabId: tabId
          }))
        }
      }

      // Otherwise, add the tab to the currently focused group when possible
      const preferredGroupId =
        focusedGroupId && hasGroupWithId(prev.groups, focusedGroupId) ? focusedGroupId : null

      const targetGroupId =
        preferredGroupId && hasGroupWithId(prev.groups, preferredGroupId)
          ? preferredGroupId
          : findFirstTabGroupId(prev.groups) ?? 'restorm-main-group'

      const updatedGroups = hasGroupWithId(prev.groups, targetGroupId)
        ? updateGroupById(prev.groups, targetGroupId, (group) => ({
            ...group,
            tabs: [...group.tabs, newTab],
            activeTabId: tabId
          }))
        : [
            ...prev.groups,
            {
              id: targetGroupId,
              tabs: [newTab],
              activeTabId: tabId
            }
          ]

      return {
        ...prev,
        groups: updatedGroups
      }
    })
  }, [findFirstTabGroupId, findGroupIdForTab, focusedGroupId, hasGroupWithId, updateGroupById])

  // Open an HTTP request tab in the workbench
  const openRequestTab = useCallback(
    (request: HTTPRequest, breadcrumbs: BreadcrumbItem[], environments?: Environment[]) => {
    const tabId = `request-${request.id}`

    setWorkbenchTree((prev) => {
      const newTab: HTTPRequestTab = {
        id: tabId,
        tabType: 'http-request',
        title: `${request.method} ${request.name}`,
        titleString: `${request.method} ${request.name}`,
        request,
        breadcrumbs,
        environments,
        allowFullscreen: true
      }

      // No groups yet: create the main group with this tab
      if (prev.groups.length === 0) {
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

      // If tab already exists anywhere, just activate it in its group
      const existingGroupId = findGroupIdForTab(prev.groups, tabId)
      if (existingGroupId) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, existingGroupId, (group) => ({
            ...group,
            activeTabId: tabId
          }))
        }
      }

      // Otherwise, add the tab to the currently focused group when possible
      const preferredGroupId =
        focusedGroupId && hasGroupWithId(prev.groups, focusedGroupId) ? focusedGroupId : null

      const targetGroupId =
        preferredGroupId && hasGroupWithId(prev.groups, preferredGroupId)
          ? preferredGroupId
          : findFirstTabGroupId(prev.groups) ?? 'restorm-main-group'

      const updatedGroups = hasGroupWithId(prev.groups, targetGroupId)
        ? updateGroupById(prev.groups, targetGroupId, (group) => ({
            ...group,
            tabs: [...group.tabs, newTab],
            activeTabId: tabId
          }))
        : [
            ...prev.groups,
            {
              id: targetGroupId,
              tabs: [newTab],
              activeTabId: tabId
            }
          ]

      return {
        ...prev,
        groups: updatedGroups
      }
    })
  },
    [findFirstTabGroupId, findGroupIdForTab, focusedGroupId, hasGroupWithId, updateGroupById]
  )

  // Rebuild tab callback for workbench autosave
  const handleRebuildTab = useCallback((tabId: string): EditorTab | null => {
    if (tabId.startsWith('folder-')) {
      const itemId = tabId.replace('folder-', '')
      const folder = findFolderById(swaggerFolder, itemId)
      if (folder) {
        const { breadcrumbs } = findItemWithBreadcrumbs(swaggerFolder, itemId)
        return {
          id: tabId,
          tabType: 'folder',
          title: folder.name,
          titleString: folder.name,
          folder,
          breadcrumbs,
          allowFullscreen: true
        } as FolderTab
      }
    } else if (tabId.startsWith('request-')) {
      const itemId = tabId.replace('request-', '')
      const { item, breadcrumbs } = findItemWithBreadcrumbs(swaggerFolder, itemId)
      if (item && isRequest(item) && isHTTPRequest(item)) {
        const environments = getNearestEnvironmentsForBreadcrumbs(swaggerFolder, breadcrumbs)
        return {
          id: tabId,
          tabType: 'http-request',
          title: `${item.method} ${item.name}`,
          titleString: `${item.method} ${item.name}`,
          request: item,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as HTTPRequestTab
      }
    }
    return null
  }, [swaggerFolder])

  // Handle workbench state restored
  const handleStateRestored = useCallback((restoredTree: WorkbenchTree | null) => {
    if (restoredTree) {
      setWorkbenchTree(restoredTree)
    }
  }, [])

  // Handle sizes change from workbench sash dragging
  const handleSizesChange = useCallback((nodeId: string, sizes: number[]) => {
    setWorkbenchTree(prev => {
      if (nodeId === 'root') {
        return { ...prev, sizes }
      }
      
      // Recursively update sizes for nested container nodes
      const updateNodeSizes = (nodes: GroupNode[]): GroupNode[] => {
        return nodes.map(node => {
          if (isContainerNode(node)) {
            if (node.id === nodeId) {
              return { ...node, sizes }
            }
            return { ...node, groups: updateNodeSizes(node.groups) }
          }
          return node
        })
      }
      
      return { ...prev, groups: updateNodeSizes(prev.groups) }
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
          // Focus the group containing the tab
          setFocusedGroupId('restorm-main-group')
        }
      } else if (params.type === 'http-request') {
        const { item, breadcrumbs } = findItemWithBreadcrumbs(swaggerFolder, key)
        if (item && isRequest(item) && isHTTPRequest(item)) {
          const environments = getNearestEnvironmentsForBreadcrumbs(swaggerFolder, breadcrumbs)
          openRequestTab(item, breadcrumbs, environments)
          // Focus the group containing the tab
          setFocusedGroupId('restorm-main-group')
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
      // Open folder view (same as "Define variables" context menu)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'folder' })
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

  // Handle search result click - navigate to the selected item
  const handleSearchResultClick = useCallback((result: SearchResult) => {
    if (result.navigation?.type === 'request' && result.navigation.requestId) {
      handleItemClick(result.navigation.requestId)
    } else if (result.navigation?.type === 'folder' && result.navigation.folderId) {
      handleItemClick(result.navigation.folderId)
    }
  }, [handleItemClick])

  // Convert swagger folder to ListView items
  const sidebarItems: ListViewItemData[] = useMemo(() => {
    const expandedSet = new Set(expandedIds)
    const rootItem = folderAsRootListViewItem(swaggerFolder, {
      expandedIds: expandedSet,
      renderMethodBadge: (method: string) => (
        <HttpMethodBadge method={method} />
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

  // Handle tree changes from workbench (drag-drop, close tab, etc.)
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
      // Find and update the reactive object directly (triggers search re-indexing)
      const foundItem = findItemById(swaggerFolder, item.id)
      if (foundItem) {
        foundItem.name = newName
      }

      // Force React re-render by creating new reference
      setSwaggerFolder((prevFolder) => ({ ...prevFolder }))

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
    [swaggerFolder]
  )

  // Handle tags changes from Workbench (folders or HTTP requests)
  const handleTagsChange = useCallback((targetId: string, newTags: string[]) => {
    // Find and update the reactive object directly (triggers search re-indexing)
    const item = findItemById(swaggerFolder, targetId)
    if (item) {
      item.tags = newTags
    }

    // Force React re-render without breaking reactive proxies
    forceUpdate((n) => n + 1)

    // Update tags in open workbench tabs
    setWorkbenchTree((prevTree) => {
      const group = prevTree.groups[0]
      if (!group || !isTabGroupNode(group)) return prevTree

      const updatedTabs = group.tabs.map((tab) => {
        const restormTab = tab as FolderTab | HTTPRequestTab

        if (restormTab.tabType === 'folder' && restormTab.folder.id === targetId) {
          return {
            ...restormTab,
            folder: { ...restormTab.folder, tags: newTags }
          }
        }

        if (restormTab.tabType === 'http-request' && restormTab.request.id === targetId) {
          return {
            ...restormTab,
            request: { ...restormTab.request, tags: newTags }
          }
        }

        return restormTab
      })

      return {
        ...prevTree,
        groups: [{ ...group, tabs: updatedTabs }]
      }
    })
  }, [swaggerFolder])

  // Handle folder changes from FolderView (environments, etc.)
  const handleFolderChange = useCallback((folderId: string, updatedFolder: Folder) => {
    // Find and update the reactive folder directly to preserve proxies
    const reactiveFolder = findFolderById(swaggerFolder, folderId)
    if (reactiveFolder) {
      // Update properties on the reactive object (triggers re-indexing)
      reactiveFolder.configuration = updatedFolder.configuration
      if (updatedFolder.notes !== undefined) {
        reactiveFolder.notes = updatedFolder.notes
      }
      reactiveFolder.documentation = updatedFolder.documentation
      reactiveFolder.tags = updatedFolder.tags
      reactiveFolder.name = updatedFolder.name
    }
    
    // Force React re-render without breaking reactive proxies
    forceUpdate((n) => n + 1)

    // Update folder data in open workbench tabs (all groups)
    setWorkbenchTree((prevTree) => {
      const updatedGroups = prevTree.groups.map((group) => {
        if (!isTabGroupNode(group)) return group

        const updatedTabs = group.tabs.map((tab) => {
          const restormTab = tab as FolderTab | HTTPRequestTab
          
          // Update folder tabs
          if (restormTab.tabType === 'folder' && restormTab.folder.id === folderId) {
            return {
              ...restormTab,
              folder: updatedFolder,
              title: updatedFolder.name,
              titleString: updatedFolder.name
            }
          }
          
          // Update http-request tabs that belong to this folder (check breadcrumbs)
          if (restormTab.tabType === 'http-request' && restormTab.breadcrumbs) {
            const belongsToFolder = restormTab.breadcrumbs.some(bc => bc.id === folderId)
            if (belongsToFolder) {
              // Recalculate environments for this request
              const newEnvironments = getNearestEnvironmentsForBreadcrumbs(swaggerFolder, restormTab.breadcrumbs)
              return {
                ...restormTab,
                environments: newEnvironments
              }
            }
          }
          
          return restormTab
        })

        return { ...group, tabs: updatedTabs }
      })

      return {
        ...prevTree,
        groups: updatedGroups
      }
    })
  }, [swaggerFolder])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--vscode-editor-background)',
        color: 'var(--vscode-editor-foreground)'
      }}
    >
      <Titlebar
        title={t('app.title')}
        showSearchBar
        onSearchResultClick={handleSearchResultClick}
        renderSearchTooltipContent={renderSearchTooltipContent}
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
            borderRight: '1px solid var(--vscode-sideBar-border)',
            backgroundColor: 'var(--vscode-sideBar-background)'
          }}
        >
          <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
            <Pane
              title={t('sidebar.workspace')}
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
                ariaLabel={t('sidebar.workspace')}
                selectedIds={selectedItemId ? [selectedItemId] : []}
                expandedIds={expandedIds}
                isRenameable
                expandOnChevronOnly
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

        <EnvironmentValuesProvider>
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
              focusedGroupId={focusedGroupId}
              onFocusedGroupChange={setFocusedGroupId}
              onTabActivate={handleTabActivate}
              onBreadcrumbClick={handleBreadcrumbClick}
              onItemRename={handleItemRename}
              onTagsChange={handleTagsChange}
              onFolderChange={handleFolderChange}
              onSizesChange={handleSizesChange}
              emptyFallback={<Welcome />}
              style={{ flex: 1 }}
              workbenchId={WORKBENCH_ID}
              autosave
              onRebuildTab={handleRebuildTab}
              onStateRestored={handleStateRestored}
              getRequestById={(id) => findRequestById(swaggerFolder, id)}
              getFolderById={(id) => findFolderById(swaggerFolder, id)}
            />
          </div>
        </EnvironmentValuesProvider>

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
