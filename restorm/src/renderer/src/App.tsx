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
  usePersistedState,
  eventBus,
  logger,
  computeChecksum,
  useDirtyState,
  navigationService,
  upsertSaveUnit,
  markSaveUnitDeleted,
  useDraftsRestored,
  useDirtyUnitsSet,
  cleanseForPersistence,
  toasterService
} from 'electron-core-ui/renderer'
import { PROJECT_UUID_KEY } from '../../shared/config/projectUuid'
import { HTTPRequest } from '../../shared/models/requests/HTTPRequest'
import { SoapRequest } from '../../shared/models/requests/SoapRequest'
import { GrpcRequest } from '../../shared/models/requests/GrpcRequest'
import { GraphQLRequest } from '../../shared/models/requests/GraphQLRequest'
import { WebSocketRequest } from '../../shared/models/requests/WebSocketRequest'
import { Folder as FolderClass } from '../../shared/models/Folder'
import { EnvironmentFolder as EnvironmentFolderClass } from '../../shared/models/EnvironmentFolder'
import { Environment as EnvironmentClass } from '../../shared/models/Environment'

/**
 * Resolve the concrete class of a document node by its `type`
 * discriminator. Mirrors the resolver used in `useFileManagement` so
 * `cleanseForPersistence` produces the same shape the decomposer
 * produces on save — that's the invariant `commitIfDraftMatches`
 * relies on.
 */
const classForDocument = (type: 'folder' | 'request' | 'environment', doc: Record<string, unknown>): object => {
  if (type === 'request') {
    const t = doc['type']
    if (t === 'soap') return SoapRequest
    if (t === 'grpc') return GrpcRequest
    if (t === 'graphql') return GraphQLRequest
    if (t === 'websocket') return WebSocketRequest
    return HTTPRequest
  }
  if (type === 'environment') return EnvironmentClass
  // Distinguish env folders from regular folders — the decomposer
  // lifts different child arrays depending on which of the two we're
  // looking at (`environments` + `items` vs `items` only). The bridge
  // must pick the same class so `commitIfDraftMatches` sees the same
  // cleansed shape the decomposer produces at save time.
  if (doc['folderType'] === 'environment' || Array.isArray(doc['environments'])) {
    return EnvironmentFolderClass
  }
  return FolderClass
}
import { DocumentEvents, type DocumentChangedPayload, type DocumentDeletedPayload, type RequestHistoryEventPayload } from './services/DocumentEvents'
import { getResponseHistoryList } from './services/GraphQLIntegration'
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
  findItemWithBreadcrumbs,
  getNearestEnvironmentsForBreadcrumbs
} from './utils/treeSearch'
import { DesktopIndicator } from './components/MainView/DesktopIndicator'
import { findItemById } from './utils/treeSearch'
import { EnvironmentProvider } from './contexts/EnvironmentContext'
import { StatusbarEnvironmentSelector } from './components/MainView/StatusbarEnvironmentSelector'
import { StatusbarAuthSelector } from './components/MainView/StatusbarAuthSelector'
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

  // Sync document.title with window title for taskbar
  useEffect(() => {
    const title = fileName ? `Restorm - ${fileName}${isDirty ? ' *' : ''}` : 'Restorm'
    document.title = title
  }, [fileName, isDirty])

  // Surface a toast whenever the main process restores crash-recovery
  // drafts at project open. The handler comes from the lib — we just
  // bind it to the app-level toaster.
  useDraftsRestored((payload) => {
    if (payload.count <= 0) return
    toasterService.push('app', {
      title: t('app.draftsRestoredTitle'),
      body: t('app.draftsRestoredBody', { count: payload.count })
    })
  })

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

  // Sidebar expansion is persisted per-project under
  // `restorm-main-sidebar:<projectUuid>`. The UUID is stamped into the
  // project file (top-level `PROJECT_UUID_KEY` → `_projectUuid`) by
  // `ensureFolderUuid` / `ensureFileUuid` in the main process — unlike
  // `filePath` it survives folder moves and renames, so the preference
  // follows the project across filesystem reshuffles.
  //
  // The key stays `null` until both the UUID is readable from content and
  // `rootItems` is hydrated, so the restore's `onRestore` filter has a
  // complete tree to validate stored ids against (otherwise the read can
  // race ahead of rootItems and drop every id as "unknown").
  const projectUuid = useMemo<string | null>(() => {
    const content = fileState?.currentFile.content
    if (!content || typeof content !== 'object') return null
    const raw = (content as Record<string, unknown>)[PROJECT_UUID_KEY]
    return typeof raw === 'string' && raw.length > 0 ? raw : null
  }, [fileState])

  const sidebarStorageKey = useMemo(
    () => (projectUuid && rootItems.length > 0 ? `restorm-main-sidebar:${projectUuid}` : null),
    [projectUuid, rootItems.length]
  )

  // Workbench layout (tabs, splits) is persisted under
  // `${WORKBENCH_ID}:<projectUuid>`. Keyed by UUID for the same reason
  // as the sidebar expansion state — the layout follows the project
  // even if the user renames/moves the file outside the app.
  const workbenchId = useMemo<string | undefined>(
    () => (projectUuid ? `${WORKBENCH_ID}:${projectUuid}` : undefined),
    [projectUuid]
  )
  const allFolderIdsRef = useRef<string[]>(allFolderIds)
  useEffect(() => {
    const ids: string[] = []
    for (const item of rootItems) {
      if ('items' in item) {
        ids.push(...collectAllFolderIds(item))
      }
    }
    allFolderIdsRef.current = ids
  }, [rootItems])
  const [expandedIds, setExpandedIds] = usePersistedState<string[]>(
    sidebarStorageKey,
    allFolderIds,
    {
      onRestore: (stored) => {
        const known = new Set(allFolderIdsRef.current)
        return stored.filter((id) => known.has(id))
      },
      onMissing: () => allFolderIdsRef.current.slice()
    }
  )

  // Selected item in the sidebar
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  // Focused group ID in the workbench
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null)

  // Workbench tree state (starts with no groups)
  const [workbenchTree, setWorkbenchTree] = useState<WorkbenchTree>({
    orientation: 'vertical',
    groups: []
  })

  // Per-tab dirty state tracking — the legacy checksum store is still
  // wired through `useFileManagement` for backward compat on the
  // file-mode global isDirty flag; tab dirty dots now read from the
  // save-unit registry via `useDirtyUnitsSet` which is the single
  // source of truth for per-document dirty state.
  const {
    registerItem: registerTabDirtyState,
    updateItemChecksum: updateTabDirtyChecksum,
    markAllSaved: markAllTabsSaved,
    clear: clearTabDirtyState
  } = useDirtyState()

  const rawDirtyIds = useDirtyUnitsSet()
  // Scoped cascade: only lift dirty "leaf" units (requests, environments)
  // onto their immediate parent tab. Folders don't cascade further — a
  // dirty request inside `pet` makes `pet` show a dot, but that doesn't
  // reach the env folder above; a dirty variable inside an env makes the
  // env folder dirty (variables render on the env folder tab), but a
  // dirty request three levels down doesn't. This matches what the user
  // sees and expects to save: the tab that is dirty is the tab whose
  // content actually changed.
  const dirtyItemIdsSet = useMemo((): ReadonlySet<string> => {
    if (rawDirtyIds.size === 0) return rawDirtyIds
    // Cascade is scoped to units that have no tab of their own — i.e.
    // environments and sub-environments, which render inside the env
    // folder tab. Everything else (requests, sub-folders) owns a tab
    // and is shown with its own per-unit dirty dot, independent of its
    // siblings. That way a request being unsaved doesn't flag the
    // enclosing folder tab as dirty: the folder's dirty dot means "I
    // have unsaved work on this folder document", not "something
    // somewhere below me is dirty".
    const cascadeParentById = new Map<string, string>()
    const visit = (item: EnvironmentFolder | Folder | Request): void => {
      if (!('items' in item)) return
      for (const child of item.items) visit(child)
      const itemIsEnvFolder = 'environments' in item && Array.isArray(item.environments)
      if (itemIsEnvFolder) {
        const envFolder = item
        for (const env of envFolder.environments) {
          cascadeParentById.set(env.id, envFolder.id)
          if (env.subEnvironments) {
            for (const sub of env.subEnvironments) {
              // Sub-envs resolve transitively to the env folder's tab
              // via `env.id → env folder id`.
              cascadeParentById.set(sub.id, env.id)
            }
          }
        }
      }
    }
    for (const root of rootItems) visit(root)

    const merged = new Set<string>(rawDirtyIds)
    for (const id of rawDirtyIds) {
      let parent = cascadeParentById.get(id)
      while (parent !== undefined) {
        merged.add(parent)
        parent = cascadeParentById.get(parent)
      }
    }
    return merged
  }, [rawDirtyIds, rootItems])

  // Use file management hook
  const {
    handleMenuNew,
    handleMenuOpen,
    handleMenuOpenFolder,
    handleMenuSaveAll,
    handleMenuSaveUnit,
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

  // After an import lands, increment `pendingImportSave` so the effect
  // below triggers a whole-tree save once React has committed the new
  // `rootItems` — without the indirection, `handleMenuSaveAll` would
  // close over the pre-import tree and save nothing useful.
  const [pendingImportSave, setPendingImportSave] = useState(0)
  const handleImportComplete = useCallback(() => {
    setPendingImportSave((c) => c + 1)
  }, [])

  // Use import hook — pendingEnvFolderIds triggers tab-opening below.
  const { handleImport, pendingEnvFolderIds, clearPendingEnvFolderIds } = useImport({
    rootItems,
    setRootItems,
    setExpandedIds,
    onImportComplete: handleImportComplete
  })

  // Resolve a workbench tab id (e.g. `request-idx:0.1`, `request-id:uuid`,
  // or the legacy `request-<id>` form) to its item id.
  const resolveTabItemId = useCallback((tabId: string): string | null => {
    const idxMatch = /^(folder|env-folder|request)-idx:([0-9]+(?:\.[0-9]+)*)$/.exec(tabId)
    if (idxMatch?.[2]) {
      const indexPath = idxMatch[2].split('.').map((n) => Number(n))
      let cursor: unknown = rootItems[indexPath[0] ?? 0]
      for (let i = 1; i < indexPath.length; i += 1) {
        if (!cursor || typeof cursor !== 'object' || !('items' in cursor)) return null
        const items = (cursor as { items?: unknown[] }).items
        if (!Array.isArray(items)) return null
        cursor = items[indexPath[i] ?? 0]
      }
      if (cursor && typeof cursor === 'object' && 'id' in cursor) {
        const id = (cursor as { id?: unknown }).id
        return typeof id === 'string' ? id : null
      }
      return null
    }
    const legacyMatch = /^(folder|env-folder|request)-(?:id:)?(.+)$/.exec(tabId)
    return legacyMatch?.[2] ?? null
  }, [rootItems])

  // Resolve the active tab's unit id and delegate to `handleMenuSaveUnit`,
  // or fall back to save-all when nothing is active / resolvable. Used for
  // both the menu-bar Ctrl+S shortcut (registered by the library) and the
  // window-level handler below — without this, the menu-bar's global
  // shortcut registration would fire save-all first (capture phase) and
  // prevent the window handler from ever seeing the key. Both paths must
  // therefore run the same "smart save" logic.
  const smartSaveActive = useCallback(async (): Promise<boolean> => {
    const groups = workbenchTree.groups as { tabs?: unknown; activeTabId?: string; id?: string }[]
    let activeTabId: string | undefined
    const focused = groups.find((g) => g.id === focusedGroupId && typeof g.activeTabId === 'string')
    if (focused) activeTabId = focused.activeTabId
    if (!activeTabId) {
      const first = groups.find((g) => typeof g.activeTabId === 'string')
      activeTabId = first?.activeTabId
    }
    if (!activeTabId) return await handleMenuSaveAll()
    const itemId = resolveTabItemId(activeTabId)
    if (!itemId) return await handleMenuSaveAll()
    return await handleMenuSaveUnit(itemId)
  }, [workbenchTree.groups, focusedGroupId, resolveTabItemId, handleMenuSaveAll, handleMenuSaveUnit])

  // Currently-active request resolution for the status-bar history
  // button. Uses the same focused-group → first-active-group fallback
  // as `smartSaveActive`, then narrows to the item id and looks up the
  // Request object. Returns null when no tab is active or the active
  // tab isn't a request (folder / env-folder tabs hide the button).
  const activeRequest = useMemo((): { id: string; path: string | null } | null => {
    const groups = workbenchTree.groups as { activeTabId?: string; id?: string }[]
    let activeTabId: string | undefined
    const focused = groups.find((g) => g.id === focusedGroupId && typeof g.activeTabId === 'string')
    if (focused) activeTabId = focused.activeTabId
    if (!activeTabId) {
      const first = groups.find((g) => typeof g.activeTabId === 'string')
      activeTabId = first?.activeTabId
    }
    if (!activeTabId) return null
    const itemId = resolveTabItemId(activeTabId)
    if (!itemId) return null
    const request = findRequestById(rootItems, itemId)
    if (!request) return null
    return { id: request.id, path: buildRequestPath(rootItems, request.id) }
  }, [workbenchTree.groups, focusedGroupId, resolveTabItemId, rootItems])

  // The nearest ancestor env folder of the active request — the
  // primary storage grain for OYO-196's env model. Walked from
  // breadcrumbs so it stays in sync with the workbench's active
  // selection. `null` when no env-folder ancestor exists (the
  // selector then runs without persistence).
  const activeEnvFolderId = useMemo<string | null>(() => {
    if (!activeRequest) return null
    const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, activeRequest.id)
    for (let i = breadcrumbs.length - 2; i >= 0; i -= 1) {
      const id = breadcrumbs[i]?.id
      if (!id) continue
      const folder = findFolderById(rootItems, id)
      if (folder && isEnvironmentFolder(folder as FolderItem)) return folder.id
    }
    return null
  }, [activeRequest, rootItems])

  // `EnvironmentProvider` expects `{ projectUuid, envFolderId, requestId }`
  // to wire up persistence (workspace-scoped, survives file renames).
  // Falls back to `undefined` when any field is missing — the provider
  // then runs in in-memory-only mode.
  const activeEnvPersistenceKey = useMemo(() => {
    if (!activeRequest || !projectUuid || !activeEnvFolderId) return undefined
    return { projectUuid, envFolderId: activeEnvFolderId, requestId: activeRequest.id }
  }, [activeRequest, projectUuid, activeEnvFolderId])

  // Reactive "does the active request have any history yet?" used to
  // drive the statusbar button's disabled state. The probe is tagged
  // with the `requestId` it was fetched for so the button only trusts
  // a `hasHistory: true` that matches the currently-active request —
  // otherwise a stale `true` from a previous request could briefly
  // re-enable the button after switching to a fresh request whose
  // fetch hasn't landed yet.
  const [activeHistoryProbe, setActiveHistoryProbe] = useState<{ requestId: string; hasHistory: boolean } | null>(null)

  // Re-fetch count whenever the active request changes or a tab
  // records a new history entry for that request. The tab views emit
  // `REQUEST_HISTORY_RECORDED` right after `setHistoryRefreshKey` so a
  // freshly-sent request flips the button from disabled to enabled
  // without a window reload.
  const activeRequestId = activeRequest?.id ?? null
  const activeRequestPath = activeRequest?.path ?? null
  useEffect(() => {
    // When no request tab is active, the button is unmounted anyway
    // (see `{activeRequest && ...}` in the statusbar render), so the
    // probe value is unread and left stale on purpose — avoids a
    // setState-in-effect for a value nobody reads. The probe is tagged
    // with the fetched request id so callers ignore it when stale.
    if (!activeRequestId) return
    const requestId = activeRequestId
    const requestPath = activeRequestPath
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const entries = await getResponseHistoryList(requestId, requestPath ?? undefined)
        if (!cancelled) setActiveHistoryProbe({ requestId, hasHistory: entries.length > 0 })
      } catch (error) {
        if (!cancelled) {
          logger.warn('[App] getResponseHistoryList failed', { error: String(error), requestId })
          setActiveHistoryProbe({ requestId, hasHistory: false })
        }
      }
    }
    void refresh()
    const subscription = eventBus.subscribe<RequestHistoryEventPayload>(
      DocumentEvents.REQUEST_HISTORY_RECORDED,
      (payload) => { if (payload.requestId === requestId) void refresh() }
    )
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [activeRequestId, activeRequestPath])

  // The probe is only meaningful when it matches the request we're
  // currently looking at — otherwise it's stale data from a previous
  // active request and must be treated as "unknown → keep disabled".
  const activeRequestHasHistory = Boolean(
    activeRequest &&
    activeHistoryProbe?.requestId === activeRequest.id &&
    activeHistoryProbe.hasHistory
  )

  const handleOpenActiveRequestHistory = useCallback((): void => {
    if (!activeRequest) return
    if (!activeRequestHasHistory) return
    eventBus.emitLocalSync(DocumentEvents.REQUEST_HISTORY_OPEN, { requestId: activeRequest.id } as RequestHistoryEventPayload)
  }, [activeRequest, activeRequestHasHistory])

  // Window-level Ctrl+S / Ctrl+Shift+S fallback — only fires if the
  // menu-bar's KeyboardShortcutService didn't intercept (e.g. when the
  // menu isn't mounted). Same routing as the menu bar: Ctrl+S → smart
  // per-unit save, Ctrl+Shift+S → full save-all.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const cmdOrCtrl = e.ctrlKey || e.metaKey
      if (!cmdOrCtrl || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      const logFailure = (label: string) => (err: unknown) => {
        logger.error('[App] Save shortcut failed', { shortcut: label, error: String(err) })
      }
      if (e.shiftKey) {
        void handleMenuSaveAll().catch(logFailure('Ctrl+Shift+S'))
        return
      }
      void smartSaveActive().catch(logFailure('Ctrl+S'))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [handleMenuSaveAll, smartSaveActive])

  // After an import, persist the fresh tree to disk so the registry's
  // initial hydration reference matches what's on disk. Without this,
  // the imported content stays dirty until the user explicitly saves,
  // which disagrees with the user's mental model ("I imported, it's
  // saved"). Runs once per import — the counter is latched in a ref so
  // unrelated `handleMenuSaveAll` identity changes (every `rootItems`
  // mutation rebuilds it) don't re-fire the auto-save and clobber the
  // user's later edits.
  const lastImportSaveRef = useRef(0)
  useEffect(() => {
    if (pendingImportSave === 0) return
    if (lastImportSaveRef.current === pendingImportSave) return
    lastImportSaveRef.current = pendingImportSave
    void handleMenuSaveAll().catch((err: unknown) => {
      logger.error('[App] Auto-save after import failed', { error: String(err) })
    })
  }, [pendingImportSave, handleMenuSaveAll])

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

  // Environments of the active request's nearest ancestor env-folder,
  // used to feed the status-bar env selector. Empty when the active
  // request has no env-folder ancestor (the selector then hides).
  //
  // `updateCount` ticks every time the reactive tree mutates in place
  // (env color, icon, rename, etc.) — env-folder edits bump it via
  // `handleEnvironmentFolderChange`. Without it the memo would keep
  // returning the same `envs` array (proxy mutations are invisible to
  // React's dep comparison), and the downstream `useMemo` that
  // computes `envColor` inside `EnvironmentProvider` would never pick
  // up a freshly-chosen color. Shallow-cloning each env below also
  // gives the provider a new array reference on every bump so its
  // own `envColor` memo re-runs.
  const activeRequestEnvironments = useMemo(() => {
    // Read `updateCount` so the memo re-runs when the reactive tree
    // mutates in place — see the JSDoc above for the rationale. The
    // value itself is unused; only its identity change matters.
    void updateCount
    if (!activeRequest) return []
    const found = findItemWithBreadcrumbs(rootItems, activeRequest.id)
    return getNearestEnvironmentsForBreadcrumbs(rootItems, found.breadcrumbs).map((env) => ({ ...env }))
  }, [activeRequest, rootItems, updateCount])

  // All request ids that sit under the same env folder as the active
  // request (including the active one). Passed to the statusbar env
  // selector so the "Apply to all" toggle can propagate a selection
  // across siblings without each tab needing to be mounted.
  const activeEnvFolderRequestIds = useMemo<string[]>(() => {
    if (!activeRequest) return []
    const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, activeRequest.id)
    // Walk breadcrumbs backwards to find the nearest ancestor that is
    // an EnvironmentFolder — the ticket scopes selection to that
    // folder's requests only.
    let envFolderId: string | undefined
    for (let i = breadcrumbs.length - 2; i >= 0; i -= 1) {
      const id = breadcrumbs[i]?.id
      if (!id) continue
      const folder = findFolderById(rootItems, id)
      if (folder && isEnvironmentFolder(folder as FolderItem)) {
        envFolderId = folder.id
        break
      }
    }
    if (!envFolderId) return [activeRequest.id]
    const envFolder = findEnvironmentFolderById(rootItems, envFolderId)
    if (!envFolder) return [activeRequest.id]
    const ids: string[] = []
    const walk = (items: FolderItem[]): void => {
      for (const item of items) {
        if ('items' in item) walk(item.items)
        else if (isRequest(item)) ids.push(item.id)
      }
    }
    walk(envFolder.items)
    return ids
  }, [activeRequest, rootItems])

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

  // Favorites management — keyed by projectUuid so the list follows
  // the project across external renames/moves.
  const [favoritesVersion, setFavoritesVersion] = useState(0)
  const isItemFavorite = useCallback((itemId: string): boolean => {
    void favoritesVersion // React dep
    if (!projectUuid) return false
    return favoritesStoreIsFavorite(projectUuid, itemId)
  }, [projectUuid, favoritesVersion])

  const handleToggleFavorite = useCallback((itemId: string): void => {
    if (!projectUuid) return
    favoritesStoreToggle(projectUuid, itemId)
    setFavoritesVersion((v) => v + 1)
  }, [projectUuid])

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
      setRootItems: (items: (EnvironmentFolder | Folder | Request)[]) => {
        // Make folders reactive before setting — leave root-level
        // requests as-is (they have no `items` array to wrap).
        const reactiveItems = items.map((item) =>
          'items' in item ? makeReactiveFolder(item) : item
        )
        setRootItems(reactiveItems)
        // Also trigger indexing
        void (async (): Promise<void> => {
          await searchIndexService.clearIndex()
          await searchIndexService.initialize()
          for (const rootItem of reactiveItems) {
            if ('items' in rootItem) {
              await searchIndexService.indexFolderTree(rootItem)
            } else {
              await searchIndexService.indexRootRequest(rootItem)
            }
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

    // Bridge DocumentEvents → save-unit registry. Every user edit on a
    // folder / request / environment mirrors into `upsertSaveUnit`, and
    // deletes mirror into `markSaveUnitDeleted`. The draft is the
    // *cleansed* POJO (same shape the decomposer produces on save), so
    // `commitIfDraftMatches` actually matches when the node hasn't
    // changed between mutate and save. `PasswordValue.toJSON` strips
    // plaintext on the preceding JSON round trip.
    const kindForType = (type: 'folder' | 'request' | 'environment'): 'folder' | 'file' =>
      type === 'folder' ? 'folder' : 'file'

    const handleUpsert = (payload: DocumentChangedPayload): void => {
      if (!payload.id) return
      let draft: Record<string, unknown>
      try {
        const raw = JSON.parse(JSON.stringify(payload.document)) as Record<string, unknown>
        const cls = classForDocument(payload.type, raw)
        draft = cleanseForPersistence(raw, cls)
      } catch (err) {
        logger.warn('[App] upsertSaveUnit: failed to cleanse document', {
          id: payload.id,
          error: String(err)
        })
        return
      }
      void upsertSaveUnit({
        runtimeId: payload.id,
        kind: kindForType(payload.type),
        draft,
        reason: 'modify',
        ...(payload.parentFolderId !== undefined && { parentId: payload.parentFolderId })
      }).catch((err: unknown) => {
        logger.warn('[App] upsertSaveUnit failed', { id: payload.id, error: String(err) })
      })
    }

    const handleDelete = (payload: DocumentDeletedPayload): void => {
      if (!payload.id) return
      void markSaveUnitDeleted(payload.id).catch((err: unknown) => {
        logger.warn('[App] markSaveUnitDeleted failed', { id: payload.id, error: String(err) })
      })
    }

    const subscriptions = [
      eventBus.subscribe(DocumentEvents.FOLDER_UPDATED, handleFolderOrRequestUpdated),
      eventBus.subscribe(DocumentEvents.REQUEST_UPDATED, handleFolderOrRequestUpdated),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_UPDATED, handleEnvironmentUpdated),
      eventBus.subscribe(DocumentEvents.FOLDER_UPDATED, handleUpsert),
      eventBus.subscribe(DocumentEvents.REQUEST_UPDATED, handleUpsert),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_UPDATED, handleUpsert),
      eventBus.subscribe(DocumentEvents.FOLDER_CREATED, handleUpsert),
      eventBus.subscribe(DocumentEvents.REQUEST_CREATED, handleUpsert),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_CREATED, handleUpsert),
      eventBus.subscribe(DocumentEvents.FOLDER_DELETED, handleDelete),
      eventBus.subscribe(DocumentEvents.REQUEST_DELETED, handleDelete),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_DELETED, handleDelete)
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
    handleBreadcrumbAuxClick,
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
        onSave={smartSaveActive}
        onSaveAll={handleMenuSaveAll}
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
              onBreadcrumbAuxClick={handleBreadcrumbAuxClick}
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
              projectUuid={projectUuid}
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
            onBreadcrumbAuxClick={handleBreadcrumbAuxClick}
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
            projectUuid={projectUuid}
            isItemFavorite={isItemFavorite}
            onToggleFavorite={handleToggleFavorite}
          />
        </div>
      )}

      <Statusbar data-testid="app-statusbar">
        {filePath && <StatusbarElement data-testid="app-statusbar-element" title={filePath} />}
        <DesktopIndicator />
        {(() => {
          if (!activeRequest) return null
          const reactiveRequest = findRequestById(rootItems, activeRequest.id)
          if (!reactiveRequest) return null
          // Auth routes live anywhere in the tree — inside the
          // nearest env folder, or at the root of the collection.
          // Walk the whole `rootItems` set so both shapes feed the
          // picker; the env-folder scoping that used to gate this was
          // too narrow for imports that put the auth route at the
          // root.
          return (
            <StatusbarAuthSelector
              activeRequest={reactiveRequest}
              envFolderItems={rootItems}
            />
          )
        })()}
        {activeRequest && activeRequestEnvironments.length > 0 && (
          <EnvironmentProvider
            environments={activeRequestEnvironments}
            persistenceKey={activeEnvPersistenceKey}
          >
            <StatusbarEnvironmentSelector
              folderRequestIds={activeEnvFolderRequestIds}
              projectUuid={projectUuid}
            />
          </EnvironmentProvider>
        )}
        {activeRequest && (
          <StatusbarElement
            data-testid="statusbar-request-history"
            className={activeRequestEnvironments.length > 0 ? '' : 'right-aligned'}
            disabled={!activeRequestHasHistory}
            onClick={handleOpenActiveRequestHistory}
            icon={{ type: 'codicon', value: 'history' }}
            title={t('statusbar.requestHistory')}
          />
        )}
        <StatusBarBellButton toasterId="app" />
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
