import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
  Dock,
  type DockHandle,
  Statusbar,
  StatusbarElement,
  StatusBarBellButton,
  Toaster,
  WelcomeScreen,
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
import type { EditorTab, WorkbenchTree, GroupNode } from 'electron-core-ui/renderer'
import { isContainerNode, isTabGroupNode } from 'electron-core-ui/renderer'

/**
 * Match a workbench tab by the underlying item id (request / folder /
 * env-folder id stored in `rootItems`). The tab's own `.id` is a
 * synthetic key (e.g. `request-idx:0.1.5`) and never appears in
 * `rootItems`. The Open documents + Favorites panes address rows by
 * the underlying id, so close handlers triggered from those panes
 * must look through to `tab.request?.id` / `tab.folder?.id`.
 */
type ItemBackedTab = EditorTab & { request?: { id?: string }; folder?: { id?: string } }
const tabMatchesItem = (tab: EditorTab, itemId: string): boolean => {
  const t = tab as ItemBackedTab
  return t.request?.id === itemId || t.folder?.id === itemId
}
import { EmptyBench } from './components/MainView/Workbench/EmptyBench'
import { RestormTitlebar } from './components/MainView/Titlebar/RestormTitlebar'
import { StatusbarMcpIndicator } from './components/MainView/StatusbarMcpIndicator'
import { useMcpEnabled } from './hooks/useMcpEnabled'
import { useMcpActiveStateBridge } from './hooks/useMcpActiveStateBridge'
import { useMcpNavigation } from './hooks/useMcpNavigation'
import { useMcpTreeReplace } from './hooks/useMcpTreeReplace'
import { useMcpRunRequest } from './hooks/useMcpRunRequest'
import { useMcpRequestPatch } from './hooks/useMcpRequestPatch'
import { useMcpFolderPatch } from './hooks/useMcpFolderPatch'
import { RestormSidebar } from './components/MainView/Sidebar/RestormSidebar'
import { RestormWorkbenchContainer } from './components/MainView/Workbench/RestormWorkbenchContainer'
import { SaveOptionsModal } from './components/Modals/SaveOptionsModal'
import { DeleteConfirmationModal } from './components/Modals/DeleteConfirmationModal'
import { ImportModal, type RefreshContext } from './components/Modals/ImportModal'
import { AvailableVariablesProvider } from './contexts/AvailableVariablesContext'
import { VariableTransformProvider } from './contexts/VariableTransformContext'
import { AuthRequestResolverContext, type AuthRequestResolver } from './contexts/authRequestResolverContext'
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
import { shouldShowAuthSelector } from './components/MainView/statusbarAuthHelpers'
import { useItemOperations } from './hooks/useItemOperations'
import { useRequestCreationApi } from './hooks/useRequestCreationApi'
import { RequestCreationProvider } from './contexts/RequestCreationContext'
import { useNavigation } from './hooks/useNavigation'
import { useWorkbenchUpdates } from './hooks/useWorkbenchUpdates'
import { useWorkbenchTabs } from './hooks/useWorkbenchTabs'
import { useApiUpdateNotifications } from './hooks/useApiUpdateNotifications'
import { useApiUpdateStateMap } from './hooks/useApiUpdateStateMap'
import { useSidebarState } from './hooks/useSidebarState'
import {
  isFavorite as favoritesStoreIsFavorite,
  toggleFavorite as favoritesStoreToggle,
  addFavorite as favoritesStoreAdd,
  removeFavorite as favoritesStoreRemove,
  reorderFavorites as favoritesStoreReorder
} from './services/favoritesStore'
import { useFavoritesAndOpenItems } from './hooks/useFavoritesAndOpenItems'
import { useFileManagement } from './hooks/useFileManagement'
import { useImport } from './hooks/useImport'
import { prepareForSerialization } from './utils/serialization'
import { makeReactiveFolder, makeReactiveRequest } from './types/reactive'
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
  isAnyFolder,
  isAuthenticationRequest
} from '../../shared/types/collections'
import { buildRequestPath } from './utils/requestPath'

const MIN_LEFT_WIDTH = 180

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

  // Toast on every transition into the "update available" state.
  // The settings section already owns the inline state; this is the
  // out-of-band notification for users not currently on the folder.
  useApiUpdateNotifications(t)

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

  // Persisted collapsed state for the Favorites + Opened sidebar panes,
  // keyed by project UUID like the workbench layout. Workspace stays
  // expanded — collapsible:false on its Pane.
  const sidebarPanesStorageKey = useMemo(
    () => (projectUuid ? `restorm-main-sidebar-panes:${projectUuid}` : null),
    [projectUuid]
  )
  const [panesCollapsed, setPanesCollapsed] = usePersistedState<{ favorites: boolean; opened: boolean }>(
    sidebarPanesStorageKey,
    { favorites: false, opened: false }
  )

  // Outer sidebar Dock — width + collapsed flag persisted across
  // sessions. The toggle button lives in the panel header (rendered
  // below) and drives `Dock` through the imperative `toggle()` ref.
  const [sidebarDockSize, setSidebarDockSize] = usePersistedState<number>(
    'restorm-main-sidebar-width',
    260
  )
  const [sidebarDockCollapsed, setSidebarDockCollapsed] = usePersistedState<boolean>(
    'restorm-main-sidebar-collapsed',
    false
  )
  const sidebarDockRef = useRef<DockHandle>(null)

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

  // Authentication failure → toast bridge.
  //
  // Subscribes to the main-side `auth:failed` IPC and surfaces a toast
  // in the global toaster. The toast body carries a clickable link
  // that opens the offending auth request in the workbench so the user
  // can fix credentials / URL / etc. without hunting through the tree.
  // We track the latest tree + tab opener through refs so the
  // subscription handler doesn't have to re-bind on every keystroke
  // (rootItems is reactive — its identity churns frequently).
  const authFailureRootItemsRef = useRef(rootItems)
  useEffect(() => { authFailureRootItemsRef.current = rootItems }, [rootItems])
  const authFailureOpenTabRef = useRef(openAnyRequestTab)
  useEffect(() => { authFailureOpenTabRef.current = openAnyRequestTab }, [openAnyRequestTab])
  useEffect(() => {
    const api = window.restorm?.auth
    if (!api) return undefined
    return api.onFailed((payload) => {
      const items = authFailureRootItemsRef.current
      const request = findRequestById(items, payload.authRequestId)
      if (!request) return
      const { breadcrumbs } = findItemWithBreadcrumbs(items, payload.authRequestId)
      const reason = payload.reason && payload.reason.trim() !== ''
        ? payload.reason
        : t('authFailureToast.fallbackReason', 'The authentication request did not succeed.')
      // Dedupe id used both for `push` (so a burst collapses to one
      // toast) and for the explicit dismiss when the user clicks the
      // navigation link. Dismiss before opening the tab so the toast
      // disappears in the same event tick — feels snappier and
      // sidesteps a brief flash where the toast still hovers over the
      // freshly-opened auth tab.
      const toastId = `auth-failure-${payload.authRequestId}`
      const handleOpen = (): void => {
        toasterService.dismiss('app', toastId)
        authFailureOpenTabRef.current(request, breadcrumbs)
      }
      toasterService.push('app', {
        // De-duplicate per auth-request id: a burst of failures (e.g.
        // OData $batch) collapses to one visible toast that updates
        // its `reason` in place rather than stacking N copies. The
        // same id is what `handleOpen` dismisses on click.
        id: toastId,
        title: t('authFailureToast.title', 'Authentication failed'),
        body: (
          <div data-testid="auth-failure-toast">
            <div style={{ marginBottom: 6 }}>{reason}</div>
            <a
              role="button"
              tabIndex={0}
              data-testid="auth-failure-toast-open-link"
              onClick={(e) => { e.preventDefault(); handleOpen() }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleOpen()
                }
              }}
              style={{
                cursor: 'pointer',
                color: 'var(--linkForeground, #3794ff)',
                textDecoration: 'underline'
              }}
            >
              {t('authFailureToast.openAuthRoute', 'Open authentication route')}
            </a>
          </div>
        ),
        durationMs: 8000,
        ariaLive: 'assertive'
      })
    })
  }, [t])

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
  // primary storage grain for the env model. Walked from breadcrumbs
  // so it stays in sync with the workbench's active selection. `null`
  // when no env-folder ancestor exists (the selector then runs
  // without persistence).
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
  useEffect(() => {
    // When no request tab is active, the button is unmounted anyway
    // (see `{activeRequest && ...}` in the statusbar render), so the
    // probe value is unread and left stale on purpose — avoids a
    // setState-in-effect for a value nobody reads. The probe is tagged
    // with the fetched request id so callers ignore it when stale.
    if (!activeRequestId) return
    const requestId = activeRequestId
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const entries = await getResponseHistoryList(requestId)
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
  }, [activeRequestId])

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

  // Bridge the AutoSaveController's `'file:autosave-trigger'` IPC to
  // the existing save-all flow. The controller (in main) owns the
  // when; the renderer owns the how.
  useEffect(() => {
    const unsub = window.api.file.onAutoSaveTrigger(() => {
      void handleMenuSaveAll().catch((err: unknown) => {
        logger.error('[App] Autosave failed', { error: String(err) })
      })
    })
    return () => { unsub() }
  }, [handleMenuSaveAll])

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
    handleCreateRootFolder,
    handleCreateRootEnvironmentFolder,
    handleAddChildItem,
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
    openEnvironmentFolderTab,
    openAnyRequestTab,
    projectUuid
  })

  const requestCreationApi = useRequestCreationApi({
    rootItems,
    setRootItems,
    setExpandedIds,
    setSelectedItemId,
    openAnyRequestTab
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

  // Drives the conditional `right-aligned` on the bell vs the MCP
  // indicator: at most one of them should carry `margin-left: auto`,
  // otherwise both push right and the second one ends up stranded in
  // the middle of the statusbar.
  const mcpEnabled = useMcpEnabled()

  // Wire MCP active-state push (renderer → main, drives `get_current_tab`)
  // + MCP nav listeners (main → renderer, drives `open_tab` / `reveal_in_tree`).
  // Both no-op when MCP is disabled. `envByFolder` stays empty for now —
  // populating it requires per-folder env-selector state we don't track
  // centrally yet; `get_active_env` falls back to the folder's first env.
  useMcpActiveStateBridge({
    enabled: mcpEnabled,
    tabId: null,
    itemId: activeRequest?.id ?? null,
    kind: activeRequest ? 'request' : null,
    envByFolder: {}
  })
  // `handleCloseTabById` is declared further down (it depends on
  // `setWorkbenchTree` which itself depends on hooks declared after
  // this block). Indirect via a ref so we can hand a stable callback
  // to `useMcpNavigation` without hitting the temporal dead zone.
  // The ref is patched by an effect once `handleCloseTabById` exists.
  const closeTabByItemIdRef = useRef<(itemId: string) => void>(() => { /* not yet wired */ })
  const closeTabByItemIdStable = useCallback((itemId: string) => { closeTabByItemIdRef.current(itemId) }, [])
  useMcpNavigation({
    enabled: mcpEnabled,
    rootItems,
    setExpandedIds,
    openFolderTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    closeTabByItemId: closeTabByItemIdStable
  })
  // Set to `true` by `useMcpTreeReplace` immediately before each MCP-
  // driven `setRootItems` call; read by the `setCollections` effect
  // below so the zustand store sees `source: 'mcp'` and skips the
  // main-side mirror (main is already canonical for MCP-driven
  // mutations — roundtripping would clobber its class instances).
  // The hook flips the ref true; the effect reads + resets it.
  const mcpDrivenRef = useRef(false)
  useMcpTreeReplace({ enabled: mcpEnabled, setRootItems, mcpDrivenRef })
  useMcpRunRequest({ enabled: mcpEnabled })
  // Forward-ref dance: `bumpTabContentVersionFor` is declared further
  // down (depends on `setWorkbenchTree`). Hand the patch hook a stable
  // wrapper that reads the ref so we can wire it up without restructuring
  // the file. The ref is patched by the effect right after the bump
  // helper exists.
  const bumpTabContentVersionRef = useRef<(itemId: string) => void>(() => { /* not yet wired */ })
  const bumpTabContentVersionStable = useCallback((itemId: string) => { bumpTabContentVersionRef.current(itemId) }, [])
  useMcpRequestPatch({ enabled: mcpEnabled, rootItems, bumpTabContentVersionFor: bumpTabContentVersionStable })
  useMcpFolderPatch({ enabled: mcpEnabled, rootItems, bumpTabContentVersionFor: bumpTabContentVersionStable })
  // MCP `set_favorite` listener — call the same toggle/remove path the
  // sidebar buttons use, then bump the tab content version so the H1
  // star repaints. `handleToggleFavorite` is declared further down so
  // we route through a forward-ref (same trick as bumpTabContentRef).
  const setFavoriteRefRef = useRef<(itemId: string, favorite: boolean | null) => void>(() => { /* not yet wired */ })
  useEffect(() => {
    if (!mcpEnabled) return
    const root = window as { restorm?: { runtime?: { onMcpSetFavorite?: (cb: (payload: { itemId: string; favorite: boolean | null }) => void) => () => void } } }
    const off = root.restorm?.runtime?.onMcpSetFavorite?.(({ itemId, favorite }) => {
      setFavoriteRefRef.current(itemId, favorite)
    })
    return () => { off?.() }
  }, [mcpEnabled])

  // Per-pane inline-edit targets so a rename triggered from Favorites
  // or Opened opens the input in that pane (not the Workspace tree row).
  const [favoritesEditingItemId, setFavoritesEditingItemId] = useState<string | null>(null)
  const [openedEditingItemId, setOpenedEditingItemId] = useState<string | null>(null)
  const handleStartRenameInFavorites = useCallback((itemId: string) => {
    setFavoritesEditingItemId(itemId)
  }, [])
  const handleStartRenameInOpened = useCallback((itemId: string) => {
    setOpenedEditingItemId(itemId)
  }, [])
  const handleFavoritesEditingEnd = useCallback(() => {
    setFavoritesEditingItemId(null)
  }, [])
  const handleOpenedEditingEnd = useCallback(() => {
    setOpenedEditingItemId(null)
  }, [])

  // Favorites management — keyed by projectUuid so the list follows
  // the project across external renames/moves.
  const [favoritesVersion, setFavoritesVersion] = useState(0)
  const isItemFavorite = useCallback((itemId: string): boolean => {
    void favoritesVersion // React dep
    if (!projectUuid) return false
    return favoritesStoreIsFavorite(projectUuid, itemId)
  }, [projectUuid, favoritesVersion])

  // Bump `contentVersion` on every workbench tab whose underlying
  // request matches `itemId`. EditorGroupView caches each tab's
  // rendered React tree until contentVersion flips — without this, a
  // favorite toggle wouldn't propagate to the H1 star toggle (the
  // cached node still holds the old `isFavorite` prop).
  const bumpTabContentVersionFor = useCallback((itemId: string): void => {
    setWorkbenchTree((prev) => {
      const walk = (nodes: GroupNode[]): GroupNode[] => nodes.map((n) => {
        if (isContainerNode(n)) return { ...n, groups: walk(n.groups) }
        if (!isTabGroupNode(n)) return n
        const tabs = n.tabs.map((tab) =>
          tabMatchesItem(tab, itemId)
            ? { ...tab, contentVersion: (tab.contentVersion ?? 0) + 1 }
            : tab
        )
        return { ...n, tabs }
      })
      return { ...prev, groups: walk(prev.groups) }
    })
  }, [])
  // Patch the forward-ref consumed by `useMcpRequestPatch` (above).
  useEffect(() => { bumpTabContentVersionRef.current = bumpTabContentVersionFor }, [bumpTabContentVersionFor])

  const handleToggleFavorite = useCallback((itemId: string): void => {
    if (!projectUuid) return
    favoritesStoreToggle(projectUuid, itemId)
    setFavoritesVersion((v) => v + 1)
    bumpTabContentVersionFor(itemId)
  }, [projectUuid, bumpTabContentVersionFor])
  // Patch the forward-ref consumed by the MCP `set_favorite` listener
  // (above). Routes through `addFavorite` / `removeFavorite` when an
  // explicit value is given, otherwise toggles.
  useEffect(() => {
    setFavoriteRefRef.current = (itemId: string, favorite: boolean | null): void => {
      if (!projectUuid) return
      if (favorite === true) {
        favoritesStoreAdd(projectUuid, itemId)
      } else if (favorite === false) {
        favoritesStoreRemove(projectUuid, itemId)
      } else {
        favoritesStoreToggle(projectUuid, itemId)
      }
      setFavoritesVersion((v) => v + 1)
      bumpTabContentVersionFor(itemId)
    }
  }, [projectUuid, bumpTabContentVersionFor])

  const handleUnfavorite = useCallback((itemId: string): void => {
    if (!projectUuid) return
    favoritesStoreRemove(projectUuid, itemId)
    bumpTabContentVersionFor(itemId)
  }, [projectUuid, bumpTabContentVersionFor])

  const handleFavoritesReorder = useCallback((orderedIds: string[]): void => {
    if (!projectUuid) return
    favoritesStoreReorder(projectUuid, orderedIds)
  }, [projectUuid])

  const handleCloseTabById = useCallback((itemId: string): void => {
    setWorkbenchTree((prev) => {
      const filterGroup = (g: GroupNode): GroupNode => {
        if (isContainerNode(g)) {
          return { ...g, groups: g.groups.map(filterGroup).filter((c) => !isTabGroupNode(c) || c.tabs.length > 0) }
        }
        const match = g.tabs.find((t) => tabMatchesItem(t, itemId))
        if (!match) return g
        const tabs = g.tabs.filter((t) => t.id !== match.id)
        const activeTabId = g.activeTabId === match.id ? tabs[0]?.id ?? '' : g.activeTabId ?? ''
        return { ...g, tabs, activeTabId }
      }
      const groups = prev.groups.map(filterGroup).filter((g) => !isTabGroupNode(g) || g.tabs.length > 0)
      return { ...prev, groups }
    })
  }, [])
  // Patch the forward-reference ref consumed by `useMcpNavigation` (above).
  useEffect(() => { closeTabByItemIdRef.current = handleCloseTabById }, [handleCloseTabById])

  // Close-others / close-to-the-right are scoped to the group containing
  // the targeted tab — VSCode-style semantics. The Workspace stays
  // intact across other split groups; if the user wants a global wipe
  // they call Close all.
  const handleCloseOtherTabsById = useCallback((itemId: string): void => {
    setWorkbenchTree((prev) => {
      const trim = (g: GroupNode): GroupNode => {
        if (isContainerNode(g)) return { ...g, groups: g.groups.map(trim) }
        const keep = g.tabs.find((t) => tabMatchesItem(t, itemId))
        if (!keep) return g
        return { ...g, tabs: [keep], activeTabId: keep.id }
      }
      return { ...prev, groups: prev.groups.map(trim) }
    })
  }, [])

  const handleCloseTabsToTheRightById = useCallback((itemId: string): void => {
    setWorkbenchTree((prev) => {
      const trim = (g: GroupNode): GroupNode => {
        if (isContainerNode(g)) return { ...g, groups: g.groups.map(trim) }
        const idx = g.tabs.findIndex((t) => tabMatchesItem(t, itemId))
        if (idx < 0) return g
        const tabs = g.tabs.slice(0, idx + 1)
        const activeTabId = tabs.some((t) => t.id === g.activeTabId) ? g.activeTabId ?? '' : (tabs[idx]?.id ?? '')
        return { ...g, tabs, activeTabId }
      }
      return { ...prev, groups: prev.groups.map(trim) }
    })
  }, [])

  const handleCloseAllTabs = useCallback((): void => {
    setWorkbenchTree({ orientation: 'vertical', groups: [] })
  }, [])

  // Sync favoritesVersion when favorites change from other sources (e.g. home page trash button)
  React.useEffect(() => {
    const handler = (): void => { setFavoritesVersion((v) => v + 1) }
    window.addEventListener('restorm:favorites-changed', handler)
    return () => { window.removeEventListener('restorm:favorites-changed', handler) }
  }, [])

  const apiUpdateStateMap = useApiUpdateStateMap()
  const hasApiUpdateAvailable = useCallback((id: string): boolean => apiUpdateStateMap[id]?.kind === 'available', [apiUpdateStateMap])

  const [refreshSourceTarget, setRefreshSourceTarget] = useState<{ id: string; name: string } | null>(null)
  const canRefreshFromSource = useCallback((id: string): boolean => {
    const folder = rootItems.find((c) => isEnvironmentFolder(c) && c.id === id)
    if (!folder) return false
    const apiUpdate = (folder as unknown as { apiUpdate?: { sourceUrl?: string } }).apiUpdate
    return Boolean(apiUpdate?.sourceUrl)
  }, [rootItems])
  const onRefreshFromSource = useCallback((id: string): void => {
    const folder = rootItems.find((c) => isEnvironmentFolder(c) && c.id === id)
    if (!folder || !('name' in folder)) return
    setRefreshSourceTarget({ id, name: folder.name })
  }, [rootItems])

  const { favoriteItems, openDocumentItems } = useFavoritesAndOpenItems({
    rootItems,
    workbenchTree,
    projectUuid,
    updateCount,
    isItemFavorite,
    onRenameFavoriteItem: handleStartRenameInFavorites,
    onRenameOpenedItem: handleStartRenameInOpened,
    onCloneItem: handleCloneItem,
    onDeleteItem: handleDeleteItem,
    onToggleFavorite: handleToggleFavorite,
    onUnfavorite: handleUnfavorite,
    onCloseTab: handleCloseTabById,
    onCloseOtherTabs: handleCloseOtherTabsById,
    onCloseTabsToTheRight: handleCloseTabsToTheRightById,
    onCloseAllTabs: handleCloseAllTabs
  })

  const { sidebarItems: sidebarItemsWithContextMenu } = useSidebarState({
    rootItems,
    expandedIds,
    updateCount,
    onCloneItem: handleCloneItem,
    onAddChildItem: handleAddChildItem,
    onDeleteItem: handleDeleteItem,
    onRenameItem: handleSidebarRenameItem,
    isItemFavorite,
    onToggleFavorite: handleToggleFavorite,
    canRefreshFromSource,
    onRefreshFromSource,
    hasApiUpdateAvailable
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

  // Send-time hook: request tab views call this to resolve their
  // `authenticationRequestId` back to the AuthenticationRequest
  // sitting in `rootItems`, so the IPC call carries the full auth
  // document the main-process executor needs.
  const resolveAuthRequestCb = useCallback<AuthRequestResolver>((id) => {
    const found = findRequestById(rootItems, id)
    return found && isAuthenticationRequest(found) ? found : null
  }, [rootItems])

  const environmentFolderCollectionsRef = useRef(environmentFolderCollections)
  useEffect(() => {
    environmentFolderCollectionsRef.current = environmentFolderCollections
  }, [environmentFolderCollections])

  // Keep collections store in sync for request path resolution.
  // When the change came from MCP (`mcpDrivenRef`), pass `'mcp'` so
  // the zustand store skips the main-side mirror — main already has
  // the up-to-date tree. Reset the ref on the same tick.
  useEffect(() => {
    const source = mcpDrivenRef.current ? 'mcp' : 'user'
    if (mcpDrivenRef.current) mcpDrivenRef.current = false
    setCollections(environmentFolderCollections, source)
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
  const handleMenuCloseRef = useRef<() => Promise<void>>(async () => {
    // Stub until useFileManagement populates the real handler below.
  })
  useEffect(() => {
    handleMenuCloseRef.current = handleMenuClose
  }, [handleMenuClose])

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
        menuClose: () => Promise<void>
      }
    }).__restormTestHelpers = {
      loadFile: (fileState: { currentFile: { content: unknown } }) => {
        // Use ref to ensure we call the latest version
        handleFileOpenedRef.current(fileState)
      },
      setRootItems: (items: (EnvironmentFolder | Folder | Request)[]) => {
        // Folders/env-folders go through `makeReactiveFolder`; root-level
        // requests go through `makeReactiveRequest` (no parent id) so
        // edits emit `REQUEST_UPDATED` like nested requests.
        const reactiveItems = items.map((item) =>
          'items' in item ? makeReactiveFolder(item) : makeReactiveRequest(item)
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
      menuClose: async (): Promise<void> => {
        // Trigger the same code path as File → Close in the menu bar
        // (`handleMenuClose` → `checkUnsavedChanges`), so the E2E can
        // exercise discard-branch invariants the bypass `closeFile`
        // helper above intentionally skips.
        navigationService.clearHistory()
        await handleMenuCloseRef.current()
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

  // Listen to document changes and update per-tab dirty state (works in all modes).
  // The checksum update triggers a setState in useDirtyState, which re-renders App and
  // cascades to every tab view. To avoid disturbing actively-typed Monaco editors, we
  // debounce the checksum update per document id so a typing burst produces a single
  // update after the user settles.
  const dirtyChecksumTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const upsertTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
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

    // Per-id debounce for the save-unit draft IPC. Typing in a
    // metadata-heavy OData request (1000+ entitySetProperties /
    // navigationProperties) means each keystroke emits REQUEST_UPDATED
    // and the JSON.stringify + cleanse + IPC round-trip dominates the
    // frame budget. Buffering keystrokes into a single upsert once the
    // user pauses keeps crash-recovery drafts fresh (worst case a
    // 300ms window lost if the app dies mid-typing) without killing
    // the input's responsiveness.
    const UPSERT_DEBOUNCE_MS = 300
    const doUpsert = (payload: DocumentChangedPayload): void => {
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

    const handleUpsert = (payload: DocumentChangedPayload): void => {
      if (!payload.id) return
      const existing = upsertTimersRef.current.get(payload.id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        upsertTimersRef.current.delete(payload.id)
        doUpsert(payload)
      }, UPSERT_DEBOUNCE_MS)
      upsertTimersRef.current.set(payload.id, timer)
    }

    // CREATED events bypass the debounce — the save-unit registry must
    // know about a new unit before any subsequent modify events land.
    const handleUpsertImmediate = (payload: DocumentChangedPayload): void => {
      doUpsert(payload)
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
      eventBus.subscribe(DocumentEvents.FOLDER_CREATED, handleUpsertImmediate),
      eventBus.subscribe(DocumentEvents.REQUEST_CREATED, handleUpsertImmediate),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_CREATED, handleUpsertImmediate),
      eventBus.subscribe(DocumentEvents.FOLDER_DELETED, handleDelete),
      eventBus.subscribe(DocumentEvents.REQUEST_DELETED, handleDelete),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_DELETED, handleDelete)
    ]

    const timersMap = dirtyChecksumTimersRef.current
    const upsertTimers = upsertTimersRef.current
    return () => {
      for (const sub of subscriptions) {
        sub.unsubscribe()
      }
      for (const timer of timersMap.values()) {
        clearTimeout(timer)
      }
      timersMap.clear()
      for (const timer of upsertTimers.values()) {
        clearTimeout(timer)
      }
      upsertTimers.clear()
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
        <AuthRequestResolverContext.Provider value={resolveAuthRequestCb}>
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
        <RequestCreationProvider value={requestCreationApi}>
        <Dock
          ref={sidebarDockRef}
          side="left"
          size={sidebarDockSize}
          onSizeChange={setSidebarDockSize}
          collapsed={sidebarDockCollapsed}
          onCollapsedChange={setSidebarDockCollapsed}
          minSize={MIN_LEFT_WIDTH}
          collapsedSize={34}
          data-testid="app-dock-sidebar"
          panelOverlay={
            <Button
              icon={sidebarDockCollapsed ? 'chevron-right' : 'chevron-left'}
              options={{
                ariaLabel: sidebarDockCollapsed
                  ? t('sidebar.expand', 'Expand sidebar')
                  : t('sidebar.collapse', 'Collapse sidebar')
              }}
              data-testid="restorm-main-sidebar-toggle"
              onClick={(): void => { sidebarDockRef.current?.toggle() }}
              className="restorm-main-sidebar-panel__toggle"
              style={{ bottom: 0, right: 0, position: 'absolute' }}
            />
          }
          panel={
            <div className="restorm-main-sidebar-panel">
              <div className="restorm-main-sidebar-panel__body">
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
                  onAddChildItem={handleAddChildItem}
                  onDeselectAll={() => { setSelectedItemId(null) }}
                  favoriteItems={favoriteItems}
                  openDocumentItems={openDocumentItems}
                  onFavoritesReorder={handleFavoritesReorder}
                  panesCollapsed={panesCollapsed}
                  onPanesCollapsedChange={setPanesCollapsed}
                  favoritesEditingItemId={favoritesEditingItemId}
                  openedEditingItemId={openedEditingItemId}
                  onFavoritesEditingEnd={handleFavoritesEditingEnd}
                  onOpenedEditingEnd={handleOpenedEditingEnd}
                />
              </div>
            </div>
          }
        >
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
        </Dock>
        </RequestCreationProvider>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
            emptyFallback={
              <WelcomeScreen
                name="Restorm"
                ariaLabel={t('welcome.landmarkLabel')}
                onOpenFile={(path) => { void window.restorm?.file.openPath(path) }}
                confirmRemoveFavorite={(fileName) => window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))}
                emptyStateHint={t('welcome.noFilesHint')}
              >
                <Button
                  appearance="rainbow"
                  size="xl"
                  onClick={() => { navigationService.clearHistory(); void handleMenuNew() }}
                  options={{ ariaLabel: t('welcome.newAriaLabel') }}
                  data-testid="welcome-new-button"
                >
                  {t('menuBar.new')}
                </Button>
                <Button
                  appearance="rainbow"
                  size="xl"
                  onClick={() => { void handleMenuOpen() }}
                  options={{ ariaLabel: t('welcome.openAriaLabel') }}
                  data-testid="welcome-open-button"
                >
                  {t('menuBar.open')}
                </Button>
              </WelcomeScreen>
            }
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

      {/* Pre-compute which status-bar entries actually mount so the
          FIRST visible right-side cell carries `right-aligned`
          (margin-left: auto). Only the leftmost-of-the-right needs
          the auto margin; the rest follow naturally to its right. */}
      <Statusbar data-testid="app-statusbar">
        {filePath && <StatusbarElement data-testid="app-statusbar-element" title={filePath} />}
        <DesktopIndicator />
        {(() => {
          if (!activeRequest || !activeEnvFolderId) return null
          const reactiveActiveRequest = findRequestById(rootItems, activeRequest.id)
          const activeEnvFolder = findFolderById(rootItems, activeEnvFolderId)
          if (!reactiveActiveRequest || !activeEnvFolder) return null
          if (!shouldShowAuthSelector(reactiveActiveRequest, activeEnvFolder.items)) return null
          return (
            <StatusbarAuthSelector
              activeRequest={reactiveActiveRequest}
              envFolderItems={activeEnvFolder.items}
              rightAligned
            />
          )
        })()}
        {(() => {
          if (!activeRequest || activeRequestEnvironments.length === 0) return null
          // Only push env right when no auth selector to its left.
          const authActive = !!activeEnvFolderId && (() => {
            const folder = findFolderById(rootItems, activeEnvFolderId)
            const req = findRequestById(rootItems, activeRequest.id)
            return !!(folder && req && shouldShowAuthSelector(req, folder.items))
          })()
          return (
            <EnvironmentProvider
              environments={activeRequestEnvironments}
              persistenceKey={activeEnvPersistenceKey}
            >
              <StatusbarEnvironmentSelector
                folderRequestIds={activeEnvFolderRequestIds}
                projectUuid={projectUuid}
                rightAligned={!authActive}
              />
            </EnvironmentProvider>
          )
        })()}
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
        {/* MCP indicator (only when restorm runs in MCP mode). When
         * mounted and there's nothing else right-aligned, MCP carries
         * the auto margin and the bell flows naturally to its right.
         * The bell takes the auto margin only when MCP isn't going
         * to render (mcp disabled) — otherwise both would each
         * consume their own margin slot and MCP would be stranded
         * mid-bar. */}
        <StatusbarMcpIndicator rightAligned={!activeRequest} />
        <StatusBarBellButton
          toasterId="app"
          {...(!activeRequest && !mcpEnabled ? { className: 'right-aligned' } : {})}
        />
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

          {/* Import Modal — doubles as the "Refresh from source"
              wizard when `refreshContext` is provided. The host
              builds the context from the env folder's stored
              apiUpdate config so the modal can pre-fill the URL,
              attach the saved auth route, and let main compute the
              locked-keys set from the existing folder content. */}
          <ImportModal
            isOpen={showImportModal || refreshSourceTarget !== null}
            onClose={() => {
              setShowImportModal(false)
              setRefreshSourceTarget(null)
            }}
            onImport={handleImport}
            {...(refreshSourceTarget ? (() => {
              const targetId = refreshSourceTarget.id
              const folder = rootItems.find(
                (c): c is EnvironmentFolder => isEnvironmentFolder(c) && c.id === targetId
              )
              const apiUpdate = (folder as unknown as { apiUpdate?: { sourceUrl?: string; authenticationRequestId?: string } } | undefined)?.apiUpdate
              const sourceUrl = apiUpdate?.sourceUrl ?? ''
              // The resolver returns the shared/types AuthenticationRequest
              // (data shape, no class methods), while RefreshContext —
              // matching the rest of ImportModal — types it as the
              // shared/models class. The runtime payload is the same
              // (the renderer carries reactive proxies whose getters
              // return primitive values), so cast through `unknown`.
              const authReq = (apiUpdate?.authenticationRequestId
                ? resolveAuthRequestCb(apiUpdate.authenticationRequestId)
                : null) as RefreshContext['authenticationRequest'] | null
              const refreshContext: RefreshContext = {
                sourceUrl,
                ...(authReq ? { authenticationRequest: authReq } : {}),
                targetFolderId: targetId,
                onApplied: (updatedFolder) => {
                  // Splice the apply payload onto the existing env
                  // folder in rootItems: each added request is
                  // attached at the breadcrumb path main produced
                  // (so a Swagger op tagged "Other" lands inside the
                  // existing "Other" folder instead of at the env
                  // root). The apiUpdate marker is swapped wholesale.
                  // We DON'T replace the whole folder — sub-
                  // environments / per-tab pinning / other renderer-
                  // only state would be lost since they may not have
                  // round-tripped to main yet.
                  interface AddedRequestPayload {
                    request: unknown
                    parentPath: string[]
                  }
                  interface ApplyPayload {
                    id: string
                    addedRequests: AddedRequestPayload[]
                    apiUpdate: unknown
                  }
                  const payload = updatedFolder as ApplyPayload | null
                  if (!payload?.id) {
                    setRefreshSourceTarget(null)
                    return
                  }
                  setRootItems((current) => current.map((item) => {
                    if (!('id' in item) || item.id !== payload.id) return item
                    if (!('items' in item)) return item
                    const next = item as Folder
                    const placeAt = (
                      items: FolderItem[],
                      path: readonly string[],
                      reactiveRequest: FolderItem
                    ): FolderItem[] => {
                      if (path.length === 0) return [...items, reactiveRequest]
                      const [head, ...rest] = path
                      const targetIdx = items.findIndex(
                        (child) => 'items' in child
                          && (child as Folder).name === head
                          && (child as { folderType?: string }).folderType !== 'environment'
                      )
                      if (targetIdx === -1) {
                        // Folder doesn't exist yet — fall back to root
                        // append rather than fabricating one client-
                        // side. Main has already created the folder
                        // in its own copy; the next collections sync
                        // reconciles the structure.
                        return [...items, reactiveRequest]
                      }
                      const folder = items[targetIdx] as Folder
                      const updatedFolder: Folder = {
                        ...folder,
                        items: placeAt(folder.items, rest, reactiveRequest)
                      }
                      return [
                        ...items.slice(0, targetIdx),
                        updatedFolder,
                        ...items.slice(targetIdx + 1)
                      ]
                    }
                    const updated = payload.addedRequests.reduce<FolderItem[]>(
                      (items, entry) => placeAt(
                        items,
                        entry.parentPath,
                        makeReactiveRequest(entry.request as never) as FolderItem
                      ),
                      next.items
                    )
                    return {
                      ...next,
                      items: updated,
                      ...(payload.apiUpdate ? { apiUpdate: payload.apiUpdate } : {})
                    } as typeof item
                  }))
                  setRefreshSourceTarget(null)
                }
              }
              return { refreshContext }
            })() : {})}
          />
        </div>
        </AuthRequestResolverContext.Provider>
      </VariableTransformProvider>
    </AvailableVariablesProvider>
  )
}

export default App
