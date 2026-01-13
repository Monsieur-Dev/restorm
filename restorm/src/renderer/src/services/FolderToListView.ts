/**
 * Utility to convert Folder structure to ListView items
 */

import type { ListViewItemData } from 'electron-core-ui/renderer'
import type { Folder, FolderItem, HTTPRequest, EnvironmentFolder, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest } from '../types/collections'
import { isFolder, isRequest, isHTTPRequest, isEnvironmentFolder, isAnyFolder, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest } from '../types/collections'
import React, { type ReactNode } from 'react'

export interface FolderToListViewOptions {
  /** Set of expanded item IDs */
  expandedIds: Set<string>
  /** Function to render HTTP method badge as leftActions */
  renderMethodBadge: (method: string) => ReactNode
  /** Function to render protocol badge as leftActions */
  renderProtocolBadge?: (protocol: string, label?: string) => ReactNode
  /** Function to render deprecated request title (with strikethrough) */
  renderDeprecatedTitle?: (name: string) => ReactNode
}

function withInlineBadge(title: ReactNode, badge: ReactNode | undefined): ReactNode {
  if (!badge) return title
  return React.createElement(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0
      }
    },
    React.createElement('span', { style: { flex: '0 0 auto' } }, badge),
    React.createElement('span', { style: { minWidth: 0 } }, title)
  )
}

/**
 * Convert an HTTPRequest to a ListViewItemData
 */
function httpRequestToListViewItem(
  request: HTTPRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  // Render title with strikethrough if deprecated
  const title = request.deprecated && options.renderDeprecatedTitle
    ? options.renderDeprecatedTitle(request.name)
    : request.name

  return {
    id: request.id,
    title: withInlineBadge(title, options.renderMethodBadge(request.method)),
    icon: undefined,
    leftActions: undefined
  }
}

/**
 * Convert a GraphQLRequest to a ListViewItemData
 */
function graphqlRequestToListViewItem(
  request: GraphQLRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.(request.operationType)
  return {
    id: request.id,
    title: withInlineBadge(request.name, badge),
    icon: undefined,
    leftActions: undefined
  }
}

/**
 * Convert a GrpcRequest to a ListViewItemData
 */
function grpcRequestToListViewItem(
  request: GrpcRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.(request.callType)
  return {
    id: request.id,
    title: withInlineBadge(request.name, badge),
    icon: undefined,
    leftActions: undefined
  }
}

/**
 * Convert a SoapRequest to a ListViewItemData
 */
function soapRequestToListViewItem(
  request: SoapRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.('soap')
  return {
    id: request.id,
    title: withInlineBadge(request.name, badge),
    icon: undefined,
    leftActions: undefined
  }
}

/**
 * Convert a WebSocketRequest to a ListViewItemData
 */
function websocketRequestToListViewItem(
  request: WebSocketRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.(request.protocol)
  return {
    id: request.id,
    title: withInlineBadge(request.name, badge),
    icon: undefined,
    leftActions: undefined
  }
}

/**
 * Convert a FolderItem (Folder, EnvironmentFolder, or Request) to ListViewItemData
 */
function folderItemToListViewItem(
  item: FolderItem,
  options: FolderToListViewOptions
): ListViewItemData {
  if (isRequest(item)) {
    if (isHTTPRequest(item)) {
      return httpRequestToListViewItem(item, options)
    }
    if (isGraphQLRequest(item)) {
      return graphqlRequestToListViewItem(item, options)
    }
    if (isGrpcRequest(item)) {
      return grpcRequestToListViewItem(item, options)
    }
    if (isSoapRequest(item)) {
      return soapRequestToListViewItem(item, options)
    }
    if (isWebSocketRequest(item)) {
      return websocketRequestToListViewItem(item, options)
    }
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
