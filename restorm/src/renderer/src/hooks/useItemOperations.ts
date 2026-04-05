/**
 * Hook for managing item operations (CRUD) in the sidebar
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewDropEventPayload, ListViewItemEventPayload } from 'electron-core-ui/renderer'
import { isTabGroupNode } from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder, Request } from '../../../shared/types/collections'
import { isAnyFolder } from '../../../shared/types/collections'
import { findItemById, findItemWithBreadcrumbs, getFolderIcon } from '../utils/treeSearch'
import { generateUniqueId, cloneItemInTree, removeItemFromTree, insertItemIntoTree } from '../utils/treeManipulation'
import type { WorkbenchTree } from 'electron-core-ui/renderer'
import type { FolderTab, EnvironmentFolderTab, HTTPRequestTab } from '../../../shared/types/editor'

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
}

export interface UseItemOperationsReturn {
  handleItemDrop: (payload: ListViewDropEventPayload) => void
  handleCloneItem: (itemId: string) => void
  handleCreateSubfolder: (parentFolderId: string) => void
  handleCreateRootFolder: () => void
  handleCreateRootEnvironmentFolder: () => void
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
  const { openFolderTab, openEnvironmentFolderTab } = options
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

  // Handle "Create subfolder" context menu action
  const handleCreateSubfolder = useCallback((parentFolderId: string) => {
    // Find the parent folder
    const parentFolder = findItemById(rootItems, parentFolderId)
    if (!parentFolder || !isAnyFolder(parentFolder)) return

    // Create a new folder
    const newFolder: Folder = {
      id: generateUniqueId(),
      name: 'New Folder',
      documentation: '',
      tags: [],
      configuration: {},
      items: []
    }

    // Add to parent folder
    parentFolder.items.push(newFolder)

    // Expand the parent folder to show the new subfolder
    setExpandedIds((prev) => Array.from(new Set([...prev, parentFolderId])))

    // Select the new folder
    setSelectedItemId(newFolder.id)

    // Force React re-render by creating new reference
    setRootItems((prevItems) => [...prevItems])

    // Put the new folder in edit mode (after render)
    setTimeout(() => {
      setSidebarEditingItemId(newFolder.id)
    }, 0)
  }, [rootItems, setRootItems, setExpandedIds, setSelectedItemId, setSidebarEditingItemId])

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
    handleCreateSubfolder,
    handleCreateRootFolder,
    handleCreateRootEnvironmentFolder,
    handleDeleteItem,
    confirmDelete,
    cancelDelete,
    handleSidebarItemRename
  }
}
