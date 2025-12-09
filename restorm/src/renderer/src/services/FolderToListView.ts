/**
 * Utility to convert Folder structure to ListView items
 */

import type { ListViewItemData } from 'electron-core-ui/renderer'
import type { Folder, FolderItem, HTTPRequest } from '../types/collections'
import { isFolder, isRequest, isHTTPRequest } from '../types/collections'
import type { ReactNode } from 'react'

export interface FolderToListViewOptions {
  /** Set of expanded item IDs */
  expandedIds: Set<string>
  /** Function to render HTTP method badge */
  renderMethodBadge: (method: string, name: string) => ReactNode
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
    title: options.renderMethodBadge(request.method, request.name),
    icon: 'blank'
  }
}

/**
 * Convert a FolderItem (Folder or Request) to ListViewItemData
 */
function folderItemToListViewItem(
  item: FolderItem,
  options: FolderToListViewOptions
): ListViewItemData {
  if (isRequest(item) && isHTTPRequest(item)) {
    return requestToListViewItem(item, options)
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
 * Convert a root Folder to an array of ListViewItemData
 * Returns the folder's children as top-level items
 */
export function folderToListViewItems(
  folder: Folder,
  options: FolderToListViewOptions
): ListViewItemData[] {
  return folder.items.map((item) => folderItemToListViewItem(item, options))
}

/**
 * Convert a root Folder to a single ListViewItemData (the folder itself as root)
 */
export function folderAsRootListViewItem(
  folder: Folder,
  options: FolderToListViewOptions
): ListViewItemData {
  return folderToListViewItem(folder, options)
}

/**
 * Collect all folder IDs from a Folder tree (for expanding all)
 */
export function collectAllFolderIds(folder: Folder): string[] {
  const ids: string[] = [folder.id]

  for (const item of folder.items) {
    if (isFolder(item)) {
      ids.push(...collectAllFolderIds(item))
    }
  }

  return ids
}

