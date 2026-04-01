/**
 * Hook for managing workbench updates (tags, folders, environment folders)
 */

import { useCallback, useState } from 'react'
import { isTabGroupNode } from 'electron-core-ui/renderer'
import type { WorkbenchTree } from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder, Request } from '../../../shared/types/collections'
import { isEnvironmentFolder } from '../../../shared/types/collections'
import { findItemById, findEnvironmentFolderById, getNearestEnvironmentsForBreadcrumbs } from '../utils/treeSearch'
import type { FolderTab, EnvironmentFolderTab, HTTPRequestTab, BreadcrumbItem } from '../../../shared/types/editor'

export interface UseWorkbenchUpdatesOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
}

export interface UseWorkbenchUpdatesReturn {
  handleTagsChange: (targetId: string, newTags: string[]) => void
  handleFolderChange: (folderId: string, updatedFolder: Folder) => void
  handleEnvironmentFolderChange: (folderId: string, updatedFolder: EnvironmentFolder) => void
  handleItemRename: (item: BreadcrumbItem, newName: string) => void
}

export function useWorkbenchUpdates(options: UseWorkbenchUpdatesOptions): UseWorkbenchUpdatesReturn {
  const { rootItems, setWorkbenchTree } = options

  // Counter to force re-render without breaking reactive proxies
  const [_updateCount, setUpdateCount] = useState(0)
  const forceUpdate = useCallback(() => {
    setUpdateCount(n => n + 1)
  }, [])

  // Handle tags changes from Workbench (folders or HTTP requests)
  const handleTagsChange = useCallback((targetId: string, newTags: string[]) => {
    // Find and update the reactive object directly (triggers search re-indexing)
    const item = findItemById(rootItems, targetId)
    if (item) {
      item.tags = newTags
    }

    // Force React re-render without breaking reactive proxies
    forceUpdate()

    // Update tags in open workbench tabs
    setWorkbenchTree((prevTree) => {
      const group = prevTree.groups[0]
      if (!group || !isTabGroupNode(group)) return prevTree

      const updatedTabs = group.tabs.map((tab) => {
        const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

        if (restormTab.tabType === 'folder' && restormTab.folder.id === targetId) {
          return {
            ...restormTab,
            folder: { ...restormTab.folder, tags: newTags }
          }
        }

        if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === targetId) {
          return {
            ...restormTab,
            folder: { ...restormTab.folder, tags: newTags }
          }
        }

        if (restormTab.tabType === 'http-request' && restormTab.request.id === targetId) {
          return {
            ...restormTab,
            request: { ...restormTab.request, tags: newTags }
          }
        }

        return restormTab
      })

      return {
        ...prevTree,
        groups: [{ ...group, tabs: updatedTabs }]
      }
    })
  }, [rootItems, forceUpdate, setWorkbenchTree])

  // Handle folder changes from FolderView
  const handleFolderChange = useCallback((folderId: string, updatedFolder: Folder) => {
    // Find and update the reactive folder directly to preserve proxies
    const reactiveFolder = findItemById(rootItems, folderId)
    if (reactiveFolder && !isEnvironmentFolder(reactiveFolder)) {
      // Update properties on the reactive object (triggers re-indexing)
      const folder = reactiveFolder as Folder
      folder.configuration = updatedFolder.configuration
      if (updatedFolder.notes !== undefined) {
        folder.notes = updatedFolder.notes
      }
      folder.documentation = updatedFolder.documentation
      folder.tags = updatedFolder.tags
      folder.name = updatedFolder.name
    }
    
    // Force React re-render without breaking reactive proxies
    forceUpdate()

    // Update folder data in open workbench tabs (all groups)
    setWorkbenchTree((prevTree) => {
      const updatedGroups = prevTree.groups.map((group) => {
        if (!isTabGroupNode(group)) return group

        const updatedTabs = group.tabs.map((tab) => {
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab
          
          // Update folder tabs
          if (restormTab.tabType === 'folder' && restormTab.folder.id === folderId) {
            return {
              ...restormTab,
              folder: updatedFolder,
              title: updatedFolder.name,
              titleString: updatedFolder.name
            }
          }
          
          return restormTab
        })

        return { ...group, tabs: updatedTabs }
      })

      return {
        ...prevTree,
        groups: updatedGroups
      }
    })
  }, [rootItems, forceUpdate, setWorkbenchTree])

  // Handle environment folder changes from EnvironmentFolderView
  const handleEnvironmentFolderChange = useCallback((folderId: string, updatedFolder: EnvironmentFolder) => {
    // Find and update the reactive folder directly to preserve proxies
    const reactiveFolder = findEnvironmentFolderById(rootItems, folderId)
    if (reactiveFolder) {
      // Update properties on the reactive object (triggers re-indexing)
      reactiveFolder.environments = updatedFolder.environments
      if (updatedFolder.notes !== undefined) {
        reactiveFolder.notes = updatedFolder.notes
      }
      reactiveFolder.documentation = updatedFolder.documentation
      reactiveFolder.tags = updatedFolder.tags
      reactiveFolder.name = updatedFolder.name
    }
    
    // Force React re-render without breaking reactive proxies
    forceUpdate()

    // Update folder data in open workbench tabs (all groups)
    setWorkbenchTree((prevTree) => {
      const updatedGroups = prevTree.groups.map((group) => {
        if (!isTabGroupNode(group)) return group

        const updatedTabs = group.tabs.map((tab) => {
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab
          
          // Update environment folder tabs
          if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === folderId) {
            return {
              ...restormTab,
              folder: updatedFolder,
              title: updatedFolder.name,
              titleString: updatedFolder.name
            }
          }
          
          // Update http-request tabs that belong to this folder (check breadcrumbs)
          if (restormTab.tabType === 'http-request' && restormTab.breadcrumbs) {
            const belongsToFolder = restormTab.breadcrumbs.some(bc => bc.id === folderId)
            if (belongsToFolder) {
              // Recalculate environments for this request
              const newEnvironments = getNearestEnvironmentsForBreadcrumbs(rootItems, restormTab.breadcrumbs)
              return {
                ...restormTab,
                environments: newEnvironments
              }
            }
          }
          
          return restormTab
        })

        return { ...group, tabs: updatedTabs }
      })

      return {
        ...prevTree,
        groups: updatedGroups
      }
    })
  }, [rootItems, forceUpdate, setWorkbenchTree])

  // Handle item rename from breadcrumb
  const handleItemRename = useCallback(
    (item: BreadcrumbItem, newName: string) => {
      // Find and update the reactive object directly (triggers search re-indexing)
      const foundItem = findItemById(rootItems, item.id)
      if (foundItem) {
        foundItem.name = newName
      }

      // Force React re-render
      forceUpdate()

      // Also update the workbench tab title and breadcrumbs
      setWorkbenchTree((prevTree) => {
        const group = prevTree.groups[0]
        if (!group || !isTabGroupNode(group)) return prevTree

        const updatedTabs = group.tabs.map((tab) => {
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

          // Update tab title if it's the renamed item
          if (restormTab.tabType === 'folder' && restormTab.folder.id === item.id) {
            return {
              ...restormTab,
              title: newName,
              titleString: newName,
              folder: { ...restormTab.folder, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === item.id ? { ...bc, label: newName } : bc
              )
            }
          }

          if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === item.id) {
            return {
              ...restormTab,
              title: newName,
              titleString: newName,
              folder: { ...restormTab.folder, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === item.id ? { ...bc, label: newName } : bc
              )
            }
          }

          if (restormTab.tabType === 'http-request' && restormTab.request.id === item.id) {
            const newTitle = `${restormTab.request.method} ${newName}`
            return {
              ...restormTab,
              title: newTitle,
              titleString: newTitle,
              request: { ...restormTab.request, name: newName },
              breadcrumbs: restormTab.breadcrumbs?.map((bc) =>
                bc.id === item.id ? { ...bc, label: newName } : bc
              )
            }
          }

          // Update breadcrumbs for other tabs that might reference this item
          if (restormTab.breadcrumbs) {
            const updatedBreadcrumbs = restormTab.breadcrumbs.map((bc) =>
              bc.id === item.id ? { ...bc, label: newName } : bc
            )
            return { ...restormTab, breadcrumbs: updatedBreadcrumbs }
          }

        return tab
      })

      return {
        ...prevTree,
        groups: [{ ...group, tabs: updatedTabs }]
      }
    })
  },
    [rootItems, forceUpdate, setWorkbenchTree]
  )

  return {
    handleTagsChange,
    handleFolderChange,
    handleEnvironmentFolderChange,
    handleItemRename
  }
}
