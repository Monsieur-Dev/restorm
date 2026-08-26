/**
 * Hook for managing navigation between sidebar and workbench
 */

import { useEffect, useCallback, useRef } from 'react'
import { navigationService } from 'electron-core-ui/renderer'
import type { NavigationEvent, SearchResult } from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder, Request, Environment, FolderItem, Scenario, ApiDesign } from '../../../shared/types/collections'
import { isFolder, isRequest, isScenario, isApiDesign, isEnvironmentFolder, isHTTPRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isSseRequest, isStompRequest, isODataRequest, isJsonRpcRequest, isJsonRpcBatchRequest, isTrpcRequest, isAmqpRequest, isRedisRequest, isKafkaRequest } from '../../../shared/types/collections'
import { findFolderById, findItemWithBreadcrumbs } from '../utils/treeSearch'
import { parseDesignSectionRowId, designSectionRowId } from '../../../shared/design/designSections'
import { setPendingDesignSection, peekPendingDesignSection, getActiveDesignSection, subscribeActiveDesignSection } from '../services/designSectionIntent'
import { parseDesignClientRowId, findClientRequest } from '../services/designClientsStore'
import type { BreadcrumbItem, DesignSectionKey } from '../../../shared/types/editor'

/** Control whether opening a tab moves focus to it. Mirrors
 * `OpenTabOptions` from `useWorkbenchTabs` — kept in this hook's own
 * surface so we don't couple the two modules at the signature level. */
export interface OpenNavTabOptions {
  focus?: boolean
  /** Open the tab at an explicit group + split zone (sidebar→workbench
   * split drop). Mirrors `OpenTabOptions.placement`. */
  placement?: { targetGroupId: string; zone: 'left' | 'right' | 'top' | 'bottom' | 'full' }
}

export interface UseNavigationOptions {
  rootItems: FolderItem[]
  openFolderTab: (folder: Folder, breadcrumbs: BreadcrumbItem[], options?: OpenNavTabOptions) => void
  openScenarioEditorTab: (scenario: Scenario, breadcrumbs: BreadcrumbItem[], options?: OpenNavTabOptions) => void
  openDesignTab: (design: ApiDesign, breadcrumbs: BreadcrumbItem[], options?: OpenNavTabOptions) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: BreadcrumbItem[], options?: OpenNavTabOptions) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[], options?: OpenNavTabOptions) => void
  /** Current selection anchor — lets a design tab's own section change
   * (restore, jump-to) re-sync the sidebar highlight, but only while that
   * design is the selected item. */
  selectedItemId: string | null
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>
  /**
   * Multi-selection ids (TASK-435). The sidebar renders THIS array when it is
   * non-empty, falling back to the single `selectedItemId` anchor only when it
   * is empty. So any navigation that moves the selection must set BOTH — the
   * anchor alone no longer moves the highlight once a multi-selection (or an
   * ordinary click, which also populates the array) has happened.
   */
  setSelectedItemIds: React.Dispatch<React.SetStateAction<string[]>>
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
  /**
   * Open a tree item as a workbench tab at an explicit position — the
   * sidebar→workbench split drop. `zone` is the split direction the user
   * released over ('full' = stack as a normal tab in the target group).
   * Mirrors `handleItemClick`'s item→tab dispatch (request / folder /
   * env-folder / scenario), but threads a `placement` so the tab opens
   * beside the drop target instead of in the focused group.
   */
  openItemAtSplit: (itemId: string, targetGroupId: string, zone: 'left' | 'right' | 'top' | 'bottom' | 'full') => void
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
    openDesignTab,
    openEnvironmentFolderTab,
    openAnyRequestTab,
    selectedItemId,
    setSelectedItemId,
    setSelectedItemIds,
    setExpandedIds,
    setFocusedGroupId,
    getNearestEnvironmentsForBreadcrumbs
  } = options

  /**
   * Move the sidebar selection to exactly one item — the anchor AND the
   * rendered array — so a navigation-driven selection actually shows.
   * Collapsing any prior multi-selection to the navigated item mirrors what
   * an ordinary single click does.
   */
  const selectSingle = useCallback((itemId: string) => {
    const sectionRow = parseDesignSectionRowId(itemId)
    if (sectionRow !== null) {
      // A virtual design-section row: highlight the ROW, but keep the
      // selection ANCHOR on the owning design — the anchor feeds paste
      // targets + the favorites store, which must resolve to a real tree
      // item, never a virtual section row.
      setSelectedItemId(sectionRow.designId)
      setSelectedItemIds([itemId])
      return
    }
    setSelectedItemId(itemId)
    setSelectedItemIds([itemId])
  }, [setSelectedItemId, setSelectedItemIds])

  // Keep the sidebar highlight in step when a design tab moves to a section on
  // its OWN — a restored tab landing on its persisted section, or a jump-to —
  // rather than only on a sidebar row click. Gated on the design being the
  // current anchor so a background tab can never hijack the selection. The
  // anchor is read from a ref so the subscription mounts once, not per select.
  const selectedItemIdRef = useRef(selectedItemId)
  useEffect(() => { selectedItemIdRef.current = selectedItemId }, [selectedItemId])
  useEffect(() => subscribeActiveDesignSection((designId, section) => {
    if (selectedItemIdRef.current !== designId) return
    setSelectedItemIds([section !== 'settings' ? designSectionRowId(designId, section) : designId])
  }), [setSelectedItemIds])

  // Handle navigation events from NavigationService
  useEffect(() => {
    const unsubscribe = navigationService.onNavigate((event: NavigationEvent) => {
      const { key, source, params, isHistoryNavigation } = event

      // Special / singleton tabs (Console, Firewall, …) are tracked in the
      // MRU history (so they take a real spot in the Ctrl+Tab switcher and
      // in close-returns-to-previous) but have no project-tree item. They
      // deliberately never drive sidebar selection or a tree-item reopen,
      // including on back/forward — those buttons skip over special-tab
      // entries rather than try to re-focus a tab with no item behind it.
      if (params.type === 'special') return

      // Update sidebar selection:
      // - Always for history navigation (back/forward buttons)
      // - Always for non-workbench sources (sidebar, breadcrumb, etc.)
      // - For workbench/tab-switcher sources: handled in handleTabActivate with sync check
      if ((source !== 'workbench' && source !== 'tab-switcher') || isHistoryNavigation) {
        selectSingle(key)
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
      } else if (params.type === 'design') {
        // Back/forward may target a virtual section row — resolve it to the
        // owning design and restage the section so the tab reopens on it.
        const sectionRow = parseDesignSectionRowId(key)
        const designId = sectionRow ? sectionRow.designId : key
        const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, designId)
        if (item && isApiDesign(item)) {
          if (sectionRow) setPendingDesignSection(designId, sectionRow.section)
          openDesignTab(item, breadcrumbs)
        }
      } else if (params.type === 'http-request' || params.type === 'graphql-request' ||
                 params.type === 'grpc-request' || params.type === 'soap-request' ||
                 params.type === 'websocket-request' || params.type === 'sse-request' ||
                 params.type === 'redis-request') {
        const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, key)
        if (item && isRequest(item)) {
          const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
          openAnyRequestTab(item, breadcrumbs, environments)
        }
      }
    })

    return unsubscribe
  }, [openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, openDesignTab, rootItems, selectSingle, setFocusedGroupId, getNearestEnvironmentsForBreadcrumbs])

  // Handle item click in the sidebar - use navigation service
  const handleItemClick = useCallback((itemId: string) => {
    // A transient client row (under a served design's Clients section). A leaf
    // request opens as a normal request tab from the client store's object (it
    // isn't in rootItems); a FOLDER row (a protocol root or a sub-folder) opens
    // the Clients section SCOPED to that folder — its descriptor (protocol root
    // only) + its child tree.
    const clientRow = parseDesignClientRowId(itemId)
    if (clientRow !== null) {
      const request = findClientRequest(clientRow.designId, clientRow.itemId)
      if (request !== undefined && isRequest(request)) {
        const { item: designItem } = findItemWithBreadcrumbs(rootItems, clientRow.designId)
        const designName = designItem !== null && isApiDesign(designItem) ? designItem.name : 'Clients'
        // The client URLs were baked to absolute at import time, so no env is
        // needed. SYNTHETIC breadcrumbs (ids not in the tree) keep the workbench
        // env re-sync from ever attaching the design's own env to these tabs.
        openAnyRequestTab(
          request,
          [{ id: `design-client-root:${clientRow.designId}`, label: designName }, { id: itemId, label: request.name }],
          []
        )
        return
      }
      const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, clientRow.designId)
      if (!item || !isApiDesign(item)) return
      selectSingle(itemId)
      setPendingDesignSection(item.id, 'clients', itemId)
      openDesignTab(item, breadcrumbs)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'design' })
      return
    }

    // A design's sidebar group entries are VIRTUAL rows (not tree
    // items): a click stages the target section, then rides the normal
    // design open path — the single-tab policy refocuses an already-open
    // tab, and the staged intent switches its section.
    const sectionRow = parseDesignSectionRowId(itemId)
    if (sectionRow !== null) {
      const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, sectionRow.designId)
      if (!item || !isApiDesign(item)) return
      // Highlight the clicked section ROW (selectSingle keeps the anchor on
      // the owning design so paste + favorites still resolve). Stage the
      // section, open/refocus the single design tab, and record the
      // navigation under the ROW id so any later re-select (the nav service,
      // a tab activation) keeps the row highlighted, not the design root.
      selectSingle(itemId)
      setPendingDesignSection(item.id, sectionRow.section)
      openDesignTab(item, breadcrumbs)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'design' })
      return
    }

    const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
    if (!item) return

    selectSingle(itemId)

    if (isApiDesign(item)) {
      // The design node itself opens Settings — the old "Paramètres" section
      // row is gone, so clicking the design IS how you reach its settings.
      // But a caller (e.g. a search result) may have already staged a section
      // to land on; only default to Settings when nothing is pending, so that
      // intent isn't clobbered.
      if (peekPendingDesignSection(item.id) === undefined) setPendingDesignSection(item.id, 'settings')
      openDesignTab(item, breadcrumbs)
      navigationService.navigateTo(itemId, 'sidebar', { type: 'design' })
      return
    }

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
      } else if (isSseRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'sse-request' })
      } else if (isStompRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'stomp-request' })
      } else if (isODataRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'odata-request' })
      } else if (isJsonRpcRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'jsonrpc-request' })
      } else if (isJsonRpcBatchRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'jsonrpc-batch-request' })
      } else if (isTrpcRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'trpc-request' })
      } else if (isAmqpRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'amqp-request' })
      } else if (isRedisRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'redis-request' })
      } else if (isKafkaRequest(item)) {
        navigationService.navigateTo(itemId, 'sidebar', { type: 'kafka-request' })
      }
    }
  }, [rootItems, selectSingle, openFolderTab, openScenarioEditorTab, openDesignTab, openEnvironmentFolderTab, openAnyRequestTab, getNearestEnvironmentsForBreadcrumbs])

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

    if (isApiDesign(item)) {
      openDesignTab(item, breadcrumbs, { focus: false })
      return
    }

    if (isRequest(item)) {
      const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
      openAnyRequestTab(item, breadcrumbs, environments, { focus: false })
    }
  }, [rootItems, openFolderTab, openScenarioEditorTab, openDesignTab, openEnvironmentFolderTab, openAnyRequestTab, getNearestEnvironmentsForBreadcrumbs])

  // Open a dragged sidebar item at an explicit split position. Same
  // item→tab dispatch as `handleItemClick`, but with a `placement` so the
  // tab lands beside the drop target; foreground (the user explicitly
  // dropped it there). No navigation-service event: a split drop is a
  // layout gesture, not a back/forward-history navigation.
  const openItemAtSplit = useCallback((itemId: string, targetGroupId: string, zone: 'left' | 'right' | 'top' | 'bottom' | 'full') => {
    const { item, breadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
    if (!item) return
    const placement = { targetGroupId, zone }

    if (isEnvironmentFolder(item)) {
      openEnvironmentFolderTab(item, breadcrumbs, { placement })
      return
    }
    if (isFolder(item)) {
      openFolderTab(item, breadcrumbs, { placement })
      return
    }
    if (isScenario(item)) {
      openScenarioEditorTab(item, breadcrumbs, { placement })
      return
    }
    if (isApiDesign(item)) {
      openDesignTab(item, breadcrumbs, { placement })
      return
    }
    if (isRequest(item)) {
      const environments = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
      openAnyRequestTab(item, breadcrumbs, environments, { placement })
    }
  }, [rootItems, openFolderTab, openScenarioEditorTab, openDesignTab, openEnvironmentFolderTab, openAnyRequestTab, getNearestEnvironmentsForBreadcrumbs])

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

      selectSingle(itemId)

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
        } else if (isSseRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'sse-request' })
        } else if (isStompRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'stomp-request' })
        } else if (isODataRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'odata-request' })
        } else if (isJsonRpcRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'jsonrpc-request' })
        } else if (isJsonRpcBatchRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'jsonrpc-batch-request' })
        } else if (isTrpcRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'trpc-request' })
        } else if (isAmqpRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'amqp-request' })
        } else if (isRedisRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'redis-request' })
        } else if (isKafkaRequest(foundItem)) {
          navigationService.navigateTo(itemId, 'breadcrumb', { type: 'kafka-request' })
        }
      }
    },
    [rootItems, selectSingle, openFolderTab, openEnvironmentFolderTab, openAnyRequestTab, getNearestEnvironmentsForBreadcrumbs]
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
    const idMatch = /^(env-folder|folder|request|scenario|design)-id:(.+)$/.exec(tabId)
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

    // A tab id `parseTabId` can't resolve to a project-tree item is a
    // special / singleton tab (Console, Firewall, …) — its id is a stable
    // `<type>:singleton` value. Record its activation under that id so it
    // takes a real spot in the MRU history. Deriving "special" from the
    // absence of an item id (rather than a hardcoded list) means a new
    // singleton tab type is MRU-tracked automatically. Type `'special'` is
    // inert: the history listener skips these on back/forward (no tree item
    // to reopen) and they never drive sidebar selection, so return early.
    if (!itemId) {
      navigationService.navigateTo(tabId, 'workbench', { type: 'special' })
      return
    }

    // Always record navigation for tab switcher history ordering
    // (itemId is guaranteed non-null here — the special-tab path returned above)
    if (itemType) {
      navigationService.navigateTo(itemId, 'workbench', { type: itemType })
    }

    // Conditionally sync sidebar selection based on user setting
    const settingsPromise = window.api.settings.get('behavior:syncSidebarWithTabs')

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

    // Conditionally sync sidebar selection highlight based on user setting.
    // The setting DEFAULTS to on, so the guard is "sync unless explicitly
    // off": `stored !== false`. This is deliberate rather than `stored === true
    // || stored === null` — `settings.get` returns the empty string when the
    // key is not yet resolvable (registration timing) and `null` when the
    // service is not up, and BOTH of those must fall back to the default-on
    // behaviour, not be read as a falsy "off".
    void settingsPromise.then((stored) => {
      const syncEnabled = stored !== false
      if (syncEnabled && itemId) {
        // For a design tab, highlight the section ROW it is currently showing
        // (Settings has no row — the design node itself carries it), so
        // switching back to a design tab mirrors what a row click leaves
        // selected instead of snapping the highlight to the design root.
        const section = getActiveDesignSection(itemId)
        const target = section && section !== 'settings' ? designSectionRowId(itemId, section) : itemId
        selectSingle(target)
      }
    })
  }, [parseTabId, selectSingle, setExpandedIds, rootItems])

  // Handle search result click - navigate to the selected item
  const handleSearchResultClick = useCallback((result: SearchResult) => {
    if (result.navigation?.['type'] === 'request' && result.navigation['requestId']) {
      handleItemClick(result.navigation['requestId'] as string)
    } else if (result.navigation?.['type'] === 'folder' && result.navigation['folderId']) {
      handleItemClick(result.navigation['folderId'] as string)
    } else if (result.navigation?.['type'] === 'scenario' && result.navigation['scenarioId']) {
      handleItemClick(result.navigation['scenarioId'] as string)
    } else if (result.navigation?.['type'] === 'design' && result.navigation['designId']) {
      // A design ENTITY result stages the section intent first, so the
      // single-tab open lands on the right card; the design's own
      // result carries no section and opens the tab as-is.
      const designId = result.navigation['designId'] as string
      const section = result.navigation['section'] as DesignSectionKey | undefined
      if (section !== undefined) {
        setPendingDesignSection(designId, section, result.navigation['entityId'] as string | undefined)
      }
      handleItemClick(designId)
    }
  }, [handleItemClick])

  return {
    handleItemClick,
    handleItemAuxClick,
    openItemAtSplit,
    handleBreadcrumbClick,
    handleBreadcrumbAuxClick,
    handleTabActivate,
    handleSearchResultClick
  }
}
