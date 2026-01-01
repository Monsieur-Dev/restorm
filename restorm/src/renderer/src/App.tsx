import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Titlebar,
  MenuBar,
  MenuBarItem,
  MenuItem,
  MenuItemSeparator,
  Statusbar,
  StatusbarElement,
  ListView,
  type ListViewItemData,
  type ListViewDropEventPayload,
  type ListViewItemEventPayload,
  Sash,
  type IVerticalSashLayoutProvider,
  type SashEvent,
  SplitView,
  Pane,
  Button,
  Modal,
  useSettingsModal,
  isTabGroupNode,
  isContainerNode,
  navigationService,
  useFeature,
  useFileService,
  useFileEvents,
  setContentChecksum,
  finishLoading,
  hasContentChanged,
  registerInitialChecksums,
  commitChecksums,
  eventBus,
  logger
} from 'electron-core-ui/renderer'
import { DocumentEvents, type DocumentChangedPayload } from './services/DocumentEvents'
import type { WorkbenchTree, NavigationEvent, GroupNode, TabGroupNode, EditorTab, SearchResult } from 'electron-core-ui/renderer'
import { RestormWorkbench } from './components/RestormWorkbench'
import { Welcome } from './components/Welcome'
import { EmptyBench } from './components/EmptyBench'
import { Badge } from './components/Badge'
import { SaveOptionsModal, type SaveOptions } from './components/SaveOptionsModal'
import { mapToBadgeType } from './utils/badgeUtils'
import { renderSearchTooltipContent } from './components/renderSearchTooltipContent'
import { EnvironmentValuesProvider } from './contexts/EnvironmentValuesContext'
import { AvailableVariablesProvider } from './contexts/AvailableVariablesContext'
import { VariableTransformProvider } from './contexts/VariableTransformContext'
import { searchIndexService } from './services/SearchIndexService'
import { makeReactiveFolder } from './types/reactive'
import { folderAsRootListViewItem, collectAllFolderIds } from './services/FolderToListView'
import { prepareForSerialization, processAfterDeserialization } from './utils/serialization'
import type {
  Folder,
  FolderItem,
  Environment,
  EnvironmentFolder,
  Request
} from './types/collections'
import {
  isFolder,
  isRequest,
  isHTTPRequest,
  isGraphQLRequest,
  isGrpcRequest,
  isSoapRequest,
  isWebSocketRequest,
  isEnvironmentFolder,
  isAnyFolder
} from './types/collections'
import type {
  FolderTab,
  EnvironmentFolderTab,
  HTTPRequestTab,
  GraphQLRequestTab,
  GrpcRequestTab,
  SoapRequestTab,
  WebSocketRequestTab,
  BreadcrumbItem
} from './types/editor'
import { useDirtyState, computeChecksum } from './hooks/useDirtyState'

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
  onCloneItem: ContextMenuActionHandler,
  onCreateSubfolder: ContextMenuActionHandler,
  onDeleteItem: ContextMenuActionHandler
): SidebarContextMenuItem[] => {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0
  const isItemFolder = item.isExpandable ?? hasChildren
  const itemId = item.id

  if (isItemFolder) {
    return [
      {
        id: 'create-child-folder',
        label: t('sidebar.contextMenu.createSubfolder'),
        icon: 'new-folder',
        onClick: () => {
          onCreateSubfolder(itemId)
        }
      },
      {
        id: 'rename-item',
        label: t('sidebar.contextMenu.rename'),
        icon: 'edit',
        shortcut: 'F2'
      },
      { id: 'sep-folder', isSeparator: true, label: '' },
      {
        id: 'delete-folder',
        label: t('sidebar.contextMenu.delete'),
        icon: 'trash',
        shortcut: 'Suppr',
        onClick: () => {
          onDeleteItem(itemId)
        }
      }
    ]
  }

  return [
    {
      id: 'clone-item',
      label: t('sidebar.contextMenu.clone'),
      icon: 'copy',
      shortcut: 'Ctrl+D',
      onClick: () => {
        onCloneItem(itemId)
      }
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
      icon: 'trash',
      shortcut: 'Suppr',
      onClick: () => {
        onDeleteItem(itemId)
      }
    }
  ]
}

const attachContextMenus = (
  items: ListViewItemData[],
  t: TranslateFunction,
  onCloneItem: ContextMenuActionHandler,
  onCreateSubfolder: ContextMenuActionHandler,
  onDeleteItem: ContextMenuActionHandler
): ListViewItemData[] =>
  items.map((item) => {
    const withMenu = {
      ...item,
      contextMenuItems: buildContextMenuForItem(item, t, onCloneItem, onCreateSubfolder, onDeleteItem)
    } as ListViewItemData
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus(item.children, t, onCloneItem, onCreateSubfolder, onDeleteItem)
    }
    return withMenu
  })

// Initial root folders - empty at startup, populated when opening a file
const initialRootFolders: EnvironmentFolder[] = []

const allFolderIds = initialRootFolders.flatMap((folder) => collectAllFolderIds(folder))

/** Find a folder by ID in a single folder tree (returns Folder or EnvironmentFolder) */
function findFolderByIdInTree(folder: Folder | EnvironmentFolder, id: string): Folder | EnvironmentFolder | undefined {
  if (folder.id === id) return folder
  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      const found = findFolderByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find a folder by ID across multiple root folders */
function findFolderById(rootFolders: EnvironmentFolder[], id: string): Folder | EnvironmentFolder | undefined {
  for (const root of rootFolders) {
    const found = findFolderByIdInTree(root, id)
    if (found) return found
  }
  return undefined
}

// ===========================================================================
// Workbench tree helpers (pure functions, defined outside component)
// ===========================================================================

/** Find the ID of the first tab group in a potentially nested workbench tree */
function findFirstTabGroupId(nodes: GroupNode[]): string | null {
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
}

/** Check if a group with the given ID exists anywhere in the tree */
function hasGroupWithId(nodes: GroupNode[], groupId: string): boolean {
  for (const node of nodes) {
    if (isTabGroupNode(node)) {
      if (node.id === groupId) return true
    } else if (isContainerNode(node)) {
      if (hasGroupWithId(node.groups, groupId)) return true
    }
  }
  return false
}

/** Find the ID of the group containing a tab with the given ID */
function findGroupIdForTab(nodes: GroupNode[], tabId: string): string | null {
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
}

/** Update a specific tab group by ID anywhere in the tree */
function updateGroupById(
  nodes: GroupNode[],
  groupId: string,
  updater: (group: TabGroupNode) => TabGroupNode
): GroupNode[] {
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
}

/** Find an environment folder by ID in a single folder tree */
function findEnvironmentFolderByIdInTree(folder: Folder | EnvironmentFolder, id: string): EnvironmentFolder | undefined {
  if (isEnvironmentFolder(folder as FolderItem) && folder.id === id) return folder as EnvironmentFolder
  for (const item of folder.items) {
    if (isEnvironmentFolder(item)) {
      if (item.id === id) return item
      const found = findEnvironmentFolderByIdInTree(item, id)
      if (found) return found
    } else if (isAnyFolder(item)) {
      const found = findEnvironmentFolderByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find an environment folder by ID across multiple root folders */
function findEnvironmentFolderById(rootFolders: EnvironmentFolder[], id: string): EnvironmentFolder | undefined {
  for (const root of rootFolders) {
    const found = findEnvironmentFolderByIdInTree(root, id)
    if (found) return found
  }
  return undefined
}

/** Find any request by ID in a single folder tree */
function findRequestByIdInTree(folder: Folder | EnvironmentFolder, id: string): Request | undefined {
  for (const item of folder.items) {
    if (isRequest(item) && item.id === id) return item
    if (isAnyFolder(item)) {
      const found = findRequestByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find any request by ID across multiple root folders */
function findRequestById(rootFolders: EnvironmentFolder[], id: string): Request | undefined {
  for (const root of rootFolders) {
    const found = findRequestByIdInTree(root, id)
    if (found) return found
  }
  return undefined
}

/** Find any item (folder or request) by ID in a single folder tree */
function findItemByIdInTree(folder: Folder | EnvironmentFolder, id: string): FolderItem | null {
  if (folder.id === id) return folder
  for (const item of folder.items) {
    if (item.id === id) return item
    if (isAnyFolder(item)) {
      const found = findItemByIdInTree(item, id)
      if (found) return found
    }
  }
  return null
}

/** Find any item (folder or request) by ID across multiple root folders */
function findItemById(rootFolders: EnvironmentFolder[], id: string): FolderItem | null {
  for (const root of rootFolders) {
    const found = findItemByIdInTree(root, id)
    if (found) return found
  }
  return null
}

/** Folder icon for breadcrumbs */
const FOLDER_ICON = { type: 'codicon' as const, value: 'folder' }
/** Environment folder icon for breadcrumbs */
const ENV_FOLDER_ICON = { type: 'codicon' as const, value: 'folder-library' }

/** Get the appropriate icon for a folder */
function getFolderIcon(item: Folder | EnvironmentFolder): { type: 'codicon'; value: string } {
  return isEnvironmentFolder(item as FolderItem) ? ENV_FOLDER_ICON : FOLDER_ICON
}

/** Find an item (folder or request) by ID and build breadcrumbs including the item itself - in a single tree */
function findItemWithBreadcrumbsInTree(
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
      const found = findItemWithBreadcrumbsInTree(item, id, currentPath)
      if (found.item) return found
    } else if (isRequest(item)) {
      if (item.id === id) {
        // Include the request itself as the last breadcrumb (no folder icon)
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name }] }
      }
    }
  }

  return { item: null, breadcrumbs: [] }
}

/** Find an item (folder or request) by ID and build breadcrumbs including the item itself - across multiple root folders */
function findItemWithBreadcrumbs(
  rootFolders: EnvironmentFolder[],
  id: string
): { item: FolderItem | null; breadcrumbs: BreadcrumbItem[] } {
  for (const root of rootFolders) {
    const found = findItemWithBreadcrumbsInTree(root, id)
    if (found.item) return found
  }
  return { item: null, breadcrumbs: [] }
}

/** Get environments from the nearest ancestor EnvironmentFolder */
function getNearestEnvironmentsForBreadcrumbs(
  rootFolders: EnvironmentFolder[],
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
    const folder = findFolderById(rootFolders, folderId)
    if (folder && isEnvironmentFolder(folder as FolderItem)) {
      const envFolder = folder as EnvironmentFolder
      if (envFolder.environments.length > 0) {
        return envFolder.environments
      }
    }
  }

  return []
}

/** Find an item and its parent folder in a single tree */
function findItemWithParentInTree(
  folder: Folder | EnvironmentFolder,
  targetId: string,
  parent: Folder | EnvironmentFolder | null = null
): { item: FolderItem | null; parent: Folder | EnvironmentFolder | null; index: number } {
  // Check if the folder itself is the target (but it can't be moved if it's the root)
  if (folder.id === targetId) {
    return { item: folder, parent, index: -1 }
  }

  for (let i = 0; i < folder.items.length; i++) {
    const item = folder.items[i]
    if (item === undefined) continue
    if (item.id === targetId) {
      return { item, parent: folder, index: i }
    }
    if (isAnyFolder(item)) {
      const found = findItemWithParentInTree(item, targetId, item)
      if (found.item) return found
    }
  }

  return { item: null, parent: null, index: -1 }
}

/** Find an item and its parent folder across multiple root folders */
function findItemWithParent(
  rootFolders: EnvironmentFolder[],
  targetId: string
): { item: FolderItem | null; parent: Folder | EnvironmentFolder | null; index: number; rootFolder: EnvironmentFolder | null } {
  for (const root of rootFolders) {
    const found = findItemWithParentInTree(root, targetId)
    if (found.item) return { ...found, rootFolder: root }
  }
  return { item: null, parent: null, index: -1, rootFolder: null }
}

/** Remove an item from its parent folder and return a copy of the item */
function removeItemFromTree(
  rootFolders: EnvironmentFolder[],
  itemId: string
): FolderItem | null {
  const { item, parent, index } = findItemWithParent(rootFolders, itemId)
  if (!item || !parent || index < 0) return null

  // Remove from parent
  parent.items.splice(index, 1)
  return item
}

/** Insert an item into the tree at the specified position */
function insertItemIntoTree(
  rootFolders: EnvironmentFolder[],
  item: FolderItem,
  targetId: string,
  position: 'before' | 'after' | 'into'
): boolean {
  const { item: target, parent, index } = findItemWithParent(rootFolders, targetId)
  if (!target) return false

  if (position === 'into') {
    // Insert into the target (which must be a folder)
    if (isAnyFolder(target)) {
      target.items.push(item)
      return true
    }
    // If target is not a folder, insert after it instead
    if (parent) {
      parent.items.splice(index + 1, 0, item)
      return true
    }
    return false
  }

  // Insert before or after the target
  if (!parent) return false

  const insertIndex = position === 'before' ? index : index + 1
  parent.items.splice(insertIndex, 0, item)
  return true
}

/** Generate a unique ID */
function generateUniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/** Deep clone an item with new IDs */
function deepCloneItem(item: FolderItem): FolderItem {
  const newId = generateUniqueId()

  if (isAnyFolder(item)) {
    const clonedFolder = {
      ...item,
      id: newId,
      name: `${item.name} (copy)`,
      items: item.items.map((child) => deepCloneItem(child))
    }
    return clonedFolder
  }

  // It's a request
  return {
    ...item,
    id: newId,
    name: `${item.name} (copy)`
  }
}

/** Clone an item and insert the clone after it */
function cloneItemInTree(
  rootFolders: EnvironmentFolder[],
  itemId: string
): FolderItem | null {
  const { item, parent, index } = findItemWithParent(rootFolders, itemId)
  if (!item || !parent || index < 0) return null

  // Deep clone the item
  const clonedItem = deepCloneItem(item)

  // Insert after the original
  parent.items.splice(index + 1, 0, clonedItem)

  return clonedItem
}

/**
 * Collect all objects (folders, requests, environments) with their runtimeIds for checksum tracking.
 * This creates a Map that can be passed to registerInitialChecksums.
 */
function collectAllObjectsForChecksums(folders: EnvironmentFolder[]): Map<string, unknown> {
  const objects = new Map<string, unknown>()

  function collectEnvironments(env: Environment): void {
    // Store the environment object directly - serialization happens later
    // This matches the format used in reactive.ts events: JSON.parse(JSON.stringify(env))
    objects.set(env.id, env)

    // Recursively collect sub-environments
    if (env.subEnvironments) {
      for (const subEnv of env.subEnvironments) {
        collectEnvironments(subEnv)
      }
    }
  }

  function collectFromFolder(folder: Folder | EnvironmentFolder): void {
    // Store the folder object directly - serialization happens later
    // This matches the format used in reactive.ts events: JSON.parse(JSON.stringify(folder))
    objects.set(folder.id, folder)

    // If it's an environment folder, collect its environments
    if (isEnvironmentFolder(folder as FolderItem)) {
      const envFolder = folder as EnvironmentFolder
      for (const env of envFolder.environments) {
        collectEnvironments(env)
      }
    }

    // Collect items (requests and sub-folders)
    for (const item of folder.items) {
      if (isAnyFolder(item)) {
        collectFromFolder(item)
      } else {
        // Store the request object directly - serialization happens later
        objects.set(item.id, item)
      }
    }
  }

  for (const folder of folders) {
    collectFromFolder(folder)
  }

  return objects
}

/**
 * Desktop indicator component for statusbar
 * Shows "Desktop" text when desktop-indicator feature is enabled
 */
const DesktopIndicator: React.FC = () => {
  const { isEnabled, isLoading } = useFeature('desktop-indicator')

  if (isLoading || !isEnabled) {
    return null
  }

  return <StatusbarElement title="Desktop" />
}

const App: React.FC = () => {
  const { t } = useTranslation()
  const { showSettingsModal } = useSettingsModal()
  const {
    state: fileState,
    fileName,
    filePath,
    isDirty,
    recentFiles,
    favorites,
    newFile,
    open: openFile,
    save: saveFile,
    close: closeFile,
    showUnsavedChangesDialog,
    clearDirty
  } = useFileService()

  // Sync document.title with window title for taskbar
  useEffect(() => {
    const title = fileName ? `Restorm - ${fileName}${isDirty ? ' *' : ''}` : 'Restorm'
    document.title = title
  }, [fileName, isDirty])

  const handleMenuExit = useCallback(() => {
    void window.api.closeWindow()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isMac = navigator.userAgent.toLowerCase().includes('mac')
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

  // Root folders data (mutable for renaming)
  // Each root folder is an independent EnvironmentFolder
  const [rootFolders, setRootFolders] = useState<EnvironmentFolder[]>(initialRootFolders)

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

  // Save options modal state - declared early for use in handlers
  const [showSaveOptionsModal, setShowSaveOptionsModal] = useState(false)
  
  // Track if current file was opened as a folder (for save behavior)
  const [isOpenedAsFolder, setIsOpenedAsFolder] = useState(false)
  // Store the format used when opening a folder (defaults to yaml)
  const [folderFormat, setFolderFormat] = useState<'json' | 'yaml' | 'json5'>('yaml')
  // Store the folder path when working with a folder (separate from filePath)
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null)

  // Per-tab dirty state tracking (works in both file and folder modes)
  const {
    dirtyItemIds: dirtyTabIds,
    registerItem: registerTabDirtyState,
    updateItemChecksum: updateTabDirtyChecksum,
    markAllSaved: markAllTabsSaved,
    clear: clearTabDirtyState
  } = useDirtyState()

  // Create a Set for fast lookup of dirty item IDs
  const dirtyItemIdsSet = useMemo(() => new Set(dirtyTabIds), [dirtyTabIds])

  // Compute workbench tree with dirty states applied to all tabs
  // This is computed during render, not in an effect, to avoid cascading renders
  const workbenchTreeWithDirtyState = useMemo((): WorkbenchTree => {
    const updateGroups = (groups: GroupNode[]): GroupNode[] => {
      return groups.map(group => {
        if (isTabGroupNode(group)) {
          const updatedTabs = group.tabs.map(tab => {
            // Extract item ID from tab ID (format: "request-{id}", "folder-{id}", etc.)
            const itemId = tab.id.replace(/^(request|folder|env-folder)-/, '')
            const shouldBeDirty = dirtyItemIdsSet.has(itemId)
            if (tab.isDirty !== shouldBeDirty) {
              return { ...tab, isDirty: shouldBeDirty }
            }
            return tab
          })
          return { ...group, tabs: updatedTabs }
        } else if (isContainerNode(group)) {
          return { ...group, groups: updateGroups(group.groups) }
        }
        return group
      })
    }
    
    return { ...workbenchTree, groups: updateGroups(workbenchTree.groups) }
  }, [workbenchTree, dirtyItemIdsSet])

  // File save handlers (after rootFolders is defined)
  // Deep clone to remove Proxy wrappers before IPC serialization
  const handleMenuSave = useCallback(() => {
    const plainData = JSON.parse(JSON.stringify({ collections: rootFolders })) as Record<string, unknown>
    
    if (isOpenedAsFolder && currentFolderPath) {
      // For folders, keep IDs for mapping service, main process will strip them during serialization
      void (async () => {
        const result = await window.restorm?.file.saveAsFolder(plainData, folderFormat, currentFolderPath)
        if (result?.success) {
          void clearDirty()
        }
      })()
    } else {
      // For single files, strip IDs before saving
      const dataForSave = prepareForSerialization(plainData)
      void saveFile(dataForSave)
    }
  }, [saveFile, rootFolders, isOpenedAsFolder, folderFormat, clearDirty, currentFolderPath])

  const handleMenuSaveAs = useCallback(() => {
    setShowSaveOptionsModal(true)
  }, [])

  const handleSaveWithOptions = useCallback(async (options: SaveOptions) => {
    const plainData = JSON.parse(JSON.stringify({ collections: rootFolders })) as Record<string, unknown>
    
    logger.info('[App] Saving with options', { mode: options.mode, format: options.format })
    
    try {
      if (options.mode === 'folder') {
        // For folders, keep IDs for mapping service, main process will strip them during serialization
        const result = await window.restorm?.file.saveAsFolder(plainData, options.format)
        if (result?.success && result.path) {
          logger.info('[App] Folder saved successfully', { path: result.path })
          // Update state to track that we're now working with a folder
          setIsOpenedAsFolder(true)
          setFolderFormat(options.format)
          setCurrentFolderPath(result.path)
          await clearDirty()
        } else {
          logger.error('[App] Failed to save folder', { error: result?.error ?? 'Unknown error' })
        }
      } else {
        // For single files, strip IDs before saving
        const dataForSave = prepareForSerialization(plainData)
        const result = await window.restorm?.file.saveAsFile(dataForSave, options.format)
        if (result?.success) {
          logger.info('[App] File saved successfully', { path: result.path })
          // Update state to track that we're now working with a file
          setIsOpenedAsFolder(false)
          await clearDirty()
        } else {
          logger.error('[App] Failed to save file', { error: result?.error ?? 'Unknown error' })
        }
      }
    } catch (error) {
      logger.error('[App] Save error', { error: String(error) })
    }
  }, [rootFolders, clearDirty])

  // Listen for save-and-close event from main process (when closing window with unsaved changes)
  useEffect(() => {
    const handleSaveAndClose = async (): Promise<void> => {
      const plainData = JSON.parse(JSON.stringify({ collections: rootFolders })) as unknown
      const dataForSave = prepareForSerialization(plainData)
      const saved = await saveFile(dataForSave)
      if (saved) {
        // Force close all windows after save
        await window.restorm?.forceClose()
      }
    }
    
    const cleanup = window.restorm?.onSaveAndClose(() => {
      void handleSaveAndClose()
    })
    
    return cleanup
  }, [rootFolders, saveFile])

  // Helper to check for unsaved changes before proceeding
  const checkUnsavedChanges = useCallback(async (): Promise<boolean> => {
    // Compare current state with saved state checksum via FileService
    // Use the same structure as the file content for consistent comparison (without runtime ids)
    const dataForChecksum = prepareForSerialization({ collections: rootFolders })
    const currentChecksum = JSON.stringify(dataForChecksum)
    const hasRealChanges = await hasContentChanged(currentChecksum)
    
    if (!hasRealChanges) return true // No actual changes, proceed

    const result = await showUnsavedChangesDialog({
      title: t('file.unsavedChanges.title'),
      message: t('file.unsavedChanges.message', { fileName: fileName ?? t('file.untitled') }),
      detail: t('file.unsavedChanges.detail'),
      save: t('file.unsavedChanges.save'),
      dontSave: t('file.unsavedChanges.dontSave'),
      cancel: t('file.unsavedChanges.cancel')
    })
    if (result === 'cancel') return false // User cancelled
    if (result === 'save') {
      // Save first, then proceed
      const plainData = JSON.parse(JSON.stringify({ collections: rootFolders })) as unknown
      const dataForSave = prepareForSerialization(plainData)
      const saved = await saveFile(dataForSave)
      return saved // Only proceed if save was successful
    }
    return true // User chose to discard changes
  }, [showUnsavedChangesDialog, rootFolders, saveFile, t, fileName])

  // File menu handlers
  const handleMenuNew = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      await newFile()
    }
  }, [checkUnsavedChanges, newFile])

  const handleMenuOpen = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      setIsOpenedAsFolder(false)
      await openFile()
    }
  }, [checkUnsavedChanges, openFile])

  const handleMenuOpenFolder = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      // openFolder() will trigger FileService.setOpenedFolder() which broadcasts file:opened
      // handleFileOpened will then be called automatically via useFileEvents
      const result = await window.restorm?.file.openFolder()
      if (result?.success && result.path) {
        setIsOpenedAsFolder(true)
        // Use format from restorm.conf or default to yaml
        setFolderFormat(result.format ?? 'yaml')
        setCurrentFolderPath(result.path)
      }
    }
  }, [checkUnsavedChanges])

  const handleMenuClose = useCallback(async () => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      await closeFile()
    }
  }, [checkUnsavedChanges, closeFile])

  const handleOpenRecentFile = useCallback(async (path: string) => {
    const canProceed = await checkUnsavedChanges()
    if (canProceed) {
      // Close current file first to trigger cleanup (clear index, clear context)
      await closeFile()
      setIsOpenedAsFolder(false)
      await openFile(path)
    }
  }, [checkUnsavedChanges, closeFile, openFile])

  // Track the last loaded path to prevent double loading of the same file
  const lastLoadedPathRef = useRef<string | null>(null)
  const isLoadingRef = useRef(false)

  // Handler for file opened event - loads collections into workbench
  const handleFileOpened = useCallback((state: { currentFile: { content: unknown; path?: string | null; format?: string } }) => {
    const newPath = state.currentFile.path ?? null
    
    // Prevent double loading of the same file (but allow loading a different file)
    if (isLoadingRef.current && newPath === lastLoadedPathRef.current) {
      return
    }
    
    isLoadingRef.current = true
    lastLoadedPathRef.current = newPath

    const content = state.currentFile.content as { collections?: EnvironmentFolder[] } | null
    const collections = content?.collections && Array.isArray(content.collections) ? content.collections : []
    
    // Detect if opened as folder (path doesn't end with a file extension)
    const path = state.currentFile.path ?? ''
    const openedAsFolder = path !== '' && !/\.(json|yaml|yml|json5|restorm)$/i.test(path)
    setIsOpenedAsFolder(openedAsFolder)
    if (openedAsFolder) {
      // Use format from FileService state (read from restorm.conf) or default to yaml
      const format = state.currentFile.format as 'json' | 'yaml' | 'json5' | undefined
      setFolderFormat(format ?? 'yaml')
      setCurrentFolderPath(path)
    } else {
      setCurrentFolderPath(null)
    }
    
    // Clear previous tab dirty state
    clearTabDirtyState()
    
    // Generate runtime ids for all objects after deserialization
    const collectionsWithIds = processAfterDeserialization(collections)
    
    // Make folders reactive and update state
    const reactiveFolders = collectionsWithIds.map(
      (folder) => makeReactiveFolder(folder) as EnvironmentFolder
    )
    setRootFolders(reactiveFolders)
    
    // Register items for per-tab dirty state tracking (folder mode)
    if (openedAsFolder) {
      const registerAllItems = (items: FolderItem[]): void => {
        for (const item of items) {
          const itemChecksum = computeChecksum(JSON.parse(JSON.stringify(item)))
          registerTabDirtyState(item.id, itemChecksum)
          
          if (isAnyFolder(item)) {
            registerAllItems((item as Folder).items)
          }
        }
      }
      
      for (const folder of reactiveFolders) {
        const folderChecksum = computeChecksum(JSON.parse(JSON.stringify(folder)))
        registerTabDirtyState(folder.id, folderChecksum)
        registerAllItems(folder.items)
      }
    }
    
    // Register initial checksums for all objects (granular dirty state tracking)
    // Use JSON.parse(JSON.stringify()) to strip Proxy wrappers and ensure serializable data
    const objectsForChecksums = collectAllObjectsForChecksums(reactiveFolders)
    const serializableObjects = new Map<string, unknown>()
    for (const [id, data] of objectsForChecksums) {
      try {
        serializableObjects.set(id, JSON.parse(JSON.stringify(data)))
      } catch (e) {
        logger.warn('[App] Failed to serialize object for checksum', { id, error: e })
      }
    }
    logger.info('[App] About to register initial checksums', { count: serializableObjects.size })
    registerInitialChecksums(serializableObjects)
      .then(() => { logger.info('[App] Initial checksums registered successfully') })
      .catch((err: unknown) => { logger.error('[App] Failed to register initial checksums', { error: String(err) }) })
    
    // Also set legacy content checksum for backward compatibility
    const dataForChecksum = prepareForSerialization({ collections: reactiveFolders })
    void setContentChecksum(JSON.stringify(dataForChecksum))
    
    // Clear previous data, emit events, then re-index for search
    // This must be done in correct order: clear first, then emit, then index
    void (async () => {
      // 1. Clear previous data first
      await searchIndexService.clearIndex()
      await window.restorm?.context.clearAll()
      
      // 2. Emit ENVIRONMENT_CREATED events for all environments
      const emitEnvironmentCreated = (env: Environment, parentFolderId: string, parentEnvironmentId?: string): void => {
        const payload: DocumentChangedPayload = {
          id: env.id,
          type: 'environment',
          document: JSON.parse(JSON.stringify(env)),
          parentFolderId,
          parentEnvironmentId
        }
        eventBus.emitSync(DocumentEvents.ENVIRONMENT_CREATED, payload)
        // Recursively emit for sub-environments
        if (env.subEnvironments) {
          for (const subEnv of env.subEnvironments) {
            emitEnvironmentCreated(subEnv, parentFolderId, env.id)
          }
        }
      }

      for (const folder of reactiveFolders) {
        if (isEnvironmentFolder(folder as FolderItem)) {
          const envFolder = folder
          for (const env of envFolder.environments) {
            emitEnvironmentCreated(env, envFolder.id)
          }
        }
      }

      // 3. Initialize and index for search
      await searchIndexService.initialize()
      for (const folder of reactiveFolders) {
        await searchIndexService.indexFolderTree(folder)
      }

      // 4. Signal that loading is complete - dirty state events can now be processed
      await finishLoading()

      // Allow loading again (e.g., if user closes and reopens a file)
      isLoadingRef.current = false
    })()
  }, [clearTabDirtyState, registerTabDirtyState])

  // Handler for file closed event - clears the workbench
  const handleFileClosed = useCallback(() => {
    // Reset loading flags to allow loading a new file
    isLoadingRef.current = false
    lastLoadedPathRef.current = null
    // Reset folder mode flag
    setIsOpenedAsFolder(false)
    setCurrentFolderPath(null)
    // Clear the workbench tree
    setWorkbenchTree({
      orientation: 'vertical',
      groups: []
    })
    // Clear root folders
    setRootFolders([])
    // Clear search index
    void searchIndexService.clearIndex()
    // Clear context service data
    void window.restorm?.context.clearAll()
    // Clear per-tab dirty state
    clearTabDirtyState()
  }, [clearTabDirtyState])

  // Listen to file events (including from command line --open argument)
  useFileEvents(handleFileOpened, handleFileClosed)
  
  // Listen to test events for E2E tests (only in dev/test mode)
  // Expose handleFileOpened directly on window for E2E tests
  // This must be done outside useEffect to ensure it's available immediately
  const handleFileOpenedRef = useRef(handleFileOpened)
  useEffect(() => {
    handleFileOpenedRef.current = handleFileOpened
  }, [handleFileOpened])
  
  useEffect(() => {
    // Always expose test helpers in dev mode (Vite sets DEV=true)
    // In web mode via Playwright, mode is undefined, so we check both
    const isDev = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env?.DEV ?? false
    const mode = (import.meta as { env?: { MODE?: string } }).env?.MODE
    // Always expose if not in production build
    const shouldListen = isDev || mode === 'test' || mode === 'development' || mode === undefined
    
    if (!shouldListen) return
    
    // Expose immediately (don't wait for handleFileOpened to be ready)
    ;(window as unknown as { 
      __restormTestHelpers?: { 
        loadFile: (fileState: { currentFile: { content: unknown } }) => void
        setRootFolders: (folders: EnvironmentFolder[]) => void
      } 
    }).__restormTestHelpers = {
      loadFile: (fileState: { currentFile: { content: unknown } }) => {
        // Reset loading flags to allow loading
        isLoadingRef.current = false
        lastLoadedPathRef.current = null
        // Use ref to ensure we call the latest version
        handleFileOpenedRef.current(fileState)
      },
      setRootFolders: (folders: EnvironmentFolder[]) => {
        isLoadingRef.current = false
        lastLoadedPathRef.current = null
        // Make folders reactive before setting
        const reactiveFolders = folders.map(folder => makeReactiveFolder(folder) as EnvironmentFolder)
        setRootFolders(reactiveFolders)
        // Also trigger indexing
        void (async () => {
          await searchIndexService.clearIndex()
          await searchIndexService.initialize()
          for (const folder of reactiveFolders) {
            await searchIndexService.indexFolderTree(folder)
          }
        })()
      }
    }
    
    // Also listen to eventBus for backward compatibility
    const subscription = eventBus.subscribe('restorm:test:file-opened', (fileState: { currentFile: { content: unknown } }) => {
      isLoadingRef.current = false
      lastLoadedPathRef.current = null
      handleFileOpenedRef.current(fileState)
    })
    
    return () => {
      subscription.unsubscribe()
      delete (window as unknown as { __restormTestHelpers?: unknown }).__restormTestHelpers
    }
  }, []) // Empty deps - set up once on mount

  // Load file content on mount if a file is already open (e.g., after page refresh)
  const initialLoadDoneRef = useRef(false)
  useEffect(() => {
    // Only run once and only if file is open but rootFolders is empty
    if (initialLoadDoneRef.current) return
    if (!fileState?.currentFile.path) return
    if (rootFolders.length > 0) return
    
    // A file is open but content not loaded yet - load it
    initialLoadDoneRef.current = true
    const rafId = requestAnimationFrame(() => {
      handleFileOpened(fileState)
    })
    return (): void => { cancelAnimationFrame(rafId) }
  }, [fileState, rootFolders.length, handleFileOpened])

  // Counter to force re-render without breaking reactive proxies
  const [_updateCount, forceUpdate] = useState(0)
  void _updateCount // Suppress unused variable warning

  // Commit checksums when file is saved (isDirty becomes false)
  const wasDirtyRef = useRef(isDirty)
  useEffect(() => {
    // Detect save: was dirty, now not dirty
    if (wasDirtyRef.current && !isDirty && fileName) {
      // File was just saved - commit checksums (current becomes new baseline)
      void commitChecksums()
      logger.debug('[App] Checksums committed after save')
      // Also update legacy content checksum for backward compatibility
      const dataForChecksum = prepareForSerialization({ collections: rootFolders })
      void setContentChecksum(JSON.stringify(dataForChecksum))
      // Mark all tabs as saved (folder mode)
      markAllTabsSaved()
    }
    wasDirtyRef.current = isDirty
  }, [isDirty, fileName, rootFolders, markAllTabsSaved])

  // Listen to document changes and update per-tab dirty state (works in all modes)
  useEffect(() => {
    const handleFolderOrRequestUpdated = (payload: DocumentChangedPayload): void => {
      const newChecksum = computeChecksum(JSON.parse(JSON.stringify(payload.document)))
      updateTabDirtyChecksum(payload.id, newChecksum)
    }

    // For environments, we need to update the parent folder's dirty state
    const handleEnvironmentUpdated = (payload: DocumentChangedPayload): void => {
      // Find the parent environment folder and recalculate its checksum
      const parentFolderId = payload.parentFolderId
      if (parentFolderId) {
        // Find the folder in rootFolders
        const findFolder = (items: FolderItem[]): Folder | null => {
          for (const item of items) {
            if (isAnyFolder(item)) {
              if (item.id === parentFolderId) return item
              const found = findFolder((item as Folder).items)
              if (found) return found
            }
          }
          return null
        }
        
        for (const rootFolder of rootFolders) {
          if (rootFolder.id === parentFolderId) {
            const newChecksum = computeChecksum(JSON.parse(JSON.stringify(rootFolder)))
            updateTabDirtyChecksum(parentFolderId, newChecksum)
            return
          }
          const found = findFolder(rootFolder.items)
          if (found) {
            const newChecksum = computeChecksum(JSON.parse(JSON.stringify(found)))
            updateTabDirtyChecksum(parentFolderId, newChecksum)
            return
          }
        }
      }
    }

    const subscriptions = [
      eventBus.subscribe(DocumentEvents.FOLDER_UPDATED, handleFolderOrRequestUpdated),
      eventBus.subscribe(DocumentEvents.REQUEST_UPDATED, handleFolderOrRequestUpdated),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_UPDATED, handleEnvironmentUpdated)
    ]

    return () => {
      for (const sub of subscriptions) {
        sub.unsubscribe()
      }
    }
  }, [updateTabDirtyChecksum, rootFolders])

  // Dirty state is now handled by FileService in the main process
  // It subscribes to DocumentEvents and compares checksums automatically

  // Ref to track if search index has been initialized
  const searchIndexInitializedRef = useRef(false)

  // Initialize search index service and index folder on initial load
  useEffect(() => {
    if (searchIndexInitializedRef.current) return
    searchIndexInitializedRef.current = true
    
    void (async () => {
      await searchIndexService.initialize()
      // Index all root folders
      for (const folder of rootFolders) {
        await searchIndexService.indexFolderTree(folder)
      }
    })()
    
    // Note: No cleanup needed - the service sends data to main process
    // which handles the actual indexing and event subscriptions.
  }, [rootFolders])

  // Open a folder tab in the workbench
  const openFolderTab = useCallback((folder: Folder, breadcrumbs: BreadcrumbItem[]) => {
    const tabId = `folder-${folder.id}`

    // Register initial checksum for dirty state tracking
    const folderChecksum = computeChecksum(JSON.parse(JSON.stringify(folder)))
    registerTabDirtyState(folder.id, folderChecksum)

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
  }, [focusedGroupId, registerTabDirtyState])

  // Open an environment folder tab in the workbench
  const openEnvironmentFolderTab = useCallback((folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[]) => {
    const tabId = `env-folder-${folder.id}`

    // Register initial checksum for dirty state tracking
    const folderChecksum = computeChecksum(JSON.parse(JSON.stringify(folder)))
    registerTabDirtyState(folder.id, folderChecksum)

    setWorkbenchTree((prev) => {
      const newTab: EnvironmentFolderTab = {
        id: tabId,
        tabType: 'environment-folder',
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
  }, [focusedGroupId, registerTabDirtyState])

  // Open an HTTP request tab in the workbench
  // Generic function to open any request type tab
  const openAnyRequestTab = useCallback(
    (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[]) => {
    const tabId = `request-${request.id}`
    
    // Register initial checksum for dirty state tracking
    const requestChecksum = computeChecksum(JSON.parse(JSON.stringify(request)))
    registerTabDirtyState(request.id, requestChecksum)
    
    // Determine tab type and title based on request type
    let tabType: string
    let title: string
    
    if (isHTTPRequest(request)) {
      tabType = 'http-request'
      title = `${request.method} ${request.name}`
    } else if (isGraphQLRequest(request)) {
      tabType = 'graphql-request'
      title = `GraphQL ${request.name}`
    } else if (isGrpcRequest(request)) {
      tabType = 'grpc-request'
      title = `gRPC ${request.name}`
    } else if (isSoapRequest(request)) {
      tabType = 'soap-request'
      title = `SOAP ${request.name}`
    } else if (isWebSocketRequest(request)) {
      tabType = 'websocket-request'
      title = `WS ${request.name}`
    } else {
      return // Unknown request type
    }

    setWorkbenchTree((prev) => {
      const newTab = {
        id: tabId,
        tabType,
        title,
        titleString: title,
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
    [focusedGroupId, registerTabDirtyState]
  )

  // Rebuild tab callback for workbench autosave
  const handleRebuildTab = useCallback((tabId: string): EditorTab | null => {
    if (tabId.startsWith('env-folder-')) {
      const itemId = tabId.replace('env-folder-', '')
      const folder = findEnvironmentFolderById(rootFolders, itemId)
      if (folder) {
        const { breadcrumbs } = findItemWithBreadcrumbs(rootFolders, itemId)
        return {
          id: tabId,
          tabType: 'environment-folder',
          title: folder.name,
          titleString: folder.name,
          folder,
          breadcrumbs,
          allowFullscreen: true
        } as EnvironmentFolderTab
      }
    } else if (tabId.startsWith('folder-')) {
      const itemId = tabId.replace('folder-', '')
      const folder = findFolderById(rootFolders, itemId)
      if (folder && !isEnvironmentFolder(folder as FolderItem)) {
        const { breadcrumbs } = findItemWithBreadcrumbs(rootFolders, itemId)
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
      const { item, breadcrumbs } = findItemWithBreadcrumbs(rootFolders, itemId)
      if (item && isRequest(item)) {
        const environments = getNearestEnvironmentsForBreadcrumbs(rootFolders, breadcrumbs)
        
        if (isHTTPRequest(item)) {
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
        } else if (isGraphQLRequest(item)) {
          return {
            id: tabId,
            tabType: 'graphql-request',
            title: `GraphQL ${item.name}`,
            titleString: `GraphQL ${item.name}`,
            request: item,
            breadcrumbs,
            environments,
            allowFullscreen: true
          } as GraphQLRequestTab
        } else if (isGrpcRequest(item)) {
          return {
            id: tabId,
            tabType: 'grpc-request',
            title: `gRPC ${item.name}`,
            titleString: `gRPC ${item.name}`,
            request: item,
            breadcrumbs,
            environments,
            allowFullscreen: true
          } as GrpcRequestTab
        } else if (isSoapRequest(item)) {
          return {
            id: tabId,
            tabType: 'soap-request',
            title: `SOAP ${item.name}`,
            titleString: `SOAP ${item.name}`,
            request: item,
            breadcrumbs,
            environments,
            allowFullscreen: true
          } as SoapRequestTab
        } else if (isWebSocketRequest(item)) {
          return {
            id: tabId,
            tabType: 'websocket-request',
            title: `WS ${item.name}`,
            titleString: `WS ${item.name}`,
            request: item,
            breadcrumbs,
            environments,
            allowFullscreen: true
          } as WebSocketRequestTab
        }
      }
    }
    return null
  }, [rootFolders])

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
      if (params.type === 'folder' || params.type === 'environment-folder') {
        const folder = findFolderById(rootFolders, key)
        if (folder) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootFolders, key)
          if (isEnvironmentFolder(folder as FolderItem)) {
            openEnvironmentFolderTab(folder as EnvironmentFolder, breadcrumbs)
          } else {
            openFolderTab(folder, breadcrumbs)
          }
          // Focus the group containing the tab
          setFocusedGroupId('restorm-main-group')
        }
      } else if (params.type === 'http-request' || params.type === 'graphql-request' || 
                 params.type === 'grpc-request' || params.type === 'soap-request' || 
                 params.type === 'websocket-request') {
        const { item, breadcrumbs } = findItemWithBreadcrumbs(rootFolders, key)
        if (item && isRequest(item)) {
          const environments = getNearestEnvironmentsForBreadcrumbs(rootFolders, breadcrumbs)
          openAnyRequestTab(item, breadcrumbs, environments)
          // Focus the group containing the tab
          setFocusedGroupId('restorm-main-group')
        }
      }
    })

    return unsubscribe
  }, [openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, rootFolders])

  // Handle item click in the sidebar - use navigation service
  const handleItemClick = useCallback((itemId: string) => {
    const { item } = findItemWithBreadcrumbs(rootFolders, itemId)
    if (!item) return

    if (isEnvironmentFolder(item)) {
      // Open environment folder view
      navigationService.navigateTo(itemId, 'sidebar', { type: 'environment-folder' })
      return
    }

    if (isFolder(item)) {
      // Open folder view (same as "Define variables" context menu)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'folder' })
      return
    }

    if (isRequest(item)) {
      // Navigate to request - determine type from request
      if (isHTTPRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'http-request' })
      } else if (isGraphQLRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'graphql-request' })
      } else if (isGrpcRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'grpc-request' })
      } else if (isSoapRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'soap-request' })
      } else if (isWebSocketRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'websocket-request' })
      }
    }
  }, [rootFolders])

  // Handle drag & drop in the sidebar to reorder items
  const handleItemDrop = useCallback((payload: ListViewDropEventPayload) => {
    const sourceId = payload.source.id
    const targetId = payload.item.id
    const position = payload.position

    // Don't allow dropping an item onto itself
    if (sourceId === targetId) return

    // Don't allow dropping a root folder (they are top-level)
    const isRootFolder = rootFolders.some((f) => f.id === sourceId)
    if (isRootFolder) return

    // Don't allow dropping onto a root folder with 'before' or 'after' (only 'into')
    const isTargetRootFolder = rootFolders.some((f) => f.id === targetId)
    if (isTargetRootFolder && position !== 'into') return

    // Don't allow dropping a folder into one of its descendants
    const isDescendant = (parentId: string, childId: string): boolean => {
      const parent = findItemById(rootFolders, parentId)
      if (!parent || !isAnyFolder(parent)) return false
      for (const item of parent.items) {
        if (item.id === childId) return true
        if (isAnyFolder(item) && isDescendant(item.id, childId)) return true
      }
      return false
    }
    if (isDescendant(sourceId, targetId)) return

    // Remove the item from its current position
    const removedItem = removeItemFromTree(rootFolders, sourceId)
    if (!removedItem) return

    // Insert at the new position
    const inserted = insertItemIntoTree(rootFolders, removedItem, targetId, position)
    if (!inserted) {
      // If insertion failed, try to restore the item (this shouldn't happen)
      return
    }

    // Force React re-render by creating new reference
    setRootFolders((prevFolders) => [...prevFolders])

    // Update breadcrumbs in open workbench tabs
    setWorkbenchTree((prevTree) => {
      const group = prevTree.groups[0]
      if (!group || !isTabGroupNode(group)) return prevTree

      const updatedTabs = group.tabs.map((tab) => {
        const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

        // Get the item ID from the tab
        let itemId: string
        if (restormTab.tabType === 'folder') {
          itemId = restormTab.folder.id
        } else if (restormTab.tabType === 'environment-folder') {
          itemId = restormTab.folder.id
        } else {
          itemId = restormTab.request.id
        }

        // Recalculate breadcrumbs for this tab
        const { breadcrumbs: newBreadcrumbs } = findItemWithBreadcrumbs(rootFolders, itemId)
        if (newBreadcrumbs.length === 0) return tab

        // For HTTP request tabs, also recalculate environments
        if (restormTab.tabType === 'http-request') {
          const newEnvironments = getNearestEnvironmentsForBreadcrumbs(rootFolders, newBreadcrumbs)
          return {
            ...restormTab,
            breadcrumbs: newBreadcrumbs,
            environments: newEnvironments
          }
        }

        return {
          ...restormTab,
          breadcrumbs: newBreadcrumbs
        }
      })

      return {
        ...prevTree,
        groups: [{ ...group, tabs: updatedTabs }]
      }
    })
  }, [rootFolders])

  // Handle "Clone" context menu action
  const handleCloneItem = useCallback((itemId: string) => {
    // Don't allow cloning root folders
    const isRootFolder = rootFolders.some((f) => f.id === itemId)
    if (isRootFolder) return

    // Clone the item
    const clonedItem = cloneItemInTree(rootFolders, itemId)
    if (!clonedItem) return

    // Force React re-render by creating new reference
    setRootFolders((prevFolders) => [...prevFolders])
  }, [rootFolders])

  // State for sidebar editing (controlled rename mode)
  const [sidebarEditingItemId, setSidebarEditingItemId] = useState<string | null>(null)

  // Handle "Create subfolder" context menu action
  const handleCreateSubfolder = useCallback((parentFolderId: string) => {
    // Find the parent folder
    const parentFolder = findFolderById(rootFolders, parentFolderId)
    if (!parentFolder) return

    // Create a new folder
    const newFolder: Folder = {
      id: generateUniqueId(),
      name: 'New Folder',
      documentation: '',
      tags: [],
      configuration: {},
      items: []
    }

    // Add to parent folder
    parentFolder.items.push(newFolder)

    // Expand the parent folder to show the new subfolder
    setExpandedIds((prev) => Array.from(new Set([...prev, parentFolderId])))

    // Select the new folder
    setSelectedItemId(newFolder.id)

    // Force React re-render by creating new reference
    setRootFolders((prevFolders) => [...prevFolders])

    // Put the new folder in edit mode (after render)
    setTimeout(() => {
      setSidebarEditingItemId(newFolder.id)
    }, 0)
  }, [rootFolders])

  // State for delete confirmation modal
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean
    itemId: string
    itemName: string
    isFolder: boolean
  }>({ isOpen: false, itemId: '', itemName: '', isFolder: false })

  // Handle "Delete" context menu action - show confirmation
  const handleDeleteItem = useCallback((itemId: string) => {
    // Don't allow deleting root folders
    const isRootFolder = rootFolders.some((f) => f.id === itemId)
    if (isRootFolder) return

    // Find the item to get its name and type
    const item = findItemById(rootFolders, itemId)
    if (!item) return

    const isFolderItem = isAnyFolder(item)
    setDeleteConfirmation({
      isOpen: true,
      itemId,
      itemName: item.name,
      isFolder: isFolderItem
    })
  }, [rootFolders])

  // Confirm deletion
  const confirmDelete = useCallback(() => {
    const { itemId } = deleteConfirmation

    // Remove the item from the tree
    removeItemFromTree(rootFolders, itemId)

    // Close any tabs that reference the deleted item
    setWorkbenchTree((prevTree) => {
      const group = prevTree.groups[0]
      if (!group || !isTabGroupNode(group)) return prevTree

      const filteredTabs = group.tabs.filter((tab) => {
        const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

        // Check if the tab is the deleted item
        if (restormTab.tabType === 'folder' && restormTab.folder.id === itemId) return false
        if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === itemId) return false
        if (restormTab.tabType === 'http-request' && restormTab.request.id === itemId) return false

        // Check if the tab's breadcrumbs contain the deleted item (item is inside deleted folder)
        if (restormTab.breadcrumbs?.some((bc) => bc.id === itemId)) return false

        return true
      })

      // If no tabs left, remove the group entirely to show emptyFallback
      if (filteredTabs.length === 0) {
        return {
          ...prevTree,
          groups: []
        }
      }

      // Update activeTabId if current tab was closed
      let newActiveTabId: string = group.activeTabId ?? ''
      if (!filteredTabs.some((t) => t.id === group.activeTabId)) {
        const firstTabId = filteredTabs[0]?.id
        newActiveTabId = firstTabId ?? ''
      }

      return {
        ...prevTree,
        groups: [{ ...group, tabs: filteredTabs, activeTabId: newActiveTabId }]
      }
    })

    // Force React re-render
    setRootFolders((prevFolders) => [...prevFolders])

    // Close the confirmation modal
    setDeleteConfirmation((prev) => ({ ...prev, isOpen: false }))
  }, [deleteConfirmation, rootFolders])

  // Cancel deletion
  const cancelDelete = useCallback(() => {
    setDeleteConfirmation((prev) => ({ ...prev, isOpen: false }))
  }, [])

  // Handle item rename from sidebar ListView
  const handleSidebarItemRename = useCallback((payload: ListViewItemEventPayload, newName: string) => {
    const itemId = payload.item.id

    // Find and update the reactive object directly (triggers search re-indexing)
    const foundItem = findItemById(rootFolders, itemId)
    if (foundItem) {
      foundItem.name = newName
    }

    // Force React re-render by creating new reference
    setRootFolders((prevFolders) => [...prevFolders])

    // Also update the workbench tab title and breadcrumbs
    setWorkbenchTree((prevTree) => {
      const group = prevTree.groups[0]
      if (!group || !isTabGroupNode(group)) return prevTree

      const updatedTabs = group.tabs.map((tab) => {
        const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

        // Update tab title if it's the renamed item
        if (restormTab.tabType === 'folder' && restormTab.folder.id === itemId) {
          return {
            ...restormTab,
            title: newName,
            titleString: newName,
            folder: { ...restormTab.folder, name: newName },
            breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
              bc.id === itemId ? { ...bc, label: newName } : bc
            )
          }
        }

        if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === itemId) {
          return {
            ...restormTab,
            title: newName,
            titleString: newName,
            folder: { ...restormTab.folder, name: newName },
            breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
              bc.id === itemId ? { ...bc, label: newName } : bc
            )
          }
        }

        if (restormTab.tabType === 'http-request' && restormTab.request.id === itemId) {
          const newTitle = `${restormTab.request.method} ${newName}`
          return {
            ...restormTab,
            title: newTitle,
            titleString: newTitle,
            request: { ...restormTab.request, name: newName },
            breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
              bc.id === itemId ? { ...bc, label: newName } : bc
            )
          }
        }

        // Update breadcrumbs for other tabs that might reference this item
        if (restormTab.breadcrumbs) {
          const updatedBreadcrumbs = restormTab.breadcrumbs.map((bc) =>
            bc.id === itemId ? { ...bc, label: newName } : bc
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
  }, [rootFolders])

  // Handle search result click - navigate to the selected item
  const handleSearchResultClick = useCallback((result: SearchResult) => {
    if (result.navigation?.type === 'request' && result.navigation.requestId) {
      handleItemClick(result.navigation.requestId as string)
    } else if (result.navigation?.type === 'folder' && result.navigation.folderId) {
      handleItemClick(result.navigation.folderId as string)
    }
  }, [handleItemClick])

  // Convert root folders to ListView items (each root folder is a top-level node)
  const sidebarItems: ListViewItemData[] = useMemo(() => {
    const expandedSet = new Set(expandedIds)
    const options = {
      expandedIds: expandedSet,
      renderMethodBadge: (method: string) => (
        <Badge type={mapToBadgeType(method)} />
      ),
      renderProtocolBadge: (protocol: string, label?: string) => (
        <Badge type={mapToBadgeType(protocol)} label={label} />
      ),
      renderDeprecatedTitle: (name: string) => (
        <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{name}</span>
      )
    }
    // Each root folder becomes a top-level item in the sidebar
    return rootFolders.map((folder) => folderAsRootListViewItem(folder, options))
  }, [expandedIds, rootFolders])

  const sidebarItemsWithContextMenu: ListViewItemData[] = useMemo(
    () => attachContextMenus(sidebarItems, t, handleCloneItem, handleCreateSubfolder, handleDeleteItem),
    [sidebarItems, t, handleCloneItem, handleCreateSubfolder, handleDeleteItem]
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

    if (tabId.startsWith('env-folder-')) {
      itemId = tabId.replace('env-folder-', '')
      itemType = 'environment-folder'
    } else if (tabId.startsWith('folder-')) {
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

      // Determine item type by looking up in the root folders
      const foundItem = findFolderById(rootFolders, item.id)
      if (foundItem) {
        if (isEnvironmentFolder(foundItem as FolderItem)) {
          navigationService.navigateTo(item.id, 'breadcrumb', { type: 'environment-folder' })
        } else {
          navigationService.navigateTo(item.id, 'breadcrumb', { type: 'folder' })
        }
      } else {
        // It might be a request
        const { item: requestItem } = findItemWithBreadcrumbs(rootFolders, item.id)
        if (requestItem && isRequest(requestItem) && isHTTPRequest(requestItem)) {
          navigationService.navigateTo(item.id, 'breadcrumb', { type: 'http-request' })
        }
      }
    },
    [rootFolders]
  )

  // Handle item rename from breadcrumb
  const handleItemRename = useCallback(
    (item: BreadcrumbItem, newName: string) => {
      // Find and update the reactive object directly (triggers search re-indexing)
      const foundItem = findItemById(rootFolders, item.id)
      if (foundItem) {
        foundItem.name = newName
      }

      // Force React re-render by creating new reference
      setRootFolders((prevFolders) => [...prevFolders])

      // Also update the workbench tab title and breadcrumbs
      setWorkbenchTree((prevTree) => {
        const group = prevTree.groups[0]
        if (!group || !isTabGroupNode(group)) return prevTree

        const updatedTabs = group.tabs.map((tab) => {
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

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

          if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === item.id) {
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
    [rootFolders]
  )

  // Handle tags changes from Workbench (folders or HTTP requests)
  const handleTagsChange = useCallback((targetId: string, newTags: string[]) => {
    // Find and update the reactive object directly (triggers search re-indexing)
    const item = findItemById(rootFolders, targetId)
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
        const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

        if (restormTab.tabType === 'folder' && restormTab.folder.id === targetId) {
          return {
            ...restormTab,
            folder: { ...restormTab.folder, tags: newTags }
          }
        }

        if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === targetId) {
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
  }, [rootFolders])

  // Handle folder changes from FolderView
  const handleFolderChange = useCallback((folderId: string, updatedFolder: Folder) => {
    // Find and update the reactive folder directly to preserve proxies
    const reactiveFolder = findFolderById(rootFolders, folderId)
    if (reactiveFolder && !isEnvironmentFolder(reactiveFolder as FolderItem)) {
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
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab
          
          // Update folder tabs
          if (restormTab.tabType === 'folder' && restormTab.folder.id === folderId) {
            return {
              ...restormTab,
              folder: updatedFolder,
              title: updatedFolder.name,
              titleString: updatedFolder.name
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
  }, [rootFolders])

  // Handle environment folder changes from EnvironmentFolderView
  const handleEnvironmentFolderChange = useCallback((folderId: string, updatedFolder: EnvironmentFolder) => {
    // Find and update the reactive folder directly to preserve proxies
    const reactiveFolder = findEnvironmentFolderById(rootFolders, folderId)
    if (reactiveFolder) {
      // Update properties on the reactive object (triggers re-indexing)
      reactiveFolder.environments = updatedFolder.environments
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
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab
          
          // Update environment folder tabs
          if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === folderId) {
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
              const newEnvironments = getNearestEnvironmentsForBreadcrumbs(rootFolders, restormTab.breadcrumbs)
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
  }, [rootFolders])

  return (
    <AvailableVariablesProvider>
      <VariableTransformProvider>
        <div
          style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          backgroundColor: 'var(--editor-background)',
          color: 'var(--editor-foreground)'
        }}
      >
        <Titlebar
        title={fileName ? `Restorm - ${fileName}${isDirty ? ' *' : ''}` : t('app.title')}
        showSearchBar
        onSearchResultClick={handleSearchResultClick}
        renderSearchTooltipContent={renderSearchTooltipContent}
        renderSearchBadge={(method) => <Badge type={mapToBadgeType(method)} />}
        leftContent={
          <MenuBar>
            <MenuBarItem title={t('menuBar.file')}>
              <MenuItem title={t('menuBar.new')} shortcut="Ctrl+N" onClick={() => { void handleMenuNew() }} />
              <MenuItemSeparator />
              <MenuItem title={t('menuBar.open')} shortcut="Ctrl+O" onClick={() => { void handleMenuOpen() }} />
              <MenuItem title={t('menuBar.openFolder')} onClick={() => { void handleMenuOpenFolder() }} />
              {fileName && (
                <>
                  <MenuItemSeparator />
                  <MenuItem title={t('menuBar.save')} shortcut="Ctrl+S" onClick={handleMenuSave} />
                  <MenuItem title={t('menuBar.saveAs')} shortcut="Ctrl+Shift+S" onClick={handleMenuSaveAs} />
                </>
              )}
              {recentFiles.length > 0 && (
                <MenuItem title={t('menuBar.recentFiles')}>
                  {recentFiles.slice(0, 10).map((file) => (
                    <MenuItem
                      key={file.path}
                      title={file.name}
                      onClick={() => { void handleOpenRecentFile(file.path) }}
                    />
                  ))}
                </MenuItem>
              )}
              {favorites.length > 0 && (
                <MenuItem title={t('menuBar.favorites')}>
                  {favorites.map((file) => (
                    <MenuItem
                      key={file.path}
                      title={file.name}
                      onClick={() => { void handleOpenRecentFile(file.path) }}
                    />
                  ))}
                </MenuItem>
              )}
              {fileName && (
                <>
                  <MenuItemSeparator />
                  <MenuItem title={t('menuBar.close')} onClick={() => { void handleMenuClose() }} />
                </>
              )}
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
        {fileName && (
          <div
            style={{
              width: leftWidth,
              minWidth: MIN_LEFT_WIDTH,
              maxWidth: '70%',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderRight: '1px solid var(--sideBar-border)',
              backgroundColor: 'var(--sideBar-background)'
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
                onItemDrop={handleItemDrop}
                onItemRename={handleSidebarItemRename}
                editingItemId={sidebarEditingItemId}
                onEditingEnd={() => { setSidebarEditingItemId(null) }}
                onDeleteRequest={(payload) => { handleDeleteItem(payload.item.id) }}
              />
              </Pane>
            </SplitView>
          </div>
        )}

        <EnvironmentValuesProvider>
          <div
            style={{
              flex: 1,
              minWidth: RIGHT_MIN_WIDTH,
              minHeight: 0,
              display: 'flex'
            }}
          >
            <RestormWorkbench
              tree={workbenchTreeWithDirtyState}
              onTreeChange={handleTreeChange}
              focusedGroupId={focusedGroupId}
              onFocusedGroupChange={setFocusedGroupId}
              onTabActivate={handleTabActivate}
              onBreadcrumbClick={handleBreadcrumbClick}
              onItemRename={handleItemRename}
              onTagsChange={handleTagsChange}
              onFolderChange={handleFolderChange}
              onEnvironmentFolderChange={handleEnvironmentFolderChange}
              onSizesChange={handleSizesChange}
              emptyFallback={fileName ? <EmptyBench /> : <Welcome />}
              style={{ flex: 1 }}
              workbenchId={WORKBENCH_ID}
              autosave
              onRebuildTab={handleRebuildTab}
              onStateRestored={handleStateRestored}
              getRequestById={(id) => findRequestById(rootFolders, id)}
              getFolderById={(id) => findFolderById(rootFolders, id)}
              getEnvironmentFolderById={(id) => findEnvironmentFolderById(rootFolders, id)}
            />
          </div>
        </EnvironmentValuesProvider>

        {fileName && (
          <Sash
            orientation="vertical"
            layoutProvider={layoutProvider}
            onStart={handleSashStart}
            onChange={handleSashChange}
            size={4}
          />
        )}
      </div>

      <Statusbar>
        {filePath && <StatusbarElement title={filePath} />}
        <DesktopIndicator />
      </Statusbar>

      {/* Delete confirmation modal */}
      <Modal
        title={t('sidebar.deleteConfirm.title')}
        isOpen={deleteConfirmation.isOpen}
        onClose={cancelDelete}
        size="dialog"
      >
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0 }}>
            {deleteConfirmation.isFolder
              ? t('sidebar.deleteConfirm.folderMessage', { name: deleteConfirmation.itemName })
              : t('sidebar.deleteConfirm.itemMessage', { name: deleteConfirmation.itemName })}
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button secondary onClick={cancelDelete}>
              {t('sidebar.deleteConfirm.cancel')}
            </Button>
            <Button onClick={confirmDelete}>
              {t('sidebar.deleteConfirm.confirm')}
            </Button>
          </div>
        </div>
          </Modal>

          {/* Save Options Modal */}
          <SaveOptionsModal
            isOpen={showSaveOptionsModal}
            onClose={() => { setShowSaveOptionsModal(false) }}
            onSave={handleSaveWithOptions}
            rootFolder={rootFolders[0]}
          />
        </div>
      </VariableTransformProvider>
    </AvailableVariablesProvider>
  )
}

export default App
