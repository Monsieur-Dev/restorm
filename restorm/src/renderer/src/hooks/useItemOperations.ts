/**
 * Hook for managing item operations (CRUD) in the sidebar
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewDropEventPayload, ListViewItemEventPayload } from 'electron-core-ui/renderer'
import { isTabGroupNode } from 'electron-core-ui/renderer'
import type { Environment, Folder, EnvironmentFolder, Request, FolderItem } from '../../../shared/types/collections'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'
import { isAnyFolder, isScenario } from '../../../shared/types/collections'
import {
  HTTPRequest,
  GraphQLRequest,
  GrpcRequest,
  SoapRequest,
  WebSocketRequest,
  ODataRequest,
  AuthenticationRequest
} from '../../../shared/models/requests'
import type { HTTPMethod } from '../../../shared/models/types'
import { findItemById, findItemWithBreadcrumbs, getFolderIcon, getNearestEnvironmentsForBreadcrumbs } from '../utils/treeSearch'
import { cloneForEventBus } from '../utils/cloneForEventBus'
import { generateUniqueId, cloneItemInTree, removeItemFromTree, insertItemIntoTree } from '../utils/treeManipulation'
import type { WorkbenchTree } from 'electron-core-ui/renderer'
import type { BreadcrumbItem, FolderTab, EnvironmentFolderTab, HTTPRequestTab } from '../../../shared/types/editor'
import { makeReactiveFolder, makeReactiveRequest } from '../types/reactive'
import { DocumentEvents, type DocumentChangedPayload } from '../services/DocumentEvents'
import { eventBus } from 'electron-core-ui/renderer'
import type { AddChildKind } from '../components/MainView/Sidebar/contextMenuBuilder'
import { removeFavorite as favoritesStoreRemove } from '../services/favoritesStore'

export interface UseItemOperationsOptions {
  rootItems: FolderItem[]
  setRootItems: React.Dispatch<React.SetStateAction<FolderItem[]>>
  setExpandedIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>
  setSidebarEditingItemId: React.Dispatch<React.SetStateAction<string | null>>
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
  setDeleteConfirmation: React.Dispatch<React.SetStateAction<{
    isOpen: boolean
    itemId: string
    itemName: string
    isFolder: boolean
  }>>
  openFolderTab: (folder: Folder, breadcrumbs: import('../../../shared/types/editor').BreadcrumbItem[]) => void
  openScenarioEditorTab: (scenario: import('../../../shared/types/collections').Scenario, breadcrumbs: BreadcrumbItem[]) => void
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: import('../../../shared/types/editor').BreadcrumbItem[]) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[]) => void
  /** Project UUID. When the deleted subtree contains favorited items,
   * each id is removed from the favorites store under this key. */
  projectUuid: string | null
}

export interface UseItemOperationsReturn {
  handleItemDrop: (payload: ListViewDropEventPayload) => void
  handleCloneItem: (itemId: string) => void
  handleCreateRootFolder: () => void
  handleCreateRootEnvironmentFolder: () => void
  /** Kind-agnostic add-child dispatcher bound to the sidebar's
   * "Ajouter" submenu. Creates a well-typed empty request (or a
   * folder), wraps it reactive, pushes it into the parent's `items[]`,
   * fires the matching `*_CREATED` event so the save-unit registry
   * picks it up, and opens the new item in a workbench tab. */
  handleAddChildItem: (parentId: string, kind: AddChildKind, options?: { silent?: boolean }) => string | null
  handleDeleteItem: (itemId: string) => void
  confirmDelete: (itemId: string) => void
  cancelDelete: () => void
  handleSidebarItemRename: (payload: ListViewItemEventPayload, newName: string) => void
}

export function useItemOperations(options: UseItemOperationsOptions): UseItemOperationsReturn {
  const {
    rootItems,
    setRootItems,
    setExpandedIds,
    setSelectedItemId,
    setSidebarEditingItemId,
    setWorkbenchTree,
    setDeleteConfirmation,
    projectUuid
  } = options
  const { openFolderTab, openScenarioEditorTab, openEnvironmentFolderTab, openAnyRequestTab } = options
  const { t } = useTranslation()

  // Handle drag & drop in the sidebar to reorder items
  const handleItemDrop = useCallback((payload: ListViewDropEventPayload) => {
    const sourceId = payload.source.id
    const targetId = payload.item.id
    const position = payload.position

    // Don't allow dropping an item onto itself
    if (sourceId === targetId) return

    // Don't allow dropping a root folder (they are top-level)
    const isRootItem = rootItems.some((f) => f.id === sourceId)
    if (isRootItem) return

    // Don't allow dropping onto a root folder with 'before' or 'after' (only 'into')
    const isTargetRootFolder = rootItems.some((f) => f.id === targetId)
    if (isTargetRootFolder && position !== 'into') return

    // Don't allow dropping a folder into one of its descendants
    const isDescendant = (parentId: string, childId: string): boolean => {
      const parent = findItemById(rootItems, parentId)
      if (!parent || !isAnyFolder(parent)) return false
      for (const item of parent.items) {
        if (item.id === childId) return true
        if (isAnyFolder(item) && isDescendant(item.id, childId)) return true
      }
      return false
    }
    if (isDescendant(sourceId, targetId)) return

    // Remove the item from its current position
    const removedItem = removeItemFromTree(rootItems, sourceId)
    if (!removedItem) return

    // Insert at the new position
    const inserted = insertItemIntoTree(rootItems, removedItem, targetId, position)
    if (!inserted) {
      // If insertion failed, try to restore the item (this shouldn't happen)
      return
    }

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])

    // Update breadcrumbs in open workbench tabs
    setWorkbenchTree((prevTree) => {
      const group = prevTree.groups[0]
      if (!group || !isTabGroupNode(group)) return prevTree

      const updatedTabs = group.tabs.map((tab) => {
        const tabType = (tab as { tabType?: string }).tabType
        // Singleton tabs (Console, Firewall) aren't tied to any
        // tree item — skip them. Without this guard the `else`
        // branch below would dereference `.request.id` on a tab
        // that doesn't carry one and crash with "Cannot read
        // properties of undefined (reading 'id')" the moment a
        // sidebar drag-and-drop fires the breadcrumb refresh.
        if (tabType === 'console' || tabType === 'firewall') {
          return tab
        }
        const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

        // Get the item ID from the tab
        let itemId: string
        if (restormTab.tabType === 'folder') {
          itemId = restormTab.folder.id
        } else if (restormTab.tabType === 'environment-folder') {
          itemId = restormTab.folder.id
        } else {
          itemId = restormTab.request.id
        }

        // Recalculate breadcrumbs for this tab
        const { breadcrumbs: newBreadcrumbs } = findItemWithBreadcrumbs(rootItems, itemId)
        if (newBreadcrumbs.length === 0) return tab

        // For HTTP request tabs, also recalculate environments
        if (restormTab.tabType === 'http-request') {
          // This would need getNearestEnvironmentsForBreadcrumbs but we'll simplify for now
          return {
            ...restormTab,
            breadcrumbs: newBreadcrumbs
          }
        }

        return {
          ...restormTab,
          breadcrumbs: newBreadcrumbs
        }
      })

      return {
        ...prevTree,
        groups: [{ ...group, tabs: updatedTabs }]
      }
    })
  }, [rootItems, setRootItems, setWorkbenchTree])

  // Handle "Clone" context menu action
  const handleCloneItem = useCallback((itemId: string) => {
    // Don't allow cloning root folders
    const isRootItem = rootItems.some((f) => f.id === itemId)
    if (isRootItem) return

    // Clone the item
    const clonedItem = cloneItemInTree(rootItems, itemId)
    if (!clonedItem) return

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])
  }, [rootItems, setRootItems])

  // Handle "Delete" context menu action - show confirmation
  const handleDeleteItem = useCallback((itemId: string) => {
    // Find the item to get its name and type
    const item = findItemById(rootItems, itemId)
    if (!item) return

    const isFolderItem = isAnyFolder(item)
    setDeleteConfirmation({
      isOpen: true,
      itemId,
      itemName: item.name,
      isFolder: isFolderItem
    })
  }, [rootItems, setDeleteConfirmation])

  // Confirm deletion
  const confirmDelete = useCallback((itemId: string) => {
    // Collect every id reachable from the about-to-delete subtree —
    // including the root id itself — so we can sweep favorites in one
    // pass once the tree mutation has happened. Walking BEFORE removal
    // lets us see the descendants; the favorites cleanup runs after so
    // listeners on `restorm:favorites-changed` don't race the tree.
    const subtreeIds = new Set<string>()
    const collect = (id: string): void => {
      subtreeIds.add(id)
      const node = findItemById(rootItems, id)
      if (node && isAnyFolder(node)) {
        for (const child of node.items) collect(child.id)
      }
    }
    collect(itemId)

    // Remove the item from the tree (handles nested items)
    const removed = removeItemFromTree(rootItems, itemId)
    if (!removed) {
      // Root-level item: remove directly from rootItems
      setRootItems((prev) => prev.filter((f) => f.id !== itemId))
    }

    // Close any tabs that reference the deleted item (all groups)
    setWorkbenchTree((prevTree) => {
      const updatedGroups = prevTree.groups.map((group) => {
        if (!isTabGroupNode(group)) return group

        const filteredTabs = group.tabs.filter((tab) => {
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

          if (restormTab.tabType === 'folder' && restormTab.folder.id === itemId) return false
          if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === itemId) return false
          if (restormTab.tabType === 'http-request' && restormTab.request.id === itemId) return false

          if (restormTab.breadcrumbs?.some((bc) => bc.id === itemId)) return false

          return true
        })

        let newActiveTabId: string = group.activeTabId ?? ''
        if (!filteredTabs.some((t) => t.id === group.activeTabId)) {
          const firstTabId = filteredTabs[0]?.id
          newActiveTabId = firstTabId ?? ''
        }

        return { ...group, tabs: filteredTabs, activeTabId: newActiveTabId }
      }).filter((group) => !isTabGroupNode(group) || group.tabs.length > 0)

      return { ...prevTree, groups: updatedGroups }
    })

    // Force React re-render
    setRootItems((prevItems) => [...prevItems])

    // Cascade: drop every deleted id from the favorites store. The
    // favorites pane in the sidebar listens to `restorm:favorites-changed`
    // (dispatched from `removeFavorite`) so it re-renders without a
    // ghost row. Folder deletions sweep every favorited descendant.
    if (projectUuid) {
      for (const id of subtreeIds) favoritesStoreRemove(projectUuid, id)
    }

    // Close the confirmation modal
    setDeleteConfirmation((prev) => ({ ...prev, isOpen: false }))
  }, [rootItems, setRootItems, setWorkbenchTree, setDeleteConfirmation, projectUuid])

  // Cancel deletion
  const cancelDelete = useCallback(() => {
    setDeleteConfirmation((prev) => ({ ...prev, isOpen: false }))
  }, [setDeleteConfirmation])

  // Handle item rename from sidebar ListView
  const handleSidebarItemRename = useCallback((payload: ListViewItemEventPayload, newName: string) => {
    const itemId = payload.item.id

    // Find and update the reactive object directly (triggers search re-indexing)
    const foundItem = findItemById(rootItems, itemId)
    if (foundItem) {
      foundItem.name = newName
    }

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])

    // Also update the workbench tab title and breadcrumbs (all groups)
    setWorkbenchTree((prevTree) => {
      const updatedGroups = prevTree.groups.map((group) => {
        if (!isTabGroupNode(group)) return group

        const updatedTabs = group.tabs.map((tab) => {
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

          // Update tab title if it's the renamed item
          if (restormTab.tabType === 'folder' && restormTab.folder.id === itemId) {
            return {
              ...restormTab,
              title: newName,
              titleString: newName,
              folder: { ...restormTab.folder, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === itemId ? { ...bc, label: newName } : bc
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === itemId) {
            return {
              ...restormTab,
              title: newName,
              titleString: newName,
              folder: { ...restormTab.folder, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === itemId ? { ...bc, label: newName } : bc
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          if (restormTab.tabType === 'http-request' && restormTab.request.id === itemId) {
            const newTitle = `${restormTab.request.method} ${newName}`
            return {
              ...restormTab,
              title: newTitle,
              titleString: newTitle,
              request: { ...restormTab.request, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === itemId ? { ...bc, label: newName } : bc
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          // Update breadcrumbs for other tabs that might reference this item
          if (restormTab.breadcrumbs) {
            const hasMatch = restormTab.breadcrumbs.some((bc) => bc.id === itemId)
            if (hasMatch) {
              const updatedBreadcrumbs = restormTab.breadcrumbs.map((bc) =>
                bc.id === itemId ? { ...bc, label: newName } : bc
              )
              return { ...restormTab, breadcrumbs: updatedBreadcrumbs, contentVersion: (restormTab.contentVersion ?? 0) + 1 }
            }
          }

          return tab
        })

        return { ...group, tabs: updatedTabs }
      })

      return { ...prevTree, groups: updatedGroups }
    })

    // Notify external listeners (sidebar Favorites + Open documents
    // panes) that an item's `name` mutated in-place. Cheap signal that
    // doesn't require those panes to depend on a reference flip in
    // `rootItems` — which doesn't happen because the rename is an
    // in-place mutation.
    window.dispatchEvent(new CustomEvent('restorm:item-renamed', { detail: { id: itemId } }))
  }, [rootItems, setRootItems, setWorkbenchTree])

  // Default names for each kind the sidebar's Ajouter submenu can
  // create. Matches the submenu label order, intentionally untranslated
  // so the user can rename in place via F2 without the default drifting
  // with locale.
  const defaultNameFor = useCallback((kind: AddChildKind): string => {
    switch (kind) {
      case 'folder': return t('sidebar.newFolder')
      case 'http-get': return 'New GET request'
      case 'http-post': return 'New POST request'
      case 'http-put': return 'New PUT request'
      case 'http-patch': return 'New PATCH request'
      case 'http-delete': return 'New DELETE request'
      case 'graphql': return 'New GraphQL request'
      case 'grpc': return 'New gRPC request'
      case 'soap': return 'New SOAP request'
      case 'websocket': return 'New WebSocket request'
      case 'odata': return 'New OData request'
      case 'auth': return 'New auth request'
      case 'scenario': return 'New scenario'
    }
  }, [t])

  const handleAddChildItem = useCallback((parentId: string, kind: AddChildKind, options?: { silent?: boolean }): string | null => {
    // `parentId === ''` is the ROOT sentinel — used by the empty-area
    // sidebar context menu so users can add a top-level folder /
    // request without first creating a parent. For non-root cases we
    // resolve the parent + its ancestor chain up front and append the
    // child's breadcrumb locally (the closure-captured `rootItems`
    // would be pre-update after `setRootItems`).
    const isRoot = parentId === ''
    const parentLookup = isRoot
      ? null
      : findItemWithBreadcrumbs(rootItems, parentId)
    const parent = parentLookup?.item ?? null
    // A parent can be a folder/env-folder OR a scenario (scenarios double as
    // containers for requests authored inside them).
    const parentIsContainer = !!parent && (isAnyFolder(parent) || isScenario(parent))
    if (!isRoot && !parentIsContainer) return null
    const parentBreadcrumbs = parentLookup?.breadcrumbs ?? []
    const name = defaultNameFor(kind)
    const id = generateUniqueId()

    // Append the reactive item under the right parent. The two arms
    // are intentionally distinct because they hit different React
    // signals: a root append goes through `setRootItems` (state set ->
    // React re-render), a folder append mutates a Proxy-wrapped array
    // in place, which in turn emits REQUEST/FOLDER_UPDATED via the
    // array proxy handler — but since `rootItems` itself didn't change
    // identity, we still need to nudge React with `setRootItems((prev)
    // => [...prev])` so the sidebar's `.map(rootItems)` re-runs and
    // picks the new descendant up.
    const mountChild = (reactive: FolderItem): void => {
      if (isRoot) {
        setRootItems((prev) => [...prev, reactive])
      } else if (parent && isAnyFolder(parent)) {
        parent.items.push(reactive)
      } else if (parent && isScenario(parent)) {
        // Scenario container: its `items` is optional — seed it then append.
        const scn = parent as { items?: FolderItem[] }
        scn.items ??= []
        scn.items.push(reactive)
      }
    }

    // Build a plain item then wrap it reactive; mirrors the shapes
    // `useImport` produces on import so the save-unit registry /
    // serializer / executors all pick them up without special casing.
    let pushedItem: FolderItem
    if (kind === 'scenario') {
      // A scenario is a plain tree item (no execution wiring yet in
      // Phase 1). It syncs to main via `collections:sync` and reifies
      // into a `Scenario` model there; no per-item document event is
      // needed (there's no ContextService/search registration to do).
      const scenario = {
        type: 'scenario' as const,
        id,
        name,
        tags: [] as string[],
        params: [],
        nodes: [],
        edges: [],
        // A scenario doubles as a folder-like container for requests authored
        // inside it; starts empty.
        items: [] as FolderItem[]
      }
      mountChild(scenario as unknown as FolderItem)
      pushedItem = scenario as unknown as FolderItem
    } else if (kind === 'folder') {
      const folder: Folder = {
        id,
        name,
        tags: [],
        configuration: {},
        items: []
      }
      const reactive = makeReactiveFolder(folder)
      mountChild(reactive)
      pushedItem = reactive
      // Strip the proxy before sending over IPC — `eventBus.emitSync`
      // goes through `structuredClone` which can't ferry Proxy
      // wrappers. `cloneForEventBus` rather than the JSON round-trip
      // so `PasswordValue.toJSON()` doesn't strip the plaintext on
      // its way to main (matters when the folder being created
      // carries an environment with secrets — main needs them for
      // handlebars resolution and for the next `.restorm.env` write).
      const folderPayload: DocumentChangedPayload = {
        id: reactive.id,
        type: 'folder',
        document: cloneForEventBus(reactive)
      }
      eventBus.emitSync(DocumentEvents.FOLDER_CREATED, folderPayload)
    } else {
      // The class instances structurally satisfy the structural
      // `Request` union in `shared/types/requests`, but TS's
      // `exactOptionalPropertyTypes: true` can't prove the match because
      // the class-side `type` field is typed as the full union on
      // `BaseRequest`. Cast through `unknown` once at the boundary
      // rather than threading class unions everywhere downstream.
      const httpMethod: HTTPMethod | undefined =
        kind === 'http-get' ? 'GET' :
          kind === 'http-post' ? 'POST' :
            kind === 'http-put' ? 'PUT' :
              kind === 'http-patch' ? 'PATCH' :
                kind === 'http-delete' ? 'DELETE' :
                  undefined
      let built: unknown
      if (httpMethod !== undefined) {
        built = new HTTPRequest({ id, name, method: httpMethod })
      } else if (kind === 'graphql') {
        built = new GraphQLRequest({ id, name })
      } else if (kind === 'grpc') {
        built = new GrpcRequest({ id, name })
      } else if (kind === 'soap') {
        built = new SoapRequest({ id, name })
      } else if (kind === 'websocket') {
        built = new WebSocketRequest({ id, name })
      } else if (kind === 'odata') {
        built = new ODataRequest({ id, name })
      } else {
        built = new AuthenticationRequest({ id, name })
      }
      const request = built as Request
      const resolvedParentId = isRoot
        ? undefined
        : (parent && (isAnyFolder(parent) || isScenario(parent)) ? parent.id : undefined)
      const reactive = resolvedParentId !== undefined
        ? makeReactiveRequest(request, resolvedParentId)
        : makeReactiveRequest(request)
      mountChild(reactive)
      pushedItem = reactive
      const createdPayload: DocumentChangedPayload = {
        id: reactive.id,
        type: 'request',
        document: cloneForEventBus(reactive),
        ...(resolvedParentId !== undefined ? { parentFolderId: resolvedParentId } : {})
      }
      eventBus.emitSync(DocumentEvents.REQUEST_CREATED, createdPayload)
    }

    // `silent` (a request created inline in a scenario graph) skips ALL
    // navigation — no parent expand, no sidebar selection, no tab — so the user
    // stays on the graph and the sidebar doesn't jump. The tree still re-renders
    // (the `[...prevItems]` nudge) so the new child shows once its parent is
    // expanded; see the `mountChild` comment for why the nudge is needed.
    const silent = options?.silent === true
    if (!isRoot) {
      if (!silent) setExpandedIds((prev) => Array.from(new Set([...prev, parentId])))
      setRootItems((prevItems) => [...prevItems])
    }
    if (!silent) setSelectedItemId(id)

    if (!silent) {
      const newBreadcrumb: BreadcrumbItem = {
        id,
        label: name,
        icon: isAnyFolder(pushedItem) ? getFolderIcon(pushedItem) : null
      }
      const breadcrumbs = [...parentBreadcrumbs, newBreadcrumb]
      const envs = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
      if (kind === 'folder' && isAnyFolder(pushedItem)) {
        openFolderTab(pushedItem, breadcrumbs)
      } else if (isScenario(pushedItem)) {
        openScenarioEditorTab(pushedItem, breadcrumbs)
      } else if (!isAnyFolder(pushedItem)) {
        openAnyRequestTab(pushedItem, breadcrumbs, envs)
      }
    }
    return id
  }, [rootItems, setRootItems, setExpandedIds, setSelectedItemId, openFolderTab, openScenarioEditorTab, openAnyRequestTab, defaultNameFor])

  const handleCreateRootFolder = useCallback(() => {
    const newFolder: Folder = {
      id: generateUniqueId(),
      name: t('sidebar.newFolder'),
      tags: [],
      configuration: {},
      items: []
    }
    setRootItems((prev) => [...prev, newFolder])
    setSelectedItemId(newFolder.id)
    const breadcrumbs = [{ id: newFolder.id, label: newFolder.name, icon: getFolderIcon(newFolder) }]
    openFolderTab(newFolder, breadcrumbs)
    setTimeout(() => {
      setSidebarEditingItemId(newFolder.id)
    }, 0)
  }, [setRootItems, setSelectedItemId, setSidebarEditingItemId, openFolderTab, t])

  const handleCreateRootEnvironmentFolder = useCallback(() => {
    const newFolder: EnvironmentFolder = {
      id: generateUniqueId(),
      name: t('sidebar.newEnvironmentFolder'),
      folderType: 'environment',
      fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
      tags: [],
      configuration: {},
      environments: [],
      items: []
    }
    setRootItems((prev) => [...prev, newFolder])
    setSelectedItemId(newFolder.id)
    const breadcrumbs = [{ id: newFolder.id, label: newFolder.name, icon: getFolderIcon(newFolder) }]
    openEnvironmentFolderTab(newFolder, breadcrumbs)
    setTimeout(() => {
      setSidebarEditingItemId(newFolder.id)
    }, 0)
  }, [setRootItems, setSelectedItemId, setSidebarEditingItemId, openEnvironmentFolderTab, t])

  return {
    handleItemDrop,
    handleCloneItem,
    handleCreateRootFolder,
    handleCreateRootEnvironmentFolder,
    handleAddChildItem,
    handleDeleteItem,
    confirmDelete,
    cancelDelete,
    handleSidebarItemRename
  }
}
