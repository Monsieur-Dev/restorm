import React, { useMemo, useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger, IconView, TabSwitcherOverlay, navigationService, useFeature, MiniBrowserPanel, ConsolePanel, SettingsPage, McpLogsPanel, Tabs, MarkdownEditor, FirewallPanel, type Tab, type ContextMenuItem, type McpLogsLabels } from 'electron-core-ui/renderer'
import { miniBrowserDriver } from '../../../services/miniBrowserDriver'
import type { EditorWorkbenchCallbacks, WorkbenchTree, EditorTab, EditorWorkbenchHandle, RebuildTabCallback, TabSwitcherItem } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type { RestormEditorTab, BreadcrumbItem } from '../../../../../shared/types/editor'
import {
  isFolderTab,
  isEnvironmentFolderTab,
  isHTTPRequestTab,
  isGraphQLRequestTab,
  isGrpcRequestTab,
  isSoapRequestTab,
  isWebSocketRequestTab,
  isODataRequestTab,
  isAuthenticationRequestTab,
  isAnyRequestTab,
  isScenarioEditorTab,
  isConsoleTab,
  isFirewallTab,
  isMiniBrowserTab,
  isSettingsTab,
  isMcpLogsTab
} from '../../../../../shared/types/editor'
import { FIREWALL_TEST_BUTTON_FEATURE } from '../../../../../main/featureFlags'
import {
  HTTPRequestTabView,
  GraphQLRequestTabView,
  GrpcRequestTabView,
  SoapRequestTabView,
  WebSocketRequestTabView,
  ODataRequestTabView
} from '../../RequestTabViews'
import { EnvironmentProvider } from '../../../contexts/EnvironmentContext'
import { WorkbenchActiveTabContext } from '../../../contexts/WorkbenchActiveTabContext'
import { ScenarioEditorView } from '../../Scenario/ScenarioEditorView'
import type { ResolveBoundItem, ResolveRequestEnv } from '../../Scenario/scenarioBoundResolver'
import type { SyntheticRequestPreview } from '../../../../../shared/utils/syntheticRequestPreview'
import type { AddChildKind } from '../Sidebar/contextMenuBuilder'
import { FolderView } from '../../Folders/FolderView'
import { EnvironmentFolderView } from '../../Folders/EnvironmentFolderView'
import type { EnvironmentFolder, Folder, Request, Scenario, ScenarioNode, ScenarioEdge } from '../../../../../shared/types/collections'
import { getFolderIcon } from '../../../utils/treeSearch'
import { Badge } from '../../common/Badge'
import { ScenarioRunningBadge } from '../../common/ScenarioRunningBadge'
import { SecretResolvingSpinner } from '../../common/SecretResolvingSpinner'
import { SecretErrorIndicator } from '../../common/SecretErrorIndicator'
import { ItemSecretBadges } from '../../common/ItemSecretBadges'
import { collectFolderEnvIds } from '../../../services/FolderToListView'
import { mapToBadgeType } from '../../../utils/badgeUtils'
import { useTranslation } from 'react-i18next'
import { RestormWorkbenchTab } from './RestormWorkbenchTab'
import { DeprecationAwareRequestTab } from './DeprecationAwareRequestTab'
import { RequestScenarioUsageButton } from './RequestScenarioUsageButton'
import { RequestHeaderEnvSelector } from '../RequestHeaderEnvSelector'
import { RequestHeaderHistoryButton } from '../RequestHeaderHistoryButton'
import { RequestHeaderAuthSelector } from '../RequestHeaderAuthSelector'
import { ScenarioCallersButton } from './ScenarioCallersButton'
import { HeaderHoverTooltip } from '../HeaderHoverTooltip'
import { ScenarioRunHistoryButton } from '../../Scenario/ScenarioRunHistoryButton'
import type { ScenarioRequestUsage, ScenarioScenarioUsage } from '../../../services/scenarioRequestUsage'
import { useTabSwitcher } from '../../../hooks/useTabSwitcher'

/** Extract title string from EditorTab */
function getTabTitleString(tab: EditorTab & { titleString?: string }, fallback = ''): string {
  if (tab.titleString !== undefined) {
    return tab.titleString
  }
  if (typeof tab.title === 'string') {
    return tab.title
  }
  if (typeof tab.title === 'number' || typeof tab.title === 'boolean') {
    return String(tab.title)
  }
  return fallback
}

export interface RestormWorkbenchProps {
  tree: WorkbenchTree
  dirtyItemIdsSet?: ReadonlySet<string> | undefined
  initialTabContentMap?: Record<string, string>
  onTreeChange?: (tree: WorkbenchTree) => void
  className?: string
  style?: React.CSSProperties
  /** ID of the group that was focused last in the workbench */
  focusedGroupId?: string | null
  /** Callback fired whenever the focused group changes */
  onFocusedGroupChange?: (groupId: string | null) => void
  /** Callback fired whenever the maximized (fullscreen) tab changes —
   * forwarded from `EditorWorkbench` so the host can track the
   * workbench-wide maximized state (it lives outside the tree). */
  onFullscreenTabIdChange?: ((tabId: string | null) => void) | undefined
  /** Callback fired when a tab is activated (clicked or selected) */
  onTabActivate?: (tabId: string) => void
  /** Open a request by id — passed through to env-folder home tabs so
   *  the Favorite Requests rows behave like sidebar entries. */
  onRequestClick?: (requestId: string) => void
  /** Middle-click variant of `onRequestClick`. Threaded down to the
   *  env-folder home favorites so a middle-click opens the request tab
   *  without focusing it (the "open in background" gesture). */
  onRequestAuxClick?: (requestId: string) => void
  /** Callback fired when a breadcrumb item is clicked (for navigation) */
  onBreadcrumbClick?: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  /** Callback fired on middle-click of a non-last breadcrumb item — the
   * "open tab in background" gesture. Consumers typically open the
   * matching workbench tab without focusing it or touching the sidebar. */
  onBreadcrumbAuxClick?: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  /** Callback fired when the last breadcrumb item is renamed */
  onItemRename?: (item: BreadcrumbItem, newName: string) => void
  /** Callback fired when the last breadcrumb item's icon changes */
  onItemIconChange?: ((item: BreadcrumbItem, newIcon: Icon | null) => void) | undefined
  /** Callback fired when tags are changed for a folder or request */
  onTagsChange?: (targetId: string, tags: string[]) => void
  /** Callback fired when a tag color changes for an environment folder */
  onTagColorChange?: ((envFolderId: string, tag: string, color: string | null) => void) | undefined
  /** Callback fired when a folder's data changes (environments, etc.) */
  onFolderChange?: (folderId: string, folder: Folder) => void
  /** Callback fired when a scenario's graph (nodes/edges) changes. */
  onScenarioChange?: (scenarioId: string, patch: { nodes?: ScenarioNode[]; edges?: ScenarioEdge[]; notes?: string }) => void
  /** Create a new HTTP request as a child of the scenario (id), return its id. */
  onCreateScenarioRequest?: (scenarioId: string) => string | null
  /** Create a child item of the given kind (request protocol or sub-scenario)
   * under the scenario from the graph add-palette, returning its id. */
  onCreateScenarioChild?: (scenarioId: string, kind: AddChildKind) => string | null
  /** Resolve a tree item by id → live object, for drop + bound node sync. */
  resolveBoundItem?: ResolveBoundItem
  /** Predicate marking a non-editor-tab drag (a sidebar list item) as one
   * the workbench should show the split overlay for. Wired into ECUI's
   * `isExternalDropDrag`. */
  isWorkbenchExternalDrop?: (event: DragEvent) => boolean
  /** Open a dragged sidebar item beside the drop target — ECUI resolved
   * the released group + split zone. Wired into ECUI's `onExternalDrop`. */
  onWorkbenchExternalDrop?: (event: DragEvent, targetGroupId: string, direction: 'left' | 'right' | 'top' | 'bottom' | 'full') => void
  /** Resolve a request's environments + default selection (scenario env section). */
  resolveRequestEnv?: ResolveRequestEnv
  /** Synthesise a documentation-derived preview for a request — used by
   * the scenario inspector to show example data when the request has
   * never been run but its env folder carries an imported spec. */
  resolveSyntheticPreview?: (requestId: string) => SyntheticRequestPreview | null
  /** Fallback component displayed when no tabs are open */
  emptyFallback?: React.ReactNode
  /** Callback fired when group sizes change (sash dragging) */
  onSizesChange?: (nodeId: string, sizes: number[]) => void
  /** Unique identifier for workbench persistence (required if autosave is enabled) */
  workbenchId?: string | undefined
  /** Enable automatic save/load of workbench state */
  autosave?: boolean
  /** Callback to rebuild a tab from its ID (required if autosave
   * is enabled). Pass `undefined` to delay ECUI's autosave restore
   * until the caller has the data needed to reconstruct tabs
   * (e.g., wait for `rootItems` to load). */
  onRebuildTab?: RebuildTabCallback | undefined
  /** Called when state is restored from storage */
  onStateRestored?: (tree: WorkbenchTree | null) => void
  /** Get a reactive Request by ID (for reactivity support) */
  getRequestById?: (id: string) => Request | undefined
  /** Scenarios that reference a request — drives the "used in scenarios"
   * reverse-navigation button in the request editor's toolbar. */
  getScenariosUsingRequest?: ((requestId: string) => ScenarioRequestUsage[]) | undefined
  /** Open a scenario tab from a request; `focusNodeId` centres a box. */
  onOpenScenarioFromRequest?: ((scenarioId: string, focusNodeId?: string) => void) | undefined
  /** Scenarios that reference a sub-scenario via a `runScenario` node — drives
   * the reverse-nav button on a sub-scenario's editor toolbar. */
  getScenariosUsingScenario?: ((scenarioId: string) => ScenarioScenarioUsage[]) | undefined
  /** Get a reactive Folder by ID (for reactivity support) */
  getFolderById?: (id: string) => Folder | undefined
  /** Get a reactive Scenario by ID (for reactivity support) — the editor tab
   * re-fetches the live scenario from this rather than rendering its stored
   * snapshot, so variable/port edits survive a hard refresh + tab restore. */
  getScenarioById?: (id: string) => Scenario | undefined
  /** Check if a request is a favorite */
  isItemFavorite?: ((itemId: string) => boolean) | undefined
  /** Toggle favorite status on a request */
  onToggleFavorite?: ((itemId: string) => void) | undefined
  /** Get a reactive EnvironmentFolder by ID (for reactivity support) */
  getEnvironmentFolderById?: (id: string) => EnvironmentFolder | undefined
  /** Callback fired when an environment folder's data changes */
  onEnvironmentFolderChange?: (folderId: string, folder: EnvironmentFolder) => void
  /** Whether navigation features (back/forward, Ctrl+Tab) are enabled */
  navigationEnabled?: boolean | undefined
  /** CSS selector for the element to anchor the tab switcher overlay to */
  tabSwitcherAnchorSelector?: string | undefined
  /**
   * Project UUID stamped into the collection file. Used to scope the
   * env-selection persistence so selections survive file moves or
   * renames the user does outside the app.
   */
  projectUuid?: string | null | undefined
}

/** Imperative handle for Workbench component */
export interface RestormWorkbenchHandle {
  saveState: () => Promise<boolean>
  loadState: () => Promise<WorkbenchTree | null>
  clearState: () => Promise<boolean>
  /** Maximize a workbench tab into the fullscreen modal, or restore
   * the maximized tab with `null`. Forwards to `EditorWorkbench`. */
  setFullscreenTabId: (tabId: string | null) => void
}

const EditorWorkbenchAny = EditorWorkbench as unknown as React.ForwardRefExoticComponent<Record<string, unknown> & React.RefAttributes<EditorWorkbenchHandle>>

/** Wrapper component for EditorWorkbench that handles restorm-specific tab rendering */
export const RestormWorkbench = forwardRef<RestormWorkbenchHandle, RestormWorkbenchProps>(({
  tree: initialTree,
  dirtyItemIdsSet,
  onTreeChange,
  className,
  style,
  focusedGroupId,
  onFocusedGroupChange,
  onFullscreenTabIdChange,
  onTabActivate,
  onRequestClick,
  onRequestAuxClick,
  onBreadcrumbClick,
  onBreadcrumbAuxClick,
  onItemRename,
  onItemIconChange,
  onTagsChange,
  onTagColorChange,
  onFolderChange,
  onScenarioChange,
  onCreateScenarioRequest,
  onCreateScenarioChild,
  resolveBoundItem,
  isWorkbenchExternalDrop,
  onWorkbenchExternalDrop,
  resolveRequestEnv,
  resolveSyntheticPreview,
  onEnvironmentFolderChange,
  emptyFallback,
  onSizesChange,
  workbenchId,
  autosave,
  onRebuildTab,
  onStateRestored,
  getRequestById,
  getFolderById,
  getScenarioById,
  getEnvironmentFolderById,
  navigationEnabled,
  tabSwitcherAnchorSelector,
  projectUuid,
  isItemFavorite,
  onToggleFavorite,
  getScenariosUsingRequest,
  onOpenScenarioFromRequest,
  getScenariosUsingScenario
}, ref) => {
  const { t } = useTranslation()
  // Localized labels for the generic ECUI MCP-logs viewer (it ships no copy).
  // Memoized so the panel isn't handed a fresh object on every render.
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
  const editorWorkbenchRef = useRef<EditorWorkbenchHandle>(null)
  const isControlled = onTreeChange !== undefined
  const [localTree, setLocalTree] = useState<WorkbenchTree>(initialTree)
  const tree = isControlled ? initialTree : localTree
  // Always-current view of the tree, for callbacks baked into tab
  // content. `EditorWorkbench` caches each tab's rendered content
  // workbench-wide and that cache survives the tab being moved between
  // groups — so a callback that *closed over* `tree` would keep
  // computing against the tab's pre-move position and snap it back.
  // `treeRef` is read instead, so those callbacks always see where the
  // tab actually is now.
  const treeRef = useRef<WorkbenchTree>(tree)
  useEffect(() => { treeRef.current = tree }, [tree])
  const lastTabCountRef = useRef<number>(0)
  // Per-group active-tab tracker so we can detect activations in any
  // split pane (not just `groups[0]`) when the tree mutates
  // programmatically (e.g. via back/forward navigation).
  const lastActiveByGroupRef = useRef<Map<string, string>>(new Map())

  // Keep the per-group active-tab tracker in sync with EXTERNAL tree changes
  // (e.g. a sidebar click opening a tab, which updates the controlled tree but
  // never flows through `handleTreeChange`). Without this the tracker goes
  // stale: closing an externally-opened tab reverts the active tab to its
  // previous value, and because the stale "previous" still equals that value
  // the revert looks like "no change" — so `onTabActivate` never fires and a
  // sidebar that follows the active tab stays stuck on the just-closed item.
  // We only refresh the tracker here (deliberately no `onTabActivate`):
  // external opens already sync the sidebar through their own click handler,
  // so firing again would double the navigation history.
  useEffect(() => {
    const syncTracker = (nodes: WorkbenchTree['groups']): void => {
      for (const node of nodes) {
        if (isTabGroupNode(node)) {
          if (node.activeTabId) lastActiveByGroupRef.current.set(node.id, node.activeTabId)
        } else if (isContainerNode(node)) {
          syncTracker(node.groups)
        }
      }
    }
    syncTracker(tree.groups)
  }, [tree])

  // Cache for tabs dropped from other windows (stores the full RestormEditorTab data)
  const droppedTabsCacheRef = useRef<Map<string, RestormEditorTab>>(new Map())
  
  // Expose imperative handle
  useImperativeHandle(ref, () => ({
    saveState: async () => editorWorkbenchRef.current?.saveState() ?? false,
    loadState: async () => editorWorkbenchRef.current?.loadState() ?? null,
    clearState: async () => editorWorkbenchRef.current?.clearState() ?? false,
    setFullscreenTabId: (tabId: string | null) => { editorWorkbenchRef.current?.setFullscreenTabId(tabId) }
  }), [])

  useEffect(() => {
    if (!isControlled) {
      const rafId = requestAnimationFrame(() => {
        setLocalTree(initialTree)
      })
      return (): void => { cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [initialTree, isControlled])

  const handleTabDropped = useCallback(
    (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }): boolean | Promise<boolean> => {
      // Parse the content JSON to get the full RestormEditorTab and cache it
      if (tabData.content) {
        try {
          const restoredTab = JSON.parse(tabData.content) as RestormEditorTab
          droppedTabsCacheRef.current.set(tabData.tabId, restoredTab)
        } catch (error) {
          logger.error('Failed to parse dropped tab content', { tabId: tabData.tabId, error: String(error) })
          return false
        }
      }
      return true
    },
    []
  )

  // Render tab title with icon and HTTP method badge (if applicable)
  const getTabItemId = useCallback((tab: RestormEditorTab): string | null => {
    if (isFolderTab(tab) || isEnvironmentFolderTab(tab)) {
      return tab.folder.id
    }
    if (isScenarioEditorTab(tab)) {
      return tab.scenario.id
    }
    if (
      isHTTPRequestTab(tab) ||
      isGraphQLRequestTab(tab) ||
      isGrpcRequestTab(tab) ||
      isSoapRequestTab(tab) ||
      isWebSocketRequestTab(tab) ||
      isODataRequestTab(tab) ||
      isAuthenticationRequestTab(tab)
    ) {
      return tab.request.id
    }
    return null
  }, [])

  // Stable key every tab is tracked under in the navigation (MRU)
  // history. Regular tabs reuse their underlying item id (the key the
  // sidebar / breadcrumb / workbench navigation already records).
  // Any tab without an item id is a special / singleton tab (Console,
  // Firewall, Mini browser, Settings, …): it falls back to the tab's own
  // id — which for these is a fixed singleton id (e.g. `console:singleton`),
  // never reused. Deriving the key generically from `tab.id` means a new
  // singleton tab type is MRU-tracked automatically, with no change here.
  // Drives both the switcher sort and the close-returns-to-previous
  // selection in the workbench.
  const getTabNavKey = useCallback((tab: RestormEditorTab): string | null => {
    return getTabItemId(tab) ?? tab.id
  }, [getTabItemId])

  const renderDirtyIndicator = useCallback((tab: RestormEditorTab): React.ReactNode => {
    const itemId = getTabItemId(tab)
    if (!itemId || !dirtyItemIdsSet?.has(itemId)) return null
    return (
      <HeaderHoverTooltip label="Modified">
        <span
          className="codicon codicon-circle-filled dirty-indicator"
          aria-label="Modified"
          style={{ marginLeft: 6 }}
        />
      </HeaderHoverTooltip>
    )
  }, [dirtyItemIdsSet, getTabItemId])

  const renderTabTitle = useCallback((tab: EditorTab): React.ReactNode => {
    // Check if this is a dropped tab with cached data
    const cachedTab = droppedTabsCacheRef.current.get(tab.id)
    const restormTab = cachedTab ?? (tab as RestormEditorTab)

    // Folder tab: show folder icon (custom or default)
    if (isFolderTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconView icon={getFolderIcon(restormTab.folder)} size={14} />
          <span>{restormTab.folder.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // Environment folder tab: show folder-library icon (custom or default)
    if (isEnvironmentFolderTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconView icon={getFolderIcon(restormTab.folder)} size={14} />
          <span>{restormTab.folder.name}</span>
          <SecretResolvingSpinner environmentIds={collectFolderEnvIds(restormTab.folder.environments)} />
          <SecretErrorIndicator environmentIds={collectFolderEnvIds(restormTab.folder.environments)} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // Scenario editor tab: show scenario badge + name
    if (isScenarioEditorTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ScenarioRunningBadge scenarioId={restormTab.scenario.id}>
            <Badge type="SCENARIO" />
          </ScenarioRunningBadge>
          <span>{restormTab.scenario.name}</span>
          <ItemSecretBadges itemId={restormTab.scenario.id} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // HTTP request tab: show method badge
    if (isHTTPRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.method)} />
          <span>{restormTab.request.name}</span>
          <ItemSecretBadges itemId={restormTab.request.id} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // GraphQL request tab
    if (isGraphQLRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="GQL" />
          <span>{restormTab.request.name}</span>
          <ItemSecretBadges itemId={restormTab.request.id} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // gRPC request tab
    if (isGrpcRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.callType)} />
          <span>{restormTab.request.name}</span>
          <ItemSecretBadges itemId={restormTab.request.id} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // SOAP request tab
    if (isSoapRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="SOAP" />
          <span>{restormTab.request.name}</span>
          <ItemSecretBadges itemId={restormTab.request.id} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // WebSocket request tab
    if (isWebSocketRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.protocol)} />
          <span>{restormTab.request.name}</span>
          <ItemSecretBadges itemId={restormTab.request.id} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // OData request tab. All OData operations share the 'ODATA' badge today;
    // once an `operationKind` discriminator ('entity-set' | 'function' |
    // 'action') exists, functions / actions could get their own badges.
    if (isODataRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="ODATA" />
          <span>{restormTab.request.name}</span>
          <ItemSecretBadges itemId={restormTab.request.id} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    if (isAuthenticationRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="AUTH" />
          <span>{restormTab.request.name}</span>
          <ItemSecretBadges itemId={restormTab.request.id} />
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // Console tab — codicon `console` + plain "Console" label.
    // Singleton tab, no dirty indicator (its content is a live log,
    // not a persistable surface).
    if (isConsoleTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconView icon={{ type: 'codicon', value: 'console' }} size={14} />
          <span>Console</span>
        </span>
      )
    }

    // Firewall admin tab — codicon `shield` + "Firewall" label.
    // Singleton, no dirty indicator (mode + allowlist persist
    // through main-process IPC, not workbench autosave).
    if (isFirewallTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconView icon={{ type: 'codicon', value: 'shield' }} size={14} />
          <span>Firewall</span>
        </span>
      )
    }

    // Mini browser tab — codicon `browser` + "Mini browser" label.
    // Singleton, no dirty indicator (the navigated URL is persisted
    // directly on the tab object via the workbench tree).
    if (isMiniBrowserTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconView icon={{ type: 'codicon', value: 'browser' }} size={14} />
          <span>Mini browser</span>
        </span>
      )
    }

    // Settings tab — codicon `settings-gear` + "Settings" label.
    // Singleton, no dirty indicator (settings persist through the
    // main-process settings store, not workbench autosave).
    if (isSettingsTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconView icon={{ type: 'codicon', value: 'settings-gear' }} size={14} />
          <span>{t('settings.title', 'Settings')}</span>
        </span>
      )
    }

    // MCP logs tab — codicon `mcp` + "MCP logs" label. Singleton, no dirty
    // indicator (the call log is a live, read-only feed from the main process).
    if (isMcpLogsTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconView icon={{ type: 'codicon', value: 'mcp' }} size={14} />
          <span>{t('mcpLogs.title')}</span>
        </span>
      )
    }

    return null
  }, [renderDirtyIndicator, t])

  // Build tab switcher items from workbench tree tabs, sorted by navigation history
  const buildTabSwitcherItems = useCallback((): TabSwitcherItem[] => {
    // Walk the whole tree: without recursion into container nodes, tabs
    // that live inside a split (side-by-side, nested) would never show
    // up in the Ctrl+Tab overlay.
    const allTabs: RestormEditorTab[] = []
    const collectTabs = (nodes: WorkbenchTree['groups']): void => {
      for (const node of nodes) {
        if (isTabGroupNode(node)) {
          for (const tab of node.tabs) {
            allTabs.push(tab as RestormEditorTab)
          }
        } else if (isContainerNode(node)) {
          collectTabs(node.groups)
        }
      }
    }
    collectTabs(tree.groups)

    // Navigation history ordering (most recent → order 0)
    const history = navigationService.getHistory()
    const historyOrder = new Map<string, number>()
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i]
      if (entry && !historyOrder.has(entry.key)) {
        historyOrder.set(entry.key, historyOrder.size)
      }
    }

    // Sort by navigation order (most recent first), tabs without history at the end.
    // Keying on `getTabNavKey` (not `getTabItemId`) means special / singleton
    // tabs — which now record activations under their singleton id — interleave
    // in true MRU order instead of being forced to the back.
    const sorted = [...allTabs].sort((a, b) => {
      const aKey = getTabNavKey(a)
      const bKey = getTabNavKey(b)
      const aOrder = (aKey ? historyOrder.get(aKey) : undefined) ?? 999
      const bOrder = (bKey ? historyOrder.get(bKey) : undefined) ?? 999
      return aOrder - bOrder
    })

    return sorted.map((tab) => {
      const rendered = renderTabTitle(tab)
      return {
        id: tab.id,
        title: tab.titleString ?? '',
        icon: rendered
      }
    })
  }, [tree.groups, renderTabTitle, getTabNavKey])

  const {
    isOpen: tabSwitcherOpen,
    items: tabSwitcherItems,
    selectedIndex: tabSwitcherIndex,
    handleClose: closeTabSwitcher,
    handleSelect: selectTabSwitcherItem
  } = useTabSwitcher({
    enabled: navigationEnabled ?? false,
    onTabSelect: (tabId) => {
      // Walk the tree recursively to find which group (possibly nested) owns the tab,
      // update its activeTabId, and capture the owning group id for focus sync.
      const found: { groupId?: string; itemId?: string | null } = {}
      const updateGroups = (nodes: typeof tree.groups): typeof tree.groups => {
        return nodes.map((node) => {
          if (isTabGroupNode(node)) {
            const tab = node.tabs.find((t) => t.id === tabId)
            if (tab) {
              found.groupId = node.id
              found.itemId = getTabItemId(tab as RestormEditorTab)
              return { ...node, activeTabId: tabId }
            }
            return node
          }
          if (isContainerNode(node)) {
            return { ...node, groups: updateGroups(node.groups) }
          }
          return node
        })
      }
      const updatedGroups = updateGroups(tree.groups)

      // Record navigation synchronously so history is up-to-date for next Ctrl+Tab
      if (found.itemId) {
        const tabType = tabId.startsWith('env-folder') ? 'environment-folder'
          : tabId.startsWith('folder') ? 'folder'
          : 'http-request'
        navigationService.navigateTo(found.itemId, 'tab-switcher', { type: tabType })
      }

      if (onTreeChange) {
        onTreeChange({ ...tree, groups: updatedGroups })
      }
      // Move focus to the group that owns the activated tab so its tab strip reflects the change.
      if (found.groupId && onFocusedGroupChange) {
        onFocusedGroupChange(found.groupId)
      }
      // Also notify the tab activate callback for sidebar sync etc.
      if (onTabActivate) {
        onTabActivate(tabId)
      }
    },
    buildItems: buildTabSwitcherItems
  })

  /** Find tagColors from the nearest ancestor EnvironmentFolder via breadcrumbs */
  const getTagColorsFromBreadcrumbs = useCallback((breadcrumbs: BreadcrumbItem[]): Record<string, string> | undefined => {
    if (!getEnvironmentFolderById) return undefined
    // Walk breadcrumbs from parent (second-to-last) upward, skip the item itself (last)
    for (let i = breadcrumbs.length - 2; i >= 0; i -= 1) {
      const crumb = breadcrumbs[i]
      if (!crumb) continue
      const envFolder = getEnvironmentFolderById(crumb.id)
      if (envFolder?.tagColors) {
        return envFolder.tagColors
      }
    }
    return undefined
  }, [getEnvironmentFolderById])

  /** Find the nearest ancestor EnvironmentFolder ID from breadcrumbs */
  const getEnvFolderIdFromBreadcrumbs = useCallback((breadcrumbs: BreadcrumbItem[]): string | undefined => {
    if (!getEnvironmentFolderById) return undefined
    for (let i = breadcrumbs.length - 2; i >= 0; i -= 1) {
      const crumb = breadcrumbs[i]
      if (!crumb) continue
      const envFolder = getEnvironmentFolderById(crumb.id)
      if (envFolder) return envFolder.id
    }
    return undefined
  }, [getEnvironmentFolderById])

  /** Persist the Mini browser's current URL on its tab record so
   * reopening the workbench restores the navigation state. Walks the
   * tree (including nested split containers) to locate the tab by id,
   * then replaces it with an updated copy. No-op when the URL hasn't
   * actually changed so we don't churn the workbench-tree subscribers. */
  const updateMiniBrowserUrl = useCallback((tabId: string, url: string): void => {
    const currentTree = treeRef.current
    const updateGroups = (nodes: typeof currentTree.groups): typeof currentTree.groups =>
      nodes.map((node) => {
        if (isTabGroupNode(node)) {
          const target = node.tabs.find((t) => t.id === tabId)
          if (!target) return node
          const current = (target as RestormEditorTab & { url?: string }).url
          if (current === url) return node
          return {
            ...node,
            // Mirror the URL into `persistedState` as well, so ECUI's
            // workbench autosave captures it under `tabData[N]` and the
            // matching `handleRebuildTab(MINI_BROWSER_TAB_ID, data)`
            // call restores the navigation state on file reopen.
            tabs: node.tabs.map((t) => (
              t.id === tabId
                ? ({ ...t, url, persistedState: { url } } as EditorTab)
                : t
            ))
          }
        }
        if (isContainerNode(node)) {
          return { ...node, groups: updateGroups(node.groups) }
        }
        return node
      })
    const nextGroups = updateGroups(currentTree.groups)
    if (nextGroups === currentTree.groups) return
    const nextTree = { ...currentTree, groups: nextGroups }
    if (onTreeChange) onTreeChange(nextTree)
    else setLocalTree(nextTree)
  }, [onTreeChange])

  // Render tab content based on tab type
  const renderTabContent = useCallback((tab: RestormEditorTab): React.ReactNode => {
    // Check if this is a dropped tab with cached data
    const cachedTab = droppedTabsCacheRef.current.get(tab.id)
    const effectiveTab = cachedTab ?? tab

    const breadcrumbs = effectiveTab.breadcrumbs ?? [
      { id: 'root', label: 'Root' }
    ]

    // Scenario editor tab — same chrome as a request tab: breadcrumb +
    // editable title + bookmark ribbons + favourite star, then two
    // sub-tabs (the graph + a Notes markdown editor).
    if (isScenarioEditorTab(effectiveTab)) {
      // Re-fetch the live scenario from `rootItems` (like folder/env-folder
      // tabs do) instead of trusting the tab's stored snapshot. After a hard
      // refresh + tab restore, `effectiveTab.scenario` is a fresh copy
      // disconnected from the model, so in-place edits (renamed variables,
      // new ports) would never reach the editor without this lookup.
      const scenario = getScenarioById?.(effectiveTab.scenario.id) ?? effectiveTab.scenario
      const scnTagColors = getTagColorsFromBreadcrumbs(breadcrumbs)
      const scnEnvFolderId = getEnvFolderIdFromBreadcrumbs(breadcrumbs)
      const handleScnTagColorChange = scnEnvFolderId && onTagColorChange
        ? (tag: string, color: string | null): void => { onTagColorChange(scnEnvFolderId, tag, color) }
        : undefined
      const scnFav = onToggleFavorite
        ? { isFavorite: isItemFavorite?.(scenario.id) ?? false, onToggleFavorite: () => { onToggleFavorite(scenario.id) } }
        : {}
      // Drop the breadcrumb icon on the scenario itself (the last
      // crumb) — the `circuit-board` glyph next to the H1 title reads
      // as noise here; the SCENARIO badge already conveys the kind
      // wherever it matters (sidebar, search). Ancestor crumbs keep
      // their folder icons.
      const scnBreadcrumbs = breadcrumbs.map((crumb, i) =>
        i === breadcrumbs.length - 1 ? { ...crumb, icon: null } : crumb
      )
      const scnTabs: Tab[] = [
        {
          id: 'graph',
          label: t('scenario.tab.graph', 'Scenario'),
          useScrollableElement: false,
          content: (
            <div style={{ height: '100%', minHeight: 0 }}>
              <ScenarioEditorView
                scenario={scenario}
                tabId={effectiveTab.id}
                {...(projectUuid ? { projectUuid } : {})}
                {...(onScenarioChange ? { onScenarioChange } : {})}
                {...(resolveBoundItem ? { resolveBoundItem } : {})}
                {...(resolveRequestEnv ? { resolveRequestEnv } : {})}
                {...(resolveSyntheticPreview ? { resolveSyntheticPreview } : {})}
                {...(onRequestClick ? { onOpenItem: onRequestClick } : {})}
                {...(onCreateScenarioRequest ? { onCreateRequest: onCreateScenarioRequest } : {})}
                {...(onCreateScenarioChild ? { onCreateChild: onCreateScenarioChild } : {})}
              />
            </div>
          )
        },
        {
          id: 'notes',
          label: t('scenario.tab.notes', 'Notes'),
          useScrollableElement: false,
          content: (
            <MarkdownEditor
              key={scenario.id}
              initialValue={scenario.notes ?? ''}
              onChange={(md: string) => { onScenarioChange?.(scenario.id, { notes: md }) }}
              data-testid="scenario-notes-editor"
            />
          )
        }
      ]
      const scenarioCallers = getScenariosUsingScenario?.(scenario.id) ?? []
      const scenarioCallersAction = scenarioCallers.length > 0 && onOpenScenarioFromRequest
        ? <ScenarioCallersButton usages={scenarioCallers} onOpenScenario={onOpenScenarioFromRequest} />
        : null
      return (
        <RestormWorkbenchTab
          breadcrumbs={scnBreadcrumbs}
          onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbAuxClick={onBreadcrumbAuxClick}
          onBreadcrumbRename={onItemRename}
          onBreadcrumbIconChange={onItemIconChange}
          tags={scenario.tags}
          onTagsChange={(nextTags) => { onTagsChange?.(scenario.id, nextTags) }}
          tagColors={scnTagColors}
          {...(handleScnTagColorChange ? { onTagColorChange: handleScnTagColorChange } : {})}
          tabId={effectiveTab.id}
          headerActions={<ScenarioRunHistoryButton scenarioId={scenario.id} />}
          {...(scenarioCallersAction ? { topRightAction: scenarioCallersAction } : {})}
          {...scnFav}
        >
          <Tabs tabs={scnTabs} data-testid={`scenario-subtabs-${effectiveTab.id}`} />
        </RestormWorkbenchTab>
      )
    }

    // Folder tab
    if (isFolderTab(effectiveTab)) {
      // Get reactive folder if available, otherwise use tab's copy
      const folder = getFolderById?.(effectiveTab.folder.id) ?? effectiveTab.folder
      const folderTagColors = getTagColorsFromBreadcrumbs(breadcrumbs)
      const folderEnvFolderId = getEnvFolderIdFromBreadcrumbs(breadcrumbs)
      const handleFolderTagColorChange = folderEnvFolderId && onTagColorChange
        ? (tag: string, color: string | null): void => { onTagColorChange(folderEnvFolderId, tag, color) }
        : undefined
      return (
        <RestormWorkbenchTab
          breadcrumbs={breadcrumbs}
          onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbAuxClick={onBreadcrumbAuxClick}
          onBreadcrumbRename={onItemRename}
          onBreadcrumbIconChange={onItemIconChange}
          tags={folder.tags}
          onTagsChange={(nextTags) => {
            onTagsChange?.(folder.id, nextTags)
          }}
          tagColors={folderTagColors}
          onTagColorChange={handleFolderTagColorChange}
        >
          <FolderView
            folder={folder}
            onFolderChange={(updatedFolder: Folder) => {
              if (onFolderChange) {
                onFolderChange(folder.id, updatedFolder)
              }
            }}
          />
        </RestormWorkbenchTab>
      )
    }

    // Environment folder tab
    if (isEnvironmentFolderTab(effectiveTab)) {
      // Get reactive environment folder if available, otherwise use tab's copy
      const reactiveFolder = getEnvironmentFolderById?.(effectiveTab.folder.id)
      const folder = reactiveFolder ?? effectiveTab.folder
      const handleEnvFolderTagColorChange = onTagColorChange
        ? (tag: string, color: string | null): void => { onTagColorChange(folder.id, tag, color) }
        : undefined
      return (
        <RestormWorkbenchTab
          breadcrumbs={breadcrumbs}
          onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbAuxClick={onBreadcrumbAuxClick}
          onBreadcrumbRename={onItemRename}
          onBreadcrumbIconChange={onItemIconChange}
          tags={effectiveTab.folder.tags}
          onTagsChange={(nextTags) => {
            onTagsChange?.(folder.id, nextTags)
          }}
          tagColors={folder.tagColors}
          onTagColorChange={handleEnvFolderTagColorChange}
          tabId={effectiveTab.id}
        >
          <EnvironmentFolderView
            folder={folder}
            onFolderChange={(updatedFolder) => {
              if (onEnvironmentFolderChange) {
                onEnvironmentFolderChange(folder.id, updatedFolder)
              }
            }}
            {...(onRequestClick ? { onRequestClick } : {})}
            {...(onRequestAuxClick ? { onRequestAuxClick } : {})}
          />
        </RestormWorkbenchTab>
      )
    }

    // Shared favorite-toggle props for request tabs. The H1 title gets
    // a star to its left; clicking flips via `onToggleFavorite`. Folder
    // tabs skip this — they aren't favoritable.
    const favoritePropsFor = (id: string): { isFavorite: boolean; onToggleFavorite: () => void } | object =>
      onToggleFavorite
        ? { isFavorite: isItemFavorite?.(id) ?? false, onToggleFavorite: () => { onToggleFavorite(id) } }
        : {}

    // "Used in scenarios" reverse-nav button for the request toolbar. Renders
    // null when the request is used by no scenario (the button hides itself).
    const scenarioUsageActionFor = (id: string): React.ReactNode =>
      getScenariosUsingRequest && onOpenScenarioFromRequest
        ? <RequestScenarioUsageButton usages={getScenariosUsingRequest(id)} onOpenScenario={onOpenScenarioFromRequest} />
        : null

    // Shared tag color props for request tabs
    const requestTagColors = getTagColorsFromBreadcrumbs(breadcrumbs)
    const envFolderId = getEnvFolderIdFromBreadcrumbs(breadcrumbs)
    const handleRequestTagColorChange = envFolderId && onTagColorChange
      ? (tag: string, color: string | null): void => { onTagColorChange(envFolderId, tag, color) }
      : undefined

    // Read the env list live off the reactive env-folder rather than
    // off `effectiveTab.environments` (which was a one-shot snapshot
    // captured at tab-open time). `EnvironmentFolderView.updateEnvironments`
    // assigns `folder.environments = nextArray` on every add/remove,
    // so the snapshot would otherwise miss any env created after the
    // tab was first opened — surfacing as `{{name}}` resolving empty
    // when the user picks the new env in the status bar selector,
    // because the request tab's `setAvailableEnvironments` IPC never
    // included it. Reading live closes that gap; cached tab content
    // re-renders when `contentVersion` is bumped on env events (see
    // useWorkbenchUpdates).
    const reactiveEnvFolder = envFolderId ? getEnvironmentFolderById?.(envFolderId) : undefined
    const fallbackEnvironments = (effectiveTab as { environments?: typeof reactiveEnvFolder extends EnvironmentFolder ? typeof reactiveEnvFolder['environments'] : never }).environments
    const liveEnvironments = reactiveEnvFolder?.environments ?? fallbackEnvironments

    // Build the persistence key for the environment provider scoped
    // to this tab. Requires both the project UUID (workspace identity)
    // and the request's ancestor env folder id (primary storage grain).
    // Falls back to `undefined` when either is missing — the provider
    // then runs in in-memory-only mode.
    const envPersistenceKey = (requestId: string): { projectUuid: string; envFolderId: string; requestId: string } | undefined => {
      if (!projectUuid || !envFolderId) return undefined
      return { projectUuid, envFolderId, requestId }
    }

    // Flatten every request id under this env folder. Surfaced through
    // the context so popover hosts (statusbar env selector +
    // Send-button right-click) can wipe stale per-request overrides on
    // siblings when the user picks an env with "Apply to all" on.
    interface FolderWalkNode { readonly type?: string; readonly id: string; readonly items?: readonly FolderWalkNode[] }
    const envFolderRequestIds: string[] | undefined = (() => {
      if (!reactiveEnvFolder) return undefined
      const ids: string[] = []
      const walk = (items: readonly FolderWalkNode[]): void => {
        for (const it of items) {
          if (it.type === 'request') ids.push(it.id)
          else if (it.items) walk(it.items)
        }
      }
      walk((reactiveEnvFolder as unknown as { items: readonly FolderWalkNode[] }).items)
      return ids
    })()

    // Request tab-header action cluster (left of the bookmark ribbon):
    // the env selector (reads the surrounding EnvironmentProvider) + the
    // response-history button. Rendered for every request protocol.
    const requestHeaderActionsFor = (id: string): React.ReactNode => (
      <>
        <RequestHeaderEnvSelector folderRequestIds={envFolderRequestIds ?? []} projectUuid={projectUuid ?? null} />
        <RequestHeaderHistoryButton requestId={id} />
      </>
    )

    // Auth-route key selector, anchored immediately to the LEFT of the
    // favourite star. Hides itself when the env folder has no auth route
    // (or the request is itself an auth request). Needs the reactive
    // Request (to write `authenticationRequestId`) + the env-folder item
    // tree (to enumerate available auth routes), both in scope here.
    const starLeftActionFor = (request: Request): React.ReactNode =>
      reactiveEnvFolder
        ? (
          <RequestHeaderAuthSelector
            activeRequest={request}
            envFolderItems={reactiveEnvFolder.items}
          />
        )
        : null

    // HTTP request tab
    if (isHTTPRequestTab(effectiveTab)) {
      // Get reactive request if available, otherwise use tab's copy
      const reactiveRequest = getRequestById?.(effectiveTab.request.id)
      const request = (reactiveRequest?.type === 'http') ? reactiveRequest : effectiveTab.request
      return (
        <EnvironmentProvider environments={liveEnvironments} tagColors={requestTagColors} persistenceKey={envPersistenceKey(effectiveTab.request.id)} folderRequestIds={envFolderRequestIds}>
          <DeprecationAwareRequestTab
            request={request}
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbAuxClick={onBreadcrumbAuxClick}
            onBreadcrumbRename={onItemRename}
            onBreadcrumbIconChange={onItemIconChange}
            tags={request.tags}
            onTagsChange={(nextTags) => { onTagsChange?.(request.id, nextTags) }}
            tagColors={requestTagColors}
            onTagColorChange={handleRequestTagColorChange}
            tabId={effectiveTab.id}
            {...favoritePropsFor(request.id)}
            headerActions={requestHeaderActionsFor(request.id)}
            topRightAction={scenarioUsageActionFor(request.id)}
            starLeftAction={starLeftActionFor(request)}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '0 16px 8px 16px' }}>
              <HTTPRequestTabView
                request={request}
              />
            </div>
          </DeprecationAwareRequestTab>
        </EnvironmentProvider>
      )
    }

    // GraphQL request tab
    if (isGraphQLRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={liveEnvironments} tagColors={requestTagColors} persistenceKey={envPersistenceKey(effectiveTab.request.id)} folderRequestIds={envFolderRequestIds}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbAuxClick={onBreadcrumbAuxClick}
            onBreadcrumbRename={onItemRename}
            onBreadcrumbIconChange={onItemIconChange}
            tags={request.tags}
            onTagsChange={(nextTags) => { onTagsChange?.(request.id, nextTags) }}
            tagColors={requestTagColors}
            onTagColorChange={handleRequestTagColorChange}
            tabId={effectiveTab.id}
            {...favoritePropsFor(request.id)}
            headerActions={requestHeaderActionsFor(request.id)}
            topRightAction={scenarioUsageActionFor(request.id)}
            starLeftAction={starLeftActionFor(request)}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '0 16px 8px 16px' }}>
              <GraphQLRequestTabView
                request={request}
              />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // gRPC request tab
    if (isGrpcRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={liveEnvironments} tagColors={requestTagColors} persistenceKey={envPersistenceKey(effectiveTab.request.id)} folderRequestIds={envFolderRequestIds}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbAuxClick={onBreadcrumbAuxClick}
            onBreadcrumbRename={onItemRename}
            onBreadcrumbIconChange={onItemIconChange}
            tags={request.tags}
            onTagsChange={(nextTags) => { onTagsChange?.(request.id, nextTags) }}
            tagColors={requestTagColors}
            onTagColorChange={handleRequestTagColorChange}
            tabId={effectiveTab.id}
            {...favoritePropsFor(request.id)}
            headerActions={requestHeaderActionsFor(request.id)}
            topRightAction={scenarioUsageActionFor(request.id)}
            starLeftAction={starLeftActionFor(request)}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '0 16px 8px 16px' }}>
              <GrpcRequestTabView
                request={request}
              />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // SOAP request tab
    if (isSoapRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={liveEnvironments} tagColors={requestTagColors} persistenceKey={envPersistenceKey(effectiveTab.request.id)} folderRequestIds={envFolderRequestIds}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbAuxClick={onBreadcrumbAuxClick}
            onBreadcrumbRename={onItemRename}
            onBreadcrumbIconChange={onItemIconChange}
            tags={request.tags}
            onTagsChange={(nextTags) => { onTagsChange?.(request.id, nextTags) }}
            tagColors={requestTagColors}
            onTagColorChange={handleRequestTagColorChange}
            tabId={effectiveTab.id}
            {...favoritePropsFor(request.id)}
            headerActions={requestHeaderActionsFor(request.id)}
            topRightAction={scenarioUsageActionFor(request.id)}
            starLeftAction={starLeftActionFor(request)}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '0 16px 8px 16px' }}>
              <SoapRequestTabView
                request={request}
              />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // WebSocket request tab
    if (isWebSocketRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={liveEnvironments} tagColors={requestTagColors} persistenceKey={envPersistenceKey(effectiveTab.request.id)} folderRequestIds={envFolderRequestIds}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbAuxClick={onBreadcrumbAuxClick}
            onBreadcrumbRename={onItemRename}
            onBreadcrumbIconChange={onItemIconChange}
            tags={request.tags}
            onTagsChange={(nextTags) => { onTagsChange?.(request.id, nextTags) }}
            tagColors={requestTagColors}
            onTagColorChange={handleRequestTagColorChange}
            tabId={effectiveTab.id}
            {...favoritePropsFor(request.id)}
            headerActions={requestHeaderActionsFor(request.id)}
            topRightAction={scenarioUsageActionFor(request.id)}
            starLeftAction={starLeftActionFor(request)}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '0 16px 8px 16px' }}>
              <WebSocketRequestTabView
                request={request}
              />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // OData request tab
    if (isODataRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={liveEnvironments} tagColors={requestTagColors} persistenceKey={envPersistenceKey(effectiveTab.request.id)} folderRequestIds={envFolderRequestIds}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
            onBreadcrumbAuxClick={onBreadcrumbAuxClick}
            onBreadcrumbRename={onItemRename}
            onBreadcrumbIconChange={onItemIconChange}
            tags={request.tags}
            onTagsChange={(nextTags) => { onTagsChange?.(request.id, nextTags) }}
            tagColors={requestTagColors}
            onTagColorChange={handleRequestTagColorChange}
            tabId={effectiveTab.id}
            {...favoritePropsFor(request.id)}
            headerActions={requestHeaderActionsFor(request.id)}
            topRightAction={scenarioUsageActionFor(request.id)}
            starLeftAction={starLeftActionFor(request)}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '0 16px 8px 16px' }}>
              <ODataRequestTabView request={request} />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // Authentication request tab — reuses HTTPRequestTabView, which
    // injects an extra "Configuration" tab when it sees type === 'auth'.
    if (isAuthenticationRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={liveEnvironments} tagColors={requestTagColors} persistenceKey={envPersistenceKey(effectiveTab.request.id)} folderRequestIds={envFolderRequestIds}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
            onBreadcrumbAuxClick={onBreadcrumbAuxClick}
            onBreadcrumbRename={onItemRename}
            onBreadcrumbIconChange={onItemIconChange}
            tags={request.tags}
            onTagsChange={(nextTags) => { onTagsChange?.(request.id, nextTags) }}
            tagColors={requestTagColors}
            onTagColorChange={handleRequestTagColorChange}
            tabId={effectiveTab.id}
            {...favoritePropsFor(request.id)}
            headerActions={requestHeaderActionsFor(request.id)}
            topRightAction={scenarioUsageActionFor(request.id)}
            starLeftAction={starLeftActionFor(request)}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '0 16px 8px 16px' }}>
              <HTTPRequestTabView
                request={request}
              />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // Console tab — singleton, identified by `tabType: 'console'`.
    // Mounts the standalone `<ConsolePanel />` (xterm.js + firewall
    // feed subscriber). The breadcrumb chrome is intentionally
    // skipped: the Console isn't a request / folder, no project-tree
    // ancestor path applies. The component manages its own lifecycle.
    if (isConsoleTab(effectiveTab)) {
      return <ConsolePanel />
    }

    // Firewall admin tab — singleton, identified by `tabType: 'firewall'`.
    // Mounts the `<FirewallPanel />` (mode picker + allowlist editor).
    // No breadcrumbs for the same reason as Console.
    if (isFirewallTab(effectiveTab)) {
      return <FirewallPanel appName="Restorm" testButtonFeature={FIREWALL_TEST_BUTTON_FEATURE} />
    }

    // Mini browser tab — singleton, identified by `tabType: 'mini-browser'`.
    // The currently-navigated URL is stored on the tab itself; we update
    // it through the workbench tree so reopening restores the same page.
    if (isMiniBrowserTab(effectiveTab)) {
      return (
        <MiniBrowserPanel
          tabId={effectiveTab.id}
          {...(effectiveTab.url !== undefined ? { initialUrl: effectiveTab.url } : {})}
          onUrlChange={(url) => { updateMiniBrowserUrl(effectiveTab.id, url) }}
          driver={miniBrowserDriver}
        />
      )
    }

    // Settings tab — singleton, identified by `tabType: 'settings'`.
    // Mounts the shared `<SettingsPage />` (User / Workspace sections)
    // — the same content as the full-screen Settings modal. No
    // breadcrumbs for the same reason as Console / Firewall.
    if (isSettingsTab(effectiveTab)) {
      return (
        <div style={{ height: '100%', overflow: 'auto' }} data-testid="settings-tab-content">
          <SettingsPage />
        </div>
      )
    }

    // MCP logs tab — singleton, identified by `tabType: 'mcp-logs'`. Mounts
    // the shared ECUI `<McpLogsPanel />`, which pulls the served-call buffer
    // from the source restorm wired at bootstrap. Localized labels passed in
    // so the generic ECUI component carries no copy. No breadcrumbs for the
    // same reason as Console / Firewall / Settings.
    if (isMcpLogsTab(effectiveTab)) {
      return (
        <div style={{ height: '100%', overflow: 'hidden' }} data-testid="mcp-logs-tab-content">
          <McpLogsPanel labels={mcpLogsLabels} translateToolTitle={t} />
        </div>
      )
    }

    // Legacy/empty tab fallback (should not happen with typed tabs)
    return null
  }, [t, mcpLogsLabels, onBreadcrumbClick, onBreadcrumbAuxClick, onItemRename, onItemIconChange, onTagsChange, onTagColorChange, onFolderChange, onScenarioChange, onCreateScenarioRequest, onCreateScenarioChild, resolveBoundItem, resolveRequestEnv, resolveSyntheticPreview, onEnvironmentFolderChange, onRequestClick, onRequestAuxClick, getRequestById, getFolderById, getScenarioById, getEnvironmentFolderById, getTagColorsFromBreadcrumbs, getEnvFolderIdFromBreadcrumbs, projectUuid, isItemFavorite, onToggleFavorite, getScenariosUsingRequest, onOpenScenarioFromRequest, getScenariosUsingScenario, updateMiniBrowserUrl])

  // Handle tab detach to new window
  const handleDetachToNewWindow = useCallback(
    (tabId: string, groupId: string, cursorX?: number, cursorY?: number): void => {
      const groupResult = findGroup(tree, groupId)
      if (!groupResult.node || !isTabGroupNode(groupResult.node)) {
        logger.error('Group not found for detach', { groupId })
        return
      }

      const tab = groupResult.node.tabs.find((t: EditorTab) => t.id === tabId)
      if (!tab) {
        logger.error('Tab not found for detach', { tabId, groupId })
        return
      }

      // Check if this tab was dropped from another window and use cached data
      const cachedTab = droppedTabsCacheRef.current.get(tabId)
      const restormTab = cachedTab ?? (tab as RestormEditorTab)

      // Serialize the complete tab data so the editor window can display it directly
      const editorParams: { title: string; content?: string; x?: number; y?: number } = {
        title: getTabTitleString(restormTab, 'untitled'),
        // Pass the complete tab as JSON - the editor window will deserialize and display it
        content: JSON.stringify(restormTab)
      }
      if (cursorX !== undefined) {
        editorParams.x = cursorX
      }
      if (cursorY !== undefined) {
        editorParams.y = cursorY
      }
      void window.restorm?.openEditor(editorParams)
    },
    [tree]
  )

  const getTabContextMenuItems = useCallback(
    (tab: EditorTab, _groupId: string, actions: { close: () => void; closeOthersInGroup: () => void }): ContextMenuItem[] => {
      const items: ContextMenuItem[] = []
      // Use the type guard, not a `tabType.includes('request')` substring
      // sniff: isAnyRequestTab matches the exact request-tab discriminants
      // and narrows to the union that carries `request`.
      const restormTab = tab as RestormEditorTab
      const isRequest = isAnyRequestTab(restormTab)
      const requestId = isRequest ? restormTab.request.id : undefined

      if (isRequest && requestId && isItemFavorite && onToggleFavorite) {
        const isFav = isItemFavorite(requestId)
        items.push({
          id: 'toggle-favorite',
          label: isFav ? t('workbench.tabContextMenu.removeFromFavorites') : t('workbench.tabContextMenu.addToFavorites'),
          icon: isFav ? 'star-full' : 'star-empty',
          onClick: () => { onToggleFavorite(requestId) }
        })
        items.push({ id: 'sep-fav', label: '', isSeparator: true })
      }

      items.push({
        id: 'close',
        label: t('workbench.tabContextMenu.close'),
        icon: 'close',
        onClick: actions.close
      })
      items.push({
        id: 'close-others',
        label: t('workbench.tabContextMenu.closeOthers'),
        icon: 'close-all',
        onClick: actions.closeOthersInGroup
      })

      return items
    },
    [t, isItemFavorite, onToggleFavorite]
  )

  const workbenchRenderTabContent = useMemo(() => {
    return (tab: unknown): React.ReactNode => {
      const baseTab = tab as RestormEditorTab
      return renderTabContent(baseTab)
    }
  }, [renderTabContent])

  // Get tab content for serialization (used when detaching tabs to other windows)
  const getTabContent = useCallback((tabId: string): string | undefined => {
    // First check in dropped tabs cache
    const cachedTab = droppedTabsCacheRef.current.get(tabId)
    if (cachedTab) {
      return JSON.stringify(cachedTab)
    }

    // Search for the tab in the tree
    const findTabInTree = (nodes: typeof tree.groups): RestormEditorTab | undefined => {
      for (const node of nodes) {
        if (isTabGroupNode(node)) {
          const tab = node.tabs.find(t => t.id === tabId)
          if (tab) {
            return tab as RestormEditorTab
          }
        } else if (isContainerNode(node)) {
          const found = findTabInTree(node.groups)
          if (found) return found
        }
      }
      return undefined
    }

    const tab = findTabInTree(tree.groups)
    if (tab) {
      return JSON.stringify(tab)
    }

    logger.warn('getTabContent: Tab not found', { tabId })
    return undefined
  }, [tree])

  // Tab-detach is gated behind the `workbench.tabDetach` feature flag
  // (defaulted off in `restorm/resources/features.yaml`). When disabled,
  // dragging a tab outside the window's bounds is a no-op: the tab
  // stays put, no new BrowserWindow is opened, and the
  // `restorm:open-editor` IPC channel rejects the request main-side
  // for defence-in-depth. Engineers working on the underlying detach
  // bug flip the flag on locally to reproduce the buggy state.
  const { isEnabled: tabDetachEnabled } = useFeature('workbench.tabDetach')

  const callbacks = useMemo<Partial<EditorWorkbenchCallbacks>>(() => {
    return {
      onWorkbenchTabDropped: handleTabDropped,
      renderTabContent: workbenchRenderTabContent,
      renderTabTitle,
      onDetachToNewWindow: handleDetachToNewWindow,
      getTabContextMenuItems,
      onGetTabContent: getTabContent,
      disableTabDetach: !tabDetachEnabled,
      // Sidebar→workbench split drop: light the split overlay for a
      // dragged sidebar item and open it beside the drop target. Both
      // must be present for the channel to do anything (the predicate
      // gates the overlay, the handler performs the open).
      ...(isWorkbenchExternalDrop && onWorkbenchExternalDrop
        ? { isExternalDropDrag: isWorkbenchExternalDrop, onExternalDrop: onWorkbenchExternalDrop }
        : {}),
      // Forward tab activation from any group (incl. non-main split
      // groups) so the sidebar can sync. Intentionally no dedup here:
      // clicking an already-active tab must still re-trigger ancestor
      // expansion (e.g. after the user manually collapsed the parent
      // folder). Downstream handlers (`navigationService.navigateTo`,
      // `setExpandedIds` with Set semantics) are idempotent, so a
      // repeat fire is safe.
      onActivateTab: (tabId) => {
        onTabActivate?.(tabId)
      },
      // Drives the close-returns-to-most-recently-used-tab behaviour in
      // the workbench: the same stable key the Ctrl+Tab switcher sorts by.
      getTabNavKey: (tab: EditorTab) => getTabNavKey(tab as RestormEditorTab)
    }
  }, [handleTabDropped, workbenchRenderTabContent, renderTabTitle, handleDetachToNewWindow, getTabContextMenuItems, getTabContent, onTabActivate, tabDetachEnabled, getTabNavKey, isWorkbenchExternalDrop, onWorkbenchExternalDrop])

  const handleTreeChange = useCallback(
    (newTree: WorkbenchTree) => {
      const tabCount = newTree.groups.reduce((total, node) => {
        if (isTabGroupNode(node)) {
          return total + node.tabs.length
        }
        if (isContainerNode(node)) {
          const countRecursive = (n: typeof node): number => {
            return n.groups.reduce((sum, child) => {
              if (isTabGroupNode(child)) {
                return sum + child.tabs.length
              }
              if (isContainerNode(child)) {
                return sum + countRecursive(child)
              }
              return sum
            }, 0)
          }
          return total + countRecursive(node)
        }
        return total
      }, 0)

      lastTabCountRef.current = tabCount

      // Detect active tab changes across every group (including those
      // nested inside split containers). Previously we only watched
      // `groups[0].activeTabId`, so programmatic activations that landed
      // in a non-primary pane — e.g. the back/forward button re-focusing
      // a tab in a side-by-side split — were invisible to the history /
      // sidebar-sync listener. Track the active tab *per group id* and
      // fire `onTabActivate` for each group whose active tab changed.
      const currentActiveByGroup = new Map<string, string>()
      const collectActiveTabs = (nodes: WorkbenchTree['groups']): void => {
        for (const node of nodes) {
          if (isTabGroupNode(node)) {
            if (node.activeTabId) {
              currentActiveByGroup.set(node.id, node.activeTabId)
            }
          } else if (isContainerNode(node)) {
            collectActiveTabs(node.groups)
          }
        }
      }
      collectActiveTabs(newTree.groups)
      for (const [groupId, tabId] of currentActiveByGroup) {
        const prev = lastActiveByGroupRef.current.get(groupId)
        lastActiveByGroupRef.current.set(groupId, tabId)
        if (prev !== tabId) {
          onTabActivate?.(tabId)
        }
      }
      // Drop entries for groups that no longer exist so we don't leak.
      for (const groupId of Array.from(lastActiveByGroupRef.current.keys())) {
        if (!currentActiveByGroup.has(groupId)) {
          lastActiveByGroupRef.current.delete(groupId)
        }
      }

      if (isControlled) {
        onTreeChange(newTree)
      } else {
        setLocalTree(newTree)
      }
    },
    [onTreeChange, isControlled, onTabActivate]
  )

  // Compute overlay position from anchor element (covers the search bar)
  const tabSwitcherStyle = useMemo((): React.CSSProperties | undefined => {
    if (!tabSwitcherOpen || !tabSwitcherAnchorSelector) return undefined
    const el = document.querySelector(tabSwitcherAnchorSelector)
    if (!el) return undefined
    const rect = el.getBoundingClientRect()
    return { top: rect.top, left: rect.left, width: rect.width }
  }, [tabSwitcherOpen, tabSwitcherAnchorSelector])

  // The focused split-group's active tab id — fed to descendants (the scenario
  // editors) via context so each can tell if it's THE active tab. Keyboard
  // shortcuts + the Delete key gate on this so they only ever act on the
  // focused tab, never a background split.
  const activeWorkbenchTabId = useMemo((): string | null => {
    if (!focusedGroupId) return null
    const node = findGroup(tree, focusedGroupId).node
    return node && isTabGroupNode(node) ? (node.activeTabId ?? null) : null
  }, [tree, focusedGroupId])

  return (
    <WorkbenchActiveTabContext.Provider value={activeWorkbenchTabId}>
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', flex: 1, ...style }}
      className={className}
    >
      {tabSwitcherOpen && (
        <TabSwitcherOverlay
          open={tabSwitcherOpen}
          items={tabSwitcherItems}
          selectedIndex={tabSwitcherIndex}
          onSelect={selectTabSwitcherItem}
          onClose={closeTabSwitcher}
          style={tabSwitcherStyle ?? { top: 36, left: '50%', transform: 'translateX(-50%)', width: 400 }}
          data-testid="tab-switcher"
        />
      )}
      <EditorWorkbenchAny
        ref={editorWorkbenchRef}
        tree={tree}
        onChange={handleTreeChange}
        focusedGroupId={focusedGroupId ?? undefined}
        onFocusedGroupChange={onFocusedGroupChange}
        onFullscreenTabIdChange={onFullscreenTabIdChange}
        emptyFallback={emptyFallback}
        onSizesChange={onSizesChange}
        workbenchId={workbenchId}
        autosave={autosave}
        onRebuildTab={onRebuildTab}
        onStateRestored={onStateRestored}
        data-testid={workbenchId ? `workbench-${workbenchId}` : 'workbench'}
        {...callbacks}
      />
    </div>
    </WorkbenchActiveTabContext.Provider>
  )
})

RestormWorkbench.displayName = 'RestormWorkbench'

export default RestormWorkbench
