import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Statusbar,
  StatusbarElement,
  StatusBarBellButton,
  Toaster,
  VerticalSashContainer,
  useFileService,
  useFeature,
  eventBus,
  logger,
  computeChecksum,
  useDirtyState,
  commitChecksums,
  navigationService
} from 'electron-core-ui/renderer'
import { DocumentEvents, type DocumentChangedPayload } from './services/DocumentEvents'
import type { WorkbenchTree } from 'electron-core-ui/renderer'
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
  getNearestEnvironmentsForBreadcrumbs
} from './utils/treeSearch'
import { DesktopIndicator } from './components/MainView/DesktopIndicator'
import { findItemById } from './utils/treeSearch'
import { useItemOperations } from './hooks/useItemOperations'
import { useNavigation } from './hooks/useNavigation'
import { useWorkbenchUpdates } from './hooks/useWorkbenchUpdates'
import { useWorkbenchTabs } from './hooks/useWorkbenchTabs'
import { useSidebarState } from './hooks/useSidebarState'
import { isFavorite as favoritesStoreIsFavorite, toggleFavorite as favoritesStoreToggle } from './services/favoritesStore'
import { useFileManagement } from './hooks/useFileManagement'
import { useImport } from './hooks/useImport'
import { prepareForSerialization } from './utils/serialization'
import { makeReactiveFolder } from './types/reactive'
import { searchIndexService } from './services/SearchIndexService'
import { useRestormStore } from './store/restormStore'
import type {
  Folder,
  FolderItem,
  EnvironmentFolder,
  Request
} from '../../shared/types/collections'
import {
  isRequest,
  isEnvironmentFolder,
  isAnyFolder
} from '../../shared/types/collections'
import { buildRequestPath } from './utils/requestPath'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getResponsesHistoryApi(): { updatePath: (requestId: string, requestPath: string) => Promise<boolean> } | null {
  const root = window as { restorm?: unknown }
  const restorm = root.restorm
  if (!isRecord(restorm)) return null
  const responsesHistory = (restorm as { responsesHistory?: unknown }).responsesHistory
  if (!isRecord(responsesHistory)) return null
  const updatePath = (responsesHistory as { updatePath?: unknown }).updatePath
  if (typeof updatePath !== 'function') return null
  return { updatePath: updatePath as (requestId: string, requestPath: string) => Promise<boolean> }
}

const MIN_LEFT_WIDTH = 180
const RIGHT_MIN_WIDTH = 240

/** Workbench ID for persistence */
const WORKBENCH_ID = 'restorm-main-workbench'

// Initial root items - empty at startup, populated when opening a file
const initialRootItems: EnvironmentFolder[] = []

const allFolderIds = initialRootItems.flatMap((folder) => collectAllFolderIds(folder))

const App: React.FC = () => {
  const { t } = useTranslation()
  const { isEnabled: navigationEnabled } = useFeature('navigation')
  const setCollections = useRestormStore((state) => state.setCollections)
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
    close: closeFileDirect
  } = useFileService()

  const workbenchId = useMemo((): string | undefined => {
    if (!filePath) return undefined
    return `${WORKBENCH_ID}:${filePath}`
  }, [filePath])

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

  // Use workbench tabs hook for tab creation, restoration, and tree updates
  const {
    workbenchRef,
    hasRestoredWorkbenchRef,
    openFolderTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    handleRebuildTab,
    handleStateRestored,
    handleSizesChange,
    handleTreeChange
  } = useWorkbenchTabs({
    rootItems,
    focusedGroupId,
    setWorkbenchTree,
    registerTabDirtyState
  })

  // Use import hook — pendingEnvFolderIds triggers tab-opening below.
  const { handleImport, pendingEnvFolderIds, clearPendingEnvFolderIds } = useImport({
    rootItems,
    setRootItems,
    setExpandedIds
  })

  // After an import, open a workbench tab for each newly-created env folder.
  // This runs in a useEffect so rootItems has already committed — the
  // openEnvironmentFolderTab call sees the up-to-date tree.
  useEffect(() => {
    if (pendingEnvFolderIds.length === 0) return
    for (const id of pendingEnvFolderIds) {
      const folder = rootItems.find((item) => item.id === id)
      if (folder && isEnvironmentFolder(folder)) {
        openEnvironmentFolderTab(folder, [
          { id: folder.id, label: folder.name }
        ])
      }
    }
    clearPendingEnvFolderIds()
  }, [pendingEnvFolderIds, rootItems, openEnvironmentFolderTab, clearPendingEnvFolderIds])

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
    handleCreateRootFolder,
    handleCreateRootEnvironmentFolder,
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
    setDeleteConfirmation,
    openFolderTab,
    openEnvironmentFolderTab
  })

  const {
    handleTagsChange,
    handleTagColorChange,
    handleFolderChange,
    handleEnvironmentFolderChange,
    handleItemRename,
    handleItemIconChange,
    updateCount
  } = useWorkbenchUpdates({
    rootItems,
    setWorkbenchTree
  })

  // Keep the ref in sync so __restormTestHelpers.setEnvFolderTagColor can
  // delegate to the live handler without re-listing hook deps below.
  useEffect(() => {
    handleTagColorChangeRef.current = handleTagColorChange
  }, [handleTagColorChange])

  // `handleMenuClose` lives inside `useFileManagement`; keep a ref so the
  // test helper below can call it directly when the UI path (File → Close
  // via the menu bar) is unreliable after a context-menu-heavy flow.

  const handleSidebarRenameItem = useCallback((itemId: string) => {
    setSidebarEditingItemId(itemId)
  }, [])

  // Favorites management
  const [favoritesVersion, setFavoritesVersion] = useState(0)
  const isItemFavorite = useCallback((itemId: string): boolean => {
    void favoritesVersion // React dep
    if (!filePath) return false
    return favoritesStoreIsFavorite(filePath, itemId)
  }, [filePath, favoritesVersion])

  const handleToggleFavorite = useCallback((itemId: string): void => {
    if (!filePath) return
    favoritesStoreToggle(filePath, itemId)
    setFavoritesVersion((v) => v + 1)
  }, [filePath])

  // Sync favoritesVersion when favorites change from other sources (e.g. home page trash button)
  React.useEffect(() => {
    const handler = (): void => { setFavoritesVersion((v) => v + 1) }
    window.addEventListener('restorm:favorites-changed', handler)
    return () => { window.removeEventListener('restorm:favorites-changed', handler) }
  }, [])

  const { sidebarItems: sidebarItemsWithContextMenu } = useSidebarState({
    rootItems,
    expandedIds,
    updateCount,
    onCloneItem: handleCloneItem,
    onCreateSubfolder: handleCreateSubfolder,
    onDeleteItem: handleDeleteItem,
    onRenameItem: handleSidebarRenameItem,
    isItemFavorite,
    onToggleFavorite: handleToggleFavorite
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
      
      // Close all open tabs for the currently opened file.
      requestAnimationFrame(() => {
        setWorkbenchTree({
          orientation: 'vertical',
          groups: []
        })
      })
      setFocusedGroupId(null)
    })
    
    return () => {
      unsubscribe1()
      unsubscribe2()
    }
  }, [handleFileOpened, handleFileClosed, filePath, hasRestoredWorkbenchRef])

  // Restore workbench state after rootItems are available (autosave relies on onRebuildTab)
  useEffect(() => {
    if (!workbenchId || rootItems.length === 0 || hasRestoredWorkbenchRef.current) return
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
  }, [workbenchId, rootItems, hasRestoredWorkbenchRef, workbenchRef])

  // Memoize environment folder collections to avoid creating new arrays on every render
  const environmentFolderCollections = useMemo(
    () => rootItems.filter(isEnvironmentFolder),
    [rootItems]
  )

  // Stable lookup callbacks — avoids re-render cascade through RestormWorkbench → EditorGroupView
  const getRequestByIdCb = useCallback((id: string) => findRequestById(rootItems, id), [rootItems])
  const getFolderByIdCb = useCallback((id: string) => findFolderById(rootItems, id), [rootItems])
  const getEnvironmentFolderByIdCb = useCallback((id: string) => findEnvironmentFolderById(rootItems, id), [rootItems])

  const environmentFolderCollectionsRef = useRef(environmentFolderCollections)
  useEffect(() => {
    environmentFolderCollectionsRef.current = environmentFolderCollections
  }, [environmentFolderCollections])

  // Keep collections store in sync for request path resolution
  useEffect(() => {
    setCollections(environmentFolderCollections, 'user')
  }, [environmentFolderCollections, setCollections])

  // Listen to test events for E2E tests (only in dev/test mode)
  // Expose handleFileOpened directly on window for E2E tests
  // This must be done outside useEffect to ensure it's available immediately
  const handleFileOpenedRef = useRef(handleFileOpened)
  useEffect(() => {
    handleFileOpenedRef.current = handleFileOpened
  }, [handleFileOpened])

  // Keep a live-updating ref so the test-helper closure below always sees
  // the current collections without listing `rootItems` as an effect dep.
  const rootItemsRef = useRef(rootItems)
  useEffect(() => {
    rootItemsRef.current = rootItems
  }, [rootItems])

  // Same pattern for `handleTagColorChange` — the closure below needs a
  // stable reference the helper can call without tracking the hook's
  // re-creations as useEffect deps.
  const handleTagColorChangeRef = useRef<(folderId: string, tag: string, color: string | null) => void>(() => {
    // Stub until useWorkbenchUpdates populates the real handler below.
  })
  const closeFileDirectRef = useRef<() => Promise<unknown>>(async () => {
    // Stub until useFileService populates the real handler below.
  })
  useEffect(() => {
    closeFileDirectRef.current = closeFileDirect
  }, [closeFileDirect])
  
  useEffect(() => {
    // Test helpers used to be gated behind Vite's DEV flag, but that
    // excludes the production build that Playwright E2E launches (even
    // with NODE_ENV=development). The helpers are inert unless called,
    // so exposing them unconditionally is safe and unblocks E2E that
    // needs to introspect rootItems.
    
    // Expose immediately (don't wait for handleFileOpened to be ready)
    ;(window as unknown as {
      __restormTestHelpers?: {
        loadFile: (fileState: { currentFile: { content: unknown } }) => void
        setRootItems: (folders: EnvironmentFolder[]) => void
        findItemIndexPath: (nameChain: string[]) => number[] | null
        setEnvFolderTagColor: (folderName: string, tag: string, color: string | null) => boolean
        closeFile: () => Promise<void>
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
      },
      closeFile: async (): Promise<void> => {
        // Skip the unsaved-changes prompt (which in prod blocks on a
        // native dialog) and close the file directly. Used by the E2E
        // when the File → Close menu flow is unreliable from leftover
        // context-menu state. The scenario saves right before this step
        // so bypassing the prompt is safe.
        navigationService.clearHistory()
        await closeFileDirectRef.current()
      },
      setEnvFolderTagColor: (folderName: string, tag: string, color: string | null): boolean => {
        // Locate the first env folder whose name matches, then delegate to
        // `handleTagColorChange` via its runtime ID. That hook mutates the
        // reactive `tagColors` map AND calls `forceUpdate` so React repaints
        // tag renderers — matching the real UI change-tag-color flow.
        const target = (rootItemsRef.current as { id?: string; name?: string }[])
          .find((it) => it.name === folderName)
        if (!target?.id) return false
        handleTagColorChangeRef.current(target.id, tag, color)
        return true
      },
      findItemIndexPath: (nameChain: string[]): number[] | null => {
        // Walk the current rootItems tree following each name in `nameChain`
        // and return the index path that locates the matching item. Returns
        // null as soon as a hop can't be resolved. Used by the full-workflow
        // e2e to translate human-readable targets into the `idx:` tab ids
        // the workbench persistence layer expects.
        if (nameChain.length === 0) return null
        const pathOut: number[] = []
        let currentList: unknown[] = rootItemsRef.current as unknown[]
        for (const name of nameChain) {
          const idx = currentList.findIndex((item) => {
            return typeof (item as { name?: unknown }).name === 'string'
              && (item as { name: string }).name === name
          })
          if (idx === -1) return null
          pathOut.push(idx)
          const next = currentList[idx] as { items?: unknown[] } | undefined
          currentList = next?.items ?? []
        }
        return pathOut
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
  const requestPathCacheRef = useRef(new Map<string, string>())

  useEffect(() => {
    if (!fileName) {
      requestPathCacheRef.current.clear()
      return
    }
    if (requestPathCacheRef.current.size > 0) return
    const collections = environmentFolderCollections
    const requestIds: string[] = []
    const collectRequestIds = (items: FolderItem[]): void => {
      for (const item of items) {
        if (isAnyFolder(item)) {
          collectRequestIds(item.items)
        } else if (isRequest(item)) {
          requestIds.push(item.id)
        }
      }
    }
    for (const collection of collections) {
      collectRequestIds(collection.items)
    }
    for (const requestId of requestIds) {
      const requestPath = buildRequestPath(collections, requestId)
      if (requestPath) {
        requestPathCacheRef.current.set(requestId, requestPath)
      }
    }
  }, [fileName, rootItems, environmentFolderCollections])
  useEffect(() => {
    if (wasDirtyRef.current && !isDirty && fileName) {
      void commitChecksums().catch((err: unknown) => {
        logger.error('[App] Failed to commit checksums', { error: String(err) })
      })
    }
    wasDirtyRef.current = isDirty
  }, [isDirty, fileName])

  // Listen to document changes and update per-tab dirty state (works in all modes).
  // The checksum update triggers a setState in useDirtyState, which re-renders App and
  // cascades to every tab view. To avoid disturbing actively-typed Monaco editors, we
  // debounce the checksum update per document id so a typing burst produces a single
  // update after the user settles.
  const dirtyChecksumTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const DIRTY_CHECKSUM_DEBOUNCE_MS = 300
  useEffect(() => {
    const scheduleChecksumUpdate = (id: string, compute: () => string): void => {
      const existing = dirtyChecksumTimersRef.current.get(id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        dirtyChecksumTimersRef.current.delete(id)
        const newChecksum = compute()
        updateTabDirtyChecksum(id, newChecksum)
      }, DIRTY_CHECKSUM_DEBOUNCE_MS)
      dirtyChecksumTimersRef.current.set(id, timer)
    }

    const handleFolderOrRequestUpdated = (payload: DocumentChangedPayload): void => {
      const doc = payload.document
      scheduleChecksumUpdate(payload.id, () => {
        const serialized = JSON.parse(JSON.stringify(doc)) as FolderItem
        return computeChecksum(serialized)
      })

      if (payload.type === 'request') {
        const requestPath = buildRequestPath(environmentFolderCollections, payload.id)
        if (requestPath) {
          const cachedPath = requestPathCacheRef.current.get(payload.id)
          if (cachedPath === requestPath) {
            return
          }
          requestPathCacheRef.current.set(payload.id, requestPath)
          const api = getResponsesHistoryApi()
          if (api) {
            void api.updatePath(payload.id, requestPath)
          }
        }
      }
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
          scheduleChecksumUpdate(parentFolderId, () => computeChecksum(JSON.parse(JSON.stringify(rootFolder)) as EnvironmentFolder | Folder | Request))
          return
        }
        // Only search in folders, not Requests
        if ('items' in rootFolder) {
          const found = findFolder(rootFolder.items)
          if (found) {
            scheduleChecksumUpdate(parentFolderId, () => computeChecksum(JSON.parse(JSON.stringify(found)) as Folder))
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

    const timersMap = dirtyChecksumTimersRef.current
    return () => {
      for (const sub of subscriptions) {
        sub.unsubscribe()
      }
      for (const timer of timersMap.values()) {
        clearTimeout(timer)
      }
      timersMap.clear()
    }
  }, [updateTabDirtyChecksum, rootItems, environmentFolderCollections, filePath])

  // Dirty state is now handled by FileService in the main process
  // It subscribes to DocumentEvents and compares checksums automatically

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
    setExpandedIds,
    setFocusedGroupId,
    getNearestEnvironmentsForBreadcrumbs
  })

  // Initialize navigation history with restored active tab only
  const hasInitializedNavRef = useRef(false)
  useEffect(() => {
    if (!navigationEnabled || hasInitializedNavRef.current) return
    // Only seed the active tab of each group into navigation history.
    // Other tabs appear in the tab switcher (from tree), but without a navigation order.
    const seedNavigation = (): void => {
      for (const group of workbenchTree.groups) {
        if (!('tabs' in group)) continue
        const tabGroup = group as { tabs: { id: string }[]; activeTabId?: string }
        const activeTabId = tabGroup.activeTabId
        if (!activeTabId) continue
        const parts = activeTabId.split(':')
        const itemId = parts.length > 1 ? parts.slice(1).join(':') : activeTabId
        const item = findItemById(rootItems, itemId)
        if (item) {
          const type = 'method' in item ? 'request' : 'folder'
          navigationService.navigateTo(itemId, 'restore', { type })
        }
      }
      hasInitializedNavRef.current = true
    }
    if (workbenchTree.groups.length > 0) {
      seedNavigation()
    }
  }, [navigationEnabled, workbenchTree.groups, rootItems])

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
        onNew={() => { navigationService.clearHistory(); void handleMenuNew() }}
        onOpen={() => { void handleMenuOpen() }}
        onOpenFolder={() => { void handleMenuOpenFolder() }}
        onSave={handleMenuSave}
        onSaveAs={handleMenuSaveAs}
        onClose={() => { navigationService.clearHistory(); void handleMenuClose() }}
        onExit={handleMenuExit}
        onImport={() => { setShowImportModal(true) }}
        onOpenRecentFile={(path) => { void handleOpenRecentFile(path) }}
        onSearchResultClick={handleSearchResultClick}
      />

      {fileName ? (
        <VerticalSashContainer
          data-testid="app-vertical-sash-container"
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
                activeId={selectedItemId}
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
                onEditingStart={(itemId) => { setSidebarEditingItemId(itemId) }}
                onEditingEnd={() => { setSidebarEditingItemId(null) }}
                onAddRequest={() => { setShowImportModal(true) }}
                onCollapseAll={() => { setExpandedIds([]) }}
                onCreateRootFolder={handleCreateRootFolder}
                onCreateRootEnvironmentFolder={handleCreateRootEnvironmentFolder}
                onDeselectAll={() => { setSelectedItemId(null) }}
              />
            </div>
          }
          Right={
            <RestormWorkbenchContainer
              workbenchRef={workbenchRef}
              tree={workbenchTree}
              dirtyItemIdsSet={dirtyItemIdsSet}
              onTreeChange={handleTreeChange}
              focusedGroupId={focusedGroupId}
              onFocusedGroupChange={setFocusedGroupId}
              onTabActivate={handleTabActivate}
              onBreadcrumbClick={handleBreadcrumbClick}
              onItemRename={handleItemRename}
              onItemIconChange={handleItemIconChange}
              onTagsChange={handleTagsChange}
              onTagColorChange={handleTagColorChange}
              onFolderChange={handleFolderChange}
              onEnvironmentFolderChange={handleEnvironmentFolderChange}
              onSizesChange={handleSizesChange}
              emptyFallback={<EmptyBench />}
              workbenchId={workbenchId}
              onRebuildTab={handleRebuildTab}
              onStateRestored={handleStateRestored}
              getRequestById={getRequestByIdCb}
              getFolderById={getFolderByIdCb}
              getEnvironmentFolderById={getEnvironmentFolderByIdCb}
              navigationEnabled={navigationEnabled}
              tabSwitcherAnchorSelector='[data-testid="main-titlebar-searchbar-closed"]'
              filePath={filePath ?? undefined}
              isItemFavorite={isItemFavorite}
              onToggleFavorite={handleToggleFavorite}
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
            tree={workbenchTree}
            dirtyItemIdsSet={dirtyItemIdsSet}
            onTreeChange={handleTreeChange}
            focusedGroupId={focusedGroupId}
            onFocusedGroupChange={setFocusedGroupId}
            onTabActivate={handleTabActivate}
            onBreadcrumbClick={handleBreadcrumbClick}
            onItemRename={handleItemRename}
            onItemIconChange={handleItemIconChange}
            onTagsChange={handleTagsChange}
            onFolderChange={handleFolderChange}
            onEnvironmentFolderChange={handleEnvironmentFolderChange}
            onSizesChange={handleSizesChange}
            emptyFallback={<Welcome />}
            workbenchId={workbenchId}
            onRebuildTab={handleRebuildTab}
            onStateRestored={handleStateRestored}
            getRequestById={(id) => findRequestById(rootItems, id)}
            getFolderById={(id) => findFolderById(rootItems, id)}
            getEnvironmentFolderById={(id) => findEnvironmentFolderById(rootItems, id)}
            navigationEnabled={navigationEnabled}
            tabSwitcherAnchorSelector='[data-testid="main-titlebar-searchbar-closed"]'
            filePath={filePath ?? undefined}
            isItemFavorite={isItemFavorite}
            onToggleFavorite={handleToggleFavorite}
          />
        </div>
      )}

      <Statusbar data-testid="app-statusbar">
        {filePath && <StatusbarElement data-testid="app-statusbar-element" title={filePath} />}
        <DesktopIndicator />
        <StatusBarBellButton toasterId="app" className="right-aligned" />
      </Statusbar>

      {/* Global toaster anchored to the bottom-right, toggled by the statusbar bell. */}
      <Toaster id="app" position="bottom-right" data-testid="app-toaster" />

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
