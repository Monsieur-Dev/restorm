/**
 * Hook for managing sidebar state and list view items
 */

import React, { useCallback, useMemo } from 'react'
import { findItemById } from '../utils/treeSearch'
import { useTranslation } from 'react-i18next'
import type { ListViewItemData } from 'electron-core-ui/renderer'
import type { FolderItem } from '../../../shared/types/collections'
import { isScenario, isApiDesign } from '../../../shared/types/collections'
import { folderAsRootListViewItem, folderItemToListViewItem } from '../services/FolderToListView'
import { attachContextMenus } from '../components/MainView/Sidebar/contextMenuBuilder'
import type { AddChildKind } from '../components/MainView/Sidebar/contextMenuBuilder'
import { Badge } from '../components/common/Badge'
import { RegistryBadge } from '../components/common/RegistryBadge'
import { httpBadgeIdFor, isKnownHttpMethod } from '../../../shared/utils/httpMethod'
import { mapToBadgeType, requestBadgeId } from '../utils/badgeUtils'
import type { Request } from '../../../shared/types/collections'
import { useDeprecatedRequestIds } from './useDeprecatedRequestIds'

export interface UseSidebarStateOptions {
  rootItems: FolderItem[]
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
  /** Sidebar clipboard trio — forwarded to the context-menu builder. */
  onCutItem?: (itemId: string) => void
  onCopyItem?: (itemId: string) => void
  onPasteItem?: (itemId: string) => void
  canPaste?: () => boolean
  /** `true` for an env folder that has an apiUpdate.sourceUrl
   * configured. Drives the "Refresh" right-click entry. */
  canRefreshFromSource?: (itemId: string) => boolean
  onRefreshFromSource?: (itemId: string) => void
  /** Open an item in a split workbench panel (design context menu). */
  onOpenInSplit?: (itemId: string) => void
}

export interface UseSidebarStateReturn {
  sidebarItems: ListViewItemData[]
}

export function useSidebarState(options: UseSidebarStateOptions): UseSidebarStateReturn {
  const { rootItems, expandedIds, updateCount, onCloneItem, onAddChildItem, onDeleteItem, onRenameItem, isItemFavorite, onToggleFavorite, onCutItem, onCopyItem, onPasteItem, canPaste, canRefreshFromSource, onRefreshFromSource, onOpenInSplit } = options
  const { t } = useTranslation()

  // Set of request ids whose URL currently resolves to a deprecated
  // operation in their owning env folder's apiDocumentation. Lives
  // outside the listview-item memo so its dependency on the matcher
  // is explicit, and the dim re-evaluates as soon as the user edits
  // a URL — no persisted `request.deprecated` flag involved.
  const deprecatedRequestIds = useDeprecatedRequestIds(rootItems, updateCount)

  // Convert root folders to ListView items
  // updateCount is used as a dependency to force re-computation when items are mutated in-place
  const sidebarItems: ListViewItemData[] = useMemo(() => {
    void updateCount
    const expandedSet = new Set(expandedIds)
    const renderOptions = {
      expandedIds: expandedSet,
      renderMethodBadge: (method: string) => React.createElement(RegistryBadge, { badgeId: httpBadgeIdFor(method), text: method }),
      renderProtocolBadge: (protocol: string, label?: string, mode?: 'client' | 'server') =>
      // The HTTP mock server's badge is method-colored: route it to the
      // registry capsule (GraphQL's QUERY badge renamed GQL upstream, so a
      // known-verb token here is genuinely HTTP).
      (mode === 'server' && isKnownHttpMethod(protocol))
        ? React.createElement(RegistryBadge, { badgeId: httpBadgeIdFor(protocol), text: label ?? protocol, server: true })
        : React.createElement(Badge, { type: mapToBadgeType(protocol), label, mode }),
      renderRequestBadge: (request: Request) => React.createElement(RegistryBadge, { badgeId: requestBadgeId(request) }),
      // Removed (vanished from the spec) renders strikethrough.
      // Deprecated rows are dimmed via the per-id set passed alongside
      // — the wrapper applies opacity to the whole row visual rather
      // than the title alone, and the decision rides on the live
      // matcher (so editing the URL re-evaluates instantly).
      renderRemovedTitle: (name: string) => React.createElement('span', { style: { textDecoration: 'line-through', opacity: 0.6 }, title: 'Removed from source spec' }, name),
      deprecatedRequestIds
    }
    // Each root item becomes a top-level row in the sidebar. Folders
    // go through `folderAsRootListViewItem` (which renders them as a
    // folder node whose children hang off it); root-level requests
    // (e.g. an attached auth route) render as their own row via
    // `folderItemToListViewItem`, which already dispatches to the
    // right request-type adapter.
    return rootItems.map((item) =>
      // A container (has `items`) renders as a root folder — except a scenario,
      // which goes through `folderItemToListViewItem` to get its expandable
      // scenario row. Keep the original `'items' in item` test (not `isAnyFolder`)
      // so a folder missing a `configuration` field still renders with children.
      'items' in item && !isScenario(item)
        ? folderAsRootListViewItem(item, renderOptions)
        : folderItemToListViewItem(item, renderOptions)
    )
  }, [expandedIds, rootItems, updateCount, deprecatedRequestIds])

  // Attach context menus to sidebar items.
  // `isItemFavorite` / `onToggleFavorite` are optional: only spread
  // when defined so `exactOptionalPropertyTypes` doesn't reject an
  // explicit `undefined`.
  // Walk the tree to flag scenarios — the context-menu builder routes
  // them through a dedicated branch (toggle-favourite + Add child) so
  // a scenario gets the bookmark affordance every request has.
  const isItemScenario = useCallback((itemId: string): boolean => {
    const item = findItemById(rootItems, itemId)
    return item !== null && isScenario(item)
  }, [rootItems])

  const isItemDesign = useCallback((itemId: string): boolean => {
    const item = findItemById(rootItems, itemId)
    return item !== null && isApiDesign(item)
  }, [rootItems])

  const sidebarItemsWithContextMenu: ListViewItemData[] = useMemo(
    () => attachContextMenus({
      items: sidebarItems,
      t,
      onCloneItem,
      onDeleteItem,
      onRenameItem,
      onAddChildItem,
      ...(isItemFavorite !== undefined && { isItemFavorite }),
      ...(onToggleFavorite !== undefined && { onToggleFavorite }),
      ...(onCutItem !== undefined && { onCutItem }),
      ...(onCopyItem !== undefined && { onCopyItem }),
      ...(onPasteItem !== undefined && { onPasteItem }),
      ...(canPaste !== undefined && { canPaste }),
      ...(canRefreshFromSource !== undefined && { canRefreshFromSource }),
      ...(onRefreshFromSource !== undefined && { onRefreshFromSource }),
      ...(onOpenInSplit !== undefined && { onOpenInSplit }),
      isItemScenario,
      isItemDesign
    }),
    [sidebarItems, t, onCloneItem, onDeleteItem, onRenameItem, onAddChildItem, isItemFavorite, onToggleFavorite, onCutItem, onCopyItem, onPasteItem, canPaste, canRefreshFromSource, onRefreshFromSource, onOpenInSplit, isItemScenario, isItemDesign]
  )

  return {
    sidebarItems: sidebarItemsWithContextMenu
  }
}
