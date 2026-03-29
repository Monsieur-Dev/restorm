import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Statusbar,
  StatusbarElement,
  VerticalSashContainer,
  useFileService,
  eventBus,
  logger,
  computeChecksum,
  useDirtyState,
  setContentChecksum,
  commitChecksums
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
import { useItemOperations } from './hooks/useItemOperations'
import { useNavigation } from './hooks/useNavigation'
import { useWorkbenchUpdates } from './hooks/useWorkbenchUpdates'
import { useWorkbenchTabs } from './hooks/useWorkbenchTabs'
import { useSidebarState } from './hooks/useSidebarState'
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
    close: _closeFile
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

  // Use import hook
  const { handleImport } = useImport({
    rootItems,
    setRootItems
  })

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

  // Keep collections store in sync for request path resolution
  useEffect(() => {
    const collections = rootItems.filter(isEnvironmentFolder)
    setCollections(collections, 'user')
  }, [rootItems, setCollections])

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
  const requestPathCacheRef = useRef(new Map<string, string>())

  useEffect(() => {
    if (!fileName) {
      requestPathCacheRef.current.clear()
      return
    }
    if (requestPathCacheRef.current.size > 0) return
    const collections = rootItems.filter(isEnvironmentFolder)
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
  }, [fileName, rootItems])
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

      if (payload.type === 'request') {
        const collections = rootItems.filter(isEnvironmentFolder)
        const requestPath = buildRequestPath(collections, payload.id)
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
              tree={workbenchTree}
              dirtyItemIdsSet={dirtyItemIdsSet}
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
              workbenchId={workbenchId}
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
            tree={workbenchTree}
            dirtyItemIdsSet={dirtyItemIdsSet}
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
            workbenchId={workbenchId}
            onRebuildTab={handleRebuildTab}
            onStateRestored={handleStateRestored}
            getRequestById={(id) => findRequestById(rootItems, id)}
            getFolderById={(id) => findFolderById(rootItems, id)}
            getEnvironmentFolderById={(id) => findEnvironmentFolderById(rootItems, id)}
          />
        </div>
      )}

      <Statusbar data-testid="app-statusbar">
        {filePath && <StatusbarElement data-testid="app-statusbar-element" title={filePath} />}
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
