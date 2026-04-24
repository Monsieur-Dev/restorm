/**
 * Hook for managing item operations (CRUD) in the sidebar
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewDropEventPayload, ListViewItemEventPayload } from 'electron-core-ui/renderer'
import { isTabGroupNode } from 'electron-core-ui/renderer'
import type { Environment, Folder, EnvironmentFolder, Request } from '../../../shared/types/collections'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'
import { isAnyFolder } from '../../../shared/types/collections'
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
import { generateUniqueId, cloneItemInTree, removeItemFromTree, insertItemIntoTree } from '../utils/treeManipulation'
import type { WorkbenchTree } from 'electron-core-ui/renderer'
import type { BreadcrumbItem, FolderTab, EnvironmentFolderTab, HTTPRequestTab } from '../../../shared/types/editor'
import { makeReactiveFolder, makeReactiveRequest } from '../types/reactive'
import { DocumentEvents } from '../services/DocumentEvents'
import { eventBus } from 'electron-core-ui/renderer'
import type { AddChildKind } from '../components/MainView/Sidebar/contextMenuBuilder'

export interface UseItemOperationsOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  setRootItems: React.Dispatch<React.SetStateAction<(EnvironmentFolder | Folder | Request)[]>>
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
  openEnvironmentFolderTab: (folder: EnvironmentFolder, breadcrumbs: import('../../../shared/types/editor').BreadcrumbItem[]) => void
  openAnyRequestTab: (request: Request, breadcrumbs: BreadcrumbItem[], environments?: Environment[]) => void
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
  handleAddChildItem: (parentId: string, kind: AddChildKind) => void
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
    setDeleteConfirmation
  } = options
  const { openFolderTab, openEnvironmentFolderTab, openAnyRequestTab } = options
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

    // Close the confirmation modal
    setDeleteConfirmation((prev) => ({ ...prev, isOpen: false }))
  }, [rootItems, setRootItems, setWorkbenchTree, setDeleteConfirmation])

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
    }
  }, [t])

  const handleAddChildItem = useCallback((parentId: string, kind: AddChildKind) => {
    // Resolve the parent + its ancestor chain once, up front, so we can
    // append the new child's breadcrumb locally instead of re-walking
    // the tree after `setRootItems` (the closure-captured `rootItems`
    // is pre-update at that point and any concurrent tree mutation
    // would make a post-push lookup unsound).
    const parentLookup = findItemWithBreadcrumbs(rootItems, parentId)
    const parent = parentLookup.item
    if (!parent || !isAnyFolder(parent)) return
    const parentBreadcrumbs = parentLookup.breadcrumbs
    const name = defaultNameFor(kind)
    const id = generateUniqueId()

    // Build a plain item then wrap it reactive; mirrors the shapes
    // `useImport` produces on import so the save-unit registry /
    // serializer / executors all pick them up without special casing.
    if (kind === 'folder') {
      const folder: Folder = {
        id,
        name,
        documentation: '',
        tags: [],
        configuration: {},
        items: []
      }
      const reactive = makeReactiveFolder(folder)
      parent.items.push(reactive)
      // Strip the proxy before sending over IPC — `eventBus.emitSync`
      // goes through `structuredClone` which can't ferry Proxy
      // wrappers, and `useImport` follows the same JSON-round-trip
      // pattern to stay safe here.
      eventBus.emitSync(DocumentEvents.FOLDER_CREATED, {
        id: reactive.id,
        type: 'folder',
        document: JSON.parse(JSON.stringify(reactive)) as Folder
      })
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
      const reactive = makeReactiveRequest(request, parent.id)
      parent.items.push(reactive)
      eventBus.emitSync(DocumentEvents.REQUEST_CREATED, {
        id: reactive.id,
        type: 'request',
        document: JSON.parse(JSON.stringify(reactive)) as Request,
        parentFolderId: parent.id
      })
    }

    // Mount the new item: expand the parent, select the child, force
    // a sidebar re-render, and open the new item in the workbench.
    setExpandedIds((prev) => Array.from(new Set([...prev, parentId])))
    setSelectedItemId(id)
    setRootItems((prevItems) => [...prevItems])

    // Build the new item's breadcrumb chain from the parent chain we
    // captured before the push. The last entry in `parent.items` is
    // always the just-pushed child (single-threaded React update).
    const pushedItem = parent.items[parent.items.length - 1]
    if (pushedItem === undefined) return
    const newBreadcrumb: BreadcrumbItem = {
      id,
      label: name,
      icon: isAnyFolder(pushedItem) ? getFolderIcon(pushedItem) : null
    }
    const breadcrumbs = [...parentBreadcrumbs, newBreadcrumb]
    const envs = getNearestEnvironmentsForBreadcrumbs(rootItems, breadcrumbs)
    if (kind === 'folder' && isAnyFolder(pushedItem)) {
      openFolderTab(pushedItem as Folder, breadcrumbs)
    } else if (!isAnyFolder(pushedItem)) {
      openAnyRequestTab(pushedItem as Request, breadcrumbs, envs)
    }
  }, [rootItems, setRootItems, setExpandedIds, setSelectedItemId, openFolderTab, openAnyRequestTab, defaultNameFor])

  const handleCreateRootFolder = useCallback(() => {
    const newFolder: Folder = {
      id: generateUniqueId(),
      name: t('sidebar.newFolder'),
      documentation: '',
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
      documentation: '',
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
