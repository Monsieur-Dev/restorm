/**
 * Hook for managing sidebar state and list view items
 */

import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewItemData } from 'electron-core-ui/renderer'
import type { Folder, EnvironmentFolder, Request } from '../types/collections'
import { folderAsRootListViewItem } from '../services/FolderToListView'
import { attachContextMenus } from '../components/MainView/Sidebar/contextMenuBuilder'
import { Badge } from '../components/common/Badge'
import { mapToBadgeType } from '../utils/badgeUtils'

export interface UseSidebarStateOptions {
  rootItems: (EnvironmentFolder | Folder | Request)[]
  expandedIds: string[]
  onCloneItem: (itemId: string) => void
  onCreateSubfolder: (itemId: string) => void
  onDeleteItem: (itemId: string) => void
}

export interface UseSidebarStateReturn {
  sidebarItems: ListViewItemData[]
}

export function useSidebarState(options: UseSidebarStateOptions): UseSidebarStateReturn {
  const { rootItems, expandedIds, onCloneItem, onCreateSubfolder, onDeleteItem } = options
  const { t } = useTranslation()

  // Convert root folders to ListView items
  const sidebarItems: ListViewItemData[] = useMemo(() => {
    const expandedSet = new Set(expandedIds)
    const renderOptions = {
      expandedIds: expandedSet,
      renderMethodBadge: (method: string) => React.createElement(Badge, { type: mapToBadgeType(method) }),
      renderProtocolBadge: (protocol: string, label?: string) => React.createElement(Badge, { type: mapToBadgeType(protocol), label }),
      renderDeprecatedTitle: (name: string) => React.createElement('span', { style: { textDecoration: 'line-through', opacity: 0.7 } }, name)
    }
    // Each root folder becomes a top-level item in the sidebar
    // Filter out Requests at root level (they need special handling)
    return rootItems
      .filter((item): item is Folder | EnvironmentFolder => 'items' in item)
      .map((folder) => folderAsRootListViewItem(folder, renderOptions))
  }, [expandedIds, rootItems])

  // Attach context menus to sidebar items
  const sidebarItemsWithContextMenu: ListViewItemData[] = useMemo(
    () => attachContextMenus(sidebarItems, t, onCloneItem, onCreateSubfolder, onDeleteItem),
    [sidebarItems, t, onCloneItem, onCreateSubfolder, onDeleteItem]
  )

  return {
    sidebarItems: sidebarItemsWithContextMenu
  }
}
