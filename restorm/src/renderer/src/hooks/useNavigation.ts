/**
 * Hook for managing navigation between sidebar and workbench
 */

import { useEffect, useCallback } from 'react'
import { navigationService } from 'electron-core-ui/renderer'
import type { NavigationEvent, SearchResult } from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder, Request, Environment, FolderItem, Scenario } from '../../../shared/types/collections'
import { isFolder, isRequest, isScenario, isEnvironmentFolder, isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isODataRequest } from '../../../shared/types/collections'
import { findFolderById, findItemWithBreadcrumbs } from '../utils/treeSearch'
import type { BreadcrumbItem } from '../../../shared/types/editor'

/** Control whether opening a tab moves focus to it. Mirrors
 * `OpenTabOptions` from `useWorkbenchTabs` — kept in this hook's own
 * surface so we don't couple the two modules at the signature level. */
export interface OpenNavTabOptions {
  focus?: boolean
}

export interface UseNavigationOptions {
  rootItems: FolderItem[]
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenNavTabOptions) => void
  openScenarioEditorTab: (scenario: Scenario, breadcrumbs: BreadcrumbItem[], options?: OpenNavTabOptions) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenNavTabOptions) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenNavTabOptions) => void
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>
  setFocusedGroupId: React.Dispatch<React.SetStateAction<string | null>>
  getNearestEnvironmentsForBreadcrumbs: (rootItems: FolderItem[], breadcrumbs: BreadcrumbItem[]) => Environment[]
}

export interface UseNavigationReturn {
  handleItemClick: (itemId: string) => void
  /**
   * Middle-click ("open in background") variant of `handleItemClick`.
   * Opens the matching workbench tab without focusing it, without
   * moving the sidebar selection, and without pushing a
   * navigation-service event.
   */
  handleItemAuxClick: (itemId: string) => void
  handleBreadcrumbClick: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  /**
   * Middle-click handler for a breadcrumb folder / env-folder segment.
   * Opens the matching workbench tab without focusing it and without
   * touching the sidebar selection — the "open in background" gesture.
   * Requests are out of scope (clicking a request segment via middle
   * mouse would be rare; left-click already covers the request flow).
   */
  handleBreadcrumbAuxClick: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  handleTabActivate: (tabId: string) => void
  handleSearchResultClick: (result: SearchResult) => void
}

export function useNavigation(options: UseNavigationOptions): UseNavigationReturn {
  const {
    rootItems,
    openFolderTab,
    openScenarioEditorTab,
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

    if (isScenario(item)) {
      openScenarioEditorTab(item, breadcrumbs)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'scenario-editor' })
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
      } else if (isODataRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'odata-request' })
      }
    }
  }, [rootItems, setSelectedItemId, openFolderTab, openScenarioEditorTab, openEnvironmentFolderTab, openAnyRequestTab, getNearestEnvironmentsForBreadcrumbs])

  // Middle-click ("open in background") variant of `handleItemClick`.
  // Opens the corresponding workbench tab without focusing it, without
  // moving sidebar selection, and without pushing a navigation-service
  // event — the user's current focus stays exactly where it was.
  const handleItemAuxClick = useCallback((itemId: string) => {
    const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
    if (!item) return

    if (isEnvironmentFolder(item)) {
      openEnvironmentFolderTab(item, breadcrumbs, { focus: false })
      return
    }

    if (isFolder(item)) {
      openFolderTab(item, breadcrumbs, { focus: false })
      return
    }

    if (isScenario(item)) {
      openScenarioEditorTab(item, breadcrumbs, { focus: false })
      return
    }

    if (isRequest(item)) {
      const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
      openAnyRequestTab(item, breadcrumbs, environments, { focus: false })
    }
  }, [rootItems, openFolderTab, openScenarioEditorTab, openEnvironmentFolderTab, openAnyRequestTab, getNearestEnvironmentsForBreadcrumbs])

  // Handle breadcrumb item click — open a workbench tab for the
  // clicked segment, not just update history. The old implementation
  // only called `navigationService.navigateTo(...)`, but the navigation
  // subscription above ignores non-history events for tab opening
  // (direct clicks are expected to open tabs themselves, see the
  // `handleItemClick` pattern). That left breadcrumb clicks as
  // sidebar-select-only — the sidebar highlighted the target but the
  // workbench never surfaced a tab for it.
  const handleBreadcrumbClick = useCallback(
    (item: BreadcrumbItem, _index: number, isLast: boolean) => {
      // Last item is the current page — no navigation.
      if (isLast) return

      const itemId = item.id
      const { item: foundItem, breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
      if (!foundItem) return

      setSelectedItemId(itemId)

      if (isEnvironmentFolder(foundItem)) {
        openEnvironmentFolderTab(foundItem, breadcrumbs)
        navigationService.navigateTo(itemId, 'breadcrumb', { type: 'environment-folder' })
        return
      }

      if (isFolder(foundItem)) {
        openFolderTab(foundItem, breadcrumbs)
        navigationService.navigateTo(itemId, 'breadcrumb', { type: 'folder' })
        return
      }

      if (isRequest(foundItem)) {
        const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
        openAnyRequestTab(foundItem, breadcrumbs, environments)
        if (isHTTPRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'http-request' })
        } else if (isGraphQLRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'graphql-request' })
        } else if (isGrpcRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'grpc-request' })
        } else if (isSoapRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'soap-request' })
        } else if (isWebSocketRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'websocket-request' })
        } else if (isODataRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'odata-request' })
        }
      }
    },
    [rootItems, setSelectedItemId, openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, getNearestEnvironmentsForBreadcrumbs]
  )

  // Middle-click ("open in background") variant of the breadcrumb
  // handler. Open the matching tab if it isn't already in the
  // workbench, but don't focus it, don't touch the sidebar selection,
  // and don't push a navigation-service event — this is the opposite
  // of `handleBreadcrumbClick`, which moves focus in every direction.
  //
  // Scope: folders + env-folders only. Requests are excluded because
  // middle-click on a leaf segment (the current page) never happens
  // — EditableLabel replaces that segment and swallows clicks for
  // its own edit affordance. Only ancestor (folder-ish) segments ever
  // receive `onItemAuxClick`.
  const handleBreadcrumbAuxClick = useCallback(
    (item: BreadcrumbItem, _index: number, isLast: boolean) => {
      if (isLast) return
      const { item: foundItem, breadcrumbs } = findItemWithBreadcrumbs(rootItems, item.id)
      if (!foundItem) return
      if (isEnvironmentFolder(foundItem)) {
        openEnvironmentFolderTab(foundItem, breadcrumbs, { focus: false })
        return
      }
      if (isFolder(foundItem)) {
        openFolderTab(foundItem, breadcrumbs, { focus: false })
      }
      // Requests are intentionally a no-op — see the comment on the
      // return type for rationale.
    },
    [rootItems, openFolderTab, openEnvironmentFolderTab]
  )

  // Resolve an index path (e.g. "0.0.1") to an actual item ID by walking rootItems
  const resolveIndexPath = useCallback((indexPath: string): string | null => {
    const indices = indexPath.split('.').map(Number)
    let current: FolderItem[] = rootItems
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i]
      if (idx === undefined || idx >= current.length) return null
      const item = current[idx]
      if (!item) return null
      if (i === indices.length - 1) return item.id
      // Navigate into children
      if ('items' in item && Array.isArray(item.items)) {
        current = item.items
      } else {
        return null
      }
    }
    return null
  }, [rootItems])

  // Parse a tab ID to extract the item ID and type
  const parseTabId = useCallback((tabId: string): { itemId: string | null; itemType: string | null } => {
    const indexMatch = /^(env-folder|folder|request|scenario)-idx:(.+)$/.exec(tabId)
    const idMatch = /^(env-folder|folder|request|scenario)-id:(.+)$/.exec(tabId)
    const mapType = (prefix: string): string =>
      prefix === 'request' ? 'http-request' : prefix === 'scenario' ? 'scenario-editor' : prefix

    if (indexMatch?.[1] && indexMatch[2]) {
      return { itemType: mapType(indexMatch[1]), itemId: resolveIndexPath(indexMatch[2]) }
    }
    if (idMatch?.[1] && idMatch[2]) {
      return { itemType: mapType(idMatch[1]), itemId: idMatch[2] }
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
    } else if (result.navigation?.['type'] === 'scenario' && result.navigation['scenarioId']) {
      handleItemClick(result.navigation['scenarioId'] as string)
    }
  }, [handleItemClick])

  return {
    handleItemClick,
    handleItemAuxClick,
    handleBreadcrumbClick,
    handleBreadcrumbAuxClick,
    handleTabActivate,
    handleSearchResultClick
  }
}
