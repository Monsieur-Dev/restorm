/**
 * Utility functions for searching items in the folder tree structure
 */

import type {
  Folder,
  FolderItem,
  Environment,
  EnvironmentFolder,
  Request
} from '../../../shared/types/collections'
import { isEnvironmentFolder, isAnyFolder, isRequest } from '../../../shared/types/collections'
import type { BreadcrumbItem } from '../../../shared/types/editor'

/** Folder icon for breadcrumbs */
const FOLDER_ICON = { type: 'codicon' as const, value: 'folder' }
/** Environment folder icon for breadcrumbs */
const ENV_FOLDER_ICON = { type: 'codicon' as const, value: 'folder-library' }

/** Get the appropriate icon for a folder */
export function getFolderIcon(item: Folder | EnvironmentFolder): { type: 'codicon'; value: string } {
  return isEnvironmentFolder(item as FolderItem) ? ENV_FOLDER_ICON : FOLDER_ICON
}

/** Find a folder by ID in a single folder tree (returns Folder or EnvironmentFolder) */
function findFolderByIdInTree(folder: Folder | EnvironmentFolder, id: string): Folder | EnvironmentFolder | undefined {
  if (folder.id === id) return folder
  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      const found = findFolderByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find a folder by ID across multiple root items */
export function findFolderById(rootItems: (EnvironmentFolder | Folder | Request)[], id: string): Folder | EnvironmentFolder | undefined {
  for (const root of rootItems) {
    // Skip if root is a Request (has no folder tree)
    if (!('items' in root)) continue
    const found = findFolderByIdInTree(root, id)
    if (found) return found
  }
  return undefined
}

/** Find an environment folder by ID in a single folder tree */
function findEnvironmentFolderByIdInTree(folder: Folder | EnvironmentFolder, id: string): EnvironmentFolder | undefined {
  if (isEnvironmentFolder(folder as FolderItem) && folder.id === id) return folder as EnvironmentFolder
  for (const item of folder.items) {
    if (isEnvironmentFolder(item)) {
      if (item.id === id) return item
      const found = findEnvironmentFolderByIdInTree(item, id)
      if (found) return found
    } else if (isAnyFolder(item)) {
      const found = findEnvironmentFolderByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find an environment folder by ID across multiple root folders */
export function findEnvironmentFolderById(rootItems: (EnvironmentFolder | Folder | Request)[], id: string): EnvironmentFolder | undefined {
  for (const root of rootItems) {
    // Skip if root is a Request (has no folder tree)
    if (!('items' in root)) continue
    const found = findEnvironmentFolderByIdInTree(root, id)
    if (found) return found
  }
  return undefined
}

/** Find any request by ID in a single folder tree */
function findRequestByIdInTree(folder: Folder | EnvironmentFolder, id: string): Request | undefined {
  for (const item of folder.items) {
    if (isRequest(item) && item.id === id) return item
    if (isAnyFolder(item)) {
      const found = findRequestByIdInTree(item, id)
      if (found) return found
    }
  }
  return undefined
}

/** Find any request by ID across multiple root folders */
export function findRequestById(rootItems: (EnvironmentFolder | Folder | Request)[], id: string): Request | undefined {
  for (const root of rootItems) {
    // Check if root itself is the Request we're looking for
    if (!('items' in root) && root.id === id) {
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

/** Find any item (folder or request) by ID in a single folder tree */
function findItemByIdInTree(folder: Folder | EnvironmentFolder, id: string): FolderItem | null {
  if (folder.id === id) return folder
  for (const item of folder.items) {
    if (item.id === id) return item
    if (isAnyFolder(item)) {
      const found = findItemByIdInTree(item, id)
      if (found) return found
    }
  }
  return null
}

/** Find any item (folder or request) by ID across multiple root folders */
export function findItemById(rootItems: (EnvironmentFolder | Folder | Request)[], id: string): FolderItem | null {
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
  folder: Folder | EnvironmentFolder,
  id: string,
  path: BreadcrumbItem[] = []
): { item: FolderItem | null; breadcrumbs: BreadcrumbItem[] } {
  // Check if the root folder itself matches the ID
  if (folder.id === id) {
    return { item: folder, breadcrumbs: [...path, { id: folder.id, label: folder.name, icon: getFolderIcon(folder) }] }
  }

  const currentPath = [...path, { id: folder.id, label: folder.name, icon: getFolderIcon(folder) }]

  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      if (item.id === id) {
        // Include the folder itself as the last breadcrumb (with appropriate icon)
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name, icon: getFolderIcon(item) }] }
      }
      const found = findItemWithBreadcrumbsInTree(item, id, currentPath)
      if (found.item) return found
    } else if (isRequest(item)) {
      if (item.id === id) {
        // Include the request itself as the last breadcrumb (no folder icon)
        return { item, breadcrumbs: [...currentPath, { id: item.id, label: item.name }] }
      }
    }
  }

  return { item: null, breadcrumbs: [] }
}

/** Find an item (folder or request) by ID and build breadcrumbs including the item itself - across multiple root folders */
export function findItemWithBreadcrumbs(
  rootItems: (EnvironmentFolder | Folder | Request)[],
  id: string
): { item: FolderItem | null; breadcrumbs: BreadcrumbItem[] } {
  for (const root of rootItems) {
    // Check if root itself is the item (for root-level Requests)
    if (root.id === id) {
      // Convert icon to BreadcrumbIcon compatible format
      const icon = root.icon && (root.icon.type === 'codicon' || root.icon.type === 'emoji' || root.icon.type === 'none')
        ? { type: root.icon.type, value: root.icon.value }
        : null
      
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
  rootItems: (EnvironmentFolder | Folder | Request)[],
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
  folder: Folder | EnvironmentFolder,
  targetId: string,
  parent: Folder | EnvironmentFolder | null = null
): { item: FolderItem | null; parent: Folder | EnvironmentFolder | null; index: number } {
  // Check if the folder itself is the target (but it can't be moved if it's the root)
  if (folder.id === targetId) {
    return { item: folder, parent, index: -1 }
  }

  for (let i = 0; i < folder.items.length; i++) {
    const item = folder.items[i]
    if (item === undefined) continue
    if (item.id === targetId) {
      return { item, parent: folder, index: i }
    }
    if (isAnyFolder(item)) {
      const found = findItemWithParentInTree(item, targetId, item)
      if (found.item) return found
    }
  }

  return { item: null, parent: null, index: -1 }
}

/** Find an item and its parent folder across multiple root folders */
export function findItemWithParent(
  rootItems: (EnvironmentFolder | Folder | Request)[],
  targetId: string
): { item: FolderItem | null; parent: Folder | EnvironmentFolder | null; index: number; rootFolder: EnvironmentFolder | Folder | null } {
  // Check if any root item is directly the target (for root-level Requests)
  const rootIndex = rootItems.findIndex(root => root.id === targetId)
  if (rootIndex !== -1) {
    const item = rootItems[rootIndex]
    if (item) {
      return { item, parent: null, index: rootIndex, rootFolder: null }
    }
  }
  
  // Otherwise search in folder trees
  for (const root of rootItems) {
    if (!('items' in root)) continue
    const found = findItemWithParentInTree(root, targetId)
    if (found.item) return { ...found, rootFolder: root }
  }
  return { item: null, parent: null, index: -1, rootFolder: null }
}
