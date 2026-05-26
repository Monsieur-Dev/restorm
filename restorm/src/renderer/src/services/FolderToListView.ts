/**
 * Utility to convert Folder structure to ListView items
 */

import type { ListViewItemData } from 'electron-core-ui/renderer'
import { IconView } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'
import type { Folder, FolderItem, HTTPRequest, EnvironmentFolder, GraphQLRequest, GrpcRequest, SoapRequest, WebSocketRequest, ODataRequest, AuthenticationRequest, Scenario } from '../../../shared/types/collections'
import { isFolder, isRequest, isHTTPRequest, isEnvironmentFolder, isAnyFolder, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isODataRequest, isAuthenticationRequest, isScenario } from '../../../shared/types/collections'
import React, { type ReactNode } from 'react'

/** Convert an Icon to a ListView-compatible icon (string for codicons, ReactNode for others) */
function toListViewIcon(icon: Icon | undefined, fallback: string): string | ReactNode {
  if (!icon || icon.type === 'none') return fallback
  if (icon.type === 'codicon') return icon.value
  return React.createElement(IconView, { icon, size: 16 })
}

export interface FolderToListViewOptions {
  /** Set of expanded item IDs */
  expandedIds: Set<string>
  /** Function to render HTTP method badge as leftActions */
  renderMethodBadge: (method: string) => ReactNode
  /** Function to render protocol badge as leftActions */
  renderProtocolBadge?: (protocol: string, label?: string) => ReactNode
  /** Function to render removed-from-spec request title — strikethrough. */
  renderRemovedTitle?: (name: string) => ReactNode
  /** Set of request ids whose URL resolves to a deprecated operation
   * in the owning env folder's apiDocumentation. Both the title and
   * the method badge get wrapped in a `opacity: 0.5` span so the
   * whole row reads as dimmed, while the row stays selectable +
   * executable. The check rides on the live matcher (see
   * `useDeprecatedRequestIds`); editing a URL re-evaluates the row
   * instantly. */
  deprecatedRequestIds?: ReadonlySet<string>
}

const DEPRECATED_DIM_STYLE: React.CSSProperties = { opacity: 0.5 }
const DEPRECATED_DIM_TITLE = 'Deprecated in source spec'

function dimNode(node: ReactNode): ReactNode {
  return React.createElement('span', { style: DEPRECATED_DIM_STYLE, title: DEPRECATED_DIM_TITLE }, node)
}

/**
 * Wrap title + icon in dimming spans when the request id is in the
 * deprecated set. We dim BOTH so the method badge fades alongside
 * the name — a row halfway dimmed reads as "something's wrong with
 * the badge" rather than "this whole route is deprecated".
 */
function applyDeprecatedDimming(
  request: { id: string; name: string },
  options: FolderToListViewOptions,
  baseTitle: ReactNode,
  baseIcon: ReactNode
): { title: ReactNode; icon: ReactNode } {
  if (options.deprecatedRequestIds?.has(request.id) === true) {
    return { title: dimNode(baseTitle), icon: dimNode(baseIcon) }
  }
  return { title: baseTitle, icon: baseIcon }
}

/**
 * Convert an HTTPRequest to a ListViewItemData
 */
function decorateRequestTitle(name: string, request: HTTPRequest, options: FolderToListViewOptions): React.ReactNode | string {
  // Removed (vanished from the spec) gets the strikethrough treatment
  // — distinct from the deprecation dim because the two states have
  // different semantics: deprecated = "still in spec, author asks
  // you to migrate"; removed = "spec dropped this entirely".
  if (request.removed === true) return options.renderRemovedTitle?.(name) ?? name
  return name
}

function httpRequestToListViewItem(
  request: HTTPRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const decorated = applyDeprecatedDimming(
    request,
    options,
    decorateRequestTitle(request.name, request, options),
    options.renderMethodBadge(request.method)
  )
  return {
    id: request.id,
    title: decorated.title,
    icon: decorated.icon
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
    title: request.name,
    icon: badge
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
    title: request.name,
    icon: badge
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
    title: request.name,
    icon: badge
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
    title: request.name,
    icon: badge
  }
}

/**
 * Convert an ODataRequest to a ListViewItemData. Phase 1 shows a
 * dedicated `odata` badge so entries don't masquerade as plain HTTP
 * GETs in the sidebar. The badge label changes across phases when
 * actions ('ACT') and functions ('FN') land.
 */
function odataRequestToListViewItem(
  request: ODataRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.('odata', 'ODATA')
  return {
    id: request.id,
    title: request.name,
    icon: badge
  }
}

/**
 * Convert an AuthenticationRequest to a ListViewItemData. Auth
 * requests render a key-icon badge instead of the HTTP method
 * (so they stand out in the tree when the importer creates them).
 */
function authenticationRequestToListViewItem(
  request: AuthenticationRequest,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.('auth', 'AUTH')
  return {
    id: request.id,
    title: request.name,
    icon: badge
  }
}

/**
 * Convert a Scenario to a ListViewItemData. Renders the circuit-board
 * scenario badge so dataflow graphs are visually distinct from requests.
 * A scenario doubles as a folder-like container: its `items` (requests +
 * sub-folders authored inside it) render as expandable children.
 */
function scenarioToListViewItem(
  scenario: Scenario,
  options: FolderToListViewOptions
): ListViewItemData {
  const badge = options.renderProtocolBadge?.('scenario', 'SCENARIO')
  const isExpanded = options.expandedIds.has(scenario.id)
  const children = (scenario.items ?? []).map((item) => folderItemToListViewItem(item, options))
  return {
    id: scenario.id,
    title: scenario.name,
    isExpandable: children.length > 0,
    isExpanded,
    icon: badge,
    children
  }
}

/**
 * Convert a FolderItem (Folder, EnvironmentFolder, or Request) to ListViewItemData
 */
export function folderItemToListViewItem(
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
    if (isODataRequest(item)) {
      return odataRequestToListViewItem(item, options)
    }
    if (isAuthenticationRequest(item)) {
      return authenticationRequestToListViewItem(item, options)
    }
  }

  if (isScenario(item)) {
    return scenarioToListViewItem(item, options)
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

  const children = folder.items.map((item) => folderItemToListViewItem(item, options))
  return {
    id: folder.id,
    title: folder.name,
    isExpandable: children.length > 0,
    isExpanded,
    icon: toListViewIcon(folder.icon, 'folder-library'),
    children
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

  const children = folder.items.map((item) => folderItemToListViewItem(item, options))
  return {
    id: folder.id,
    title: folder.name,
    isExpandable: children.length > 0,
    isExpanded,
    icon: toListViewIcon(folder.icon, isExpanded ? 'folder-opened' : 'folder'),
    children
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
