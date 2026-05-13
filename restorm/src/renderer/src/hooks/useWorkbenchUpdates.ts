/**
 * Hook for managing workbench updates (tags, folders, environment folders)
 */

import React, { useCallback, useState } from 'react'
import { isContainerNode, isTabGroupNode } from 'electron-core-ui/renderer'
import type { EditorTab, GroupNode, WorkbenchTree } from 'electron-core-ui/renderer'

/**
 * Walk every tab in the workbench tree (including ones nested in
 * container groups from split-pane layouts) and run `mapTab` on each.
 * Returns a new groups array with the transformed tabs.
 *
 * The original handlers in this file used `prev.groups.map(...)` which
 * only touched the top-level groups — any tab inside a split-pane
 * container was silently skipped, so e.g. a tag-color change emitted
 * no contentVersion bump for tabs nested below a horizontal/vertical
 * split. The visible symptom: bookmark ribbons kept the old color
 * until a full file reopen rebuilt the workbench from scratch.
 */
function mapAllTabs(
  groups: readonly GroupNode[],
  mapTab: (tab: EditorTab) => EditorTab
): GroupNode[] {
  return groups.map((g) => {
    if (isContainerNode(g)) return { ...g, groups: mapAllTabs(g.groups, mapTab) }
    if (isTabGroupNode(g)) return { ...g, tabs: g.tabs.map(mapTab) }
    return g
  })
}
import type { Icon } from 'electron-core-ui/types'
import type { Folder, EnvironmentFolder, Request } from '../../../shared/types/collections'
import { isEnvironmentFolder } from '../../../shared/types/collections'
import { findItemById, findEnvironmentFolderById, getNearestEnvironmentsForBreadcrumbs, getFolderIcon } from '../utils/treeSearch'
import { isAnyFolder } from '../../../shared/types/collections'
import type { FolderTab, EnvironmentFolderTab, HTTPRequestTab, BreadcrumbItem } from '../../../shared/types/editor'

export interface UseWorkbenchUpdatesOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  setWorkbenchTree: React.Dispatch<React.SetStateAction<WorkbenchTree>>
}

export interface UseWorkbenchUpdatesReturn {
  handleTagsChange: (targetId: string, newTags: string[]) => void
  handleTagColorChange: (envFolderId: string, tag: string, color: string | null) => void
  handleFolderChange: (folderId: string, updatedFolder: Folder) => void
  handleEnvironmentFolderChange: (folderId: string, updatedFolder: EnvironmentFolder) => void
  handleItemRename: (item: BreadcrumbItem, newName: string) => void
  handleItemIconChange: (item: BreadcrumbItem, newIcon: Icon | null) => void
  /** Counter incremented on each in-place mutation, useful as a useMemo dependency */
  updateCount: number
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

    // Update tags in open workbench tabs (all groups, including nested
    // split-pane containers — see `mapAllTabs` for the rationale).
    setWorkbenchTree((prevTree) => {
      const updatedGroups = mapAllTabs(prevTree.groups, (tab) => {
        const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

          if (restormTab.tabType === 'folder' && restormTab.folder.id === targetId) {
            return {
              ...restormTab,
              folder: { ...restormTab.folder, tags: newTags },
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === targetId) {
            return {
              ...restormTab,
              folder: { ...restormTab.folder, tags: newTags },
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          if ('request' in restormTab && restormTab.request.id === targetId) {
            return {
              ...restormTab,
              request: { ...restormTab.request, tags: newTags },
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          return restormTab
      })

      return {
        ...prevTree,
        groups: updatedGroups
      }
    })
  }, [rootItems, forceUpdate, setWorkbenchTree])

  // Handle tag color changes (update tagColors on the parent EnvironmentFolder)
  const handleTagColorChange = useCallback((envFolderId: string, tag: string, color: string | null) => {
    const folder = findEnvironmentFolderById(rootItems, envFolderId)
    if (!folder) return

    const newTagColors = { ...folder.tagColors }
    if (color === null) {
      Reflect.deleteProperty(newTagColors, tag)
    } else {
      newTagColors[tag] = color
    }
    folder.tagColors = newTagColors

    forceUpdate()

    // Update workbench tabs that display this folder or its children
    // (recursing into split-pane containers via `mapAllTabs`).
    setWorkbenchTree((prevTree) => {
      const updatedGroups = mapAllTabs(prevTree.groups, (tab) => {
        const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab
        // Bump contentVersion on the env folder tab itself
        if (restormTab.tabType === 'environment-folder' && restormTab.folder.id === envFolderId) {
          return { ...restormTab, contentVersion: (restormTab.contentVersion ?? 0) + 1 }
        }
        // Bump contentVersion on any request tab that belongs to this folder
        if ('request' in restormTab && restormTab.breadcrumbs?.some(bc => bc.id === envFolderId)) {
          return { ...restormTab, contentVersion: (restormTab.contentVersion ?? 0) + 1 }
        }
        return restormTab
      })
      return { ...prevTree, groups: updatedGroups }
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

    // Update folder data in open workbench tabs (all groups, including
    // nested split-pane containers).
    setWorkbenchTree((prevTree) => {
      const updatedGroups = mapAllTabs(prevTree.groups, (tab) => {
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
      const updatedGroups = mapAllTabs(prevTree.groups, (tab) => {
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

        // Update any request tabs that belong to this folder (check breadcrumbs)
        if ('request' in restormTab && restormTab.breadcrumbs) {
          const belongsToFolder = restormTab.breadcrumbs.some(bc => bc.id === folderId)
          if (belongsToFolder) {
            // Recalculate environments for this request (shallow clone to trigger re-render)
            const newEnvironments = getNearestEnvironmentsForBreadcrumbs(rootItems, restormTab.breadcrumbs)
              .map(env => ({ ...env }))
            return {
              ...restormTab,
              environments: newEnvironments,
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }
        }

        return restormTab
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

      // Also update the workbench tab title and breadcrumbs (all groups)
      setWorkbenchTree((prevTree) => {
        const updatedGroups = mapAllTabs(prevTree.groups, (tab) => {
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
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
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
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
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
              ),
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          // Update breadcrumbs for other tabs that might reference this item
          if (restormTab.breadcrumbs) {
            const hasMatch = restormTab.breadcrumbs.some((bc) => bc.id === item.id)
            if (hasMatch) {
              const updatedBreadcrumbs = restormTab.breadcrumbs.map((bc) =>
                bc.id === item.id ? { ...bc, label: newName } : bc
              )
              return { ...restormTab, breadcrumbs: updatedBreadcrumbs, contentVersion: (restormTab.contentVersion ?? 0) + 1 }
            }
          }

          return tab
        })

        return { ...prevTree, groups: updatedGroups }
      })
  },
    [rootItems, forceUpdate, setWorkbenchTree]
  )

  const handleItemIconChange = useCallback(
    (item: BreadcrumbItem, newIcon: Icon | null) => {
      const foundItem = findItemById(rootItems, item.id)

      // When clearing (null), reset to default icon for folders
      let effectiveIcon = newIcon
      if (!effectiveIcon && foundItem && isAnyFolder(foundItem)) {
        delete foundItem.icon
        effectiveIcon = getFolderIcon(foundItem)
      } else if (foundItem) {
        if (effectiveIcon) {
          foundItem.icon = effectiveIcon
        } else {
          delete foundItem.icon
        }
      }

      forceUpdate()

      // Also update breadcrumbs in the workbench tree (all groups)
      setWorkbenchTree((prevTree) => {
        const updatedGroups = mapAllTabs(prevTree.groups, (tab) => {
          const restormTab = tab as FolderTab | EnvironmentFolderTab | HTTPRequestTab

          // Update folder icon + breadcrumbs for the affected tab
          if ((restormTab.tabType === 'folder' || restormTab.tabType === 'environment-folder') && restormTab.folder.id === item.id && effectiveIcon) {
            const updatedBreadcrumbs = restormTab.breadcrumbs?.map((bc) =>
              bc.id === item.id ? { ...bc, icon: effectiveIcon } : bc
            )
            return {
              ...restormTab,
              folder: { ...restormTab.folder, icon: effectiveIcon },
              breadcrumbs: updatedBreadcrumbs,
              contentVersion: (restormTab.contentVersion ?? 0) + 1
            }
          }

          // Update breadcrumbs for tabs that reference this item (e.g. child tabs)
          if (restormTab.breadcrumbs) {
            const hasMatch = restormTab.breadcrumbs.some((bc) => bc.id === item.id)
            if (hasMatch) {
              const updatedBreadcrumbs = restormTab.breadcrumbs.map((bc) =>
                bc.id === item.id ? { ...bc, icon: effectiveIcon } : bc
              )
              return {
                ...restormTab,
                breadcrumbs: updatedBreadcrumbs,
                contentVersion: (restormTab.contentVersion ?? 0) + 1
              }
            }
          }
          return tab
        })

        return { ...prevTree, groups: updatedGroups }
      })
    },
    [rootItems, forceUpdate, setWorkbenchTree]
  )

  return {
    handleTagsChange,
    handleTagColorChange,
    handleFolderChange,
    handleEnvironmentFolderChange,
    handleItemRename,
    handleItemIconChange,
    updateCount: _updateCount
  }
}
