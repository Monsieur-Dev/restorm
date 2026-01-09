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
  onDeleteItem: ContextMenuActionHandler
): SidebarContextMenuItem[] => {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0
  const isItemFolder = item.isExpandable ?? hasChildren
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
        shortcut: 'F2'
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

  return [
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
  onDeleteItem: ContextMenuActionHandler
): ListViewItemData[] =>
  items.map((item) => {
    const withMenu = {
      ...item,
      contextMenuItems: buildContextMenuForItem(item, t, onCloneItem, onCreateSubfolder, onDeleteItem)
    } as ListViewItemData
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus(item.children, t, onCloneItem, onCreateSubfolder, onDeleteItem)
    }
    return withMenu
  })
