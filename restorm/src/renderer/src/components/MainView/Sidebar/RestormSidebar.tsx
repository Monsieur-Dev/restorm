import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListView,
  ContextMenu,
  type ListViewItemData,
  type ListViewItemEventPayload,
  type ListViewDropEventPayload,
  type ListViewDropPosition,
  type ContextMenuItem,
  SplitView,
  Pane,
  Button
} from 'electron-core-ui/renderer'
import { buildEmptyAreaContextMenu, type AddChildHandler, type SidebarContextMenuItem } from './contextMenuBuilder'

export interface RestormSidebarProps {
  items: ListViewItemData[]
  favoriteItems: ListViewItemData[]
  openDocumentItems: ListViewItemData[]
  selectedItemId: string | null
  /** Full multi-selection (visual order) — the workspace tree runs in
   * `selectionMode="multiple"`; `selectedItemId` stays the active anchor. */
  selectedItemIds: string[]
  onSelectionChange: (ids: string[], anchorId: string) => void
  activeId?: string | null
  expandedIds: string[]
  editingItemId: string | null
  onItemClick: (itemId: string) => void
  /**
   * Middle-click on a row. Receives the item id so the consumer can open
   * the corresponding tab without focusing it (the typical "open in
   * background" semantics).
   */
  onItemAuxClick?: (itemId: string) => void
  onItemToggle: (payload: ListViewItemEventPayload, expanded: boolean) => void
  onItemDrop: (payload: ListViewDropEventPayload) => void
  /** Hover-time coherence check for the drag (ghost error badge + refusal). */
  canDropSelection: (sourceIds: string[], targetId: string, position: ListViewDropPosition) => boolean
  /** Group context menu when the right-clicked row is part of a
   * multi-selection of more than one row. */
  selectionContextMenuItems: (ids: string[]) => ContextMenuItem[] | null
  /** Drop on the workspace tree's empty area — moves the rows to the root. */
  onEmptyAreaDrop: (sources: ListViewItemEventPayload[]) => void
  onItemRename: (payload: ListViewItemEventPayload, newName: string) => void
  onDeleteRequest: (payload: ListViewItemEventPayload) => void
  onEditingStart: (itemId: string) => void
  onEditingEnd: () => void
  onAddRequest: () => void
  onCollapseAll: () => void
  onExpandAll: () => void
  onCreateRootEnvironmentFolder: () => void
  /**
   * Same handler the per-item Ajouter submenu uses — invoked with
   * `parentId === ''` from the empty-area menu so the request /
   * folder lands at the root of the collection. The hook itself
   * (`useItemOperations.handleAddChildItem`) handles the root case.
   */
  onAddChildItem: AddChildHandler
  onDeselectAll: () => void
  /** Reorder the project's favorites — receives the full ordered id list. */
  onFavoritesReorder: (orderedIds: string[]) => void
  /** Initial collapsed state for the Favorites + Opened panes (in that
   * order). Workspace is always expanded. */
  panesCollapsed?: { favorites: boolean; opened: boolean }
  /** Fired whenever the user collapses or expands one of the two
   * collapsible panes. Receives the new state. */
  onPanesCollapsedChange?: (state: { favorites: boolean; opened: boolean }) => void
  /** Per-pane inline-rename target. */
  favoritesEditingItemId?: string | null
  openedEditingItemId?: string | null
  onFavoritesEditingEnd?: () => void
  onOpenedEditingEnd?: () => void
}

/**
 * Sidebar component with workspace navigation and folder tree
 */
export const RestormSidebar: React.FC<RestormSidebarProps> = ({
  items,
  favoriteItems,
  openDocumentItems,
  selectedItemId,
  selectedItemIds,
  onSelectionChange,
  activeId,
  expandedIds,
  editingItemId,
  onItemClick,
  onItemAuxClick,
  onItemToggle,
  onItemDrop,
  canDropSelection,
  selectionContextMenuItems,
  onEmptyAreaDrop,
  onItemRename,
  onDeleteRequest,
  onEditingStart,
  onEditingEnd,
  onAddRequest,
  onCollapseAll,
  onExpandAll,
  onCreateRootEnvironmentFolder,
  onAddChildItem,
  onDeselectAll,
  onFavoritesReorder,
  panesCollapsed,
  onPanesCollapsedChange,
  favoritesEditingItemId = null,
  openedEditingItemId = null,
  onFavoritesEditingEnd,
  onOpenedEditingEnd
}) => {
  const { t } = useTranslation()
  const [emptyAreaMenu, setEmptyAreaMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 })

  const handleItemClick = useCallback((payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => {
    // A modified click (ctrl/cmd toggle, shift range) is a SELECTION
    // gesture: the ListView already updated the multi-selection, and
    // opening a tab for every toggled row would turn selection-building
    // into a tab storm. Only a plain click navigates.
    if (event.ctrlKey || event.metaKey || event.shiftKey) return
    const id = payload.item.id
    if (id) {
      onItemClick(id)
    }
  }, [onItemClick])

  const handleSelectionChange = useCallback((ids: string[], payload: ListViewItemEventPayload) => {
    onSelectionChange(ids, payload.item.id)
  }, [onSelectionChange])

  const handleCanDrop = useCallback((
    sources: ListViewItemEventPayload[],
    target: ListViewItemEventPayload,
    position: ListViewDropPosition
  ): boolean => canDropSelection(sources.map((s) => s.item.id), target.item.id, position), [canDropSelection])

  const handleItemAuxClick = useCallback((payload: ListViewItemEventPayload) => {
    if (!onItemAuxClick) return
    const id = payload.item.id
    if (id) {
      onItemAuxClick(id)
    }
  }, [onItemAuxClick])

  // Each optional pane is only rendered when it has content, so the
  // collapsed-array indices coming back from SplitView depend on the
  // current composition. Tracking which panes are present here lets
  // the handler map indices → pane names without index-shift bugs.
  const showFavoritesPane = favoriteItems.length > 0
  const showOpenedPane = openDocumentItems.length > 0
  const presentPanes = useMemo<('favorites' | 'opened' | 'workspace')[]>(() => {
    const list: ('favorites' | 'opened' | 'workspace')[] = []
    if (showFavoritesPane) list.push('favorites')
    if (showOpenedPane) list.push('opened')
    list.push('workspace')
    return list
  }, [showFavoritesPane, showOpenedPane])

  const handleSplitViewCollapsedChange = useCallback((collapsed: boolean[]) => {
    const next = { favorites: false, opened: false }
    presentPanes.forEach((name, idx) => {
      if (name === 'favorites') next.favorites = collapsed[idx] ?? false
      else if (name === 'opened') next.opened = collapsed[idx] ?? false
    })
    onPanesCollapsedChange?.(next)
  }, [onPanesCollapsedChange, presentPanes])

  const handleFavoritesDrop = useCallback((payload: ListViewDropEventPayload) => {
    // Reorder inside the Favorites pane only. Cross-pane drops are
    // ignored: we only act when both source and target ids belong to
    // the current favorites list.
    const sourceId = payload.source.id
    const targetId = payload.item.id
    if (!sourceId || !targetId) return
    const ids = favoriteItems.map((f) => f.id)
    if (!ids.includes(sourceId) || !ids.includes(targetId)) return
    const without = ids.filter((id) => id !== sourceId)
    const targetIndex = without.indexOf(targetId)
    if (targetIndex < 0) return
    const insertIndex = payload.position === 'after' ? targetIndex + 1 : targetIndex
    const next = [...without.slice(0, insertIndex), sourceId, ...without.slice(insertIndex)]
    onFavoritesReorder(next)
  }, [favoriteItems, onFavoritesReorder])

  const handleEmptyAreaClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.list-view-row')) return
    // A context menu opened over the tree renders INSIDE this wrapper —
    // clicking one of its entries is not an empty-area click, and clearing
    // the selection here would strip the very selection the entry acts on.
    if (target.closest('.ecui-context-menu')) return
    onDeselectAll()
  }, [onDeselectAll])

  const handleEmptyAreaContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.list-view-row')) return
    if (target.closest('.ecui-context-menu')) return
    e.preventDefault()
    onDeselectAll()
    setEmptyAreaMenu({ visible: true, x: e.clientX, y: e.clientY })
  }, [onDeselectAll])

  const closeEmptyAreaMenu = useCallback(() => {
    setEmptyAreaMenu(prev => ({ ...prev, visible: false }))
  }, [])

  // Build the empty-area context menu lazily so the "Ajouter" submenu
  // (which closes over `onAddChildItem` + `t`) always reflects the
  // current handler reference. `buildEmptyAreaContextMenu` uses the
  // `'' /* root sentinel */` parentId so `handleAddChildItem` pushes the
  // new node into `rootItems` rather than a parent folder's `items` array.
  // Every leaf `onClick` is decorated to also dismiss the menu.
  const emptyAreaMenuItems = useMemo(() => {
    const closeAfter = (action: () => void) => () => { action(); closeEmptyAreaMenu() }
    const decorate = (entry: SidebarContextMenuItem): SidebarContextMenuItem => {
      const withItems = entry.items ? { ...entry, items: entry.items.map(decorate) } : entry
      return withItems.onClick
        ? { ...withItems, onClick: closeAfter(withItems.onClick) }
        : withItems
    }
    return buildEmptyAreaContextMenu(t, onAddChildItem, onCreateRootEnvironmentFolder).map(decorate)
  }, [t, onAddChildItem, onCreateRootEnvironmentFolder, closeEmptyAreaMenu])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderRight: '1px solid var(--sideBar-border)',
        // No backgroundColor here — the parent Dock paints
        // `var(--dock-background)` on `.dock__panel-content`, and we
        // want that fill to show through the entire panel (including
        // the strip below the workspace tree). Without removing this
        // inline override, the sidebar paints over the dock's background.
        width: '100%',
        height: '100%'
      }}
    >
      <SplitView
        data-testid="sidebar-splitview"
        orientation="vertical"
        style={{ width: '100%', height: '100%' }}
        onCollapsedChange={handleSplitViewCollapsedChange}
      >
        {showFavoritesPane && (
          <Pane
            title={t('sidebar.favorites')}
            minSize={80}
            initialSize={0.2}
            defaultCollapsed={panesCollapsed?.favorites ?? false}
          >
            <ListView
              items={favoriteItems}
              rootRole="list"
              ariaLabel={t('sidebar.favorites')}
              selectedIds={selectedItemId ? [selectedItemId] : []}
              activeId={activeId}
              isRenameable
              editingItemId={favoritesEditingItemId}
              {...(onFavoritesEditingEnd && { onEditingEnd: onFavoritesEditingEnd })}
              onItemRename={onItemRename}
              onItemClick={handleItemClick}
              onItemAuxClick={handleItemAuxClick}
              onItemDrop={handleFavoritesDrop}
              data-testid="sidebar-favorites-listview"
            />
          </Pane>
        )}
        {showOpenedPane && (
          <Pane
            title={t('common.opened')}
            minSize={80}
            initialSize={0.2}
            defaultCollapsed={panesCollapsed?.opened ?? false}
          >
            <ListView
              items={openDocumentItems}
              rootRole="list"
              ariaLabel={t('common.opened')}
              selectedIds={selectedItemId ? [selectedItemId] : []}
              activeId={activeId}
              isRenameable
              editingItemId={openedEditingItemId}
              {...(onOpenedEditingEnd && { onEditingEnd: onOpenedEditingEnd })}
              onItemRename={onItemRename}
              onItemClick={handleItemClick}
              onItemAuxClick={handleItemAuxClick}
              data-testid="sidebar-open-documents-listview"
            />
          </Pane>
        )}
        <Pane
          title={t('sidebar.workspace')}
          collapsible={false}
          minSize={180}
          headerActions={
            <>
              <Button
                data-testid="sidebar-collapse-all-button"
                secondary
                small
                icon="collapse-all"
                options={{ ariaLabel: t('sidebar.collapseAll'), title: t('sidebar.collapseAll') }}
                onClick={onCollapseAll}
              />
              <Button
                data-testid="sidebar-expand-all-button"
                secondary
                small
                icon="expand-all"
                options={{ ariaLabel: t('sidebar.expandAll'), title: t('sidebar.expandAll') }}
                onClick={onExpandAll}
              />
              <Button
                data-testid="sidebar-add-request-button"
                secondary
                small
                icon="add"
                options={{ ariaLabel: t('sidebar.addRequest'), title: t('sidebar.addRequest') }}
                onClick={onAddRequest}
              />
            </>
          }
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
            onClick={handleEmptyAreaClick}
            onContextMenu={handleEmptyAreaContextMenu}
            data-testid="sidebar-empty-area"
          >
            <ListView
              items={items}
              rootRole="tree"
              ariaLabel={t('sidebar.workspace')}
              selectionMode="multiple"
              // Fall back to the anchor when no explicit multi-selection
              // exists: paths that only set the anchor (item creation's
              // inline-rename, reveal-in-tree) must still render the row
              // selected, exactly as the single-selection tree did.
              selectedIds={selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : []}
              onSelectionChange={handleSelectionChange}
              // Shift-range anchors on the ListView's `activeId`. For a design
              // entity the app anchor (`selectedItemId`/`activeId`) is the OWNING
              // DESIGN (so paste / favorites resolve against it), while the real
              // highlighted row lives in `selectedItemIds` — so drive the anchor
              // from the highlighted row when exactly one is selected. With a
              // multi-selection, pass `undefined` so the ListView keeps the
              // internal anchor its own shift-click just set (never snapping it
              // back to the design).
              activeId={selectedItemIds.length === 1 ? selectedItemIds[0] : selectedItemIds.length === 0 ? activeId : undefined}
              expandedIds={expandedIds}
              isRenameable
              expandOnChevronOnly
              onItemToggle={onItemToggle}
              onItemClick={handleItemClick}
              onItemAuxClick={handleItemAuxClick}
              onItemDrop={onItemDrop}
              canDrop={handleCanDrop}
              dragExpandDelayMs={1000}
              onEmptyAreaDrop={onEmptyAreaDrop}
              selectionContextMenuItems={selectionContextMenuItems}
              onItemRename={onItemRename}
              editingItemId={editingItemId}
              onEditingStart={onEditingStart}
              onEditingEnd={onEditingEnd}
              onDeleteRequest={onDeleteRequest}
              data-testid="sidebar-listview"
            />
          </div>
          <ContextMenu
            visible={emptyAreaMenu.visible}
            x={emptyAreaMenu.x}
            y={emptyAreaMenu.y}
            items={emptyAreaMenuItems}
            data-testid="sidebar-empty-area-context-menu"
            onRequestClose={closeEmptyAreaMenu}
          />
        </Pane>
      </SplitView>
    </div>
  )
}
