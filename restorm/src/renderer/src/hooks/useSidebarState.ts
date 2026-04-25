/**
 * Hook for managing sidebar state and list view items
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewItemData } from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder, Request } from '../../../shared/types/collections'
import { folderAsRootListViewItem, folderItemToListViewItem } from '../services/FolderToListView'
import { attachContextMenus } from '../components/MainView/Sidebar/contextMenuBuilder'
import type { AddChildKind } from '../components/MainView/Sidebar/contextMenuBuilder'
import { Badge } from '../components/common/Badge'
import { mapToBadgeType } from '../utils/badgeUtils'

export interface UseSidebarStateOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  expandedIds: string[]
  /** Counter incremented on in-place mutations to trigger re-computation */
  updateCount?: number
  onCloneItem: (itemId: string) => void
  onDeleteItem: (itemId: string) => void
  onRenameItem: (itemId: string) => void
  /** Kind-agnostic add-child dispatcher for the sidebar's Ajouter
   * submenu. Only invoked on folder + environment-folder rows. */
  onAddChildItem: (parentId: string, kind: AddChildKind) => void
  isItemFavorite?: (itemId: string) => boolean
  onToggleFavorite?: (itemId: string) => void
}

export interface UseSidebarStateReturn {
  sidebarItems: ListViewItemData[]
}

export function useSidebarState(options: UseSidebarStateOptions): UseSidebarStateReturn {
  const { rootItems, expandedIds, updateCount, onCloneItem, onAddChildItem, onDeleteItem, onRenameItem, isItemFavorite, onToggleFavorite } = options
  const { t } = useTranslation()

  // Convert root folders to ListView items
  // updateCount is used as a dependency to force re-computation when items are mutated in-place
  const sidebarItems: ListViewItemData[] = useMemo(() => {
    void updateCount
    const expandedSet = new Set(expandedIds)
    const renderOptions = {
      expandedIds: expandedSet,
      renderMethodBadge: (method: string) => React.createElement(Badge, { type: mapToBadgeType(method) }),
      renderProtocolBadge: (protocol: string, label?: string) => React.createElement(Badge, { type: mapToBadgeType(protocol), label }),
      renderDeprecatedTitle: (name: string) => React.createElement('span', { style: { textDecoration: 'line-through', opacity: 0.7 } }, name)
    }
    // Each root item becomes a top-level row in the sidebar. Folders
    // go through `folderAsRootListViewItem` (which renders them as a
    // folder node whose children hang off it); root-level requests
    // (e.g. an attached auth route) render as their own row via
    // `folderItemToListViewItem`, which already dispatches to the
    // right request-type adapter.
    return rootItems.map((item) =>
      'items' in item
        ? folderAsRootListViewItem(item, renderOptions)
        : folderItemToListViewItem(item, renderOptions)
    )
  }, [expandedIds, rootItems, updateCount])

  // Attach context menus to sidebar items.
  // `isItemFavorite` / `onToggleFavorite` are optional: only spread
  // when defined so `exactOptionalPropertyTypes` doesn't reject an
  // explicit `undefined`.
  const sidebarItemsWithContextMenu: ListViewItemData[] = useMemo(
    () => attachContextMenus({
      items: sidebarItems,
      t,
      onCloneItem,
      onDeleteItem,
      onRenameItem,
      onAddChildItem,
      ...(isItemFavorite !== undefined && { isItemFavorite }),
      ...(onToggleFavorite !== undefined && { onToggleFavorite })
    }),
    [sidebarItems, t, onCloneItem, onDeleteItem, onRenameItem, onAddChildItem, isItemFavorite, onToggleFavorite]
  )

  return {
    sidebarItems: sidebarItemsWithContextMenu
  }
}
