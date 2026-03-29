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
    setFocusedGroupId,
    getNearestEnvironmentsForBreadcrumbs
  } = options

  // Handle navigation events from NavigationService
  useEffect(() => {
    const unsubscribe = navigationService.onNavigate((event: NavigationEvent) => {
      const { key, params } = event

      // Update sidebar selection
      setSelectedItemId(key)

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
          // Focus the group containing the tab
          setFocusedGroupId('restorm-main-group')
        }
      } else if (params.type === 'http-request' || params.type === 'graphql-request' || 
                 params.type === 'grpc-request' || params.type === 'soap-request' || 
                 params.type === 'websocket-request') {
        const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, key)
        if (item && isRequest(item)) {
          const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
          openAnyRequestTab(item, breadcrumbs, environments)
          // Focus the group containing the tab
          setFocusedGroupId('restorm-main-group')
        }
      }
    })

    return unsubscribe
  }, [openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, rootItems, setSelectedItemId, setFocusedGroupId, getNearestEnvironmentsForBreadcrumbs])

  // Handle item click in the sidebar - use navigation service
  const handleItemClick = useCallback((itemId: string) => {
    const { item } = findItemWithBreadcrumbs(rootItems, itemId)
    if (!item) return

    if (isEnvironmentFolder(item)) {
      // Open environment folder view
      navigationService.navigateTo(itemId, 'sidebar', { type: 'environment-folder' })
      return
    }

    if (isFolder(item)) {
      // Open folder view (same as "Define variables" context menu)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'folder' })
      return
    }

    if (isRequest(item)) {
      // Navigate to request - determine type from request
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
  }, [rootItems])

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

  // Handle tab activation in workbench - navigate to sync sidebar selection
  const handleTabActivate = useCallback((tabId: string) => {
    // Extract the item ID from the tab ID
    let itemId: string | null = null
    let itemType: string | null = null

    if (tabId.startsWith('env-folder-')) {
      itemId = tabId.replace('env-folder-', '')
      itemType = 'environment-folder'
    } else if (tabId.startsWith('folder-')) {
      itemId = tabId.replace('folder-', '')
      itemType = 'folder'
    } else if (tabId.startsWith('request-')) {
      itemId = tabId.replace('request-', '')
      itemType = 'http-request'
    }

    if (itemId && itemType) {
      // Navigate to sync sidebar selection
      navigationService.navigateTo(itemId, 'workbench', { type: itemType })
    }
  }, [])

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
