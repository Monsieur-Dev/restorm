import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Statusbar,
  StatusbarElement,
  Sash,
  isTabGroupNode,
  isContainerNode,
  navigationService,
  useFileService,
  useVerticalSash,
  eventBus,
  logger,
  computeChecksum,
  useDirtyState,
  hasContentChanged,
  setContentChecksum,
  registerInitialChecksums,
  commitChecksums,
  finishLoading
} from 'electron-core-ui/renderer'
import { DocumentEvents, type DocumentChangedPayload } from './services/DocumentEvents'
import type { WorkbenchTree, NavigationEvent, GroupNode, EditorTab } from 'electron-core-ui/renderer'
import { Welcome } from './components/Welcome/Welcome'
import { EmptyBench } from './components/MainView/Workbench/EmptyBench'
import { RestormTitlebar } from './components/MainView/Titlebar/RestormTitlebar'
import { RestormSidebar } from './components/MainView/Sidebar/RestormSidebar'
import { RestormWorkbenchContainer } from './components/MainView/Workbench/RestormWorkbenchContainer'
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
import { prepareForSerialization, processAfterDeserialization } from './utils/serialization'
import { makeReactiveFolder } from './types/reactive'
import { collectAllObjectsForChecksums } from './utils/checksumHelpers'
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
    showSaveOptionsModal,
    setShowSaveOptionsModal,
    isOpenedAsFolder: _isOpenedAsFolder,
    setIsOpenedAsFolder,
    folderFormat: _folderFormat,
    setFolderFormat,
    currentFolderPath: _currentFolderPath,
    setCurrentFolderPath
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
      const format = state.currentFile.format
      setFolderFormat((format ?? 'yaml') as 'json' | 'yaml' | 'json5')
      setCurrentFolderPath(path)
    } else {
      setCurrentFolderPath(null)
    }
    
    // Clear previous tab dirty state
    clearTabDirtyState()
    
    // Generate runtime ids for all objects after deserialization
    const collectionsWithIds = processAfterDeserialization(collections)
    
    // Make folders reactive and update state
    const reactiveItems = collectionsWithIds.map(
      (folder) => makeReactiveFolder(folder) as EnvironmentFolder
    )
    setRootItems(reactiveItems)
    
    // Register items for per-tab dirty state tracking (folder mode)
    if (openedAsFolder) {
      const registerAllItems = (items: FolderItem[]): void => {
        for (const item of items) {
          const itemChecksum = computeChecksum(JSON.parse(JSON.stringify(item)) as FolderItem)
          registerTabDirtyState(item.id, itemChecksum)
          
          if (isAnyFolder(item)) {
            registerAllItems((item as Folder).items)
          }
        }
      }
      
      for (const folder of reactiveItems) {
        const folderChecksum = computeChecksum(JSON.parse(JSON.stringify(folder)) as EnvironmentFolder)
        registerTabDirtyState(folder.id, folderChecksum)
        registerAllItems(folder.items)
      }
    }
    
    // Register initial checksums for all objects (granular dirty state tracking)
    // Use JSON.parse(JSON.stringify()) to strip Proxy wrappers and ensure serializable data
    const objectsForChecksums = collectAllObjectsForChecksums(reactiveItems)
    const serializableObjects = new Map<string, unknown>()
    for (const [id, data] of objectsForChecksums) {
      try {
        serializableObjects.set(id, JSON.parse(JSON.stringify(data)) as unknown)
      } catch (e) {
        logger.warn('[App] Failed to serialize object for checksum', { id, error: String(e) })
      }
    }
    logger.info('[App] About to register initial checksums', { count: serializableObjects.size })
    void registerInitialChecksums(serializableObjects)
      .then(() => { logger.info('[App] Initial checksums registered successfully') })
      .catch((err: unknown) => { logger.error('[App] Failed to register initial checksums', { error: String(err) }) })
    
    // Also set legacy content checksum for backward compatibility
    const dataForChecksum = prepareForSerialization({ collections: reactiveItems }) as { collections: unknown[] }
    void setContentChecksum(JSON.stringify(dataForChecksum))
    
    // Clear previous data, emit events, then re-index for search
    // This must be done in correct order: clear first, then emit, then index
    void (async (): Promise<void> => {
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

      for (const folder of reactiveItems) {
        if (isEnvironmentFolder(folder as FolderItem)) {
          const envFolder = folder
          for (const env of envFolder.environments) {
            emitEnvironmentCreated(env, envFolder.id)
          }
        }
      }

      // 3. Initialize and index for search
      await searchIndexService.initialize()
      for (const folder of reactiveItems) {
        await searchIndexService.indexFolderTree(folder)
      }

      // 4. Signal that loading is complete - dirty state events can now be processed
      await finishLoading()

      // Allow loading again (e.g., if user closes and reopens a file)
      isLoadingRef.current = false
    })()
  }, [clearTabDirtyState, registerTabDirtyState, setCurrentFolderPath, setFolderFormat, setIsOpenedAsFolder])

  // Handler for file closed event - clears the workbench
  const handleFileClosed = useCallback(() => {
    // Reset loading flags to allow loading a new file
    isLoadingRef.current = false
    lastLoadedPathRef.current = null
    // Clear the workbench tree
    setWorkbenchTree({
      orientation: 'vertical',
      groups: []
    })
    // Clear root folders
    setRootItems([])
    // Clear search index
    void searchIndexService.clearIndex().catch((err: unknown) => {
      logger.error('[App] Failed to clear search index', { error: String(err) })
    })
    // Clear context service data
    void window.restorm?.context.clearAll()
    // Clear per-tab dirty state
    clearTabDirtyState()
  }, [clearTabDirtyState])

  // Listen to file events from FileService
  useEffect(() => {
    const subscription1 = eventBus.subscribe('file:opened', (state: { currentFile: { content: unknown; path?: string | null; format?: string } }) => {
      handleFileOpened(state)
    })
    const subscription2 = eventBus.subscribe('file:closed', () => {
      handleFileClosed()
    })
    
    return () => {
      subscription1.unsubscribe()
      subscription2.unsubscribe()
    }
  }, [handleFileOpened, handleFileClosed])

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
        // Reset loading flags to allow loading
        isLoadingRef.current = false
        lastLoadedPathRef.current = null
        // Use ref to ensure we call the latest version
        handleFileOpenedRef.current(fileState)
      },
      setRootItems: (folders: EnvironmentFolder[]) => {
        isLoadingRef.current = false
        lastLoadedPathRef.current = null
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
    // Only run once and only if file is open but rootItems is empty
    if (initialLoadDoneRef.current) return
    if (!fileState?.currentFile.path) return
    if (rootItems.length > 0) return
    
    // A file is open but content not loaded yet - load it
    initialLoadDoneRef.current = true
    const rafId = requestAnimationFrame(() => {
      handleFileOpened(fileState)
    })
    return (): void => { cancelAnimationFrame(rafId) }
  }, [fileState, rootItems.length, handleFileOpened])

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

  // Ref to track if search index has been initialized
  const searchIndexInitializedRef = useRef(false)

  // Initialize search index service and index folder on initial load
  useEffect(() => {
    if (searchIndexInitializedRef.current) return
    searchIndexInitializedRef.current = true
    
    void (async (): Promise<void> => {
      await searchIndexService.initialize()
      // Index all root folders (skip root-level Requests)
      for (const folder of rootItems) {
        if ('items' in folder) {
          await searchIndexService.indexFolderTree(folder)
        }
      }
    })()
    
    // Note: No cleanup needed - the service sends data to main process
    // which handles the actual indexing and event subscriptions.
  }, [rootItems])

  // Open a folder tab in the workbench
  const openFolderTab = useCallback((folder: Folder, breadcrumbs: BreadcrumbItem[]) => {
    const tabId = `folder-${folder.id}`

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
      const folder = findEnvironmentFolderById(rootItems, itemId)
      if (folder) {
        const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
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
      const folder = findFolderById(rootItems, itemId)
      if (folder && !isEnvironmentFolder(folder as FolderItem)) {
        const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
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
      const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
      if (item && isRequest(item)) {
        const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
        
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
  }, [rootItems])

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
        const folder = findFolderById(rootItems, key)
        if (folder) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, key)
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
        const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, key)
        if (item && isRequest(item)) {
          const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
          openAnyRequestTab(item, breadcrumbs, environments)
          // Focus the group containing the tab
          setFocusedGroupId('restorm-main-group')
        }
      }
    })

    return unsubscribe
  }, [openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, rootItems])

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

  // Use vertical sash hook for sidebar resizing
  const {
    containerRef,
    width: leftWidth,
    layoutProvider,
    handleSashStart,
    handleSashChange
  } = useVerticalSash({
    initialWidth: 260,
    minWidth: MIN_LEFT_WIDTH,
    minRightWidth: RIGHT_MIN_WIDTH,
    storageKey: 'restorm-sidebar-width'
  })

  // Handle tree changes from workbench (drag-drop, close tab, etc.)
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
              minHeight: 0
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
        )}

        <RestormWorkbenchContainer
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
          workbenchId={WORKBENCH_ID}
          onRebuildTab={handleRebuildTab}
          onStateRestored={handleStateRestored}
          getRequestById={(id) => findRequestById(rootItems, id)}
          getFolderById={(id) => findFolderById(rootItems, id)}
          getEnvironmentFolderById={(id) => findEnvironmentFolderById(rootItems, id)}
        />

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
