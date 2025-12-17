/**
 * Utility to convert Folder structure to ListView items
 */

import type { ListViewItemData } from 'electron-core-ui/renderer'
import type { Folder, FolderItem, HTTPRequest, EnvironmentFolder } from '../types/collections'
import { isFolder, isRequest, isHTTPRequest, isEnvironmentFolder, isAnyFolder } from '../types/collections'
import type { ReactNode } from 'react'

export interface FolderToListViewOptions {
  /** Set of expanded item IDs */
  expandedIds: Set<string>
  /** Function to render HTTP method badge as leftActions */
  renderMethodBadge: (method: string) => ReactNode
}

/**
 * Convert an HTTPRequest to a ListViewItemData
 */
function requestToListViewItem(
  request: HTTPRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  return {
    id: request.id,
    title: request.name,
    icon: undefined,
    leftActions: options.renderMethodBadge(request.method)
  }
}

/**
 * Convert a FolderItem (Folder, EnvironmentFolder, or Request) to ListViewItemData
 */
function folderItemToListViewItem(
  item: FolderItem,
  options: FolderToListViewOptions
): ListViewItemData {
  if (isRequest(item) && isHTTPRequest(item)) {
    return requestToListViewItem(item, options)
  }

  if (isEnvironmentFolder(item)) {
    return environmentFolderToListViewItem(item, options)
  }

  if (isFolder(item)) {
    return folderToListViewItem(item, options)
  }

  // Fallback for unknown types
  return {
    id: (item as { id?: string }).id ?? crypto.randomUUID(),
    title: (item as { name?: string }).name ?? 'Unknown',
    icon: 'blank'
  }
}

/**
 * Convert an EnvironmentFolder to a ListViewItemData
 */
function environmentFolderToListViewItem(
  folder: EnvironmentFolder,
  options: FolderToListViewOptions
): ListViewItemData {
  const isExpanded = options.expandedIds.has(folder.id)

  return {
    id: folder.id,
    title: folder.name,
    isExpandable: true,
    isExpanded,
    // Use folder-library icon for environment folders
    icon: 'folder-library',
    children: folder.items.map((item) => folderItemToListViewItem(item, options))
  }
}

/**
 * Convert a Folder to a ListViewItemData
 */
function folderToListViewItem(
  folder: Folder,
  options: FolderToListViewOptions
): ListViewItemData {
  const isExpanded = options.expandedIds.has(folder.id)

  return {
    id: folder.id,
    title: folder.name,
    isExpandable: true,
    isExpanded,
    icon: isExpanded ? 'folder-opened' : 'folder',
    children: folder.items.map((item) => folderItemToListViewItem(item, options))
  }
}

/**
 * Convert a root Folder or EnvironmentFolder to an array of ListViewItemData
 * Returns the folder's children as top-level items
 */
export function folderToListViewItems(
  folder: Folder | EnvironmentFolder,
  options: FolderToListViewOptions
): ListViewItemData[] {
  return folder.items.map((item) => folderItemToListViewItem(item, options))
}

/**
 * Convert a root Folder or EnvironmentFolder to a single ListViewItemData (the folder itself as root)
 */
export function folderAsRootListViewItem(
  folder: Folder | EnvironmentFolder,
  options: FolderToListViewOptions
): ListViewItemData {
  if (isEnvironmentFolder(folder as FolderItem)) {
    return environmentFolderToListViewItem(folder as EnvironmentFolder, options)
  }
  return folderToListViewItem(folder, options)
}

/**
 * Collect all folder IDs from a Folder or EnvironmentFolder tree (for expanding all)
 */
export function collectAllFolderIds(folder: Folder | EnvironmentFolder): string[] {
  const ids: string[] = [folder.id]

  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      ids.push(...collectAllFolderIds(item))
    }
  }

  return ids
}
