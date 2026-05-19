/**
 * Hook for managing workbench tab creation, restoration, and tree updates
 */

import { useCallback, useRef } from 'react'
import {
  isContainerNode,
  computeChecksum,
  logger
} from 'electron-core-ui/renderer'
import type { WorkbenchTree, GroupNode, EditorTab } from 'electron-core-ui/renderer'
import type { RestormWorkbenchHandle } from '../components/MainView/Workbench/RestormWorkbench'
import {
  findFirstTabGroupId,
  hasGroupWithId,
  findGroupIdForTab,
  updateGroupById
} from '../utils/workbenchHelpers'
import {
  findFolderById,
  findEnvironmentFolderById,
  findRequestById,
  findItemWithBreadcrumbs,
  getNearestEnvironmentsForBreadcrumbs
} from '../utils/treeSearch'
import type {
  Folder,
  FolderItem,
  EnvironmentFolder,
  Environment,
  Request
} from '../../../shared/types/collections'
import {
  isRequest,
  isHTTPRequest,
  isGraphQLRequest,
  isGrpcRequest,
  isSoapRequest,
  isWebSocketRequest,
  isODataRequest,
  isAuthenticationRequest,
  isEnvironmentFolder,
  isAnyFolder
} from '../../../shared/types/collections'
import type {
  FolderTab,
  EnvironmentFolderTab,
  HTTPRequestTab,
  GraphQLRequestTab,
  GrpcRequestTab,
  SoapRequestTab,
  WebSocketRequestTab,
  ODataRequestTab,
  AuthenticationRequestTab,
  ConsoleTab,
  FirewallTab,
  BreadcrumbItem
} from '../../../shared/types/editor'
import { CONSOLE_TAB_ID, FIREWALL_TAB_ID, MINI_BROWSER_TAB_ID, type MiniBrowserTab } from '../../../shared/types/editor'

export interface UseWorkbenchTabsOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  focusedGroupId: string | null
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
  registerTabDirtyState: (id: string, checksum: string) => void
}

/** Control whether opening a tab moves focus to it. Middle-click ("open in
 * background") flows pass `focus: false` so the current tab + sidebar
 * selection stay put. */
export interface OpenTabOptions {
  focus?: boolean
}

export interface UseWorkbenchTabsReturn {
  workbenchRef: React.RefObject<RestormWorkbenchHandle | null>
  hasRestoredWorkbenchRef: React.RefObject<boolean>
  findIndexPathById: (items: FolderItem[], targetId: string) => number[] | null
  buildTabId: (prefix: 'folder' | 'env-folder' | 'request', id: string) => string
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenTabOptions) => void
  handleRebuildTab: (tabId: string) => EditorTab | null
  handleStateRestored: (restoredTree: WorkbenchTree | null) => void
  handleSizesChange: (nodeId: string, sizes: number[]) => void
  handleTreeChange: (newTree: WorkbenchTree) => void
}

export function useWorkbenchTabs(options: UseWorkbenchTabsOptions): UseWorkbenchTabsReturn {
  const {
    rootItems,
    focusedGroupId,
    setWorkbenchTree,
    registerTabDirtyState
  } = options

  const workbenchRef = useRef<RestormWorkbenchHandle>(null)
  const hasRestoredWorkbenchRef = useRef(false)

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

  /**
   * Walk the workbench tree (recursing into ContainerGroupNodes for
   * split layouts) for the first tab whose underlying tree item id
   * matches `itemId`. Returns `null` if no tab represents that
   * item. Used as the second dedup key in `addTabToTree`: lets us
   * find a stale tab whose `tabId` is now out-of-date because the
   * user moved the request / folder to a different parent.
   */
  const findTabByItemId = useCallback((nodes: GroupNode[], itemId: string): { groupId: string; tabId: string } | null => {
    for (const node of nodes) {
      if (isContainerNode(node)) {
        const inner = findTabByItemId(node.groups, itemId)
        if (inner !== null) return inner
        continue
      }
      for (const tab of node.tabs) {
        const t = tab as { folder?: { id?: string }; request?: { id?: string } }
        const tabItemId = t.folder?.id ?? t.request?.id
        if (typeof tabItemId === 'string' && tabItemId === itemId) {
          return { groupId: node.id, tabId: tab.id }
        }
      }
    }
    return null
  }, [])

  /**
   * Tab id is keyed off the item's stable uuid, NOT its current
   * index path. Index-path-based ids (`request-idx:0.1.5`) flip
   * to point at a DIFFERENT item the moment the user reorders /
   * moves the tree, because the path stays the same while the
   * underlying item changes — meaning two open tabs would swap
   * identities after a sidebar swap. UUID ids stay glued to the
   * item they were opened for. The legacy `request-idx:N.N.N`
   * form is still recognised by `parseTabId` for backward-
   * compat with already-persisted workbench state; new tabs are
   * always emitted as `request-id:<uuid>`.
   */
  const buildTabId = useCallback((prefix: 'folder' | 'env-folder' | 'request', id: string): string => {
    return `${prefix}-id:${id}`
  }, [])

  // Helper to add a tab to the workbench tree, reusing the focused or
  // first group. When `focus` is false (middle-click "open in
  // background" flow), the tab is added without altering the
  // destination group's `activeTabId`, and an already-open tab
  // becomes a no-op instead of re-activating.
  //
  // `itemId` is the underlying tree-item uuid (request.id /
  // folder.id) that this tab represents. It's used as a SECOND
  // dedup key — `tabId` alone isn't enough because index-path-
  // based ids change every time the user drags the item to a
  // different parent. Without `itemId` matching, dragging a
  // request from `pet/0.1.5` to `pet/0.2.3` and re-clicking it
  // would spawn a duplicate tab (the new `tabId` doesn't match
  // the still-open old `tabId`).
  const addTabToTree = useCallback((
    prev: WorkbenchTree,
    tabId: string,
    newTab: EditorTab,
    options?: OpenTabOptions,
    itemId?: string
  ): WorkbenchTree => {
    const focus = options?.focus ?? true
    // No groups yet: create the main group with this tab. We always
    // activate it here — even in background mode, an empty workbench
    // has nothing to preserve, so the new tab becomes the only visible
    // content (the alternative is a blank workbench with a hidden tab
    // in an unreachable group).
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

    // Dedup pass A — by tabId. Fast path for the common case
    // (item hasn't moved since the previous open).
    const existingGroupId = findGroupIdForTab(prev.groups, tabId)
    if (existingGroupId) {
      if (!focus) return prev
      return {
        ...prev,
        groups: updateGroupById(prev.groups, existingGroupId, (group) => ({
          ...group,
          activeTabId: tabId
        }))
      }
    }

    // Dedup pass B — by itemId. Fires when the user dragged the
    // item between parents and the index-path-encoded `tabId`
    // changed. Walk every tab in every group, compare to the
    // tab's underlying `request.id` / `folder.id`. On hit:
    // refresh the tab in place with the new `tabId` + new tab
    // payload (breadcrumbs, environments, etc.) and focus.
    if (typeof itemId === 'string' && itemId.length > 0) {
      const stale = findTabByItemId(prev.groups, itemId)
      if (stale !== null) {
        const replacedGroups = updateGroupById(prev.groups, stale.groupId, (group) => {
          const nextActive = focus
            ? tabId
            : (group.activeTabId === stale.tabId ? tabId : (group.activeTabId ?? tabId))
          return {
            ...group,
            tabs: group.tabs.map((t) => (t.id === stale.tabId ? newTab : t)),
            activeTabId: nextActive
          }
        })
        return { ...prev, groups: replacedGroups }
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
          // Background mode: preserve the group's current active tab
          // if it has one, fall back to the just-added tab otherwise
          // (an empty-activeTabId group would render as blank).
          activeTabId: focus ? tabId : (group.activeTabId ?? tabId)
        }))
      : [
          ...prev.groups,
          {
            id: targetGroupId,
            tabs: [newTab],
            // A brand-new group must have SOME activeTabId — background
            // mode still uses the just-added tab here, because the
            // alternative is an empty selection.
            activeTabId: tabId
          }
        ]

    return {
      ...prev,
      groups: updatedGroups
    }
  }, [focusedGroupId, findTabByItemId])

  // Open a folder tab in the workbench
  const openFolderTab = useCallback((folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => {
    const tabId = buildTabId('folder', folder.id)

    setTimeout(() => {
      const folderChecksum = computeChecksum(JSON.parse(JSON.stringify(folder)) as Folder)
      registerTabDirtyState(folder.id, folderChecksum)
    }, 500)

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
      return addTabToTree(prev, tabId, newTab, options, folder.id)
    })
  }, [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree])

  // Open an environment folder tab in the workbench
  const openEnvironmentFolderTab = useCallback((folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenTabOptions) => {
    const tabId = buildTabId('env-folder', folder.id)

    // Defer checksum registration: the KV table mutates the folder's
    // variables (adding runtime IDs, normalizing types) on first render.
    // Computing the checksum synchronously would capture the pre-mutation
    // state, creating a baseline that never matches subsequent updates.
    // A short deferral lets the first render cycle settle.
    setTimeout(() => {
      const folderChecksum = computeChecksum(JSON.parse(JSON.stringify(folder)))
      registerTabDirtyState(folder.id, folderChecksum)
    }, 500)

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
      return addTabToTree(prev, tabId, newTab, options, folder.id)
    })
  }, [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree])

  // Open any request type tab in the workbench
  const openAnyRequestTab = useCallback(
    (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenTabOptions) => {
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
    } else if (isODataRequest(request)) {
      tabType = 'odata-request'
      title = request.name
    } else if (isAuthenticationRequest(request)) {
      tabType = 'auth-request'
      title = request.name
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
      return addTabToTree(prev, tabId, newTab, options, request.id)
    })
  },
    [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree]
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
  const handleRebuildTab = useCallback((tabId: string, data?: unknown): EditorTab | null => {
    // Console singleton: not tied to any tree item, so it doesn't go
    // through `parseTabId`. The tab content (xterm + toolbar) is
    // owned by `RestormWorkbench` based on the `tabType: 'console'`
    // discriminator — we just rebuild the metadata shell.
    if (tabId === CONSOLE_TAB_ID) {
      return {
        id: CONSOLE_TAB_ID,
        tabType: 'console',
        title: 'Console',
        titleString: 'Console',
        allowFullscreen: true
      } as ConsoleTab
    }
    // Firewall singleton — same pattern as Console: not tied to
    // any tree item, content owned by `RestormWorkbench`'s
    // `tabType: 'firewall'` branch.
    if (tabId === FIREWALL_TAB_ID) {
      return {
        id: FIREWALL_TAB_ID,
        tabType: 'firewall',
        title: 'Firewall',
        titleString: 'Firewall',
        allowFullscreen: true
      } as FirewallTab
    }
    // Mini browser singleton — same singleton-shell pattern, but it
    // round-trips a navigated URL via ECUI's per-tab `persistedState`
    // (see `extractWorkbenchState` / `RebuildTabCallback`). Without
    // this branch the tab silently dropped on every file reopen.
    if (tabId === MINI_BROWSER_TAB_ID) {
      const url = typeof (data as { url?: unknown } | undefined)?.url === 'string'
        ? (data as { url: string }).url
        : undefined
      return {
        id: MINI_BROWSER_TAB_ID,
        tabType: 'mini-browser',
        title: 'Mini browser',
        titleString: 'Mini browser',
        allowFullscreen: true,
        ...(url !== undefined ? { url, persistedState: { url } } : {})
      } as MiniBrowserTab
    }
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
      if (isODataRequest(requestItem)) {
        return {
          id: tabId,
          tabType: 'odata-request',
          title: requestItem.name,
          titleString: requestItem.name,
          request: requestItem,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as ODataRequestTab
      }
      if (isAuthenticationRequest(requestItem)) {
        return {
          id: tabId,
          tabType: 'auth-request',
          title: requestItem.name,
          titleString: requestItem.name,
          request: requestItem,
          breadcrumbs,
          environments,
          allowFullscreen: true
        } as AuthenticationRequestTab
      }
    }
    return null
  }, [findItemByIndexPath, parseTabId, rootItems])

  // Handle workbench state restored
  const handleStateRestored = useCallback((restoredTree: WorkbenchTree | null) => {
    logger.info('[App] workbench state restored', {
      hasTree: Boolean(restoredTree),
      groupCount: restoredTree?.groups.length ?? 0
    })
    if (restoredTree) {
      setWorkbenchTree(restoredTree)
      // Register dirty-state baselines for every restored tab so the
      // dirty-dot tracking works for modify + revert cycles.
      const registerRestoredTabs = (groups: GroupNode[]): void => {
        for (const node of groups) {
          if (isContainerNode(node)) {
            registerRestoredTabs(node.groups)
          } else {
            for (const tab of node.tabs) {
              const typed = tab as { folder?: EnvironmentFolder | Folder; request?: Request }
              const doc = typed.folder ?? typed.request
              if (doc) {
                const checksum = computeChecksum(JSON.parse(JSON.stringify(doc)))
                registerTabDirtyState(doc.id, checksum)
              }
            }
          }
        }
      }
      registerRestoredTabs(restoredTree.groups)
    }
  }, [setWorkbenchTree, registerTabDirtyState])

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
  }, [setWorkbenchTree])

  const handleTreeChange = useCallback((newTree: WorkbenchTree) => {
    setWorkbenchTree(newTree)
  }, [setWorkbenchTree])

  return {
    workbenchRef,
    hasRestoredWorkbenchRef,
    findIndexPathById,
    buildTabId,
    openFolderTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    handleRebuildTab,
    handleStateRestored,
    handleSizesChange,
    handleTreeChange
  }
}
