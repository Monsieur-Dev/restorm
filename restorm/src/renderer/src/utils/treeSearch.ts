/**
 * Utility functions for searching items in the folder tree structure
 */

import type {
  Folder,
  FolderItem,
  Environment,
  EnvironmentFolder,
  Request,
  Scenario,
  ApiDesign
} from '../../../shared/types/collections'
import { isEnvironmentFolder, isAnyFolder, isRequest, isScenario, isApiDesign } from '../../../shared/types/collections'
import type { Icon } from 'electron-core-ui/types'
import type { BreadcrumbItem } from '../../../shared/types/editor'

/** Folder icon for breadcrumbs */
const FOLDER_ICON: Icon = { type: 'codicon', value: 'folder' }
/** Environment folder icon for breadcrumbs */
const ENV_FOLDER_ICON: Icon = { type: 'codicon', value: 'folder-library' }
/** Scenario icon for breadcrumbs (scenarios double as containers). */
const SCENARIO_ICON: Icon = { type: 'codicon', value: 'circuit-board' }

/**
 * A descendable tree node: anything that carries child `items`. Scenarios now
 * double as folder-like containers, so the tree walkers recurse through them
 * (a request/sub-folder authored inside a scenario must be findable +
 * navigable) — even though a scenario is never itself returned as a folder.
 */
type TreeContainer = Folder | EnvironmentFolder | Scenario

/** Children of any container (a scenario's `items` is optional → treat as []). */
function childItemsOf(container: TreeContainer): FolderItem[] {
  return (container as { items?: FolderItem[] }).items ?? []
}

/** Whether a tree item can be descended into (folder, env-folder, or scenario). */
function isContainer(item: FolderItem): item is TreeContainer {
  return isAnyFolder(item) || isScenario(item)
}

/** Breadcrumb icon for a container node. */
function getContainerIcon(item: TreeContainer): Icon {
  return isScenario(item) ? SCENARIO_ICON : getFolderIcon(item)
}

/** Get the appropriate icon for a folder (custom icon if set, otherwise default) */
export function getFolderIcon(item: Folder | EnvironmentFolder): Icon {
  if (item.icon && item.icon.type !== 'none') return item.icon
  return isEnvironmentFolder(item as FolderItem) ? ENV_FOLDER_ICON : FOLDER_ICON
}

/** Find a folder by ID in a single tree (returns Folder or EnvironmentFolder;
 * descends scenarios but never returns one as a folder). */
function findFolderByIdInTree(container: TreeContainer, id: string): Folder | EnvironmentFolder | undefined {
  // Return any folder/env-folder match (a scenario is a container we descend
  // but never a folder); `!isScenario` rather than `isAnyFolder` so a folder
  // missing its `configuration` field is still returned, matching prior behavior.
  if (!isScenario(container) && container.id === id) return container
  for (const item of childItemsOf(container)) {
    if (isContainer(item)) {
      const found = findFolderByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find a folder by ID across multiple root items */
export function findFolderById(rootItems: FolderItem[], id: string): Folder | EnvironmentFolder | undefined {
  for (const root of rootItems) {
    // Skip if root is a Request (has no folder tree)
    if (!('items' in root)) continue
    const found = findFolderByIdInTree(root, id)
    if (found) return found
  }
  return undefined
}

/** Find an environment folder by ID in a single tree (descends scenarios). */
function findEnvironmentFolderByIdInTree(container: TreeContainer, id: string): EnvironmentFolder | undefined {
  if (isEnvironmentFolder(container as FolderItem) && container.id === id) return container as EnvironmentFolder
  for (const item of childItemsOf(container)) {
    if (isEnvironmentFolder(item)) {
      if (item.id === id) return item
      const found = findEnvironmentFolderByIdInTree(item, id)
      if (found) return found
    } else if (isContainer(item)) {
      const found = findEnvironmentFolderByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find an environment folder by ID across multiple root folders */
export function findEnvironmentFolderById(rootItems: FolderItem[], id: string): EnvironmentFolder | undefined {
  for (const root of rootItems) {
    // Skip if root is a Request (has no folder tree)
    if (!('items' in root)) continue
    const found = findEnvironmentFolderByIdInTree(root, id)
    if (found) return found
  }
  return undefined
}

/** Find a scenario by ID in a single tree (scenarios can nest other scenarios). */
function findScenarioByIdInTree(container: TreeContainer, id: string): Scenario | undefined {
  if (isScenario(container) && container.id === id) return container
  for (const item of childItemsOf(container)) {
    if (isScenario(item) && item.id === id) return item
    if (isContainer(item)) {
      const found = findScenarioByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find a scenario by ID across multiple root folders. The workbench uses this
 * to re-fetch the live scenario from `rootItems` instead of rendering the tab's
 * stale snapshot — so edits (renamed variables, added ports) reach the editor
 * even after a hard refresh restores the tab from a disconnected copy. */
export function findScenarioById(rootItems: FolderItem[], id: string): Scenario | undefined {
  for (const root of rootItems) {
    if (isScenario(root) && root.id === id) return root
    if ('items' in root) {
      const found = findScenarioByIdInTree(root, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find any request by ID in a single tree (descends scenarios). */
function findRequestByIdInTree(container: TreeContainer, id: string): Request | undefined {
  for (const item of childItemsOf(container)) {
    if (isRequest(item) && item.id === id) return item
    if (isContainer(item)) {
      const found = findRequestByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find any request by ID across multiple root folders */
export function findRequestById(rootItems: FolderItem[], id: string): Request | undefined {
  for (const root of rootItems) {
    // Check if root itself is the Request we're looking for (a Scenario
    // is also a childless root item, so guard on isRequest).
    if (isRequest(root) && root.id === id) {
      return root
    }
    // Otherwise search in folder tree
    if ('items' in root) {
      const found = findRequestByIdInTree(root, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find any item (folder, request, or scenario) by ID in a single tree. */
function findItemByIdInTree(container: TreeContainer, id: string): FolderItem | null {
  if (container.id === id) return container
  for (const item of childItemsOf(container)) {
    if (item.id === id) return item
    if (isContainer(item)) {
      const found = findItemByIdInTree(item, id)
      if (found) return found
    }
  }
  return null
}

/** Find any item (folder or request) by ID across multiple root folders */
/** Find a design anywhere in the tree by its id. */
export function findDesignById(rootItems: FolderItem[], id: string): ApiDesign | undefined {
  const item = findItemById(rootItems, id)
  return item !== null && isApiDesign(item) ? item : undefined
}

export function findItemById(rootItems: FolderItem[], id: string): FolderItem | null {
  for (const root of rootItems) {
    // Check if root itself is the item we're looking for
    if (root.id === id) {
      return root
    }
    // Otherwise search in folder tree if root has items
    if ('items' in root) {
      const found = findItemByIdInTree(root, id)
      if (found) return found
    }
  }
  return null
}

/** Find an item (folder or request) by ID and build breadcrumbs including the item itself - in a single tree */
function findItemWithBreadcrumbsInTree(
  container: TreeContainer,
  id: string,
  path: BreadcrumbItem[] = []
): { item: FolderItem | null; breadcrumbs: BreadcrumbItem[] } {
  // Check if the container itself matches the ID
  if (container.id === id) {
    return { item: container, breadcrumbs: [...path, { id: container.id, label: container.name, icon: getContainerIcon(container) }] }
  }

  const currentPath = [...path, { id: container.id, label: container.name, icon: getContainerIcon(container) }]

  for (const item of childItemsOf(container)) {
    if (isContainer(item)) {
      // A container (folder / env-folder / scenario) — it can be the target and
      // also be descended into (a scenario holds children).
      if (item.id === id) {
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name, icon: getContainerIcon(item) }] }
      }
      const found = findItemWithBreadcrumbsInTree(item, id, currentPath)
      if (found.item) return found
    } else if (isRequest(item)) {
      if (item.id === id) {
        // Leaf request — last breadcrumb, no icon.
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name, icon: null }] }
      }
    } else if (isApiDesign(item)) {
      // An API design's section rows are virtual, so it's a childless leaf
      // in the data tree — found like a request (without this branch a nested
      // design resolves to null and the sidebar click never opens its tab).
      if (item.id === id) {
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name, icon: null }] }
      }
    }
  }

  return { item: null, breadcrumbs: [] }
}

/** Find an item (folder or request) by ID and build breadcrumbs including the item itself - across multiple root folders */
export function findItemWithBreadcrumbs(
  rootItems: FolderItem[],
  id: string
): { item: FolderItem | null; breadcrumbs: BreadcrumbItem[] } {
  for (const root of rootItems) {
    // Check if root itself is the item (for root-level Requests)
    if (root.id === id) {
      // Folders get their icon (custom or default), requests get null (no IconSelect)
      const icon = isAnyFolder(root) ? getFolderIcon(root) : null

      const breadcrumbs: BreadcrumbItem[] = [
        {
          id: root.id,
          label: root.name,
          icon
        }
      ]
      return { item: root, breadcrumbs }
    }
    // Otherwise search in folder tree
    if ('items' in root) {
      const found = findItemWithBreadcrumbsInTree(root, id)
      if (found.item) return found
    }
  }
  return { item: null, breadcrumbs: [] }
}

/** Get environments from the nearest ancestor EnvironmentFolder */
export function getNearestEnvironmentsForBreadcrumbs(
  rootItems: FolderItem[],
  breadcrumbs: BreadcrumbItem[]
): Environment[] {
  if (breadcrumbs.length === 0) {
    return []
  }

  // The last breadcrumb is the item itself (request or folder),
  // so we start from its parent and go up
  for (let i = breadcrumbs.length - 2; i >= 0; i -= 1) {
    const folderId = breadcrumbs[i]?.id
    if (!folderId) {
      continue
    }
    const folder = findFolderById(rootItems, folderId)
    if (folder && isEnvironmentFolder(folder as FolderItem)) {
      const envFolder = folder as EnvironmentFolder
      if (envFolder.environments.length > 0) {
        return envFolder.environments
      }
    }
  }

  return []
}

/** Find an item and its parent folder in a single tree */
function findItemWithParentInTree(
  container: TreeContainer,
  targetId: string,
  parent: TreeContainer | null = null
): { item: FolderItem | null; parent: TreeContainer | null; index: number } {
  // Check if the container itself is the target (but it can't be moved if it's the root)
  if (container.id === targetId) {
    return { item: container, parent, index: -1 }
  }

  const items = childItemsOf(container)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item === undefined) continue
    if (item.id === targetId) {
      return { item, parent: container, index: i }
    }
    if (isContainer(item)) {
      const found = findItemWithParentInTree(item, targetId, item)
      if (found.item) return found
    }
  }

  return { item: null, parent: null, index: -1 }
}

/** Find an item and its parent folder across multiple root folders */
export function findItemWithParent(
  rootItems: FolderItem[],
  targetId: string
): { item: FolderItem | null; parent: TreeContainer | null; index: number; rootFolder: TreeContainer | null } {
  // Check if any root item is directly the target (for root-level Requests)
  const rootIndex = rootItems.findIndex(root => root.id === targetId)
  if (rootIndex !== -1) {
    const item = rootItems[rootIndex]
    if (item) {
      return { item, parent: null, index: rootIndex, rootFolder: null }
    }
  }

  // Otherwise search in trees (the inner walk descends scenarios as containers
  // too). Keep the loose `'items' in root` gate (not `isContainer`) so a root
  // folder missing a `configuration` field is still descended.
  for (const root of rootItems) {
    if (!('items' in root)) continue
    const found = findItemWithParentInTree(root, targetId)
    if (found.item) return { ...found, rootFolder: root }
  }
  return { item: null, parent: null, index: -1, rootFolder: null }
}
