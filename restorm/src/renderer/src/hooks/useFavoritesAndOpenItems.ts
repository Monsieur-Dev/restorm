import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewItemData } from 'electron-core-ui/renderer'
import {
  isContainerNode,
  isTabGroupNode,
  logger,
  type EditorTab,
  type GroupNode,
  type WorkbenchTree
} from 'electron-core-ui/renderer'
import type { FolderItem } from '../../../shared/types/collections'
import { folderItemToListViewItem } from '../services/FolderToListView'
import { Badge } from '../components/common/Badge'
import { RegistryBadge } from '../components/common/RegistryBadge'
import { httpBadgeIdFor, isKnownHttpMethod } from '../../../shared/utils/httpMethod'
import { mapToBadgeType, requestBadgeId } from '../utils/badgeUtils'
import type { Request } from '../../../shared/types/collections'
import { findItemById } from '../utils/treeSearch'
import { getFavorites } from '../services/favoritesStore'
import {
  buildFavoritesContextMenuForItem,
  buildOpenDocumentsContextMenuForItem
} from '../components/MainView/Sidebar/contextMenuBuilder'

export interface UseFavoritesAndOpenItemsOptions {
  rootItems: FolderItem[]
  workbenchTree: WorkbenchTree
  projectUuid: string | null
  /** Counter incremented when items are mutated in-place (rename, etc.) */
  updateCount?: number
  isItemFavorite: (itemId: string) => boolean
  /** Start rename inline within the Favorites pane row. */
  onRenameFavoriteItem: (itemId: string) => void
  /** Start rename inline within the Opened pane row. */
  onRenameOpenedItem: (itemId: string) => void
  onCloneItem: (itemId: string) => void
  onDeleteItem: (itemId: string) => void
  onToggleFavorite: (itemId: string) => void
  onUnfavorite: (itemId: string) => void
  onCloseTab: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseTabsToTheRight: (tabId: string) => void
  onCloseAllTabs: () => void
}

export interface UseFavoritesAndOpenItemsReturn {
  favoriteItems: ListViewItemData[]
  openDocumentItems: ListViewItemData[]
}

/**
 * Walk the workbench tree depth-first and collect the underlying item id
 * (request / folder / env-folder) for every open tab. The tab's `.id`
 * field is a synthetic key (e.g. `request-idx:0.1.5`) that doesn't match
 * anything in `rootItems`; the real item id lives on `tab.request.id`,
 * `tab.folder.id`, or — for tabs that wrap an environment — the env
 * folder id. Deduped, preserving order of first appearance.
 */
type ItemBackedTab = EditorTab & {
  request?: { id?: string }
  folder?: { id?: string }
  scenario?: { id?: string }
}

function collectOpenItemIds(tree: WorkbenchTree): { itemId: string; tabId: string }[] {
  const out: { itemId: string; tabId: string }[] = []
  const seen = new Set<string>()
  const walk = (nodes: GroupNode[]): void => {
    for (const node of nodes) {
      if (isTabGroupNode(node)) {
        for (const tab of node.tabs) {
          const t = tab as ItemBackedTab
          // The Opened pane lists open requests + scenarios — both are
          // "documents" the user re-opens; folder / environment-folder
          // tabs (Configuration / Docs / Notes surfaces) carry
          // workbench state but aren't items to surface here.
          const itemId = t.request?.id ?? t.scenario?.id ?? null
          if (!itemId || seen.has(itemId)) continue
          seen.add(itemId)
          out.push({ itemId, tabId: tab.id })
        }
      } else if (isContainerNode(node)) {
        walk(node.groups)
      }
    }
  }
  walk(tree.groups)
  return out
}

export function useFavoritesAndOpenItems(
  options: UseFavoritesAndOpenItemsOptions
): UseFavoritesAndOpenItemsReturn {
  const {
    rootItems, workbenchTree, projectUuid, updateCount,
    isItemFavorite,
    onRenameFavoriteItem, onRenameOpenedItem,
    onCloneItem, onDeleteItem,
    onToggleFavorite, onUnfavorite,
    onCloseTab, onCloseOtherTabs, onCloseTabsToTheRight, onCloseAllTabs
  } = options
  const { t } = useTranslation()

  const [renameVersion, setRenameVersion] = useState(0)
  const [favoritesVersion, setFavoritesVersion] = useState(0)
  useEffect(() => {
    const onRename = (): void => { setRenameVersion((v) => v + 1) }
    const onFavs = (): void => { setFavoritesVersion((v) => v + 1) }
    window.addEventListener('restorm:item-renamed', onRename)
    window.addEventListener('restorm:favorites-changed', onFavs)
    return () => {
      window.removeEventListener('restorm:item-renamed', onRename)
      window.removeEventListener('restorm:favorites-changed', onFavs)
    }
  }, [])

  const renderOptions = useMemo(() => ({
    expandedIds: new Set<string>(),
    renderMethodBadge: (method: string) => React.createElement(RegistryBadge, { badgeId: httpBadgeIdFor(method), text: method }),
    renderProtocolBadge: (protocol: string, label?: string, mode?: 'client' | 'server') =>
      // The HTTP mock server's badge is method-colored: route it to the
      // registry capsule (GraphQL's QUERY badge renamed GQL upstream, so a
      // known-verb token here is genuinely HTTP).
      (mode === 'server' && isKnownHttpMethod(protocol))
        ? React.createElement(RegistryBadge, { badgeId: httpBadgeIdFor(protocol), text: label ?? protocol, server: true })
        :
      React.createElement(Badge, { type: mapToBadgeType(protocol), label, mode }),
    renderRequestBadge: (request: Request) =>
      React.createElement(RegistryBadge, { badgeId: requestBadgeId(request) }),
    renderRemovedTitle: (name: string) =>
      React.createElement('span', { style: { textDecoration: 'line-through', opacity: 0.6 } }, name)
  }), [])

  const itemToRow = useCallback((id: string): ListViewItemData | null => {
    const item = findItemById(rootItems, id)
    if (!item) return null
    const row = folderItemToListViewItem(item, renderOptions)
    // Both panes render FLAT lists: strip the children AND the expandability
    // that came with them. A scenario (or any container) reports
    // `isExpandable` from its bound items, but here there are no children to
    // reveal — so without this the row shows a disclosure chevron that
    // expands nothing.
    const { children: _children, isExpandable: _isExpandable, isExpanded: _isExpanded, ...flat } = row
    void _children
    void _isExpandable
    void _isExpanded
    return { ...flat, isExpandable: false }
  }, [rootItems, renderOptions])

  const favoriteItems = useMemo<ListViewItemData[]>(() => {
    // Version refs trigger recompute when the favorites store changes
    // or an in-place rename/mutation happens — the deps array drives it.
    void favoritesVersion; void renameVersion; void updateCount
    if (!projectUuid) return []
    const ids = getFavorites(projectUuid)
    // Resolve only once the tree exists. On a project load this memo runs
    // before `rootItems` is populated, so EVERY favorite looks unknown — the
    // list renders empty for a beat and the log claims each id is dangling.
    // The stored ids are never touched by this pass, so nothing is lost, but
    // on a slow load the empty list is what the user sees.
    if (ids.length > 0 && rootItems.length === 0) return []

    const rows: ListViewItemData[] = []
    let warnedOnce = false
    for (const id of ids) {
      const row = itemToRow(id)
      if (!row) {
        if (!warnedOnce) {
          // Reached only with a loaded tree, so this really is a dangling
          // favorite (a stale persistence file), not a load race. Debug-level:
          // it isn't actionable for the end user — the entry just doesn't
          // appear in the Favorites view.
          logger.debug('Favorite id refers to an unknown item — skipping', { id })
          warnedOnce = true
        }
        continue
      }
      rows.push({
        ...row,
        contextMenuItems: buildFavoritesContextMenuForItem({
          item: row, t,
          onRenameItem: onRenameFavoriteItem,
          onCloneItem, onDeleteItem, onUnfavorite
        })
      })
    }
    return rows
  }, [
    projectUuid, itemToRow, rootItems, updateCount, renameVersion, favoritesVersion, t,
    onRenameFavoriteItem, onCloneItem, onDeleteItem, onUnfavorite
  ])

  const openDocumentItems = useMemo<ListViewItemData[]>(() => {
    void renameVersion; void updateCount
    const entries = collectOpenItemIds(workbenchTree)
    const rows: ListViewItemData[] = []
    for (const { itemId } of entries) {
      const row = itemToRow(itemId)
      if (!row) continue
      rows.push({
        ...row,
        contextMenuItems: buildOpenDocumentsContextMenuForItem({
          item: row, t,
          onRenameItem: onRenameOpenedItem,
          onCloneItem, onDeleteItem,
          isItemFavorite, onToggleFavorite,
          onCloseTab, onCloseOtherTabs, onCloseTabsToTheRight, onCloseAllTabs
        })
      })
    }
    return rows
  }, [
    workbenchTree, itemToRow, updateCount, renameVersion, t,
    onRenameOpenedItem, onCloneItem, onDeleteItem,
    isItemFavorite, onToggleFavorite,
    onCloseTab, onCloseOtherTabs, onCloseTabsToTheRight, onCloseAllTabs
  ])

  return { favoriteItems, openDocumentItems }
}
