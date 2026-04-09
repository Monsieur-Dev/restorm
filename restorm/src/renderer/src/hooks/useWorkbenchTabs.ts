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
  BreadcrumbItem
} from '../../../shared/types/editor'

export interface UseWorkbenchTabsOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  focusedGroupId: string | null
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
  registerTabDirtyState: (id: string, checksum: string) => void
}

export interface UseWorkbenchTabsReturn {
  workbenchRef: React.RefObject<RestormWorkbenchHandle | null>
  hasRestoredWorkbenchRef: React.RefObject<boolean>
  findIndexPathById: (items: FolderItem[], targetId: string) => number[] | null
  buildTabId: (prefix: 'folder' | 'env-folder' | 'request', id: string) => string
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[]) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[]) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[]) => void
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

  const buildTabId = useCallback((prefix: 'folder' | 'env-folder' | 'request', id: string): string => {
    const indexPath = findIndexPathById(rootItems as FolderItem[], id)
    if (!indexPath) {
      return `${prefix}-id:${id}`
    }
    return `${prefix}-idx:${indexPath.join('.')}`
  }, [findIndexPathById, rootItems])

  // Helper to add a tab to the workbench tree, reusing the focused or first group
  const addTabToTree = useCallback((
    prev: WorkbenchTree,
    tabId: string,
    newTab: EditorTab
  ): WorkbenchTree => {
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
  }, [focusedGroupId])

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
      return addTabToTree(prev, tabId, newTab)
    })
  }, [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree])

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
      return addTabToTree(prev, tabId, newTab)
    })
  }, [buildTabId, registerTabDirtyState, setWorkbenchTree, addTabToTree])

  // Open any request type tab in the workbench
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
      return addTabToTree(prev, tabId, newTab)
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
    logger.info('[App] workbench state restored', {
      hasTree: Boolean(restoredTree),
      groupCount: restoredTree?.groups.length ?? 0
    })
    if (restoredTree) {
      setWorkbenchTree(restoredTree)
    }
  }, [setWorkbenchTree])

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
