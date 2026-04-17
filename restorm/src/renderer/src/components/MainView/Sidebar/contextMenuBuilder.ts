/**
 * Context menu builder for sidebar items
 */

import type { ListViewItemData } from 'electron-core-ui/renderer'

export interface SidebarContextMenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  isSeparator?: boolean
  onClick?: () => void
}

export type TranslateFunction = (key: string) => string
export type ContextMenuActionHandler = (itemId: string) => void

export const buildContextMenuForItem = (
  item: ListViewItemData,
  t: TranslateFunction,
  onCloneItem: ContextMenuActionHandler,
  onCreateSubfolder: ContextMenuActionHandler,
  onDeleteItem: ContextMenuActionHandler,
  onRenameItem: ContextMenuActionHandler,
  isItemFavorite?: (itemId: string) => boolean,
  onToggleFavorite?: ContextMenuActionHandler
): SidebarContextMenuItem[] => {
  const isItemFolder = Array.isArray(item.children)
  const itemId = item.id

  if (isItemFolder) {
    return [
      {
        id: 'create-child-folder',
        label: t('sidebar.contextMenu.createSubfolder'),
        icon: 'new-folder',
        onClick: () => {
          onCreateSubfolder(itemId)
        }
      },
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

export const attachContextMenus = (
  items: ListViewItemData[],
  t: TranslateFunction,
  onCloneItem: ContextMenuActionHandler,
  onCreateSubfolder: ContextMenuActionHandler,
  onDeleteItem: ContextMenuActionHandler,
  onRenameItem: ContextMenuActionHandler,
  isItemFavorite?: (itemId: string) => boolean,
  onToggleFavorite?: ContextMenuActionHandler
): ListViewItemData[] =>
  items.map((item) => {
    const withMenu = {
      ...item,
      contextMenuItems: buildContextMenuForItem(item, t, onCloneItem, onCreateSubfolder, onDeleteItem, onRenameItem, isItemFavorite, onToggleFavorite)
    } as ListViewItemData
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus(item.children, t, onCloneItem, onCreateSubfolder, onDeleteItem, onRenameItem, isItemFavorite, onToggleFavorite)
    }
    return withMenu
  })
