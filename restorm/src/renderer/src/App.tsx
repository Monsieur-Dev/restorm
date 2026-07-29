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
  toasterService,
  useMcpMiniBrowserBridge,
  clearConsoleFeed,
  registerConsoleFeedSource,
  registerMcpLogsSource,
  McpLogsPanel,
  Modal,
  type MiniBrowserBridgeApi,
  type ConsoleFeedSource,
  type McpLogsSource,
  type McpLogsLabels,
  GitHistoryView,
  type GitHistoryCommit
} from 'electron-core-ui/renderer'
import { PROJECT_UUID_KEY } from '../../shared/config/projectUuid'
import { preloadRequestPanelStates, removeRequestPanelState } from './services/requestPanelStateStore'
import { preloadScenarioViewports } from './services/scenarioViewportStore'
import { preloadScenarioBreakpoints } from './services/scenarioBreakpointStore'
import { HTTPRequest } from '../../shared/models/requests/HTTPRequest'
import { SoapRequest } from '../../shared/models/requests/SoapRequest'
import { GrpcRequest } from '../../shared/models/requests/GrpcRequest'
import { GraphQLRequest } from '../../shared/models/requests/GraphQLRequest'
import { WebSocketRequest } from '../../shared/models/requests/WebSocketRequest'
import { SseRequest } from '../../shared/models/requests/SseRequest'
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
// Debounce handle + latest save-all callback for the scenario-edit autosave
// (see handleScenarioChange). Module-scoped (single App instance) so the
// debounced timer always invokes the current `handleMenuSaveAll` — capturing it
// in the timer closure would save a stale `rootItems` snapshot.
//
// `usePushModal`'s `saveBeforePush` reuses this SAME latest-ref for the same
// reason: `usePushModal(...)` is called before `handleMenuSaveAll` exists
// yet (a few lines down in this component), so it can't take the callback
// directly without reordering hooks — `latestSaveAll` already solves exactly
// that "need the current callback despite an ordering constraint" problem.
let scenarioSaveTimer: ReturnType<typeof setTimeout> | null = null
let latestSaveAll: (() => Promise<boolean>) | null = null

/** Flush the live in-memory tree to disk via the current save-all callback,
 * reporting whether the save succeeded. A `null` ref (save-all not mounted
 * yet) resolves `true` — the git actions only ever run from a user click well
 * after mount, so this is a defensive fallback, not an expected path. Shared
 * by the Push flow (`saveBeforePush`) and the Pull flow (`useGitActions`):
 * both must persist pending edits before touching git, since git reads/merges
 * whatever is on disk. `handleMenuSaveAll` writes only when the tree actually
 * changed, so a clean git op leaves the file untouched. */
function saveAllForGit(): Promise<boolean> {
  return latestSaveAll ? latestSaveAll() : Promise.resolve(true)
}

/** Adapter: `usePushModal`'s `saveBeforePush` wants `Promise<void>`. */
function saveBeforePush(): Promise<void> {
  return saveAllForGit().then(() => undefined)
}

/**
 * Cancel any pending scenario-edit autosave. MUST run on file-close and
 * on App unmount: otherwise the module-scoped debounce timer can fire
 * AFTER teardown and serialize the just-closed (or a previous) project's
 * tree over the freshly-opened one. Also drops the stale save callback.
 */
function cancelScenarioSaveTimer(): void {
  if (scenarioSaveTimer) {
    clearTimeout(scenarioSaveTimer)
    scenarioSaveTimer = null
  }
  latestSaveAll = null
}

const classForDocument = (type: 'folder' | 'request' | 'environment', doc: Record<string, unknown>): object => {
  if (type === 'request') {
    const t = doc['type']
    if (t === 'soap') return SoapRequest
    if (t === 'grpc') return GrpcRequest
    if (t === 'graphql') return GraphQLRequest
    if (t === 'websocket') return WebSocketRequest
    if (t === 'sse') return SseRequest
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
import { DocumentEvents, type DocumentChangedPayload, type DocumentDeletedPayload } from './services/DocumentEvents'
import type { EditorTab, WorkbenchTree, GroupNode, TabGroupNode, ContainerGroupNode } from 'electron-core-ui/renderer'
import { isContainerNode, isTabGroupNode, loadWorkbenchTabIds, useSetting, LIST_VIEW_DRAG_MIME } from 'electron-core-ui/renderer'
import type { SplitDirection } from 'electron-core-ui/renderer'
import { REOPEN_LAST_FILE_STORAGE_KEY, REOPEN_LAST_FILE_SETTING_KEY } from '../../shared/config/reopenLastFile'
import { CONSOLE_TAB_ID, FIREWALL_TAB_ID, MINI_BROWSER_TAB_ID, SETTINGS_TAB_ID, MCP_LOGS_TAB_ID, type ConsoleTab, type FirewallTab, type MiniBrowserTab, type SettingsTab, type McpLogsTab } from '../../shared/types/editor'
import { findGroupIdForTab, hasGroupWithId, updateGroupById } from './utils/workbenchHelpers'
import { pruneOrphanTabs } from './utils/workbenchTabs'
import { findTopLevelEnvironment } from './utils/envSaveUnit'

/**
 * Match a workbench tab by the underlying item id (request / folder /
 * env-folder id stored in `rootItems`). The tab's own `.id` is a
 * synthetic key (e.g. `request-idx:0.1.5`) and never appears in
 * `rootItems`. The Open documents + Favorites panes address rows by
 * the underlying id, so close handlers triggered from those panes
 * must look through to `tab.request?.id` / `tab.folder?.id`.
 */
type ItemBackedTab = EditorTab & { request?: { id?: string }; folder?: { id?: string }; scenario?: { id?: string } }
const tabMatchesItem = (tab: EditorTab, itemId: string): boolean => {
  const t = tab as ItemBackedTab
  // A tab is backed by a request, a (env-)folder, OR a scenario — match all
  // three so MCP open/close/reveal-by-id works for scenario tabs too (their id
  // lives on `scenario`, not `request`/`folder`).
  return t.request?.id === itemId || t.folder?.id === itemId || t.scenario?.id === itemId
}
import { Onboarding } from './components/MainView/Workbench/Onboarding'
import { RestormTitlebar } from './components/MainView/Titlebar/RestormTitlebar'
import { StatusbarMcpIndicator } from './components/MainView/StatusbarMcpIndicator'
import { UpdateNotifications } from './components/UpdateNotifications'
import { CrashConsentPrompt } from './components/Privacy/CrashConsentPrompt'
import { CrashReportReviewHost } from './components/Privacy/CrashReportReviewHost'
import { StatusbarGitIndicator } from './components/MainView/StatusbarGitIndicator'
import { StatusbarPathActionsHost } from './components/MainView/StatusbarPathActions'
import { useGitPendingFlags } from './hooks/useGitPendingFlags'
import { ScenarioToastBody, ScenarioToastTitle } from './components/ScenarioToastBody'
import { useMcpEnabled } from './hooks/useMcpEnabled'
import { useMcpActiveStateBridge } from './hooks/useMcpActiveStateBridge'
import { useMcpNavigation } from './hooks/useMcpNavigation'
import { useExternalFileChange } from './hooks/useExternalFileChange'
import { useGitMergeInProgressToast } from 'electron-core-ui/renderer'
import { useGitFolder } from './hooks/useGitFolder'
import { useUserDateFormat } from './hooks/useUserDateFormat'
import { useGitActions } from './hooks/useGitActions'
import { usePushModal } from './hooks/usePushModal'
import { useGitPullConflict } from './hooks/useGitPullConflict'
import { GitUpdateRequiredModal } from './components/GitConflict/GitUpdateRequiredModal'
import { GitResetToServerConfirmModal } from './components/GitConflict/GitResetToServerConfirmModal'
import { GitRecoverVersionConfirmModal } from './components/GitConflict/GitRecoverVersionConfirmModal'
import { useGitUpdateActions } from './hooks/useGitUpdateActions'
import { GitConflictResolutionModal } from './components/GitConflict/GitConflictResolutionModal'
import { useMcpTreeReplace } from './hooks/useMcpTreeReplace'
import { useMcpRunRequest } from './hooks/useMcpRunRequest'
import { useMcpRequestPatch } from './hooks/useMcpRequestPatch'
import { useMcpWorkbenchTabsBridge } from './hooks/useMcpWorkbenchTabsBridge'
import { useMcpWorkbenchLayout } from './hooks/useMcpWorkbenchLayout'
import { useMcpFolderPatch } from './hooks/useMcpFolderPatch'
import { useScenarioSuggestionsBridge } from './testing/scenarioSuggestionsBridge'
import { useE2eDocumentUpdateBridge } from './testing/e2eDocumentUpdateBridge'
import { RestormSidebar } from './components/MainView/Sidebar/RestormSidebar'
import { RestormWorkbenchContainer } from './components/MainView/Workbench/RestormWorkbenchContainer'
import { suggestRunTarget } from '../../shared/scenarioRunTarget'
import { ScenarioCliInfoProvider } from './contexts/scenarioRunTargetContext'
import { SaveOptionsModal } from './components/Modals/SaveOptionsModal'
import { DeleteConfirmationModal } from './components/Modals/DeleteConfirmationModal'
import { RequestScenarioDeleteModal, type RequestScenarioDeleteUsage } from './components/Modals/RequestScenarioDeleteModal'
import { removeItemFromTree } from './utils/treeManipulation'
import { ImportModal, type RefreshContext } from './components/Modals/ImportModal'
import { allLeafKeys } from './components/Modals/importSelectionHelpers'
import { ApiSpecRefreshFlow } from './components/Folders/ApiSpecRefreshFlow'
import { AvailableVariablesProvider } from './contexts/AvailableVariablesContext'
import { VariableTransformProvider } from './contexts/VariableTransformContext'
import { AuthRequestResolverContext, type AuthRequestResolver } from './contexts/authRequestResolverContext'
import { collectExpandableIds } from './services/FolderToListView'
import { findScenariosUsingRequest, findScenariosUsingScenario, findScenariosUsingQuickConfig, requestScenarioDeleteUsages } from './services/scenarioRequestUsage'
import { diffScenarioPortRenames, remapCallerScenarioEdges, isEmptyRenameMap } from '../../shared/scenarioPortRename'
import { requestScenarioNodeFocus } from './services/scenarioFocusBus'
import {
  findFolderById,
  findScenarioById,
  findEnvironmentFolderById,
  findRequestById,
  findItemWithBreadcrumbs,
  getNearestEnvironmentsForBreadcrumbs
} from './utils/treeSearch'
import { StatusbarVersionPlan } from './components/MainView/StatusbarVersionPlan'
import { findItemById, findItemWithParent } from './utils/treeSearch'
import { getSessionRequestOverride, getSessionFolderEnv, findEnvironmentById } from './services/environmentSelectionStore'
import type { RequestEnvInfo } from './components/Scenario/scenarioBoundResolver'
import { useItemOperations } from './hooks/useItemOperations'
import type { AddChildKind } from './components/MainView/Sidebar/contextMenuBuilder'
import { useRequestCreationApi } from './hooks/useRequestCreationApi'
import { RequestCreationProvider } from './contexts/RequestCreationContext'
import { useNavigation } from './hooks/useNavigation'
import { useWorkbenchUpdates } from './hooks/useWorkbenchUpdates'
import { useWorkbenchTabs } from './hooks/useWorkbenchTabs'
import { useFirewallPromptToasts, useGitCliMissingToast, useGitPullAvailableToast, PushModal, AVAILABLE_LANGUAGES } from 'electron-core-ui/renderer'
import { useFirewallProjectOriginsSync } from './hooks/useFirewallProjectOriginsSync'
import { useSidebarState } from './hooks/useSidebarState'
import {
  isFavorite as favoritesStoreIsFavorite,
  getFavorites as favoritesStoreGet,
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
  ScenarioNode,
  ScenarioEdge
} from '../../shared/types/collections'
import {
  isRequest,
  isScenario,
  isEnvironmentFolder,
  isAnyFolder,
  isAuthenticationRequest
} from '../../shared/types/collections'
import { buildRequestPath } from './utils/requestPath'
import { findOperationForRoute } from '../../shared/utils/findOperationForRoute'
import { routeFromRequest } from './hooks/routeFromRequest'
import { synthesizeRequestPreview, type SyntheticRequestPreview } from '../../shared/utils/syntheticRequestPreview'
import type { ApiDocumentation } from '../../shared/types/apiDocumentation'

// Wire the ECUI Console feed to restorm's firewall IPC channel. The
// store subscribes lazily on the first `useConsoleFeed` consumer, so
// registering at module-eval time (preload has already run) is safe.
const firewallFeed = window.api.firewall as ConsoleFeedSource | undefined
if (firewallFeed) registerConsoleFeedSource(firewallFeed)

// Wire the ECUI MCP-logs viewer to restorm's runtime IPC. The viewer pulls
// the served-call buffer on demand (`getMcpLogs`) and refreshes on
// `onMcpLogsChanged`; `clearMcpLogs` is optional and gates the Clear button.
const mcpLogsRuntime = window.restorm?.runtime
if (mcpLogsRuntime) {
  const source: McpLogsSource = {
    getLogs: mcpLogsRuntime.getMcpLogs as McpLogsSource['getLogs'],
    onChange: mcpLogsRuntime.onMcpLogsChanged,
    clear: mcpLogsRuntime.clearMcpLogs
  }
  registerMcpLogsSource(source)
}

const MIN_LEFT_WIDTH = 180

/** Workbench ID for persistence */
const WORKBENCH_ID = 'restorm-main-workbench'

// Initial root items - empty at startup, populated when opening a file
const initialRootItems: EnvironmentFolder[] = []

const allFolderIds = initialRootItems.flatMap((item) => collectExpandableIds(item))

/**
 * Resolve the workbench's currently-active tab id. Walks the tree
 * recursively so split-views (where the root is a `ContainerGroupNode`
 * wrapping multiple `TabGroupNode`s — happens when the Console tab
 * sits in a bottom group below an existing horizontal split) are
 * handled correctly. Falls back to the first `TabGroupNode` with an
 * `activeTabId` if `focusedGroupId` doesn't match any node — same
 * behaviour as the old flat-walk path, just container-aware.
 *
 * Without recursion `activeRequest` (and the statusbar selectors
 * that gate on it: auth, env, request-history) would silently
 * disappear whenever the user opened the Console because the root
 * groups no longer contained a `TabGroupNode` directly.
 */
function resolveActiveTabId(groups: GroupNode[], focusedGroupId: string | null): string | undefined {
  let focusedActive: string | undefined
  let firstActive: string | undefined
  const visit = (nodes: GroupNode[]): void => {
    for (const node of nodes) {
      if (isTabGroupNode(node)) {
        if (typeof node.activeTabId !== 'string') continue
        firstActive ??= node.activeTabId
        if (focusedActive === undefined && node.id === focusedGroupId) {
          focusedActive = node.activeTabId
        }
      } else if (isContainerNode(node)) {
        visit(node.groups)
      }
    }
  }
  visit(groups)
  return focusedActive ?? firstActive
}

const App: React.FC = () => {
  const { t } = useTranslation()
  // Localized labels for the generic ECUI MCP-logs viewer (modal path). The
  // tab path builds its own copy inside RestormWorkbench; both stay in sync
  // via the same `mcpLogs.*` keys.
  const mcpLogsLabels = useMemo<McpLogsLabels>(() => ({
    title: t('mcpLogs.title'),
    empty: t('mcpLogs.empty'),
    clear: t('mcpLogs.clear'),
    tool: t('mcpLogs.tool'),
    time: t('mcpLogs.time'),
    payload: t('mcpLogs.payload'),
    truncated: t('mcpLogs.truncated'),
    screenshot: t('mcpLogs.screenshot'),
    screencast: t('mcpLogs.screencast'),
    captureEvicted: t('mcpLogs.captureEvicted'),
    copy: t('mcpLogs.copy'),
    closePreview: t('mcpLogs.closePreview'),
    captureImageTitle: t('mcpLogs.captureImageTitle'),
    captureVideoTitle: t('mcpLogs.captureVideoTitle')
  }), [t])
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

  // Tell the main process the real UI is mounted so it can close the boot
  // splash and reveal the (until-now hidden) main window. This fires only once
  // App has actually rendered — i.e. i18n is ready and the lazy App chunk has
  // resolved, so the Suspense loading fallback is already gone. Using this
  // explicit signal (not the window's first paint) guarantees the user never
  // sees the loading screen behind the splash.
  useEffect(() => {
    window.electronAPI?.notifyReady()
  }, [])

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

  // "Open containing folder" on a welcome-screen recent/favorite row.
  // The panel is a generic library component, so it only reports which
  // file the user picked; handing a path to the OS shell is this app's
  // job. Main refuses anything it doesn't already track (the open project
  // or one of its own recent files), and the OS call can fail on its own
  // when the file moved since it was listed — either way the user is
  // told, because a menu entry that silently does nothing reads as broken.
  // The failure strings are shared with the statusbar's identical action:
  // they name no surface, so they are reused rather than duplicated.
  const revealPathInFolder = useCallback((path: string): void => {
    void window.restorm?.file.revealInFolder(path)
      .then((result) => {
        if (result.success) return
        toasterService.push('app', {
          title: t('statusbar.contextMenu.revealFailedTitle'),
          body: t('statusbar.contextMenu.revealFailedBody'),
          durationMs: 5000
        })
      })
      .catch(() => { /* channel unavailable — no-op */ })
  }, [t])

  // Surface every firewall pending-permission prompt as a toast in
  // the global app toaster. The four action buttons (Allow once /
  // Allow always / Deny once / Deny always) dispatch the user's
  // choice back to main, which fans the verdict out to every
  // queued caller waiting on this destination.
  useFirewallPromptToasts()

  // One-time "git isn't installed" notice — GitService probes the CLI
  // lazily on the first repo check and fires this at most once per
  // process lifetime.
  useGitCliMissingToast()

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
  const [rootItems, setRootItems] = useState<FolderItem[]>(initialRootItems)
  // Live-updating ref to the current tree. Several stable callbacks (the
  // scenario-change handler, test helpers) must read the CURRENT collections
  // without listing `rootItems` as a dep — otherwise their closure goes stale
  // after an async re-seed (e.g. a hard renderer reload re-fetching from main),
  // mutating an item that's no longer in the live tree, so the whole-file save
  // serializes the unchanged current tree and silently writes nothing.
  const rootItemsRef = useRef(rootItems)
  useEffect(() => { rootItemsRef.current = rootItems }, [rootItems])

  // Monotonic counter forwarded to the workbench so open request tabs remount
  // after a clean pull re-hydrates the tree from disk. A request tab seeds its
  // editable fields into local React state ONCE from the request prop; the
  // tree/sidebar refresh on their own (they read the live tree) but a same-id
  // re-hydration leaves the open tab showing pre-pull values until close +
  // reopen. Bumping this remounts those tabs (see `tabReloadEpoch` in
  // RestormWorkbench). A DEDICATED counter, deliberately NOT the tab
  // `contentVersion` bump used by favorite-toggle / MCP patches: those must
  // stay plain re-renders — folding them into the remount key would tear down
  // and rebuild Monaco editors on every keystroke.
  const [tabReloadEpoch, setTabReloadEpoch] = useState(0)
  // Armed by `refreshOpenFileAfterPull` right before the pull re-opens the
  // project, consumed by `setRootItemsWithPullReload` below on the very
  // `setRootItems` call that installs the re-hydrated tree.
  const pullRefreshPendingRef = useRef(false)
  // The setter handed to `useFileManagement`. When the pull flag is armed, the
  // epoch bump is issued in the SAME synchronous call as the re-hydration's
  // `setRootItems`, so React batches both into one commit: the workbench
  // re-renders once with the fresh proxies AND the new remount key. Doing it
  // here — rather than in a `[rootItems]` effect + rAF — removes the timing
  // window entirely (a deferred bump could fire against an intermediate commit,
  // or a throttled rAF could never fire), which is what left the reopened tab
  // stale. The flag is cleared on consume so only the pull re-hydration bumps,
  // not later opens.
  const setRootItemsWithPullReload = useCallback<React.Dispatch<React.SetStateAction<FolderItem[]>>>((action) => {
    setRootItems(action)
    if (pullRefreshPendingRef.current) {
      pullRefreshPendingRef.current = false
      setTabReloadEpoch((n) => n + 1)
    }
  }, [])

  // The scenario inspector's CLI-command help asks for the shortest unambiguous
  // `--run` value for a scenario; computed from the live project tree.
  const suggestScenarioRunTarget = useCallback(
    (scenarioId: string): string | null => suggestRunTarget(rootItemsRef.current, scenarioId),
    []
  )

  // Push the project's auto-derived origins (every request URL,
  // resolved against available env vars) to the main-process
  // firewall on every tree change. The PermissionService treats
  // these as known destinations alongside the user's whitelist.
  useFirewallProjectOriginsSync(rootItems)

  // The Push modal's whole lifecycle (diff-on-open, language-driven
  // regeneration, the setting sync, the actual stage+commit+push) —
  // `rootItems` is the "after" side of its structural diff.
  const pushModal = usePushModal(filePath, rootItems, saveBeforePush, {
    onResolveConflicts: (pending) => {
      pullConflict.openFromVersions(
        pending.gitFolder,
        pending.relativePath,
        pending.versions,
        // Only a Push publishes once the conflicts are settled.
        pending.mode === 'push'
      )
    },
    // The project file on disk was replaced (updated from the server, or
    // reset onto it) — re-hydrate the tree, tabs and search index through
    // the normal open path, exactly as a clean pull does.
    onProjectReplaced: () => { refreshOpenFileAfterPull() }
  })
  // The pull-conflict 4-panel resolution flow — opened by `useGitActions`
  // below when a pull comes back conflicted, instead of a plain toast.
  const pullConflict = useGitPullConflict({
    onProjectReplaced: () => { refreshOpenFileAfterPull() }
  })
  // After a clean pull fast-forwards new content onto disk, re-open the same
  // project through the normal file-open path so the sidebar tree + open
  // editor tabs re-hydrate from the pulled content — no manual reopen, and no
  // parallel tree-loading logic (`open` re-reads disk, resets dirty, and
  // broadcasts `file:opened` → `handleFileOpened`, exactly like the initial
  // open). Tabs rebind by their stable persisted ids.
  const refreshOpenFileAfterPull = useCallback(() => {
    if (!filePath) return
    // Arm the tab-remount flag BEFORE re-opening: the re-open replaces the
    // reactive proxies wholesale, so open request tabs (which cache their
    // fields in local state) must remount to re-read the pulled values.
    // `setRootItemsWithPullReload` consumes the flag on the re-hydration's
    // `setRootItems`, bumping the remount epoch in the same commit.
    pullRefreshPendingRef.current = true
    void _openFile(filePath)
  }, [filePath, _openFile])
  // Git-history modal: opened from the statusbar `source-control` icon.
  // Loads the full log lazily on open (the modal is rare; no polling).
  const [gitHistory, setGitHistory] = useState<{ open: boolean, commits: GitHistoryCommit[], mainTipHash?: string }>({ open: false, commits: [] })
  // Same both-sides re-check as the statusbar refresh icon; the pastille
  // flags are shared with the title-bar Git menu via useGitPendingFlags.
  const handleGitRefresh = useCallback(() => { void window.api.git.refreshState() }, [])
  // "Reset to the server version" — the same destructive operation the
  // update prompt offers, reachable at any time and not only when the
  // remote happens to be ahead. Confirmed first: it throws away work.
  const [resetToServerConfirm, setResetToServerConfirm] = useState(false)
  // "Recover this version" from the git-history view: the commit the user
  // right-clicked, held until they confirm (it overwrites the open file).
  const [recoverVersionHash, setRecoverVersionHash] = useState<string | null>(null)
  const handleRecoverVersion = useCallback((hash: string) => { setRecoverVersionHash(hash) }, [])
  const confirmRecoverVersion = useCallback(() => {
    const hash = recoverVersionHash
    setRecoverVersionHash(null)
    if (hash === null || filePath?.endsWith('.restorm') !== true) return
    const sep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    const folder = filePath.slice(0, sep)
    const relativePath = filePath.slice(sep + 1)
    void window.api.git.recoverFileAtRevision(folder, relativePath, hash).then(() => {
      // The old content is on disk now, uncommitted. Re-open through the same
      // path a clean pull uses so the tree + open editor tabs re-read it —
      // otherwise the app's next autosave, still holding the pre-recovery
      // tree in memory, would write the current version back over it.
      refreshOpenFileAfterPull()
      setGitHistory((prev) => ({ ...prev, open: false }))
      toasterService.push('app', { title: t('gitHistory.recoveredTitle'), body: t('gitHistory.recoveredBody'), durationMs: 5000 })
    }).catch((error: unknown) => {
      toasterService.push('app', { title: t('gitHistory.recoverFailedTitle'), body: String(error), durationMs: 10000 })
    })
  }, [recoverVersionHash, filePath, refreshOpenFileAfterPull, t])
  const { takeServerVersion } = useGitUpdateActions()
  const handleGitResetToServer = useCallback(() => { setResetToServerConfirm(true) }, [])
  const confirmGitResetToServer = useCallback(() => {
    setResetToServerConfirm(false)
    const folder = filePath?.endsWith('.restorm') === true
      ? filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')))
      : null
    if (!folder) return
    void takeServerVersion(folder).then((result) => {
      if (!result.success) {
        toasterService.push('app', {
          title: t('gitUpdate.updateFailedTitle'),
          body: result.error ?? t('gitUpdate.updateFailedBody'),
          durationMs: 10000
        })
        return
      }
      toasterService.push('app', { title: t('gitUpdate.discardedTitle'), body: t('gitUpdate.discardedBody'), durationMs: 5000 })
      refreshOpenFileAfterPull()
    })
  }, [filePath, takeServerVersion, t, refreshOpenFileAfterPull])
  const gitPendingFlags = useGitPendingFlags(isDirty)
  const gitFolderForConflicts = useGitFolder(filePath)
  const { formatUserDate } = useUserDateFormat()
  const formatGitHistoryDate = useCallback((iso: string) => formatUserDate(new Date(iso)), [formatUserDate])

  const handleOpenGitHistory = useCallback(() => {
    const folder = filePath?.endsWith('.restorm') === true
      ? filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')))
      : filePath
    if (folder === null || folder === '') return
    void window.api.git.log(folder).then((entries) => {
      const commits: GitHistoryCommit[] = entries.map((e) => ({
        hash: e.hash,
        parents: e.parents,
        subject: e.subject,
        body: e.body,
        authorName: e.authorName,
        authorEmail: e.authorEmail,
        date: e.date,
        refs: e.refs
      }))
      // Seed lane 0 with the main/master tip so that chain renders as one
      // straight vertical (prefer the remote ref — it is the shared truth).
      const isMainRef = (r: string): boolean => /(?:^|\/|\s)(main|master)$/.test(r)
      const mainTip = commits.find((c) => c.refs.some(isMainRef))
      setGitHistory({ open: true, commits, ...(mainTip ? { mainTipHash: mainTip.hash } : {}) })
    })
  }, [filePath])

  // Repo-push / repo-pull click actions, shared verbatim by the statusbar
  // `GIT` entry and the title-bar `Git` menu (see `useGitActions`).
  // repo-push opens the modal above; the actual push happens from there.
  // Both actions save the live tree to disk first (`saveAllForGit`) — git
  // reads/merges on-disk content — and a clean pull refreshes the open file.
  const { onPush: handleGitPush, onPull: handleGitPull } = useGitActions(
    filePath,
    pushModal.openPushModal,
    saveAllForGit,
    refreshOpenFileAfterPull,
    // A contested pull raises the SAME prompt the push flow uses; the
    // prompt itself knows not to publish afterwards.
    pushModal.beginUpdatePrompt
  )
  // Semi-pull detection → "Pull now" toast. Reuses the SAME click
  // handler as the statusbar/title-bar pull actions above, so accepting
  // the toast goes through the identical conflict-aware pull flow — no
  // separate pull path to keep in sync.
  // The live behind-flag retracts the toast the moment the repository
  // catches up — otherwise it keeps offering to fetch nothing.
  useGitPullAvailableToast(handleGitPull, gitPendingFlags.pullPending)
  // A resolution screen that was closed rather than cancelled leaves the
  // repository mid-merge, with no way back into that screen — surface it
  // and offer the one escape hatch.
  useGitMergeInProgressToast(gitFolderForConflicts, gitPendingFlags.hasConflicts)
  // A `git checkout` / `git pull` run from a terminal rewrites the open
  // file under us; without this the next autosave tick silently undoes it.
  useExternalFileChange(refreshOpenFileAfterPull, saveAllForGit)

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

  // Gate the project's onboarding placeholder so it doesn't flash during the
  // async tab restore on load. We ask ECUI up front which tabs its mount-time
  // restore will reopen (`loadWorkbenchTabIds`): while a restore that WILL
  // reopen tabs is pending, the onboarding is held back; once it has settled
  // (no persisted tabs, or ECUI reported the restore) it shows — which also
  // re-shows it after the user closes the last tab. Keyed by workbench id so
  // switching projects re-peeks and re-gates without a reset effect.
  const [tabPeek, setTabPeek] = useState<{ id: string; count: number } | null>(null)
  const [restoredWorkbenchId, setRestoredWorkbenchId] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!workbenchId) return
    let cancelled = false
    void loadWorkbenchTabIds(workbenchId)
      .then((ids) => { if (!cancelled) setTabPeek({ id: workbenchId, count: ids.length }) })
      .catch(() => { if (!cancelled) setTabPeek({ id: workbenchId, count: 0 }) })
    return () => { cancelled = true }
  }, [workbenchId])

  // Pending (hold the onboarding back) while:
  //  - a file is still loading (`isFileServiceLoading` is true from mount until
  //    the read completes — covers the window before the project is even
  //    identified, when `workbenchId` is briefly undefined), OR
  //  - the peek for the current project hasn't resolved yet (don't know → a
  //    restore may come), OR
  //  - the peek found persisted tabs and ECUI hasn't reported the restore
  //    (`restoredWorkbenchId`) for this project yet — the async reopen window.
  // A stale peek (`tabPeek.id !== workbenchId`) also keeps it pending across a
  // project switch until the re-peek resolves.
  const onboardingRestorePending =
    isFileServiceLoading ||
    (workbenchId !== undefined &&
      (tabPeek?.id !== workbenchId || (tabPeek.count > 0 && restoredWorkbenchId !== workbenchId)))

  const allFolderIdsRef = useRef<string[]>(allFolderIds)
  useEffect(() => {
    const ids: string[] = []
    for (const item of rootItems) {
      ids.push(...collectExpandableIds(item))
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

  // Prime the per-request panel-collapsed cache as soon as we know
  // the project UUID — the *RequestTabView seeds its useState lazy
  // initializer synchronously from `getRequestPanelState`, so the
  // disk read has to land before the first tab mounts. Cache lookup
  // is keyed by UUID so re-opens of the same project (or hot
  // reloads) see the same persisted set.
  useEffect(() => {
    if (!projectUuid) return
    void preloadRequestPanelStates(projectUuid)
    void preloadScenarioViewports(projectUuid)
    void preloadScenarioBreakpoints(projectUuid)
  }, [projectUuid])

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
  // Id of the maximized (fullscreen) workbench tab, or null. Lives
  // outside the tree (EditorWorkbench owns it); mirrored here so the MCP
  // `get_workbench_layout` snapshot stays fresh across maximize/restore.
  const [maximizedTabId, setMaximizedTabId] = useState<string | null>(null)

  // Workbench tree state (starts with no groups)
  const [workbenchTree, setWorkbenchTree] = useState<WorkbenchTree>({
    orientation: 'vertical',
    groups: []
  })

  /**
   * `View → Console` handler. Two cases:
   *
   * - **Tab already exists**: just activate it (set `activeTabId` on
   *   the group it lives in). Layout doesn't reflow.
   * - **Tab doesn't exist yet**: create a fresh `TabGroupNode`
   *   holding a single Console tab and place it in a NEW bottom
   *   group spanning the FULL workbench width. If the root tree is
   *   already vertical, append the group to it. If the root is
   *   horizontal (the user has a side-by-side split), wrap the
   *   existing root inside a vertical container so the bottom
   *   group sits below ALL existing groups, not just one of them.
   *
   * The Console tab is a singleton (id = `console:singleton`); the
   * branching above guarantees we never end up with two.
   */
  const handleOpenConsole = useCallback(() => {
    // Record the activation so this singleton tab takes its place in the
    // Ctrl+Tab MRU history even when opened from the menu (not clicked).
    navigationService.navigateTo(CONSOLE_TAB_ID, 'workbench', { type: 'special' })
    setWorkbenchTree(prev => {
      const existingGroupId = findGroupIdForTab(prev.groups, CONSOLE_TAB_ID)
      if (existingGroupId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, existingGroupId, group => ({ ...group, activeTabId: CONSOLE_TAB_ID }))
        }
      }
      // `renderTabTitle` in RestormWorkbench owns the visual title
      // (codicon + label); `title` here is just the JSON-safe
      // serialisation fallback used by tab-drop / IPC paths.
      const consoleTab: ConsoleTab = {
        id: CONSOLE_TAB_ID,
        tabType: 'console',
        title: 'Console',
        titleString: 'Console',
        allowFullscreen: true
      }
      const newGroup: TabGroupNode = {
        id: `console-group-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
        tabs: [consoleTab],
        activeTabId: CONSOLE_TAB_ID
      }
      // Workbench orientation convention (ECUI):
      //   'vertical'   → flex-direction: row   → groups side-by-side
      //   'horizontal' → flex-direction: column → groups stacked
      // The Console must land BELOW everything → we want a horizontal
      // root with the existing layout above and the console group
      // below. If the root is already horizontal we just append; if
      // it's vertical (side-by-side) we wrap the existing tree as a
      // single child of a new horizontal root so the console sits
      // under ALL existing groups, not next to one of them.
      if (prev.orientation === 'horizontal') {
        return { ...prev, groups: [...prev.groups, newGroup], sizes: undefined }
      }
      const wrapped: ContainerGroupNode = {
        id: `container-wrap-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
        orientation: prev.orientation,
        groups: prev.groups,
        ...(prev.sizes !== undefined ? { sizes: prev.sizes } : {})
      }
      return { orientation: 'horizontal', groups: [wrapped, newGroup] }
    })
  }, [setWorkbenchTree])

  /**
   * `View → Firewall` handler. Singleton tab (id =
   * `firewall:singleton`). Unlike Console, no specific placement —
   * just append to the focused group (or the first available
   * `TabGroupNode` if no focus). Activate-existing-or-create.
   */
  const handleOpenMiniBrowser = useCallback(() => {
    navigationService.navigateTo(MINI_BROWSER_TAB_ID, 'workbench', { type: 'special' })
    setWorkbenchTree(prev => {
      const existingGroupId = findGroupIdForTab(prev.groups, MINI_BROWSER_TAB_ID)
      if (existingGroupId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, existingGroupId, group => ({ ...group, activeTabId: MINI_BROWSER_TAB_ID }))
        }
      }
      const miniBrowserTab: MiniBrowserTab = {
        id: MINI_BROWSER_TAB_ID,
        tabType: 'mini-browser',
        title: 'Mini browser',
        titleString: 'Mini browser',
        allowFullscreen: true
      }
      const findFirstTabGroup = (nodes: GroupNode[]): TabGroupNode | null => {
        for (const node of nodes) {
          if (isTabGroupNode(node)) return node
          if (isContainerNode(node)) {
            const inner = findFirstTabGroup(node.groups)
            if (inner !== null) return inner
          }
        }
        return null
      }
      const targetId = focusedGroupId !== null && hasGroupWithId(prev.groups, focusedGroupId)
        ? focusedGroupId
        : (findFirstTabGroup(prev.groups)?.id ?? null)
      if (targetId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, targetId, group => ({
            ...group,
            tabs: [...group.tabs, miniBrowserTab],
            activeTabId: MINI_BROWSER_TAB_ID
          }))
        }
      }
      const newGroup: TabGroupNode = {
        id: `mini-browser-group-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
        tabs: [miniBrowserTab],
        activeTabId: MINI_BROWSER_TAB_ID
      }
      return { ...prev, groups: [newGroup] }
    })
  }, [setWorkbenchTree, focusedGroupId])

  const handleOpenFirewall = useCallback(() => {
    navigationService.navigateTo(FIREWALL_TAB_ID, 'workbench', { type: 'special' })
    setWorkbenchTree(prev => {
      const existingGroupId = findGroupIdForTab(prev.groups, FIREWALL_TAB_ID)
      if (existingGroupId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, existingGroupId, group => ({ ...group, activeTabId: FIREWALL_TAB_ID }))
        }
      }
      const firewallTab: FirewallTab = {
        id: FIREWALL_TAB_ID,
        tabType: 'firewall',
        title: 'Firewall',
        titleString: 'Firewall',
        allowFullscreen: true
      }
      // Find the focused group (or the first TabGroupNode anywhere
      // in the tree) and append. Walks containers recursively for
      // split-view layouts.
      const findFirstTabGroup = (nodes: GroupNode[]): TabGroupNode | null => {
        for (const node of nodes) {
          if (isTabGroupNode(node)) return node
          if (isContainerNode(node)) {
            const inner = findFirstTabGroup(node.groups)
            if (inner !== null) return inner
          }
        }
        return null
      }
      const targetId = focusedGroupId !== null && hasGroupWithId(prev.groups, focusedGroupId)
        ? focusedGroupId
        : (findFirstTabGroup(prev.groups)?.id ?? null)
      if (targetId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, targetId, group => ({
            ...group,
            tabs: [...group.tabs, firewallTab],
            activeTabId: FIREWALL_TAB_ID
          }))
        }
      }
      // No groups at all yet (welcome screen path): seed a fresh
      // group containing only the firewall tab.
      const newGroup: TabGroupNode = {
        id: `firewall-group-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
        tabs: [firewallTab],
        activeTabId: FIREWALL_TAB_ID
      }
      return { ...prev, groups: [newGroup] }
    })
  }, [setWorkbenchTree, focusedGroupId])

  /**
   * Settings handler used when a workbench is active. Singleton tab
   * (id = `settings:singleton`), same focus-or-create pattern as
   * Firewall / Mini browser. When no file is open the titlebar opens
   * the full-screen Settings modal instead — this handler is only
   * wired to that workbench-active branch.
   */
  const handleOpenSettingsTab = useCallback(() => {
    navigationService.navigateTo(SETTINGS_TAB_ID, 'workbench', { type: 'special' })
    setWorkbenchTree(prev => {
      const existingGroupId = findGroupIdForTab(prev.groups, SETTINGS_TAB_ID)
      if (existingGroupId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, existingGroupId, group => ({ ...group, activeTabId: SETTINGS_TAB_ID }))
        }
      }
      const settingsTab: SettingsTab = {
        id: SETTINGS_TAB_ID,
        tabType: 'settings',
        title: 'Settings',
        titleString: 'Settings',
        allowFullscreen: true
      }
      const findFirstTabGroup = (nodes: GroupNode[]): TabGroupNode | null => {
        for (const node of nodes) {
          if (isTabGroupNode(node)) return node
          if (isContainerNode(node)) {
            const inner = findFirstTabGroup(node.groups)
            if (inner !== null) return inner
          }
        }
        return null
      }
      const targetId = focusedGroupId !== null && hasGroupWithId(prev.groups, focusedGroupId)
        ? focusedGroupId
        : (findFirstTabGroup(prev.groups)?.id ?? null)
      if (targetId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, targetId, group => ({
            ...group,
            tabs: [...group.tabs, settingsTab],
            activeTabId: SETTINGS_TAB_ID
          }))
        }
      }
      const newGroup: TabGroupNode = {
        id: `settings-group-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
        tabs: [settingsTab],
        activeTabId: SETTINGS_TAB_ID
      }
      return { ...prev, groups: [newGroup] }
    })
  }, [setWorkbenchTree, focusedGroupId])

  // MCP call-logs viewer modal — shown when no file is open (no workbench
  // to host a tab). Same tab-or-modal split as Settings.
  const [mcpLogsModalOpen, setMcpLogsModalOpen] = useState(false)

  /**
   * Open / focus the MCP logs singleton workbench tab. Modelled on
   * `handleOpenSettingsTab` — focus-or-create off `MCP_LOGS_TAB_ID`. The
   * `navigateTo(..., { type: 'special' })` records the tab in the Ctrl+Tab
   * MRU history (the nav-listener skips `special` for sidebar/tree side
   * effects) so opening from the menu — not just clicking it — is tracked.
   */
  const handleOpenMcpLogsTab = useCallback(() => {
    navigationService.navigateTo(MCP_LOGS_TAB_ID, 'workbench', { type: 'special' })
    setWorkbenchTree(prev => {
      const existingGroupId = findGroupIdForTab(prev.groups, MCP_LOGS_TAB_ID)
      if (existingGroupId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, existingGroupId, group => ({ ...group, activeTabId: MCP_LOGS_TAB_ID }))
        }
      }
      const mcpLogsTab: McpLogsTab = {
        id: MCP_LOGS_TAB_ID,
        tabType: 'mcp-logs',
        title: 'MCP logs',
        titleString: 'MCP logs',
        allowFullscreen: true
      }
      const findFirstTabGroup = (nodes: GroupNode[]): TabGroupNode | null => {
        for (const node of nodes) {
          if (isTabGroupNode(node)) return node
          if (isContainerNode(node)) {
            const inner = findFirstTabGroup(node.groups)
            if (inner !== null) return inner
          }
        }
        return null
      }
      const targetId = focusedGroupId !== null && hasGroupWithId(prev.groups, focusedGroupId)
        ? focusedGroupId
        : (findFirstTabGroup(prev.groups)?.id ?? null)
      if (targetId !== null) {
        return {
          ...prev,
          groups: updateGroupById(prev.groups, targetId, group => ({
            ...group,
            tabs: [...group.tabs, mcpLogsTab],
            activeTabId: MCP_LOGS_TAB_ID
          }))
        }
      }
      const newGroup: TabGroupNode = {
        id: `mcp-logs-group-${String(Date.now())}-${crypto.randomUUID().slice(0, 8)}`,
        tabs: [mcpLogsTab],
        activeTabId: MCP_LOGS_TAB_ID
      }
      return { ...prev, groups: [newGroup] }
    })
  }, [setWorkbenchTree, focusedGroupId])

  /**
   * Entry-point shared by the status-bar `mcp` tooltip link and the
   * `View → MCP logs` menu item: open the logs as a workbench tab when a
   * file is open, or as a full-screen modal on the welcome screen.
   */
  const handleOpenMcpLogs = useCallback(() => {
    if (fileName !== null) {
      handleOpenMcpLogsTab()
    } else {
      setMcpLogsModalOpen(true)
    }
  }, [fileName, handleOpenMcpLogsTab])

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
    const visit = (item: FolderItem): void => {
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
    currentFolderPath,
    setCurrentFolderPath: _setCurrentFolderPath
  } = useFileManagement({
    rootItems,
    setRootItems: setRootItemsWithPullReload,
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
    openScenarioEditorTab,
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
    registerTabDirtyState,
    focusGroup: setFocusedGroupId
  })

  // Record the restore against the current workbench id once ECUI has reported
  // one (the tree it reopened, or `null` when there was nothing persisted) so
  // the onboarding can render again without flashing mid-restore.
  const handleStateRestoredGated = useCallback((restoredTree: WorkbenchTree | null) => {
    handleStateRestored(restoredTree)
    setRestoredWorkbenchId(workbenchId)
  }, [handleStateRestored, workbenchId])

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
            <Button
              link
              data-testid="auth-failure-toast-open-link"
              onClick={() => { handleOpen() }}
              style={{ color: 'var(--linkForeground, #3794ff)' }}
            >
              {t('authFailureToast.openAuthRoute', 'Open authentication route')}
            </Button>
          </div>
        ),
        durationMs: 8000,
        ariaLive: 'assertive'
      })
    })
  }, [t])

  // `toast` scenario node → renderer bridge.
  //
  // Subscribes to the main-side `scenario:toast` IPC (emitted by the toast
  // executor via BrowserWindow.getAllWindows()…send) and surfaces a toast in
  // the global toaster. The header (level glyph + colour + bold title) is passed
  // as the ECUI Toast `titleNode` so it shares the close-button row; the message
  // renders below in the body. `title` (the plain string) backs accessibility +
  // `data-toast-title`. The level maps to the ariaLive politeness (error/warning
  // → assertive). `durationMs` undefined → the toast persists until dismissed
  // (the executor sends it only when the configured duration is > 0 seconds).
  useEffect(() => {
    const api = window.restorm?.runtime
    if (!api?.onScenarioToast) return undefined
    return api.onScenarioToast((payload) => {
      const ariaLive: 'polite' | 'assertive' = payload.level === 'error' || payload.level === 'warning' ? 'assertive' : 'polite'
      toasterService.push('app', {
        title: payload.title.trim().length > 0 ? payload.title : payload.message,
        titleNode: <ScenarioToastTitle title={payload.title} message={payload.message} level={payload.level} />,
        body: <ScenarioToastBody title={payload.title} message={payload.message} />,
        durationMs: typeof payload.durationMs === 'number' && payload.durationMs > 0 ? payload.durationMs : undefined,
        ariaLive
      })
    })
  }, [])

  // Resolve a workbench tab id (e.g. `request-idx:0.1`, `request-id:uuid`,
  // or the legacy `request-<id>` form) to its item id.
  const resolveTabItemId = useCallback((tabId: string): string | null => {
    const idxMatch = /^(folder|env-folder|request|scenario)-idx:([0-9]+(?:\.[0-9]+)*)$/.exec(tabId)
    if (idxMatch?.[2]) {
      const indexPath = idxMatch[2].split('.').map((n) => Number(n))
      // Don't default a bad/missing segment to index 0 — that silently resolves
      // the FIRST root/child for a malformed tab id. A non-finite segment = no match.
      const root = indexPath[0]
      if (root === undefined || !Number.isFinite(root)) return null
      let cursor: unknown = rootItems[root]
      for (let i = 1; i < indexPath.length; i += 1) {
        if (!cursor || typeof cursor !== 'object' || !('items' in cursor)) return null
        const items = (cursor as { items?: unknown[] }).items
        if (!Array.isArray(items)) return null
        const seg = indexPath[i]
        if (seg === undefined || !Number.isFinite(seg)) return null
        cursor = items[seg]
      }
      if (cursor && typeof cursor === 'object' && 'id' in cursor) {
        const id = (cursor as { id?: unknown }).id
        return typeof id === 'string' ? id : null
      }
      return null
    }
    const legacyMatch = /^(folder|env-folder|request|scenario)-(?:id:)?(.+)$/.exec(tabId)
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
    const activeTabId = resolveActiveTabId(workbenchTree.groups, focusedGroupId)
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
    const activeTabId = resolveActiveTabId(workbenchTree.groups, focusedGroupId)
    if (!activeTabId) return null
    const itemId = resolveTabItemId(activeTabId)
    if (!itemId) return null
    const request = findRequestById(rootItems, itemId)
    if (!request) return null
    return { id: request.id, path: buildRequestPath(rootItems, request.id) }
  }, [workbenchTree.groups, focusedGroupId, resolveTabItemId, rootItems])

  // Active scenario-editor tab (if any), so the MCP `get_current_tab` snapshot
  // can report `kind: 'scenario'` like it does for requests. Resolved the same
  // way as `activeRequest` but narrowed to scenarios.
  const activeScenarioId = useMemo<string | null>(() => {
    const activeTabId = resolveActiveTabId(workbenchTree.groups, focusedGroupId)
    if (!activeTabId) return null
    const itemId = resolveTabItemId(activeTabId)
    if (!itemId) return null
    return findScenarioById(rootItems, itemId) ? itemId : null
  }, [workbenchTree.groups, focusedGroupId, resolveTabItemId, rootItems])

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
  //
  // The trigger must NOT call `handleMenuSaveAll()` synchronously from
  // the IPC callback. The MCP write tools (e.g. a scenario node edit in
  // `mcp/tools/scenario.ts`) fire, in one main-process tick,
  // `mcp:tree-replace` (→ `setRootItems`, async) immediately followed by
  // `file:autosave-trigger`. A synchronous save here would close over the
  // *pre-replace* `rootItems` and write the stale tree — the MCP edit
  // would never reach disk. So we bump a counter and let a post-commit
  // effect run the save once React has applied the new `rootItems` (same
  // discipline as the post-import save below).
  const [pendingAutoSave, setPendingAutoSave] = useState(0)
  useEffect(() => {
    const unsub = window.api.file.onAutoSaveTrigger(() => {
      setPendingAutoSave((c) => c + 1)
    })
    return () => { unsub() }
  }, [])
  const lastAutoSaveRef = useRef(0)
  useEffect(() => {
    if (pendingAutoSave === 0) return
    if (lastAutoSaveRef.current === pendingAutoSave) return
    lastAutoSaveRef.current = pendingAutoSave
    void handleMenuSaveAll().catch((err: unknown) => {
      logger.error('[App] Autosave failed', { error: String(err) })
    })
  }, [pendingAutoSave, handleMenuSaveAll])

  // The MCP git commit+push route (`git_confirm_push`) asks main to flush
  // unsaved edits to disk before it stages the on-disk file, and awaits an
  // ack. Reuse the SAME deferred save-all the autosave trigger uses so a
  // concurrent `mcp:tree-replace` (async `setRootItems`) can't make the save
  // close over the pre-replace `rootItems` — then ack every queued token once
  // that save resolves. Same counter-plus-ref latch as the autosave effect
  // above (the tokens ride in a ref so the effect never calls setState), and
  // main's wait is bounded, so a missing ack only delays, never wedges.
  const flushTokenQueueRef = useRef<string[]>([])
  const [flushRequestTick, setFlushRequestTick] = useState(0)
  const lastFlushTickRef = useRef(0)
  useEffect(() => {
    const unsub = window.restorm?.git.onSaveFlushRequest((token) => {
      flushTokenQueueRef.current.push(token)
      setFlushRequestTick((c) => c + 1)
    })
    return () => { unsub?.() }
  }, [])
  useEffect(() => {
    if (flushRequestTick === 0) return
    if (lastFlushTickRef.current === flushRequestTick) return
    lastFlushTickRef.current = flushRequestTick
    const tokens = flushTokenQueueRef.current
    flushTokenQueueRef.current = []
    if (tokens.length === 0) return
    void handleMenuSaveAll()
      .catch((err: unknown) => {
        logger.error('[App] git flush-save failed', { error: String(err) })
      })
      .finally(() => {
        for (const token of tokens) window.restorm?.git.notifySaveFlushComplete(token)
      })
  }, [flushRequestTick, handleMenuSaveAll])

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

  // Enhanced deletion dialog for a request referenced by scenarios (move it in,
  // or delete + strip its boxes). Empty `usages` means the plain modal is used.
  const [scenarioDelete, setScenarioDelete] = useState<{
    isOpen: boolean
    requestId: string
    requestName: string
    usages: RequestScenarioDeleteUsage[]
  }>({ isOpen: false, requestId: '', requestName: '', usages: [] })

  // Use custom hooks for various concerns
  const {
    handleItemDrop,
    handleCloneItem,
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
    openScenarioEditorTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    projectUuid,
    // A moved SCENARIO has no save-unit document of its own, so nothing
    // marks it unsaved. Route it through the same debounced whole-file
    // save that scenario edits already use.
    onStructureChanged: () => { void saveAllForGit() }
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

  // Persist scenario graph edits (add node, move node, …) made in the
  // editor back onto the scenario in `rootItems`, then nudge React so the
  // whole-file save picks the change up (verified: scenarios round-trip
  // through the standard save path).
  // Keep the module-scoped handle pointing at the current whole-file save so
  // the scenario autosave timer always flushes the latest `rootItems`. Done in
  // an effect (post-commit) rather than during render — reassigning a global
  // mid-render is an impure side effect.
  useEffect(() => { latestSaveAll = handleMenuSaveAll }, [handleMenuSaveAll])
  const handleScenarioChange = useCallback((scenarioId: string, patch: { nodes?: ScenarioNode[]; edges?: ScenarioEdge[]; notes?: string }) => {
    // Resolve against the CURRENT tree (via the ref), not this callback's
    // closure — after an async re-seed (a hard renderer reload re-fetches the
    // collections from main) a `rootItems`-keyed closure would find a stale
    // item that's no longer in the live tree, so the in-place mutation lands on
    // an orphan and the whole-file save sees no change (silent edit loss).
    const item = findItemById(rootItemsRef.current, scenarioId)
    if (item && isScenario(item)) {
      // Detect output/input port renames (matched by stable decl id) BEFORE the
      // nodes are overwritten, so we can follow them in the callers' edges.
      const renames = patch.nodes !== undefined ? diffScenarioPortRenames(item.nodes, patch.nodes) : null
      if (patch.nodes !== undefined) item.nodes = patch.nodes
      if (patch.edges !== undefined) item.edges = patch.edges
      if (patch.notes !== undefined) item.notes = patch.notes
      // A renamed sub-scenario port (output:<name> / param:<name>) would orphan
      // the edges of every `runScenario` box that calls it — the handle ids are
      // name-based. Remap those caller edges so the connection follows the new
      // name, and tell any OPEN caller editor to re-seed its live edges.
      if (renames && !isEmptyRenameMap(renames)) {
        for (const { scenario: caller } of findScenariosUsingScenario(rootItemsRef.current, scenarioId)) {
          const remapped = remapCallerScenarioEdges(caller, scenarioId, renames)
          if (remapped !== caller.edges) {
            caller.edges = remapped
            eventBus.emitLocalSync('restorm:scenario:edges-remapped', { scenarioId: caller.id, edges: remapped })
          }
        }
      }
      setRootItems((prev) => [...prev])
      // Scenario node/edge/note edits mutate the tree in place, which doesn't
      // trip the trackable dirty trap (those keys aren't indexable) — so unlike
      // request/folder edits they never schedule an autosave, and the on-disk
      // copy keeps its create-time state. The whole-file save serializes the
      // live tree correctly, so debounce one here (via the always-current
      // `latestSaveAll`) to push scenario edits — incl. those on MCP-created
      // nodes — to disk.
      if (scenarioSaveTimer) clearTimeout(scenarioSaveTimer)
      scenarioSaveTimer = setTimeout(() => {
        scenarioSaveTimer = null
        void latestSaveAll?.().catch((err: unknown) => {
          logger.error('[App] scenario autosave failed', { error: String(err) })
        })
      }, 600)
    }
  }, [setRootItems])

  // Deletion of a request referenced by scenarios. When a request is used, the
  // plain confirm modal is replaced by one that offers to move the request into
  // a scenario (for external references) or delete + strip the boxes.
  const handleDeleteItemChecked = useCallback((itemId: string) => {
    const item = findItemById(rootItems, itemId)
    if (item && isRequest(item)) {
      // Affected scenarios = those that BIND the request through a box. A
      // request merely filed under a scenario's folder (no box wiring it) is
      // not a usage — it deletes like any other request, no dialog.
      const usages: RequestScenarioDeleteUsage[] = requestScenarioDeleteUsages(rootItems, itemId).map((u) => ({
        scenarioId: u.scenario.id,
        scenarioName: u.scenario.name,
        inSubtree: u.inSubtree
      }))
      if (usages.length > 0) {
        setScenarioDelete({ isOpen: true, requestId: itemId, requestName: item.name, usages })
        return
      }
    }
    handleDeleteItem(itemId)
  }, [rootItems, handleDeleteItem])

  // Move the request into a scenario's subtree instead of deleting it. The
  // in-place `items` mutation isn't tracked by the dirty trap, so nudge a save.
  const handleMoveRequestIntoScenario = useCallback((requestId: string, scenarioId: string) => {
    const scenario = findItemById(rootItems, scenarioId)
    if (!scenario || !isScenario(scenario)) return
    const removed = removeItemFromTree(rootItems, requestId)
    if (!removed) return
    scenario.items = [...(scenario.items ?? []), removed]
    setRootItems((prev) => [...prev])
    if (scenarioSaveTimer) clearTimeout(scenarioSaveTimer)
    scenarioSaveTimer = setTimeout(() => {
      scenarioSaveTimer = null
      void latestSaveAll?.().catch((err: unknown) => { logger.error('[App] move-into-scenario autosave failed', { error: String(err) }) })
    }, 600)
    setScenarioDelete((p) => ({ ...p, isOpen: false }))
  }, [rootItems, setRootItems])

  // Delete the request and strip every box that referenced it (plus the touched
  // edges) from each using scenario, even if that leaves a scenario incomplete.
  const handleDeleteRequestAnyway = useCallback(() => {
    const requestId = scenarioDelete.requestId
    if (!requestId) return
    for (const u of findScenariosUsingRequest(rootItems, requestId)) {
      const dropped = new Set(u.nodeIds)
      const nodes = u.scenario.nodes.filter((n) => !dropped.has(n.id))
      const edges = u.scenario.edges.filter((e) => !dropped.has(e.from.nodeId) && !dropped.has(e.to.nodeId))
      handleScenarioChange(u.scenario.id, { nodes, edges })
    }
    setScenarioDelete((p) => ({ ...p, isOpen: false }))
    confirmDeleteWithId(requestId)
  }, [scenarioDelete.requestId, rootItems, handleScenarioChange, confirmDeleteWithId])

  // Create a child item (request of any protocol, or a sub-scenario) under a
  // scenario from the graph editor's add palette. `silent`: no sidebar
  // selection/expand, no tab — stay on the graph so the user can keep editing
  // without being whisked to the new item; the matching node is dropped by the
  // editor. Returns the new item id (the editor binds its node to it).
  const handleCreateScenarioChild = useCallback((scenarioId: string, kind: AddChildKind): string | null => {
    const newId = handleAddChildItem(scenarioId, kind, { silent: true })
    if (newId) {
      if (scenarioSaveTimer) clearTimeout(scenarioSaveTimer)
      scenarioSaveTimer = setTimeout(() => {
        scenarioSaveTimer = null
        void latestSaveAll?.().catch((err: unknown) => {
          logger.error('[App] scenario child-item autosave failed', { error: String(err) })
        })
      }, 600)
    }
    return newId
  }, [handleAddChildItem])
  // Back-compat shim for the bare httpRequest node (link-drag auto-create path).
  const handleCreateScenarioRequest = useCallback(
    (scenarioId: string): string | null => handleCreateScenarioChild(scenarioId, 'http-get'),
    [handleCreateScenarioChild]
  )

  // Resolve a tree item by id to its live object — used by the scenario editor
  // both to decide what a sidebar drop creates (request/scenario/ignored) and
  // to keep a request/sub-scenario node's badge + title in sync with renames.
  // Depends on `rootItems` so the bound boxes re-resolve when the tree changes.
  const resolveBoundItem = useCallback((itemId: string): FolderItem | null => {
    return findItemById(rootItems, itemId) ?? null
  }, [rootItems])

  // A request's environment picture for its scenario node: the envs of its
  // nearest ancestor env-folder + the env currently selected for the request
  // (session override → folder default → first env). Null when the request
  // has no ancestor env-folder, so the node hides its env-selector section.
  const resolveRequestEnv = useCallback((requestId: string): RequestEnvInfo | null => {
    const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, requestId)
    const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
    if (environments.length === 0) return null
    let envFolderId: string | undefined
    for (let i = breadcrumbs.length - 2; i >= 0; i -= 1) {
      const id = breadcrumbs[i]?.id
      if (!id) continue
      const folder = findFolderById(rootItems, id)
      if (folder && isEnvironmentFolder(folder as FolderItem)) { envFolderId = folder.id; break }
    }
    let selectedEnvId = environments[0]?.id ?? null
    if (projectUuid && envFolderId) {
      const reqOverride = getSessionRequestOverride(projectUuid, requestId)
      const folderEnv = getSessionFolderEnv(projectUuid, envFolderId)
      if (reqOverride && findEnvironmentById(environments, reqOverride)) selectedEnvId = reqOverride
      else if (folderEnv && findEnvironmentById(environments, folderEnv)) selectedEnvId = folderEnv
    }
    return { environments, selectedEnvId }
  }, [rootItems, projectUuid])

  // Build a synthetic (documentation-derived) preview for a request that
  // hasn't been run yet — the scenario inspector renders this in place of
  // the "no recent run" prompt when the request's owning env-folder
  // carries an imported spec. Pure lookup: walk the tree to find the
  // request + its env-folder's `apiDocumentation`, match the operation,
  // then call the shared synthesiser. Returns `null` when any link in
  // the chain is missing (no request, no env-folder, no spec, no
  // matching operation).
  const resolveSyntheticPreview = useCallback((requestId: string): SyntheticRequestPreview | null => {
    const request = findRequestById(rootItems, requestId)
    if (!request) return null
    const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, requestId)
    let envFolder: EnvironmentFolder | undefined
    for (let i = breadcrumbs.length - 2; i >= 0; i -= 1) {
      const id = breadcrumbs[i]?.id
      if (!id) continue
      const f = findFolderById(rootItems, id)
      if (f && isEnvironmentFolder(f as FolderItem)) { envFolder = f as EnvironmentFolder; break }
    }
    if (!envFolder) return null
    const apiDoc = (envFolder as { apiDocumentation?: ApiDocumentation }).apiDocumentation
    if (!apiDoc) return null
    const route = routeFromRequest(request)
    const operation = findOperationForRoute(apiDoc, route)
    if (!operation) return null
    return synthesizeRequestPreview(apiDoc, operation, {
      ...(route.url !== undefined ? { url: route.url } : {}),
      ...(route.method !== undefined ? { method: route.method } : {})
    })
  }, [rootItems])

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

  // `mcpEnabled` gates the MCP renderer hooks below. Statusbar
  // right-alignment is owned SOLELY by the always-mounted MCP indicator
  // (it carries the lone `margin-left: auto`); the bell no longer takes a
  // conditional `right-aligned`, so the indicator anchors right in every
  // state — having two `margin-left: auto` cells would split the flex free
  // space and strand the second one in the middle.
  const mcpEnabled = useMcpEnabled()

  // Wire MCP active-state push (renderer → main, drives `get_current_tab`)
  // + MCP nav listeners (main → renderer, drives `open_tab` / `reveal_in_tree`).
  // Both no-op when MCP is disabled. `envByFolder` stays empty for now —
  // populating it requires per-folder env-selector state we don't track
  // centrally yet; `get_active_env` falls back to the folder's first env.
  // `resolveActiveTabId` walks the workbench tree (handling split groups
  // and the focused-vs-first-active fallback) so MCP callers get the real
  // tab id they'd need to pass to `close_tab`. The old `tabId: null`
  // left the snapshot half-populated (`itemId` set, `tabId` null), which
  // looked like a stale-cache bug from the agent's side.
  const mcpActiveTabId = resolveActiveTabId(workbenchTree.groups, focusedGroupId) ?? null
  useMcpActiveStateBridge({
    enabled: mcpEnabled,
    tabId: mcpActiveTabId,
    itemId: activeRequest?.id ?? activeScenarioId ?? null,
    kind: activeRequest ? 'request' : activeScenarioId ? 'scenario' : null,
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
    rootItemsRef,
    setExpandedIds,
    setSelectedItemId,
    openFolderTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    openScenarioEditorTab,
    closeTabByItemId: closeTabByItemIdStable
  })
  // Set to `true` by `useMcpTreeReplace` immediately before each MCP-
  // driven `setRootItems` call; read by the `setCollections` effect
  // below so the zustand store sees `source: 'mcp'` and skips the
  // main-side mirror (main is already canonical for MCP-driven
  // mutations — roundtripping would clobber its class instances).
  // The hook flips the ref true; the effect reads + resets it.
  const mcpDrivenRef = useRef(false)
  // Last main-side tree version applied via `mcp:tree-replace`. Stamped onto
  // the autosave mirror (`setCollections` → `syncCollections`) so main can
  // refuse a mirror that predates a newer MCP mutation (stale-write guard).
  const lastMcpVersionRef = useRef(0)
  const bumpAllTabContentVersionsRef = useRef<() => void>(() => { /* not yet wired */ })
  const bumpAllTabContentVersionsStable = useCallback((): void => { bumpAllTabContentVersionsRef.current() }, [])
  // Prune workbench tabs orphaned by a main-driven tree replacement (MCP
  // delete_item, folder move, …). `setWorkbenchTree` is stable, so this
  // callback never changes identity — safe as a hook dep.
  const pruneOrphanTabsStable = useCallback((existingIds: Set<string>): void => {
    setWorkbenchTree((prevTree) => ({ ...prevTree, groups: pruneOrphanTabs(prevTree.groups, existingIds) }))
  }, [setWorkbenchTree])
  useMcpTreeReplace({ setRootItems, rootItemsRef, mcpDrivenRef, lastMcpVersionRef, bumpAllTabContentVersions: bumpAllTabContentVersionsStable, pruneOrphanTabs: pruneOrphanTabsStable })
  useMcpRunRequest({ enabled: mcpEnabled })
  // Read-only e2e automation hook: exposes window.__restormSuggestions to pull
  // each action's inspector data suggestion for a scenario from the running app.
  useScenarioSuggestionsBridge()
  useE2eDocumentUpdateBridge()
  // Forward-ref dance: `bumpTabContentVersionFor` is declared further
  // down (depends on `setWorkbenchTree`). Hand the patch hook a stable
  // wrapper that reads the ref so we can wire it up without restructuring
  // the file. The ref is patched by the effect right after the bump
  // helper exists.
  const bumpTabContentVersionRef = useRef<(itemId: string) => void>(() => { /* not yet wired */ })
  const bumpTabContentVersionStable = useCallback((itemId: string) => { bumpTabContentVersionRef.current(itemId) }, [])
  useMcpRequestPatch({ enabled: mcpEnabled, rootItems, bumpTabContentVersionFor: bumpTabContentVersionStable })
  // MCP `mini_browser_*` bridge — main fires `mcp:mini-browser-open`
  // / `mcp:mini-browser-execute`; this hook responds by opening the
  // singleton tab + mutating its `url` (which also seeds the webview's
  // initial `src`), or by running JS inside the webview guest and
  // replying with the result.
  const setMiniBrowserUrlForMcp = useCallback((url: string): void => {
    setWorkbenchTree(prev => {
      const visit = (nodes: GroupNode[]): GroupNode[] => nodes.map((node) => {
        if (isTabGroupNode(node)) {
          const idx = node.tabs.findIndex((t) => t.id === MINI_BROWSER_TAB_ID)
          if (idx < 0) return node
          const target = node.tabs[idx] as MiniBrowserTab
          if (target.url === url) return node
          const nextTab: MiniBrowserTab = { ...target, url, persistedState: { url } }
          return { ...node, tabs: [...node.tabs.slice(0, idx), nextTab, ...node.tabs.slice(idx + 1)] }
        }
        if (isContainerNode(node)) return { ...node, groups: visit(node.groups) }
        return node
      })
      return { ...prev, groups: visit(prev.groups) }
    })
  }, [])
  useMcpMiniBrowserBridge({
    enabled: mcpEnabled,
    // `window.restorm.runtime` carries the Mini browser IPC bridge
    // methods; the runtime block isn't fully typed in window.d.ts, so
    // narrow it to the bridge shape the hook needs.
    bridge: (window as { restorm?: { runtime?: MiniBrowserBridgeApi } }).restorm?.runtime,
    openMiniBrowser: handleOpenMiniBrowser,
    setMiniBrowserUrl: setMiniBrowserUrlForMcp
  })
  // MCP `set_tab_maximized` — drive the workbench-wide fullscreen tab
  // through `EditorWorkbench`'s imperative handle. `maximized: false`
  // arrives with `tabId: null`, which restores whatever is maximized.
  const handleSetTabMaximized = useCallback((payload: { tabId: string | null; maximized: boolean }) => {
    workbenchRef.current?.setFullscreenTabId(payload.maximized ? payload.tabId : null)
  }, [workbenchRef])
  useMcpWorkbenchTabsBridge({
    enabled: mcpEnabled,
    openConsole: handleOpenConsole,
    clearConsoleFeed,
    openFirewall: handleOpenFirewall,
    setTabMaximized: handleSetTabMaximized
  })
  // Forward-ref for `handleTabActivate` (declared via `useNavigation`
  // further down) so the layout hook can sync the active tab after a set
  // without a temporal-dead-zone reference.
  const tabActivateForLayoutRef = useRef<(tabId: string) => void>(() => { /* not yet wired */ })
  const tabActivateForLayoutStable = useCallback((tabId: string) => { tabActivateForLayoutRef.current(tabId) }, [])
  // Drive the workbench-wide fullscreen tab through `EditorWorkbench`'s
  // imperative handle when an incoming layout spec maximizes a tab (the
  // same handle `set_tab_maximized` / a double-click uses).
  const setMaximizedTabIdForLayout = useCallback((tabId: string | null) => {
    workbenchRef.current?.setFullscreenTabId(tabId)
  }, [workbenchRef])
  // MCP `get_workbench_layout` / `set_workbench_layout` — push the
  // serialized layout to main for reads, and reconstruct the tree from a
  // broadcast spec on writes (reusing `handleRebuildTab` to open tabs).
  // The generic orchestration lives in electron-core-ui
  // (`useMcpWorkbenchLayoutBridge`); this wires the restorm-specific
  // mapping + IPC bridge to it.
  useMcpWorkbenchLayout({
    enabled: mcpEnabled,
    tree: workbenchTree,
    focusedGroupId,
    maximizedTabId,
    setMaximizedTabId: setMaximizedTabIdForLayout,
    setWorkbenchTree,
    setFocusedGroupId,
    handleRebuildTab,
    // `handleTabActivate` is declared further down (it comes from
    // `useNavigation`). Route through a stable forward-ref so the hook
    // can sync the active tab after a layout swap without hitting the
    // temporal dead zone. The ref is patched by an effect once
    // `handleTabActivate` exists (same trick as `closeTabByItemIdRef`).
    onTabActivate: tabActivateForLayoutStable
  })
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

  // Push the resolved item-favorites to main so the MCP `list_favorites`
  // tool can read them (the favorites store is renderer-only). Re-push on
  // mount, on project / tree change, and on every favorites mutation.
  useEffect(() => {
    if (!mcpEnabled) return undefined
    const push = (window as { restorm?: { runtime?: { pushMcpFavorites?: (p: { projectUuid: string | null; favorites: { id: string; name: string; type: string }[] }) => void } } }).restorm?.runtime?.pushMcpFavorites
    if (!push) return undefined
    const typeOf = (it: FolderItem): string => {
      if ((it as { type?: unknown }).type === 'scenario') return 'scenario'
      if ('folderType' in it && (it as { folderType?: unknown }).folderType === 'environment') return 'env-folder'
      if ('items' in it) return 'folder'
      return 'request'
    }
    const send = (): void => {
      const ids = projectUuid ? favoritesStoreGet(projectUuid) : []
      const favorites: { id: string; name: string; type: string }[] = []
      for (const id of ids) {
        const item = findItemById(rootItems, id)
        if (item) favorites.push({ id, name: item.name, type: typeOf(item) })
      }
      push({ projectUuid, favorites })
    }
    send()
    window.addEventListener('restorm:favorites-changed', send)
    return () => { window.removeEventListener('restorm:favorites-changed', send) }
  }, [mcpEnabled, projectUuid, rootItems])

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
  // request matches `itemId`. EditorWorkbench caches each tab's
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
  /**
   * Bump every workbench tab's `contentVersion`. Used after a full
   * tree replacement (`mcp:tree-replace`): the renderer just swapped
   * `rootItems` for a fresh reactive tree, so every cached tab
   * content (held by `EditorWorkbench`'s tabContentCache) is now
   * holding a stale folder/request reference. Without invalidating
   * those caches, `RestormWorkbench`'s `reactiveFolder ?? effectiveTab.folder`
   * conditional would still surface the OLD reference (the cached
   * React element was rendered with the pre-replace closure), and
   * the user would see the live tree's stale snapshot — for env
   * folders that means password edits stuck in the orphaned tree
   * never reach `rootItems` and the save flow writes an empty `.env`.
   */
  const bumpAllTabContentVersions = useCallback((): void => {
    setWorkbenchTree((prev) => {
      const walk = (nodes: GroupNode[]): GroupNode[] => nodes.map((n) => {
        if (isContainerNode(n)) return { ...n, groups: walk(n.groups) }
        if (!isTabGroupNode(n)) return n
        const tabs = n.tabs.map((tab) => ({ ...tab, contentVersion: (tab.contentVersion ?? 0) + 1 }))
        return { ...n, tabs }
      })
      return { ...prev, groups: walk(prev.groups) }
    })
  }, [])

  // Patch the forward-refs consumed by `useMcpRequestPatch` /
  // `useMcpTreeReplace` (above).
  useEffect(() => { bumpTabContentVersionRef.current = bumpTabContentVersionFor }, [bumpTabContentVersionFor])
  useEffect(() => { bumpAllTabContentVersionsRef.current = bumpAllTabContentVersions }, [bumpAllTabContentVersions])

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
  // the targeted tab — the usual editor semantics. The Workspace stays
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

  const [refreshSourceTarget, setRefreshSourceTarget] = useState<{ id: string; name: string } | null>(null)
  // The env folder the sidebar context-menu's "Refresh" entry is
  // currently running the check-then-decide flow against. Picks up
  // the same `<ApiSpecRefreshFlow>` the Home tab uses so the two
  // surfaces share UX (the "Refreshing API spec…" modal, then either
  // "up to date" or the Import modal in refresh mode).
  const [apiSpecRefreshFolder, setApiSpecRefreshFolder] = useState<EnvironmentFolder | null>(null)
  const canRefreshFromSource = useCallback((id: string): boolean => {
    const folder = rootItems.find((c) => isEnvironmentFolder(c) && c.id === id)
    if (!folder) return false
    const apiUpdate = (folder as unknown as { apiUpdate?: { sourceUrl?: string } }).apiUpdate
    return Boolean(apiUpdate?.sourceUrl)
  }, [rootItems])
  const onRefreshFromSource = useCallback((id: string): void => {
    const folder = rootItems.find((c): c is EnvironmentFolder => isEnvironmentFolder(c) && c.id === id)
    if (!folder) return
    setApiSpecRefreshFolder(folder)
  }, [rootItems])
  const openRefreshImportModal = useCallback((id: string): void => {
    const folder = rootItems.find((c) => isEnvironmentFolder(c) && c.id === id)
    if (!folder || !('name' in folder)) return
    setRefreshSourceTarget({ id, name: folder.name })
  }, [rootItems])

  // `<ApiSpecRefreshFlow>` dispatches `restorm:open-import-refresh`
  // when the user-driven Refresh button finds a checksum mismatch.
  // App owns the Import modal state, so this event triggers it
  // directly (no second checksum round-trip).
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ folderId?: string } | null>).detail
      const folderId = detail?.folderId
      if (folderId === undefined || folderId.length === 0) return
      openRefreshImportModal(folderId)
    }
    window.addEventListener('restorm:open-import-refresh', handler)
    return () => { window.removeEventListener('restorm:open-import-refresh', handler) }
  }, [openRefreshImportModal])

  const { favoriteItems, openDocumentItems } = useFavoritesAndOpenItems({
    rootItems,
    workbenchTree,
    projectUuid,
    updateCount,
    isItemFavorite,
    onRenameFavoriteItem: handleStartRenameInFavorites,
    onRenameOpenedItem: handleStartRenameInOpened,
    onCloneItem: handleCloneItem,
    onDeleteItem: handleDeleteItemChecked,
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
    onDeleteItem: handleDeleteItemChecked,
    onRenameItem: handleSidebarRenameItem,
    isItemFavorite,
    onToggleFavorite: handleToggleFavorite,
    canRefreshFromSource,
    onRefreshFromSource
  })

  // Delete an item and, when it lived DIRECTLY under a scenario, nudge the
  // whole-file save. A scenario's `items` aren't a reactive proxy (unlike a
  // folder's), so splicing a child out of one doesn't trip the dirty trap —
  // no autosave fires and the file stays dirty, prompting to save on close
  // and risking a lost deletion. Mirrors the scenario-edit autosave nudge so a
  // request deleted from a scenario behaves exactly like one deleted from a
  // folder.
  const confirmDeleteAndPersist = useCallback((itemId: string) => {
    const parent = findItemWithParent(rootItems, itemId).parent
    const parentIsScenario = !!parent && isScenario(parent as FolderItem)
    confirmDeleteWithId(itemId)
    if (parentIsScenario) {
      if (scenarioSaveTimer) clearTimeout(scenarioSaveTimer)
      scenarioSaveTimer = setTimeout(() => {
        scenarioSaveTimer = null
        void latestSaveAll?.().catch((err: unknown) => { logger.error('[App] scenario child-delete autosave failed', { error: String(err) }) })
      }, 600)
    }
  }, [rootItems, confirmDeleteWithId])

  // Wrapper for confirmDelete that uses deleteConfirmation.itemId
  const confirmDelete = useCallback(() => {
    confirmDeleteAndPersist(deleteConfirmation.itemId)
  }, [confirmDeleteAndPersist, deleteConfirmation.itemId])

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
      // Drop any pending scenario autosave so it can't fire after the
      // file is gone and serialize the closed project's tree.
      cancelScenarioSaveTimer()
      handleFileClosed()

      // The user explicitly closed the file → forget the auto-reopen record.
      // This is the ONLY place the record is cleared on a closed file: a
      // genuine close broadcasts `file:closed`, whereas an app quit does not
      // (neither `before-quit` nor the window `close` handler calls
      // FileService.close()), so the record correctly survives a quit and is
      // available to the main process on the next launch.
      void window.api.storage.delete(REOPEN_LAST_FILE_STORAGE_KEY)

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

  // Cancel any pending scenario autosave on App unmount — the timer is
  // module-scoped, so without this it can fire after teardown and
  // serialize a stale tree.
  useEffect(() => cancelScenarioSaveTimer, [])

  // Auto-reopen-last-file: when the `files:reopenLastFile` user setting is on,
  // record the currently-open file's path so the main process can reopen it on
  // the next launch.
  //
  // The record is RECORDED here (setting on + a file open) and only CLEARED on
  // two explicit user actions: closing the file (handled in the `onFileClosed`
  // listener above) and turning the setting off (the `prev === true` branch
  // below). It is deliberately NOT cleared just because `filePath` is null —
  // that condition is also true on every fresh launch, before the main process
  // has had a chance to reopen the file, so clearing on it would wipe the
  // record out from under main's startup read and defeat the whole feature.
  const [reopenLastFileSetting] = useSetting(REOPEN_LAST_FILE_SETTING_KEY)
  const prevReopenSettingRef = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    const storage = window.api.storage
    const wasEnabled = prevReopenSettingRef.current
    prevReopenSettingRef.current = reopenLastFileSetting === true
    if (reopenLastFileSetting === true) {
      if (filePath) void storage.set(REOPEN_LAST_FILE_STORAGE_KEY, filePath)
    } else if (wasEnabled === true) {
      // Setting was just turned off by the user → forget the recorded file.
      void storage.delete(REOPEN_LAST_FILE_STORAGE_KEY)
    }
  }, [reopenLastFileSetting, filePath])

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

  // Lookup callbacks passed down to RestormWorkbench → EditorGroupView,
  // which resolve a tab's request/folder/scenario by id and RENDER it.
  // Keyed on `[rootItems]` (state) ON PURPOSE: a consumer that holds these
  // must re-resolve when the tree changes (e.g. a freshly-imported request
  // a tab is opening, or a renamed/deleted item) — making them stable
  // (ref + [] deps) stopped that re-resolution and left a just-opened
  // request tab blank (hidden send button). Correctness over the
  // re-render micro-optimisation.
  const getRequestByIdCb = useCallback((id: string) => findRequestById(rootItems, id), [rootItems])
  const getFolderByIdCb = useCallback((id: string) => findFolderById(rootItems, id), [rootItems])
  const getScenarioByIdCb = useCallback((id: string) => findScenarioById(rootItems, id), [rootItems])
  const getEnvironmentFolderByIdCb = useCallback((id: string) => findEnvironmentFolderById(rootItems, id), [rootItems])

  // Send-time hook: request tab views call this to resolve their
  // `authenticationRequestId` back to the AuthenticationRequest
  // sitting in `rootItems`, so the IPC call carries the full auth
  // document the main-process executor needs. Reads `rootItems` (state),
  // not the ref + [] deps the lookup callbacks above use — this one is
  // also invoked DURING RENDER (the ImportModal refresh-context IIFE),
  // where react-hooks/refs forbids reading a ref.
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
    // Stamp the mirror with the last applied main-side version so a stale
    // `'user'` mirror (rootItems lagging an MCP mutation) is refused main-side.
    setCollections(environmentFolderCollections, source, lastMcpVersionRef.current)
  }, [environmentFolderCollections, setCollections])

  // Listen to test events for E2E tests (only in dev/test mode)
  // Expose handleFileOpened directly on window for E2E tests
  // This must be done outside useEffect to ensure it's available immediately
  const handleFileOpenedRef = useRef(handleFileOpened)
  useEffect(() => {
    handleFileOpenedRef.current = handleFileOpened
  }, [handleFileOpened])

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
        findItemIdByPath: (nameChain: string[]) => string | null
        setEnvFolderTagColor: (folderName: string, tag: string, color: string | null) => boolean
        closeFile: () => Promise<void>
        menuClose: () => Promise<void>
      }
    }).__restormTestHelpers = {
      loadFile: (fileState: { currentFile: { content: unknown } }) => {
        // Use ref to ensure we call the latest version
        handleFileOpenedRef.current(fileState)
      },
      setRootItems: (items: FolderItem[]) => {
        // Folders/env-folders go through `makeReactiveFolder`; root-level
        // requests go through `makeReactiveRequest` (no parent id) so
        // edits emit `REQUEST_UPDATED` like nested requests.
        const reactiveItems = items.map((item) =>
          isScenario(item) ? item : 'items' in item ? makeReactiveFolder(item) : makeReactiveRequest(item)
        )
        setRootItems(reactiveItems)
        // Also trigger indexing
        void (async (): Promise<void> => {
          await searchIndexService.clearIndex()
          await searchIndexService.initialize()
          for (const rootItem of reactiveItems) {
            if (isScenario(rootItem)) {
              await searchIndexService.indexScenarioTree(rootItem)
            } else if ('items' in rootItem) {
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
      },
      findItemIdByPath: (nameChain: string[]): string | null => {
        // Same name-chain walk as `findItemIndexPath` but returns the
        // leaf item's stable uuid. Tests that build a tab id need this
        // since `buildTabId` switched from index-path-based ids
        // (`request-idx:N.N.N`) to uuid-based ids (`request-id:<uuid>`).
        if (nameChain.length === 0) return null
        let currentList: unknown[] = rootItemsRef.current as unknown[]
        let leaf: { id?: unknown } | undefined
        for (const name of nameChain) {
          const idx = currentList.findIndex((item) => {
            return typeof (item as { name?: unknown }).name === 'string'
              && (item as { name: string }).name === name
          })
          if (idx === -1) return null
          leaf = currentList[idx] as { id?: unknown }
          const next = currentList[idx] as { items?: unknown[] } | undefined
          currentList = next?.items ?? []
        }
        return typeof leaf?.id === 'string' ? leaf.id : null
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

      // NOTE: the `JSON.parse(JSON.stringify(folder))` SNAPSHOTS the folder at
      // schedule time on purpose — the deferred checksum must reflect the state
      // when the env event fired, not a later live mutation (passing the live
      // object instead raced the dirty-baseline and flipped folder-mode
      // dirty-state). Keep the snapshot.
      for (const rootFolder of rootItemsRef.current) {
        if (rootFolder.id === parentFolderId) {
          scheduleChecksumUpdate(parentFolderId, () => computeChecksum(JSON.parse(JSON.stringify(rootFolder)) as EnvironmentFolder | Folder))
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
    // changed between mutate and save. `SecretValue.toJSON` strips
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

      // A sub-environment isn't its own save-unit — it lives embedded in its
      // top-level environment's content (`environments` is @separateFolders,
      // `subEnvironments` is not). Redirect the upsert onto the top-level env's
      // unit so the change is actually saved + committed; registering a
      // per-sub-env unit would create a phantom the decomposer never produces,
      // leaving the doc permanently dirty and the change unsaved despite
      // autosave. When the top-level owner can't be resolved (e.g. the event
      // raced the tree state), SKIP rather than register that phantom.
      // (See utils/envSaveUnit.ts.)
      let runtimeId = payload.id
      let document: unknown = payload.document
      let parentId = payload.parentFolderId
      if (payload.type === 'environment' && payload.parentEnvironmentId !== undefined) {
        const topEnv = payload.parentFolderId !== undefined
          ? findTopLevelEnvironment(rootItemsRef.current, payload.parentFolderId, payload.id)
          : null
        if (!topEnv || topEnv.id === payload.id) {
          logger.warn('[App] upsertSaveUnit: sub-env owner not resolved, skipping', { id: payload.id })
          return
        }
        runtimeId = topEnv.id
        document = topEnv
        parentId = payload.parentFolderId
      }

      let draft: Record<string, unknown>
      try {
        const raw = JSON.parse(JSON.stringify(document)) as Record<string, unknown>
        const cls = classForDocument(payload.type, raw)
        draft = cleanseForPersistence(raw, cls)
      } catch (err) {
        logger.warn('[App] upsertSaveUnit: failed to cleanse document', {
          id: runtimeId,
          error: String(err)
        })
        return
      }
      void upsertSaveUnit({
        runtimeId,
        kind: kindForType(payload.type),
        draft,
        reason: 'modify',
        ...(parentId !== undefined && { parentId })
      }).catch((err: unknown) => {
        logger.warn('[App] upsertSaveUnit failed', { id: runtimeId, error: String(err) })
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

      // A deleted SUB-environment isn't its own save-unit — its top-level
      // environment's content just lost a sub-env. Mark THAT unit dirty (so the
      // deletion is saved + committed) instead of recording a phantom delete
      // the save can never reconcile. Top-level env / folder / request deletes
      // fall through to the real tombstone path below.
      if (
        payload.type === 'environment' &&
        payload.parentEnvironmentId !== undefined &&
        payload.parentFolderId !== undefined
      ) {
        const topEnv = findTopLevelEnvironment(rootItemsRef.current, payload.parentFolderId, payload.parentEnvironmentId)
        if (topEnv) {
          doUpsert({ id: topEnv.id, type: 'environment', document: topEnv, parentFolderId: payload.parentFolderId })
          return
        }
      }

      void markSaveUnitDeleted(payload.id).catch((err: unknown) => {
        logger.warn('[App] markSaveUnitDeleted failed', { id: payload.id, error: String(err) })
      })
      // Drop the per-request panel-state entry so the user-level
      // store doesn't accumulate orphaned ids. Folder + env deletes
      // skip this path — only request ids key into the store.
      if (payload.type === 'request' && projectUuid) {
        removeRequestPanelState(projectUuid, payload.id)
      }
    }

    // Workbench-tab cache invalidation on env changes. Every request
    // tab's `EnvironmentProvider` reads `liveEnvironments` off the
    // reactive env-folder at render time, but the cached React element
    // captures that array reference. Without invalidation, a newly-
    // created env (Forgeaude in the original repro) never reaches the
    // request tab's `setAvailableEnvironments` IPC even though the env
    // exists in ContextService, and `{{name}}` resolves to empty on
    // dispatch. Bumping every tab's contentVersion forces the cached
    // tab content to regenerate with the live env list — React still
    // reconciles same-type components in place so component-local
    // useState survives.
    const handleEnvStructureChanged = (): void => {
      bumpAllTabContentVersionsRef.current()
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
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_DELETED, handleDelete),
      // Bump tab contentVersion so request tabs re-derive their live
      // env list when the env tree mutates — see comment above.
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_CREATED, handleEnvStructureChanged),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_UPDATED, handleEnvStructureChanged),
      eventBus.subscribe(DocumentEvents.ENVIRONMENT_DELETED, handleEnvStructureChanged)
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
    // `rootItems` is intentionally NOT a dep: the handlers read the live
    // tree via `rootItemsRef.current`, so this 15-subscription effect
    // mounts ONCE per file/project instead of tearing down + re-subscribing
    // on every tree keystroke. `environmentFolderCollections`
    // isn't read in the effect body at all, so it's dropped too.
  }, [updateTabDirtyChecksum, filePath, projectUuid])

  // Dirty state is now handled by FileService in the main process
  // It subscribes to DocumentEvents and compares checksums automatically

  // Use navigation hook for handling clicks and breadcrumbs
  const {
    handleItemClick,
    handleItemAuxClick,
    openItemAtSplit,
    handleBreadcrumbClick,
    handleBreadcrumbAuxClick,
    handleTabActivate,
    handleSearchResultClick
  } = useNavigation({
    rootItems,
    openFolderTab,
    openScenarioEditorTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    setSelectedItemId,
    setExpandedIds,
    setFocusedGroupId,
    getNearestEnvironmentsForBreadcrumbs
  })

  // Patch the forward-reference ref consumed by `useMcpWorkbenchLayout`
  // (above) now that `handleTabActivate` exists.
  useEffect(() => { tabActivateForLayoutRef.current = handleTabActivate }, [handleTabActivate])

  // Sidebar → workbench split drop. A sidebar tree item dragged over an
  // open tab lights the SAME split overlay as a dragged workbench tab
  // (the shared ECUI external-drop channel) and, on release, opens the
  // dragged item beside the drop target. `isWorkbenchExternalDrop` tells
  // the overlay which drags to react to (a ListView item drag that
  // resolves to a known tree item); `handleWorkbenchExternalDrop` opens
  // the item at the released group + zone.
  //
  // The scenario surface OWNS sidebar drops (it adds the item to the
  // graph), so the workbench split channel must NOT engage over it: we
  // return false whenever the drag is over a scenario editor. ECUI's
  // group handlers bubble up the real DOM from the portalled tab content,
  // so a drag over the scenario canvas reports `event.target` inside the
  // scenario wrapper (`data-testid="scenario-editor"`); detecting that
  // keeps the overlay dark there and lets the scenario's own React
  // `onDrop` add the node. (Relying on the scenario calling
  // `stopPropagation` on its native listeners proved fragile — the React
  // Flow pane owns the canvas drag events, so the scenario's native drop
  // never fired and the add was lost.)
  const isWorkbenchExternalDrop = useCallback((event: DragEvent): boolean => {
    const types = event.dataTransfer?.types
    if (!types) return false
    if (!Array.from(types).includes(LIST_VIEW_DRAG_MIME)) return false
    const target = event.target
    if (target instanceof Element && target.closest('[data-testid="scenario-editor"]')) return false
    return true
  }, [])

  const handleWorkbenchExternalDrop = useCallback((event: DragEvent, targetGroupId: string, direction: SplitDirection): void => {
    const itemId = event.dataTransfer?.getData('text/plain')
    if (!itemId) return
    // Only open items that exist in the tree (request / folder / env-folder
    // / scenario). Unknown ids (a foreign drag that happened to carry our
    // marker MIME) are ignored.
    if (!resolveBoundItem(itemId)) return
    openItemAtSplit(itemId, targetGroupId, direction)
  }, [resolveBoundItem, openItemAtSplit])

  // Reverse navigation request → scenarios: list the scenarios using a request,
  // and open one (optionally centring the bound box). Computed live from the
  // tree, so deletes update it with no stored back-reference.
  const getScenariosUsingRequestCb = useCallback(
    (requestId: string) => findScenariosUsingRequest(rootItems, requestId),
    [rootItems]
  )
  // Reverse navigation scenario → callers: same shape, but for sub-scenarios
  // referenced by a `runScenario` node from another scenario.
  const getScenariosUsingScenarioCb = useCallback(
    (scenarioId: string) => findScenariosUsingScenario(rootItems, scenarioId),
    [rootItems]
  )
  // Quick-config delete cross-link: the scenarios whose actions reference a
  // saved config by id, so the quick-settings trash confirmation can name them.
  const getScenariosUsingQuickConfigCb = useCallback(
    (quickConfigId: string) => findScenariosUsingQuickConfig(rootItems, quickConfigId),
    [rootItems]
  )
  const openScenarioFromRequest = useCallback((scenarioId: string, focusNodeId?: string) => {
    handleItemClick(scenarioId)
    if (focusNodeId) requestScenarioNodeFocus(scenarioId, focusNodeId)
  }, [handleItemClick])

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

  // Bundle the suggester with the open project's path so the inspector's
  // CLI help can render a fully-formed `restorm --open <file> --run <target>`.
  const scenarioCliInfo = useMemo(
    () => ({
      suggestRunTarget: suggestScenarioRunTarget,
      projectPath: filePath ?? currentFolderPath ?? null
    }),
    [suggestScenarioRunTarget, filePath, currentFolderPath]
  )

  return (
    <ScenarioCliInfoProvider value={scenarioCliInfo}>
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
        onOpenConsole={handleOpenConsole}
        onOpenFirewall={handleOpenFirewall}
        onOpenMiniBrowser={handleOpenMiniBrowser}
        onOpenMcpLogs={handleOpenMcpLogs}
        onGitPush={handleGitPush}
        onGitPull={handleGitPull}
        onGitRefresh={handleGitRefresh}
        onGitHistory={handleOpenGitHistory}
        onGitResetToServer={handleGitResetToServer}
        gitPushPending={gitPendingFlags.pushPending}
        gitPullPending={gitPendingFlags.pullPending}
        workbenchActive={fileName !== null}
        onOpenSettingsTab={handleOpenSettingsTab}
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
          previewOnHover
          data-testid="app-dock-sidebar"
          panelOverlay={
            <Button
              icon={sidebarDockCollapsed ? 'pin' : 'pinned'}
              options={{
                ariaLabel: sidebarDockCollapsed
                  ? t('sidebar.expand', 'Expand sidebar')
                  : t('sidebar.collapse', 'Collapse sidebar')
              }}
              data-testid="restorm-main-sidebar-toggle"
              onClick={(): void => { sidebarDockRef.current?.toggle() }}
              className="restorm-main-sidebar-panel__toggle restorm-main-sidebar-panel__toggle--gutter"
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
                  onItemAuxClick={handleItemAuxClick}
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
                  onDeleteRequest={(payload) => { handleDeleteItemChecked(payload.item.id) }}
                  onEditingStart={(itemId) => { setSidebarEditingItemId(itemId) }}
                  onEditingEnd={() => { setSidebarEditingItemId(null) }}
                  onAddRequest={() => { setShowImportModal(true) }}
                  onCollapseAll={() => { setExpandedIds([]) }}
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
              {/* Bottom spacer so the workspace tree never bleeds
               * under the toggle button (rendered above via
               * `panelOverlay`, which is the only place the button
               * stays visible across collapsed / expanded / preview
               * with constant on-screen position). */}
              <div className="restorm-main-sidebar-panel__footer-spacer" aria-hidden />
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
              onFullscreenTabIdChange={setMaximizedTabId}
              onTabActivate={handleTabActivate}
              onRequestClick={handleItemClick}
              onRequestAuxClick={handleItemAuxClick}
              onBreadcrumbClick={handleBreadcrumbClick}
              onBreadcrumbAuxClick={handleBreadcrumbAuxClick}
              onItemRename={handleItemRename}
              onItemIconChange={handleItemIconChange}
              onTagsChange={handleTagsChange}
              onTagColorChange={handleTagColorChange}
              onFolderChange={handleFolderChange}
              onScenarioChange={handleScenarioChange}
              onCreateScenarioRequest={handleCreateScenarioRequest}
              onCreateScenarioChild={handleCreateScenarioChild}
              resolveBoundItem={resolveBoundItem}
              isWorkbenchExternalDrop={isWorkbenchExternalDrop}
              onWorkbenchExternalDrop={handleWorkbenchExternalDrop}
              resolveRequestEnv={resolveRequestEnv}
              resolveSyntheticPreview={resolveSyntheticPreview}
              onEnvironmentFolderChange={handleEnvironmentFolderChange}
              onSizesChange={handleSizesChange}
              emptyFallback={
                // Held back while a tab restore that will reopen tabs is still
                // pending, so the onboarding never flashes during the async
                // reopen on load. See `onboardingRestorePending`.
                onboardingRestorePending
                  ? null
                  : <Onboarding rootItems={rootItems} projectUuid={projectUuid} onImport={() => { setShowImportModal(true) }} onOpenRequest={handleItemClick} />
              }
              workbenchId={workbenchId}
              onRebuildTab={rootItems.length > 0 ? handleRebuildTab : undefined}
              onStateRestored={handleStateRestoredGated}
              getRequestById={getRequestByIdCb}
              getScenariosUsingRequest={getScenariosUsingRequestCb}
              getScenariosUsingQuickConfig={getScenariosUsingQuickConfigCb}
              getScenariosUsingScenario={getScenariosUsingScenarioCb}
              onOpenScenarioFromRequest={openScenarioFromRequest}
              getFolderById={getFolderByIdCb}
              getScenarioById={getScenarioByIdCb}
              getEnvironmentFolderById={getEnvironmentFolderByIdCb}
              navigationEnabled={navigationEnabled}
              tabSwitcherAnchorSelector='[data-testid="main-titlebar-searchbar-closed"]'
              projectUuid={projectUuid}
              tabReloadEpoch={tabReloadEpoch}
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
            onFullscreenTabIdChange={setMaximizedTabId}
            onTabActivate={handleTabActivate}
            onBreadcrumbClick={handleBreadcrumbClick}
            onBreadcrumbAuxClick={handleBreadcrumbAuxClick}
            onItemRename={handleItemRename}
            onItemIconChange={handleItemIconChange}
            onTagsChange={handleTagsChange}
            onFolderChange={handleFolderChange}
            onScenarioChange={handleScenarioChange}
            onCreateScenarioRequest={handleCreateScenarioRequest}
            onCreateScenarioChild={handleCreateScenarioChild}
            resolveBoundItem={resolveBoundItem}
            isWorkbenchExternalDrop={isWorkbenchExternalDrop}
            onWorkbenchExternalDrop={handleWorkbenchExternalDrop}
            resolveRequestEnv={resolveRequestEnv}
            resolveSyntheticPreview={resolveSyntheticPreview}
            onEnvironmentFolderChange={handleEnvironmentFolderChange}
            onSizesChange={handleSizesChange}
            emptyFallback={
              <WelcomeScreen
                name="Restorm"
                ariaLabel={t('welcome.landmarkLabel')}
                onOpenFile={(path) => { void window.restorm?.file.openPath(path) }}
                confirmRemoveFavorite={(fileName) => window.confirm(t('welcome.confirmRemoveFavorite', { fileName }))}
                onRevealInFolder={(path) => { revealPathInFolder(path) }}
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
            getScenariosUsingRequest={getScenariosUsingRequestCb}
            getScenariosUsingQuickConfig={getScenariosUsingQuickConfigCb}
            getScenariosUsingScenario={getScenariosUsingScenarioCb}
            onOpenScenarioFromRequest={openScenarioFromRequest}
            getFolderById={(id) => findFolderById(rootItems, id)}
            getScenarioById={(id) => findScenarioById(rootItems, id)}
            getEnvironmentFolderById={(id) => findEnvironmentFolderById(rootItems, id)}
            navigationEnabled={navigationEnabled}
            tabSwitcherAnchorSelector='[data-testid="main-titlebar-searchbar-closed"]'
            projectUuid={projectUuid}
            tabReloadEpoch={tabReloadEpoch}
            isItemFavorite={isItemFavorite}
            onToggleFavorite={handleToggleFavorite}
          />
        </div>
      )}

      {/* Only the FIRST visible right-side cell carries `right-aligned`
          (margin-left: auto); the rest follow naturally to its right.
          Two cells with the auto margin would split the free space and
          strand the first one near the centre. The MCP indicator now
          ALWAYS mounts (even when the server is stopped/disabled — it
          stays reachable so the user can re-enable it), so it is always
          the leftmost-of-the-right cell and always owns the auto margin;
          the git entry and the bell, which follow it, must never carry
          `right-aligned`. */}
      <Statusbar data-testid="app-statusbar">
        <StatusbarVersionPlan />
        {filePath && (
          <StatusbarElement
            data-testid="app-statusbar-element"
            title={filePath}
            tooltipTrigger="click"
            tooltipPlacement="above"
          >
            <StatusbarPathActionsHost filePath={filePath} />
          </StatusbarElement>
        )}
        {/* The environment selector, request-history button and auth-route
         * selector now all live in the request tab header, not here. The
         * MCP indicator carries the `right-aligned` auto margin in every
         * state (running and stopped/disabled) since it always renders. */}
        <StatusbarMcpIndicator rightAligned onViewLogs={handleOpenMcpLogs} />
        {/* Renders nothing unless a project is open; visible-but-locked (the
         * 3-state gate) rather than hidden once one is, regardless of
         * whether the folder happens to be a git repo. */}
        <StatusbarGitIndicator filePath={filePath} hasUnsavedChanges={isDirty} onPush={handleGitPush} onPull={handleGitPull} onHistory={handleOpenGitHistory} />
        <StatusBarBellButton toasterId="app" />
      </Statusbar>

      {/* Global toaster anchored to the bottom-right, toggled by the statusbar bell. */}
      <Toaster id="app" position="bottom-right" data-testid="app-toaster" />

      {/* Turns auto-update transitions into app-toaster notifications, shows
       * "What's new" on the first run after an update, and owns the release-notes
       * modal those toasts (and the Help menu) open. */}
      <UpdateNotifications />
      <CrashConsentPrompt />
      <CrashReportReviewHost />

      {/* Fullscreen git-history modal (statusbar source-control icon). */}
      <Modal
        isOpen={gitHistory.open}
        onClose={() => { setGitHistory((prev) => ({ ...prev, open: false })) }}
        title={t('git.historyTitle')}
        data-testid="git-history-modal"
      >
        <GitHistoryView
          commits={gitHistory.commits}
          {...(gitHistory.mainTipHash !== undefined ? { mainTipHash: gitHistory.mainTipHash } : {})}
          onRecoverVersion={handleRecoverVersion}
          formatDate={formatGitHistoryDate}
        />
      </Modal>

      <GitRecoverVersionConfirmModal
        isOpen={recoverVersionHash !== null}
        onConfirm={confirmRecoverVersion}
        onCancel={() => { setRecoverVersionHash(null) }}
      />

      {/* Delete confirmation modal */}
      <DeleteConfirmationModal
        isOpen={deleteConfirmation.isOpen}
        itemName={deleteConfirmation.itemName}
        isFolder={deleteConfirmation.isFolder}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />

      {/* Push modal — triggered by the statusbar repo-push button / the
          title-bar Git menu (see `usePushModal`). Non-scoped (not bound to
          any tab). */}
      <PushModal
        isOpen={pushModal.isOpen}
        onClose={pushModal.closePushModal}
        languages={AVAILABLE_LANGUAGES}
        language={pushModal.language}
        onLanguageChange={pushModal.setLanguage}
        applyLanguageByDefault={pushModal.applyLanguageByDefault}
        onApplyLanguageByDefaultChange={pushModal.setApplyLanguageByDefault}
        title={pushModal.title}
        onTitleChange={pushModal.setTitle}
        body={pushModal.body}
        onBodyChange={pushModal.setBody}
        onPush={pushModal.push}
        pushDisabled={!pushModal.hasChanges}
      />

      {/* Explicit "throw my work away and take the server's version".
          Same operation as the update prompt's server choice — one
          implementation, two entry points — but always confirmed, since
          nothing about the click itself says how much is at stake. */}
      <GitResetToServerConfirmModal
        isOpen={resetToServerConfirm}
        onConfirm={confirmGitResetToServer}
        onCancel={() => { setResetToServerConfirm(false) }}
      />

      {/* Raised before anything is written when the server holds a newer
          version AND the two sides genuinely disagree. Shared by Push and
          Pull; with nothing contested it never opens at all. */}
      {pushModal.pendingUpdate && (
        <GitUpdateRequiredModal
          isOpen
          conflictCount={pushModal.pendingUpdate.conflicts.length}
          conflictNames={pushModal.pendingUpdate.conflicts.map((c) => `${c.kind}:${c.name}`).join(', ')}
          onClose={pushModal.cancelPendingUpdate}
          onChoice={pushModal.resolvePendingUpdate}
        />
      )}

      {/* 4-panel resolution — reached from the prompt above (or, for a
          caller that started a real git merge, from that merge state). */}
      <GitConflictResolutionModal
        isOpen={pullConflict.isOpen}
        conflictResolution={pullConflict.conflictResolution}
        onClose={pullConflict.close}
        onFinish={() => { void pullConflict.finishResolution() }}
      />

      {/* MCP call-logs viewer — full-screen modal shown on the welcome
          screen (no workbench to host a tab). When a file is open the
          status-bar link / View menu open it as a workbench tab instead. */}
      <Modal
        data-testid="mcp-logs-modal"
        isOpen={mcpLogsModalOpen}
        title={mcpLogsLabels.title}
        onClose={() => { setMcpLogsModalOpen(false) }}
      >
        <div style={{ height: '60vh', minHeight: 320, overflow: 'hidden' }}>
          <McpLogsPanel labels={mcpLogsLabels} translateToolTitle={t} />
        </div>
      </Modal>

      {/* Deletion of a request used by scenarios: move it in, or delete + strip boxes. */}
      <RequestScenarioDeleteModal
        isOpen={scenarioDelete.isOpen}
        requestName={scenarioDelete.requestName}
        usages={scenarioDelete.usages}
        onMoveIntoScenario={(scenarioId) => { handleMoveRequestIntoScenario(scenarioDelete.requestId, scenarioId) }}
        onDeleteAnyway={handleDeleteRequestAnyway}
        onCancel={() => { setScenarioDelete((p) => ({ ...p, isOpen: false })) }}
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
              const apiUpdate = (folder as unknown as { apiUpdate?: { sourceUrl?: string; authenticationRequestId?: string; sourceHeaders?: Record<string, string> } } | undefined)?.apiUpdate
              const sourceUrl = apiUpdate?.sourceUrl ?? ''
              // The resolver returns the shared/types AuthenticationRequest
              // (data shape, no class methods), while RefreshContext —
              // matching the rest of ImportModal — types it as the
              // shared/models class. The runtime payload is the same
              // (the renderer carries reactive proxies whose getters
              // return primitive values), so cast through `unknown`.
              const authReq = (apiUpdate?.authenticationRequestId
                ? resolveAuthRequestCb(apiUpdate.authenticationRequestId)
                : null)
              // Pre-compute the natural keys of every request already
              // in the env folder so the modal can lock the matching
              // leaves in the fetched preview tree. Walks the folder's
              // top-level items (children of the env-folder root).
              const existingLeafKeys = folder ? allLeafKeys(folder.items) : new Set<string>()
              const refreshContext: RefreshContext = {
                sourceUrl,
                ...(authReq ? { authenticationRequest: authReq as unknown as NonNullable<RefreshContext['authenticationRequest']> } : {}),
                ...(apiUpdate?.sourceHeaders ? { sourceHeaders: apiUpdate.sourceHeaders } : {}),
                targetFolderId: targetId,
                ...(existingLeafKeys.size > 0 ? { existingLeafKeys } : {}),
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
                  const updatedFolderRef: { value: EnvironmentFolder | null } = { value: null }
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
                    const merged = {
                      ...next,
                      items: updated,
                      ...(payload.apiUpdate ? { apiUpdate: payload.apiUpdate } : {})
                    } as typeof item
                    updatedFolderRef.value = merged as unknown as EnvironmentFolder
                    return merged
                  }))
                  // The `setRootItems` callback above swaps the proxied
                  // folder for a plain spread literal — the proxy's set
                  // trap never sees an `apiUpdate =` assignment, so even
                  // though `apiUpdate` is in FOLDER_INDEXABLE_KEYS the
                  // event doesn't auto-fire here. Emit explicitly so the
                  // save-unit upsert picks up the refreshed apiUpdate
                  // (payloadChecksum / lastImportedAt) and writes it to
                  // disk on the next flush.
                  if (updatedFolderRef.value) {
                    eventBus.emitLocalSync(DocumentEvents.FOLDER_UPDATED, {
                      type: 'folder',
                      id: payload.id,
                      document: updatedFolderRef.value
                    } as DocumentChangedPayload)
                  }
                  setRefreshSourceTarget(null)
                }
              }
              return { refreshContext }
            })() : {})}
          />
          {apiSpecRefreshFolder && (
            <ApiSpecRefreshFlow
              folder={apiSpecRefreshFolder}
              onDismiss={() => { setApiSpecRefreshFolder(null) }}
              onOpenRefreshModal={openRefreshImportModal}
              testIdPrefix="sidebar-refresh-from-source"
            />
          )}
        </div>
        </AuthRequestResolverContext.Provider>
      </VariableTransformProvider>
    </AvailableVariablesProvider>
    </ScenarioCliInfoProvider>
  )
}

export default App
