import React, { useMemo, useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger, IconView, TabSwitcherOverlay, navigationService, useFeature, MiniBrowserPanel, ConsolePanel, type ContextMenuItem } from 'electron-core-ui/renderer'
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
  isScenarioEditorTab,
  isConsoleTab,
  isFirewallTab,
  isMiniBrowserTab
} from '../../../../../shared/types/editor'
import { FirewallPanel } from '../../Firewall'
import {
  HTTPRequestTabView,
  GraphQLRequestTabView,
  GrpcRequestTabView,
  SoapRequestTabView,
  WebSocketRequestTabView,
  ODataRequestTabView
} from '../../RequestTabViews'
import { EnvironmentProvider } from '../../../contexts/EnvironmentContext'
import { ScenarioEditorView } from '../../Scenario/ScenarioEditorView'
import { FolderView } from '../../Folders/FolderView'
import { EnvironmentFolderView } from '../../Folders/EnvironmentFolderView'
import type { EnvironmentFolder, Folder, Request } from '../../../../../shared/types/collections'
import { getFolderIcon } from '../../../utils/treeSearch'
import { Badge } from '../../common/Badge'
import { mapToBadgeType } from '../../../utils/badgeUtils'
import { useTranslation } from 'react-i18next'
import { RestormWorkbenchTab } from './RestormWorkbenchTab'
import { DeprecationAwareRequestTab } from './DeprecationAwareRequestTab'
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
  /** Get a reactive Folder by ID (for reactivity support) */
  getFolderById?: (id: string) => Folder | undefined
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
  onEnvironmentFolderChange,
  emptyFallback,
  onSizesChange,
  workbenchId,
  autosave,
  onRebuildTab,
  onStateRestored,
  getRequestById,
  getFolderById,
  getEnvironmentFolderById,
  navigationEnabled,
  tabSwitcherAnchorSelector,
  projectUuid,
  isItemFavorite,
  onToggleFavorite
}, ref) => {
  const { t } = useTranslation()
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

  const renderDirtyIndicator = useCallback((tab: RestormEditorTab): React.ReactNode => {
    const itemId = getTabItemId(tab)
    if (!itemId || !dirtyItemIdsSet?.has(itemId)) return null
    return (
      <span
        className="codicon codicon-circle-filled dirty-indicator"
        aria-label="Modified"
        title="Modified"
        style={{ marginLeft: 6 }}
      />
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
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // OData request tab
    // TODO: branch on `operationKind` ('entity-set' | 'function' |
    // 'action') once the discriminator is introduced, so functions /
    // actions get their own badges instead of the shared 'ODATA' one.
    if (isODataRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="ODATA" />
          <span>{restormTab.request.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    if (isAuthenticationRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="AUTH" />
          <span>{restormTab.request.name}</span>
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

    return null
  }, [renderDirtyIndicator])

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

    // Sort by navigation order (most recent first), tabs without history at the end
    const sorted = [...allTabs].sort((a, b) => {
      const aItemId = getTabItemId(a)
      const bItemId = getTabItemId(b)
      const aOrder = (aItemId ? historyOrder.get(aItemId) : undefined) ?? 999
      const bOrder = (bItemId ? historyOrder.get(bItemId) : undefined) ?? 999
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
  }, [tree.groups, renderTabTitle, getTabItemId])

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

    // Scenario editor tab
    if (isScenarioEditorTab(effectiveTab)) {
      return <ScenarioEditorView scenario={effectiveTab.scenario} />
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
      return <FirewallPanel />
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

    // Legacy/empty tab fallback (should not happen with typed tabs)
    return null
  }, [onBreadcrumbClick, onBreadcrumbAuxClick, onItemRename, onItemIconChange, onTagsChange, onTagColorChange, onFolderChange, onEnvironmentFolderChange, onRequestClick, onRequestAuxClick, getRequestById, getFolderById, getEnvironmentFolderById, getTagColorsFromBreadcrumbs, getEnvFolderIdFromBreadcrumbs, projectUuid, isItemFavorite, onToggleFavorite, updateMiniBrowserUrl])

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
      const typed = tab as { request?: { id: string }; tabType?: string }
      const isRequest = typed.tabType?.includes('request')
      const requestId = typed.request?.id

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
      // Forward tab activation from any group (incl. non-main split
      // groups) so the sidebar can sync. Intentionally no dedup here:
      // clicking an already-active tab must still re-trigger ancestor
      // expansion (e.g. after the user manually collapsed the parent
      // folder). Downstream handlers (`navigationService.navigateTo`,
      // `setExpandedIds` with Set semantics) are idempotent, so a
      // repeat fire is safe.
      onActivateTab: (tabId) => {
        onTabActivate?.(tabId)
      }
    }
  }, [handleTabDropped, workbenchRenderTabContent, renderTabTitle, handleDetachToNewWindow, getTabContextMenuItems, getTabContent, onTabActivate, tabDetachEnabled])

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

  return (
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
  )
})

RestormWorkbench.displayName = 'RestormWorkbench'

export default RestormWorkbench
