import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Statusbar,
  StatusbarElement,
  VerticalSashContainer,
  isTabGroupNode,
  isContainerNode,
  useFileService,
  eventBus,
  logger,
  computeChecksum,
  useDirtyState,
  hasContentChanged,
  setContentChecksum,
  commitChecksums
} from 'electron-core-ui/renderer'
import { DocumentEvents, type DocumentChangedPayload } from './services/DocumentEvents'
import type { WorkbenchTree, GroupNode, EditorTab } from 'electron-core-ui/renderer'
import { Welcome } from './components/Welcome/Welcome'
import { EmptyBench } from './components/MainView/Workbench/EmptyBench'
import { RestormTitlebar } from './components/MainView/Titlebar/RestormTitlebar'
import { RestormSidebar } from './components/MainView/Sidebar/RestormSidebar'
import { RestormWorkbenchContainer } from './components/MainView/Workbench/RestormWorkbenchContainer'
import type { RestormWorkbenchHandle } from './components/MainView/Workbench/RestormWorkbench'
import { SaveOptionsModal } from './components/Modals/SaveOptionsModal'
import { DeleteConfirmationModal } from './components/Modals/DeleteConfirmationModal'
import { ImportModal } from './components/Modals/ImportModal'
import { AvailableVariablesProvider } from './contexts/AvailableVariablesContext'
import { VariableTransformProvider } from './contexts/VariableTransformContext'
import { collectAllFolderIds } from './services/FolderToListView'
import {
  findFolderById,
  findEnvironmentFolderById,
  findRequestById,
  findItemWithBreadcrumbs,
  getNearestEnvironmentsForBreadcrumbs
} from './utils/treeSearch'
import {
  findFirstTabGroupId,
  hasGroupWithId,
  findGroupIdForTab,
  updateGroupById
} from './utils/workbenchHelpers'
import { DesktopIndicator } from './components/MainView/DesktopIndicator'
import { useItemOperations } from './hooks/useItemOperations'
import { useNavigation } from './hooks/useNavigation'
import { useWorkbenchUpdates } from './hooks/useWorkbenchUpdates'
import { useSidebarState } from './hooks/useSidebarState'
import { useFileManagement } from './hooks/useFileManagement'
import { useImport } from './hooks/useImport'
import { prepareForSerialization } from './utils/serialization'
import { makeReactiveFolder } from './types/reactive'
import { searchIndexService } from './services/SearchIndexService'
import type {
  Folder,
  FolderItem,
  Environment,
  EnvironmentFolder,
  Request
} from './types/collections'
import {
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

const MIN_LEFT_WIDTH = 180
const RIGHT_MIN_WIDTH = 240

/** Workbench ID for persistence */
const WORKBENCH_ID = 'restorm-main-workbench'

// Initial root items - empty at startup, populated when opening a file
const initialRootItems: EnvironmentFolder[] = []

const allFolderIds = initialRootItems.flatMap((folder) => collectAllFolderIds(folder))

const App: React.FC = () => {
  const { t } = useTranslation()
  const {
    state: fileState,
    fileName,
    filePath,
    isDirty,
    recentFiles,
    favorites,
    isLoading: isFileServiceLoading,
    newFile: _newFile,
    open: _openFile,
    save: saveFile,
    close: _closeFile,
    showUnsavedChangesDialog
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

  // Root items data (mutable for renaming)
  // Can contain EnvironmentFolders, Folders, or standalone Requests
  const [rootItems, setRootItems] = useState<(EnvironmentFolder | Folder | Request)[]>(initialRootItems)

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
  const workbenchRef = useRef<RestormWorkbenchHandle>(null)
  const hasRestoredWorkbenchRef = useRef(false)

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

  // Use file management hook
  const {
    handleMenuNew,
    handleMenuOpen,
    handleMenuOpenFolder,
    handleMenuSave,
    handleMenuSaveAs,
    handleMenuClose,
    handleOpenRecentFile,
    handleSaveWithOptions,
    handleFileOpened,
    handleFileClosed,
    showSaveOptionsModal,
    setShowSaveOptionsModal,
    isOpenedAsFolder: _isOpenedAsFolder,
    setIsOpenedAsFolder: _setIsOpenedAsFolder,
    folderFormat: _folderFormat,
    setFolderFormat: _setFolderFormat,
    currentFolderPath: _currentFolderPath,
    setCurrentFolderPath: _setCurrentFolderPath
  } = useFileManagement({
    rootItems,
    setRootItems,
    setWorkbenchTree,
    clearTabDirtyState,
    registerTabDirtyState,
    markAllTabsSaved,
    t
  })

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false)

  // Use import hook
  const { handleImport } = useImport({
    rootItems,
    setRootItems
  })

  const findIndexPathById = useCallback(function findIndexPathByIdInner(
    items: FolderItem[],
    targetId: string
  ): number[] | null {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item) continue
      if (item.id === targetId) {
        return [i]
      }
      if (isAnyFolder(item)) {
        const childPath = findIndexPathByIdInner(item.items, targetId)
        if (childPath) {
          return [i, ...childPath]
        }
      }
    }
    return null
  }, [])

  const buildTabId = useCallback((prefix: 'folder' | 'env-folder' | 'request', id: string): string => {
    const indexPath = findIndexPathById(rootItems as FolderItem[], id)
    if (!indexPath) {
      return `${prefix}-id:${id}`
    }
    return `${prefix}-idx:${indexPath.join('.')}`
  }, [findIndexPathById, rootItems])

  const getTabRuntimeId = useCallback((tab: EditorTab): string | null => {
    const typed = tab as { tabType?: string; folder?: { id: string }; request?: { id: string } }
    if (typed.tabType === 'folder' || typed.tabType === 'environment-folder') {
      return typed.folder?.id ?? null
    }
    if (typed.tabType?.endsWith('request')) {
      return typed.request?.id ?? null
    }
    return null
  }, [])

  // Compute workbench tree with dirty states applied to all tabs
  // This is computed during render, not in an effect, to avoid cascading renders
  const workbenchTreeWithDirtyState = useMemo((): WorkbenchTree => {
    const updateGroups = (groups: GroupNode[]): GroupNode[] => {
      return groups.map(group => {
        if (isTabGroupNode(group)) {
          const updatedTabs = group.tabs.map(tab => {
            const itemId = getTabRuntimeId(tab)
            const shouldBeDirty = itemId ? dirtyItemIdsSet.has(itemId) : false
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
  }, [workbenchTree, dirtyItemIdsSet, getTabRuntimeId])

  // State for sidebar editing and delete confirmation
  const [sidebarEditingItemId, setSidebarEditingItemId] = useState<string | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean
    itemId: string
    itemName: string
    isFolder: boolean
  }>({ isOpen: false, itemId: '', itemName: '', isFolder: false })

  // Use custom hooks for various concerns
  const {
    handleItemDrop,
    handleCloneItem,
    handleCreateSubfolder,
    handleDeleteItem,
    confirmDelete: confirmDeleteWithId,
    cancelDelete,
    handleSidebarItemRename
  } = useItemOperations({
    rootItems,
    setRootItems,
    setExpandedIds,
    setSelectedItemId,
    setSidebarEditingItemId,
    setWorkbenchTree,
    setDeleteConfirmation
  })

  const {
    handleTagsChange,
    handleFolderChange,
    handleEnvironmentFolderChange,
    handleItemRename
  } = useWorkbenchUpdates({
    rootItems,
    setWorkbenchTree
  })

  const { sidebarItems: sidebarItemsWithContextMenu } = useSidebarState({
    rootItems,
    expandedIds,
    onCloneItem: handleCloneItem,
    onCreateSubfolder: handleCreateSubfolder,
    onDeleteItem: handleDeleteItem
  })

  // Wrapper for confirmDelete that uses deleteConfirmation.itemId
  const confirmDelete = useCallback(() => {
    confirmDeleteWithId(deleteConfirmation.itemId)
  }, [confirmDeleteWithId, deleteConfirmation.itemId])

  // File save handlers (after rootItems is defined)
  // Deep clone to remove Proxy wrappers before IPC serialization

  // Listen for save-and-close event from main process (when closing window with unsaved changes)
  useEffect(() => {
    const handleSaveAndClose = async (): Promise<void> => {
      const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as { collections: unknown[] }
      const dataForSave = prepareForSerialization(plainData) as { collections: unknown[] }
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
  }, [rootItems, saveFile])

  // Helper to check for unsaved changes before proceeding
  const _checkUnsavedChanges = useCallback(async (): Promise<boolean> => {
    // Compare current state with saved state checksum via FileService
    // Use the same structure as the file content for consistent comparison (without runtime ids)
    const dataForChecksum = prepareForSerialization({ collections: rootItems }) as { collections: unknown[] }
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
      const plainData = JSON.parse(JSON.stringify({ collections: rootItems })) as { collections: unknown[] }
      const dataForSave = prepareForSerialization(plainData) as { collections: unknown[] }
      const saved = await saveFile(dataForSave)
      return saved // Only proceed if save was successful
    }
    return true // User chose to discard changes
  }, [showUnsavedChangesDialog, rootItems, saveFile, t, fileName])

  // Restore file state on initial load (e.g., after page refresh)
  const hasRestoredFileRef = useRef(false)
  
  useEffect(() => {
    // Wait for FileService to finish loading
    if (isFileServiceLoading) return
    
    // Only restore once on initial mount
    if (hasRestoredFileRef.current) return
    
    // Check if a file is already open
    const currentFile = fileState?.currentFile
    if (currentFile?.path && currentFile.content) {
      hasRestoredFileRef.current = true
      handleFileOpened({
        currentFile: {
          content: currentFile.content,
          path: currentFile.path,
          format: currentFile.format
        }
      })
      
    } else {
      // No file open, mark as restored to avoid re-checking
      hasRestoredFileRef.current = true
    }
  }, [isFileServiceLoading, fileState, handleFileOpened])

  // Listen to file events from FileService via IPC
  useEffect(() => {
    const w = window as unknown as { api?: { file?: { onFileOpened: (callback: (state: { currentFile: { content: unknown; path?: string | null; format?: string } }) => void) => () => void; onFileClosed: (callback: () => void) => () => void } } }
    const api = w.api?.file
    if (!api) return

    const unsubscribe1 = api.onFileOpened((state: { currentFile: { content: unknown; path?: string | null; format?: string } }) => {
      // Mark as restored when a new file is opened via IPC
      hasRestoredFileRef.current = true
      handleFileOpened(state)
    })
    const unsubscribe2 = api.onFileClosed(() => {
      // Reset restore flags when file is closed
      hasRestoredFileRef.current = false
      hasRestoredWorkbenchRef.current = false
      handleFileClosed()
    })
    
    return () => {
      unsubscribe1()
      unsubscribe2()
    }
  }, [handleFileOpened, handleFileClosed])

  // Restore workbench state after rootItems are available (autosave relies on onRebuildTab)
  useEffect(() => {
    if (!filePath || rootItems.length === 0 || hasRestoredWorkbenchRef.current) return
    hasRestoredWorkbenchRef.current = true
    void (async (): Promise<void> => {
      try {
        const restoredTree = await workbenchRef.current?.loadState()
        if (restoredTree) {
          requestAnimationFrame(() => {
            setWorkbenchTree(restoredTree)
          })
        }
      } catch (error) {
        logger.warn('[App] Failed to restore workbench state', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })()
  }, [filePath, rootItems])

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
        setRootItems: (folders: EnvironmentFolder[]) => void
      } 
    }).__restormTestHelpers = {
      loadFile: (fileState: { currentFile: { content: unknown } }) => {
        // Use ref to ensure we call the latest version
        handleFileOpenedRef.current(fileState)
      },
      setRootItems: (folders: EnvironmentFolder[]) => {
        // Make folders reactive before setting
        const reactiveItems = folders.map(folder => makeReactiveFolder(folder) as EnvironmentFolder)
        setRootItems(reactiveItems)
        // Also trigger indexing
        void (async (): Promise<void> => {
          await searchIndexService.clearIndex()
          await searchIndexService.initialize()
          for (const folder of reactiveItems) {
            await searchIndexService.indexFolderTree(folder)
          }
        })()
      }
    }
    
    // Also listen to eventBus for backward compatibility
    const subscription = eventBus.subscribe('restorm:test:file-opened', (fileState: { currentFile: { content: { collections?: unknown[] } } }) => {
      handleFileOpenedRef.current(fileState)
    })
    
    return () => {
      subscription.unsubscribe()
      delete (window as unknown as { __restormTestHelpers?: unknown }).__restormTestHelpers
    }
  }, []) // Empty deps - set up once on mount

  // Commit checksums when file is saved (isDirty becomes false)
  const wasDirtyRef = useRef(isDirty)
  useEffect(() => {
    // Detect save: was dirty, now not dirty
    if (wasDirtyRef.current && !isDirty && fileName) {
      // File was just saved - commit checksums (current becomes new baseline)
      void commitChecksums().catch((err: unknown) => {
        logger.error('[App] Failed to commit checksums', { error: String(err) })
      })
      logger.debug('[App] Checksums committed after save')
      // Also update legacy content checksum for backward compatibility
      const dataForChecksum = prepareForSerialization({ collections: rootItems }) as { collections: unknown[] }
      void setContentChecksum(JSON.stringify(dataForChecksum)).catch((err: unknown) => {
        logger.error('[App] Failed to set content checksum', { error: String(err) })
      })
      // Mark all tabs as saved (folder mode)
      markAllTabsSaved()
    }
    wasDirtyRef.current = isDirty
  }, [isDirty, fileName, rootItems, markAllTabsSaved])

  // Listen to document changes and update per-tab dirty state (works in all modes)
  useEffect(() => {
    const handleFolderOrRequestUpdated = (payload: DocumentChangedPayload): void => {
      const newChecksum = computeChecksum(JSON.parse(JSON.stringify(payload.document)) as FolderItem)
      updateTabDirtyChecksum(payload.id, newChecksum)
    }

    // For environments, we need to update the parent folder's dirty state
    const handleEnvironmentUpdated = (payload: DocumentChangedPayload): void => {
      // Find the parent environment folder and recalculate its checksum
      const parentFolderId = payload.parentFolderId
      if (!parentFolderId) return
      
      // Find the folder in rootItems
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
      
      for (const rootFolder of rootItems) {
        if (rootFolder.id === parentFolderId) {
          const newChecksum = computeChecksum(JSON.parse(JSON.stringify(rootFolder)) as EnvironmentFolder | Folder | Request)
          updateTabDirtyChecksum(parentFolderId, newChecksum)
          return
        }
        // Only search in folders, not Requests
        if ('items' in rootFolder) {
          const found = findFolder(rootFolder.items)
          if (found) {
            const newChecksum = computeChecksum(JSON.parse(JSON.stringify(found)) as Folder)
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
  }, [updateTabDirtyChecksum, rootItems])

  // Dirty state is now handled by FileService in the main process
  // It subscribes to DocumentEvents and compares checksums automatically

  // Open a folder tab in the workbench
  const openFolderTab = useCallback((folder: Folder, breadcrumbs: BreadcrumbItem[]) => {
    const tabId = buildTabId('folder', folder.id)

    // Register initial checksum for dirty state tracking
    const folderChecksum = computeChecksum(JSON.parse(JSON.stringify(folder)) as Folder)
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
  }, [buildTabId, focusedGroupId, registerTabDirtyState])

  // Open an environment folder tab in the workbench
  const openEnvironmentFolderTab = useCallback((folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[]) => {
    const tabId = buildTabId('env-folder', folder.id)

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
  }, [buildTabId, focusedGroupId, registerTabDirtyState])

  // Open an HTTP request tab in the workbench
  // Generic function to open any request type tab
  const openAnyRequestTab = useCallback(
    (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[]) => {
    const tabId = buildTabId('request', request.id)
    
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
    [buildTabId, focusedGroupId, registerTabDirtyState]
  )

  const parseTabId = useCallback((tabId: string): { type: 'folder' | 'env-folder' | 'request'; indexPath?: number[]; legacyId?: string } | null => {
    const indexMatch = /^(folder|env-folder|request)-idx:([0-9]+(?:\.[0-9]+)*)$/.exec(tabId)
    if (indexMatch?.[1] && indexMatch[2]) {
      return {
        type: indexMatch[1] as 'folder' | 'env-folder' | 'request',
        indexPath: indexMatch[2].split('.').map((part) => Number(part))
      }
    }
    const legacyMatch = /^(folder|env-folder|request)-id:(.+)$/.exec(tabId)
    if (legacyMatch?.[1] && legacyMatch[2]) {
      return {
        type: legacyMatch[1] as 'folder' | 'env-folder' | 'request',
        legacyId: legacyMatch[2]
      }
    }
    const oldMatch = /^(folder|env-folder|request)-(.+)$/.exec(tabId)
    if (oldMatch?.[1] && oldMatch[2]) {
      return {
        type: oldMatch[1] as 'folder' | 'env-folder' | 'request',
        legacyId: oldMatch[2]
      }
    }
    return null
  }, [])

  const findItemByIndexPath = useCallback((items: FolderItem[], indexPath: number[]): FolderItem | null => {
    if (indexPath.length === 0) return null
    const firstIndex = indexPath[0]
    if (firstIndex === undefined) return null
    let current: FolderItem | undefined = items[firstIndex]
    for (let i = 1; i < indexPath.length; i += 1) {
      if (!current || !isAnyFolder(current)) {
        return null
      }
      const nextIndex = indexPath[i]
      if (nextIndex === undefined) return null
      current = current.items[nextIndex]
    }
    return current ?? null
  }, [])

  // Rebuild tab callback for workbench autosave
  const handleRebuildTab = useCallback((tabId: string): EditorTab | null => {
    const parsed = parseTabId(tabId)
    if (!parsed) return null

    if (parsed.type === 'env-folder') {
      if (parsed.indexPath) {
        const item = findItemByIndexPath(rootItems as FolderItem[], parsed.indexPath)
        if (item && isEnvironmentFolder(item)) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, item.id)
          return {
            id: tabId,
            tabType: 'environment-folder',
            title: item.name,
            titleString: item.name,
            folder: item,
            breadcrumbs,
            allowFullscreen: true
          } as EnvironmentFolderTab
        }
      } else if (parsed.legacyId) {
        const folder = findEnvironmentFolderById(rootItems, parsed.legacyId)
        if (folder) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, folder.id)
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
      }
      return null
    }

    if (parsed.type === 'folder') {
      if (parsed.indexPath) {
        const item = findItemByIndexPath(rootItems as FolderItem[], parsed.indexPath)
        if (item && isAnyFolder(item) && !isEnvironmentFolder(item)) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, item.id)
          return {
            id: tabId,
            tabType: 'folder',
            title: item.name,
            titleString: item.name,
            folder: item,
            breadcrumbs,
            allowFullscreen: true
          } as FolderTab
        }
      } else if (parsed.legacyId) {
        const folder = findFolderById(rootItems, parsed.legacyId)
        if (folder && !isEnvironmentFolder(folder as FolderItem)) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, folder.id)
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
      }
      return null
    }

    let requestItem: FolderItem | null = null
    if (parsed.indexPath) {
      requestItem = findItemByIndexPath(rootItems as FolderItem[], parsed.indexPath)
    } else if (parsed.legacyId) {
      requestItem = findRequestById(rootItems, parsed.legacyId) ?? null
    }
    if (requestItem && isRequest(requestItem)) {
      const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, requestItem.id)
      const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
      
      if (isHTTPRequest(requestItem)) {
        return {
          id: tabId,
          tabType: 'http-request',
          title: `${requestItem.method} ${requestItem.name}`,
          titleString: `${requestItem.method} ${requestItem.name}`,
          request: requestItem,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as HTTPRequestTab
      }
      if (isGraphQLRequest(requestItem)) {
        return {
          id: tabId,
          tabType: 'graphql-request',
          title: `GraphQL ${requestItem.name}`,
          titleString: `GraphQL ${requestItem.name}`,
          request: requestItem,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as GraphQLRequestTab
      }
      if (isGrpcRequest(requestItem)) {
        return {
          id: tabId,
          tabType: 'grpc-request',
          title: `gRPC ${requestItem.name}`,
          titleString: `gRPC ${requestItem.name}`,
          request: requestItem,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as GrpcRequestTab
      }
      if (isSoapRequest(requestItem)) {
        return {
          id: tabId,
          tabType: 'soap-request',
          title: `SOAP ${requestItem.name}`,
          titleString: `SOAP ${requestItem.name}`,
          request: requestItem,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as SoapRequestTab
      }
      if (isWebSocketRequest(requestItem)) {
        return {
          id: tabId,
          tabType: 'websocket-request',
          title: `WS ${requestItem.name}`,
          titleString: `WS ${requestItem.name}`,
          request: requestItem,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as WebSocketRequestTab
      }
    }
    return null
  }, [findItemByIndexPath, parseTabId, rootItems])

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

  // Use navigation hook for handling clicks and breadcrumbs
  const {
    handleItemClick,
    handleBreadcrumbClick,
    handleTabActivate,
    handleSearchResultClick
  } = useNavigation({
    rootItems,
    openFolderTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    setSelectedItemId,
    setFocusedGroupId,
    getNearestEnvironmentsForBreadcrumbs
  })

  const handleTreeChange = useCallback((newTree: WorkbenchTree) => {
    setWorkbenchTree(newTree)
  }, [])

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
        <RestormTitlebar
        fileName={fileName}
        isDirty={isDirty}
        recentFiles={recentFiles}
        favorites={favorites}
        onNew={() => { void handleMenuNew() }}
        onOpen={() => { void handleMenuOpen() }}
        onOpenFolder={() => { void handleMenuOpenFolder() }}
        onSave={handleMenuSave}
        onSaveAs={handleMenuSaveAs}
        onClose={() => { void handleMenuClose() }}
        onExit={handleMenuExit}
        onImport={() => { setShowImportModal(true) }}
        onOpenRecentFile={(path) => { void handleOpenRecentFile(path) }}
        onSearchResultClick={handleSearchResultClick}
      />

      {fileName ? (
        <VerticalSashContainer
          Left={
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                minWidth: 0,
                minHeight: 0,
                height: '100%'
              }}
            >
              <RestormSidebar
                items={sidebarItemsWithContextMenu}
                selectedItemId={selectedItemId}
                expandedIds={expandedIds}
                editingItemId={sidebarEditingItemId}
                onItemClick={handleItemClick}
                onItemToggle={(payload, expanded) => {
                  const id = payload.item.id
                  if (!id) return
                  setExpandedIds((prev) =>
                    expanded
                      ? Array.from(new Set([...prev, id]))
                      : prev.filter((existingId) => existingId !== id)
                  )
                }}
                onItemDrop={handleItemDrop}
                onItemRename={handleSidebarItemRename}
                onDeleteRequest={(payload) => { handleDeleteItem(payload.item.id) }}
                onEditingEnd={() => { setSidebarEditingItemId(null) }}
                onAddRequest={() => { setShowImportModal(true) }}
                onCollapseAll={() => { setExpandedIds([]) }}
              />
            </div>
          }
          Right={
            <RestormWorkbenchContainer
              workbenchRef={workbenchRef}
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
              emptyFallback={<EmptyBench />}
              workbenchId={WORKBENCH_ID}
              onRebuildTab={handleRebuildTab}
              onStateRestored={handleStateRestored}
              getRequestById={(id) => findRequestById(rootItems, id)}
              getFolderById={(id) => findFolderById(rootItems, id)}
              getEnvironmentFolderById={(id) => findEnvironmentFolderById(rootItems, id)}
            />
          }
          initialWidth={260}
          minLeftWidth={MIN_LEFT_WIDTH}
          minRightWidth={RIGHT_MIN_WIDTH}
          storageKey="restorm-sidebar-width"
          sashConfig={{ size: 4, className: 'always-visible' }}
          className="restorm-main-container"
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <RestormWorkbenchContainer
            workbenchRef={workbenchRef}
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
            emptyFallback={<Welcome />}
            workbenchId={WORKBENCH_ID}
            onRebuildTab={handleRebuildTab}
            onStateRestored={handleStateRestored}
            getRequestById={(id) => findRequestById(rootItems, id)}
            getFolderById={(id) => findFolderById(rootItems, id)}
            getEnvironmentFolderById={(id) => findEnvironmentFolderById(rootItems, id)}
          />
        </div>
      )}

      <Statusbar>
        {filePath && <StatusbarElement title={filePath} />}
        <DesktopIndicator />
      </Statusbar>

      {/* Delete confirmation modal */}
      <DeleteConfirmationModal
        isOpen={deleteConfirmation.isOpen}
        itemName={deleteConfirmation.itemName}
        isFolder={deleteConfirmation.isFolder}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

          {/* Save Options Modal */}
          <SaveOptionsModal
            isOpen={showSaveOptionsModal}
            onClose={() => { setShowSaveOptionsModal(false) }}
            onSave={handleSaveWithOptions}
            rootFolder={rootItems[0]}
          />

          {/* Import Modal */}
          <ImportModal
            isOpen={showImportModal}
            onClose={() => { setShowImportModal(false) }}
            onImport={handleImport}
            rootFolder={{
              id: '__virtual_root__',
              name: 'Root',
              items: rootItems
            } as EnvironmentFolder}
            selectedFolderId={selectedItemId ?? undefined}
          />
        </div>
      </VariableTransformProvider>
    </AvailableVariablesProvider>
  )
}

export default App
