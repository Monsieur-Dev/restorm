/**
 * Context menu builder for sidebar items
 */

import React from 'react'
import type { ListViewItemData } from 'electron-core-ui/renderer'
import { Badge } from '../../common/Badge'

export interface SidebarContextMenuItem {
  id: string
  label: string
  /** Codicon name (string) or any React node — passed straight to
   * `ContextMenuItem.icon`. Strings get wrapped in `codicon-<name>`;
   * nodes render as-is in the icon slot (used for Badge glyphs). */
  icon?: string | React.ReactNode
  shortcut?: string
  isSeparator?: boolean
  onClick?: () => void
  /** Nested items for a submenu entry. */
  items?: SidebarContextMenuItem[]
}

export type TranslateFunction = (key: string) => string
export type ContextMenuActionHandler = (itemId: string) => void

/** Kinds passed to {@link AddChildHandler}. `http-<method>` creates an
 * HTTP request pre-set to the matching method; `auth` uses the
 * dedicated Authentication type (renders a key badge). */
export type AddChildKind =
  | 'folder'
  | 'http-get'
  | 'http-post'
  | 'http-put'
  | 'http-patch'
  | 'http-delete'
  | 'graphql'
  | 'grpc'
  | 'soap'
  | 'websocket'
  | 'odata'
  | 'auth'

export type AddChildHandler = (parentId: string, kind: AddChildKind) => void

export interface BuildContextMenuOptions {
  item: ListViewItemData
  t: TranslateFunction
  onCloneItem: ContextMenuActionHandler
  onDeleteItem: ContextMenuActionHandler
  onRenameItem: ContextMenuActionHandler
  /** Kind-agnostic "Add child" dispatcher. Invoked from the Ajouter
   * submenu entries for folders and environment folders. */
  onAddChildItem: AddChildHandler
  isItemFavorite?: (itemId: string) => boolean
  onToggleFavorite?: ContextMenuActionHandler
}

/** Build the "Ajouter" submenu that folders and environment folders
 * expose. Identical contents for both — the caller decides whether to
 * attach it. Exported so the sidebar's empty-area context menu can
 * reuse the same submenu with `parentId === ''` (root sentinel). */
export const buildAddSubmenu = (
  parentId: string,
  t: TranslateFunction,
  onAddChildItem: AddChildHandler
): SidebarContextMenuItem[] => [
  {
    id: `add-folder-${parentId}`,
    label: t('sidebar.contextMenu.add.folder'),
    icon: 'folder',
    onClick: () => { onAddChildItem(parentId, 'folder') }
  },
  { id: `sep-add-folder-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-http-get-${parentId}`,
    label: t('sidebar.contextMenu.add.httpGet'),
    icon: React.createElement(Badge, { type: 'GET' }),
    onClick: () => { onAddChildItem(parentId, 'http-get') }
  },
  {
    id: `add-http-post-${parentId}`,
    label: t('sidebar.contextMenu.add.httpPost'),
    icon: React.createElement(Badge, { type: 'POST' }),
    onClick: () => { onAddChildItem(parentId, 'http-post') }
  },
  {
    id: `add-http-put-${parentId}`,
    label: t('sidebar.contextMenu.add.httpPut'),
    icon: React.createElement(Badge, { type: 'PUT' }),
    onClick: () => { onAddChildItem(parentId, 'http-put') }
  },
  {
    id: `add-http-patch-${parentId}`,
    label: t('sidebar.contextMenu.add.httpPatch'),
    icon: React.createElement(Badge, { type: 'PATCH' }),
    onClick: () => { onAddChildItem(parentId, 'http-patch') }
  },
  {
    id: `add-http-delete-${parentId}`,
    label: t('sidebar.contextMenu.add.httpDelete'),
    icon: React.createElement(Badge, { type: 'DELETE' }),
    onClick: () => { onAddChildItem(parentId, 'http-delete') }
  },
  { id: `sep-add-http-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-graphql-${parentId}`,
    label: t('sidebar.contextMenu.add.graphql'),
    icon: React.createElement(Badge, { type: 'QUERY' }),
    onClick: () => { onAddChildItem(parentId, 'graphql') }
  },
  {
    id: `add-grpc-${parentId}`,
    label: t('sidebar.contextMenu.add.grpc'),
    icon: React.createElement(Badge, { type: 'UNARY' }),
    onClick: () => { onAddChildItem(parentId, 'grpc') }
  },
  {
    id: `add-soap-${parentId}`,
    label: t('sidebar.contextMenu.add.soap'),
    icon: React.createElement(Badge, { type: 'SOAP' }),
    onClick: () => { onAddChildItem(parentId, 'soap') }
  },
  {
    id: `add-websocket-${parentId}`,
    label: t('sidebar.contextMenu.add.websocket'),
    icon: React.createElement(Badge, { type: 'WS' }),
    onClick: () => { onAddChildItem(parentId, 'websocket') }
  },
  {
    id: `add-odata-${parentId}`,
    label: t('sidebar.contextMenu.add.odata'),
    icon: React.createElement(Badge, { type: 'ODATA' }),
    onClick: () => { onAddChildItem(parentId, 'odata') }
  },
  { id: `sep-add-proto-${parentId}`, isSeparator: true, label: '' },
  {
    id: `add-auth-${parentId}`,
    label: t('sidebar.contextMenu.add.auth'),
    icon: React.createElement(Badge, { type: 'AUTH' }),
    onClick: () => { onAddChildItem(parentId, 'auth') }
  }
]

export const buildContextMenuForItem = (
  options: BuildContextMenuOptions
): SidebarContextMenuItem[] => {
  const { item, t, onCloneItem, onDeleteItem, onRenameItem, onAddChildItem, isItemFavorite, onToggleFavorite } = options
  const isItemFolder = Array.isArray(item.children)
  const itemId = item.id

  if (isItemFolder) {
    return [
      {
        id: 'add-child',
        label: t('sidebar.contextMenu.add.title'),
        icon: 'add',
        items: buildAddSubmenu(itemId, t, onAddChildItem)
      },
      { id: 'sep-add', isSeparator: true, label: '' },
      {
        id: 'rename-item',
        label: t('sidebar.contextMenu.rename'),
        icon: 'edit',
        shortcut: 'F2',
        onClick: () => {
          onRenameItem(itemId)
        }
      },
      { id: 'sep-folder', isSeparator: true, label: '' },
      {
        id: 'delete-folder',
        label: t('sidebar.contextMenu.delete'),
        icon: 'trash',
        shortcut: 'Suppr',
        onClick: () => {
          onDeleteItem(itemId)
        }
      }
    ]
  }

  const isFav = isItemFavorite?.(itemId) ?? false

  return [
    {
      id: 'toggle-favorite',
      label: isFav ? t('sidebar.contextMenu.removeFromFavorites') : t('sidebar.contextMenu.addToFavorites'),
      icon: isFav ? 'star-full' : 'star-empty',
      onClick: () => { onToggleFavorite?.(itemId) }
    },
    { id: 'sep-fav', isSeparator: true, label: '' },
    {
      id: 'clone-item',
      label: t('sidebar.contextMenu.clone'),
      icon: 'copy',
      shortcut: 'Ctrl+D',
      onClick: () => {
        onCloneItem(itemId)
      }
    },
    {
      id: 'rename-item',
      label: t('sidebar.contextMenu.rename'),
      icon: 'edit',
      shortcut: 'F2'
    },
    { id: 'sep-item', isSeparator: true, label: '' },
    {
      id: 'delete-item',
      label: t('sidebar.contextMenu.delete'),
      icon: 'trash',
      shortcut: 'Suppr',
      onClick: () => {
        onDeleteItem(itemId)
      }
    }
  ]
}

export interface AttachContextMenusOptions {
  items: ListViewItemData[]
  t: TranslateFunction
  onCloneItem: ContextMenuActionHandler
  onDeleteItem: ContextMenuActionHandler
  onRenameItem: ContextMenuActionHandler
  onAddChildItem: AddChildHandler
  isItemFavorite?: (itemId: string) => boolean
  onToggleFavorite?: ContextMenuActionHandler
}

export const attachContextMenus = (
  options: AttachContextMenusOptions
): ListViewItemData[] =>
  options.items.map((item) => {
    const withMenu = {
      ...item,
      contextMenuItems: buildContextMenuForItem({ ...options, item })
    } as ListViewItemData
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus({ ...options, items: item.children })
    }
    return withMenu
  })
