/**
 * Hook for managing navigation between sidebar and workbench
 */

import { useEffect, useCallback } from 'react'
import { navigationService } from 'electron-core-ui/renderer'
import type { NavigationEvent, SearchResult } from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder, Request, Environment } from '../../../shared/types/collections'
import { isFolder, isRequest, isEnvironmentFolder, isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest } from '../../../shared/types/collections'
import { findFolderById, findItemWithBreadcrumbs } from '../utils/treeSearch'
import type { BreadcrumbItem } from '../../../shared/types/editor'

export interface UseNavigationOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[]) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[]) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[]) => void
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>
  setFocusedGroupId: React.Dispatch<React.SetStateAction<string | null>>
  getNearestEnvironmentsForBreadcrumbs: (rootItems: (EnvironmentFolder | Folder | Request)[], breadcrumbs: BreadcrumbItem[]) => Environment[]
}

export interface UseNavigationReturn {
  handleItemClick: (itemId: string) => void
  handleBreadcrumbClick: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  handleTabActivate: (tabId: string) => void
  handleSearchResultClick: (result: SearchResult) => void
}

export function useNavigation(options: UseNavigationOptions): UseNavigationReturn {
  const {
    rootItems,
    openFolderTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    setSelectedItemId,
    setExpandedIds,
    setFocusedGroupId,
    getNearestEnvironmentsForBreadcrumbs
  } = options

  // Handle navigation events from NavigationService
  useEffect(() => {
    const unsubscribe = navigationService.onNavigate((event: NavigationEvent) => {
      const { key, source, params, isHistoryNavigation } = event

      // Update sidebar selection:
      // - Always for history navigation (back/forward buttons)
      // - Always for non-workbench sources (sidebar, breadcrumb, etc.)
      // - For workbench/tab-switcher sources: handled in handleTabActivate with sync check
      if ((source !== 'workbench' && source !== 'tab-switcher') || isHistoryNavigation) {
        setSelectedItemId(key)
      }

      // Only open tabs for history navigation (back/forward) — direct clicks open tabs directly
      if (!isHistoryNavigation) return

      // Open appropriate tab based on navigation type
      if (params.type === 'folder' || params.type === 'environment-folder') {
        const folder = findFolderById(rootItems, key)
        if (folder) {
          const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, key)
          if (isEnvironmentFolder(folder)) {
            openEnvironmentFolderTab(folder, breadcrumbs)
          } else {
            openFolderTab(folder, breadcrumbs)
          }
        }
      } else if (params.type === 'http-request' || params.type === 'graphql-request' || 
                 params.type === 'grpc-request' || params.type === 'soap-request' || 
                 params.type === 'websocket-request') {
        const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, key)
        if (item && isRequest(item)) {
          const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
          openAnyRequestTab(item, breadcrumbs, environments)
        }
      }
    })

    return unsubscribe
  }, [openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, rootItems, setSelectedItemId, setFocusedGroupId, getNearestEnvironmentsForBreadcrumbs])

  // Handle item click in the sidebar - use navigation service
  const handleItemClick = useCallback((itemId: string) => {
    const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
    if (!item) return

    setSelectedItemId(itemId)

    if (isEnvironmentFolder(item)) {
      openEnvironmentFolderTab(item, breadcrumbs)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'environment-folder' })
      return
    }

    if (isFolder(item)) {
      openFolderTab(item, breadcrumbs)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'folder' })
      return
    }

    if (isRequest(item)) {
      const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
      openAnyRequestTab(item, breadcrumbs, environments)
      if (isHTTPRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'http-request' })
      } else if (isGraphQLRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'graphql-request' })
      } else if (isGrpcRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'grpc-request' })
      } else if (isSoapRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'soap-request' })
      } else if (isWebSocketRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'websocket-request' })
      }
    }
  }, [rootItems, setSelectedItemId, openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, getNearestEnvironmentsForBreadcrumbs])

  // Handle breadcrumb item click - navigate to the clicked item
  const handleBreadcrumbClick = useCallback(
    (item: BreadcrumbItem, _index: number, isLast: boolean) => {
      // Skip navigation for last item (current page)
      if (isLast) return

      // Determine item type by looking up in the root folders
      const foundItem = findFolderById(rootItems, item.id)
      if (foundItem) {
        const itemId = item.id
        if (isEnvironmentFolder(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'environment-folder' })
        } else {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'folder' })
        }
      } else {
        // It might be a request
        const { item: requestItem } = findItemWithBreadcrumbs(rootItems, item.id)
        const itemId = item.id
        if (requestItem && isRequest(requestItem) && isHTTPRequest(requestItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'http-request' })
        }
      }
    },
    [rootItems]
  )

  // Resolve an index path (e.g. "0.0.1") to an actual item ID by walking rootItems
  const resolveIndexPath = useCallback((indexPath: string): string | null => {
    const indices = indexPath.split('.').map(Number)
    let current: (EnvironmentFolder | Folder | Request)[] = rootItems
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i]
      if (idx === undefined || idx >= current.length) return null
      const item = current[idx]
      if (!item) return null
      if (i === indices.length - 1) return item.id
      // Navigate into children
      if ('items' in item && Array.isArray(item.items)) {
        current = item.items as (EnvironmentFolder | Folder | Request)[]
      } else {
        return null
      }
    }
    return null
  }, [rootItems])

  // Parse a tab ID to extract the item ID and type
  const parseTabId = useCallback((tabId: string): { itemId: string | null; itemType: string | null } => {
    const indexMatch = /^(env-folder|folder|request)-idx:(.+)$/.exec(tabId)
    const idMatch = /^(env-folder|folder|request)-id:(.+)$/.exec(tabId)

    if (indexMatch?.[1] && indexMatch[2]) {
      return {
        itemType: indexMatch[1] === 'request' ? 'http-request' : indexMatch[1],
        itemId: resolveIndexPath(indexMatch[2])
      }
    }
    if (idMatch?.[1] && idMatch[2]) {
      return {
        itemType: idMatch[1] === 'request' ? 'http-request' : idMatch[1],
        itemId: idMatch[2]
      }
    }
    return { itemId: null, itemType: null }
  }, [resolveIndexPath])

  // Handle tab activation in workbench - always record navigation, conditionally sync sidebar
  const handleTabActivate = useCallback((tabId: string) => {
    const { itemId, itemType } = parseTabId(tabId)

    // Always record navigation for tab switcher history ordering
    if (itemId && itemType) {
      navigationService.navigateTo(itemId, 'workbench', { type: itemType })
    }

    // Conditionally sync sidebar selection based on user setting
    const settingsApi = (window as unknown as { api?: { settings?: { get: (k: string) => Promise<unknown> } } }).api?.settings
    const settingsPromise = settingsApi
      ? settingsApi.get('behavior:syncSidebarWithTabs')
      : Promise.resolve(true)

    // Always expand ancestor folders so the selected item is visible in the sidebar
    if (itemId) {
      const { breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
      if (breadcrumbs.length > 0) {
        const ancestorIds = breadcrumbs.slice(0, -1).map((bc) => bc.id)
        if (ancestorIds.length > 0) {
          setExpandedIds((prev) => {
            const next = new Set(prev)
            for (const id of ancestorIds) {
              next.add(id)
            }
            return Array.from(next)
          })
        }
      }
    }

    // Conditionally sync sidebar selection highlight based on user setting
    void settingsPromise.then((stored) => {
      const syncEnabled = stored !== null && stored !== undefined ? (stored as boolean) : true
      if (syncEnabled && itemId) {
        setSelectedItemId(itemId)
      }
    })
  }, [parseTabId, setSelectedItemId, setExpandedIds, rootItems])

  // Handle search result click - navigate to the selected item
  const handleSearchResultClick = useCallback((result: SearchResult) => {
    if (result.navigation?.['type'] === 'request' && result.navigation['requestId']) {
      handleItemClick(result.navigation['requestId'] as string)
    } else if (result.navigation?.['type'] === 'folder' && result.navigation['folderId']) {
      handleItemClick(result.navigation['folderId'] as string)
    }
  }, [handleItemClick])

  return {
    handleItemClick,
    handleBreadcrumbClick,
    handleTabActivate,
    handleSearchResultClick
  }
}
