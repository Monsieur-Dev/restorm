import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListView,
  ContextMenu,
  type ListViewItemData,
  type ListViewItemEventPayload,
  type ListViewDropEventPayload,
  SplitView,
  Pane,
  Button
} from 'electron-core-ui/renderer'

export interface RestormSidebarProps {
  items: ListViewItemData[]
  selectedItemId: string | null
  activeId?: string | null
  expandedIds: string[]
  editingItemId: string | null
  onItemClick: (itemId: string) => void
  onItemToggle: (payload: ListViewItemEventPayload, expanded: boolean) => void
  onItemDrop: (payload: ListViewDropEventPayload) => void
  onItemRename: (payload: ListViewItemEventPayload, newName: string) => void
  onDeleteRequest: (payload: ListViewItemEventPayload) => void
  onEditingStart: (itemId: string) => void
  onEditingEnd: () => void
  onAddRequest: () => void
  onCollapseAll: () => void
  onCreateRootFolder: () => void
  onCreateRootEnvironmentFolder: () => void
  onDeselectAll: () => void
}

/**
 * Sidebar component with workspace navigation and folder tree
 */
export const RestormSidebar: React.FC<RestormSidebarProps> = ({
  items,
  selectedItemId,
  activeId,
  expandedIds,
  editingItemId,
  onItemClick,
  onItemToggle,
  onItemDrop,
  onItemRename,
  onDeleteRequest,
  onEditingStart,
  onEditingEnd,
  onAddRequest,
  onCollapseAll,
  onCreateRootFolder,
  onCreateRootEnvironmentFolder,
  onDeselectAll
}) => {
  const { t } = useTranslation()
  const [emptyAreaMenu, setEmptyAreaMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 })

  const handleItemClick = useCallback((payload: ListViewItemEventPayload) => {
    const id = payload.item.id
    if (id) {
      onItemClick(id)
    }
  }, [onItemClick])

  const handleEmptyAreaClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.list-view-row')) return
    onDeselectAll()
  }, [onDeselectAll])

  const handleEmptyAreaContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.list-view-row')) return
    e.preventDefault()
    onDeselectAll()
    setEmptyAreaMenu({ visible: true, x: e.clientX, y: e.clientY })
  }, [onDeselectAll])

  const closeEmptyAreaMenu = useCallback(() => {
    setEmptyAreaMenu(prev => ({ ...prev, visible: false }))
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderRight: '1px solid var(--sideBar-border)',
        backgroundColor: 'var(--sideBar-background)',
        width: '100%',
        height: '100%'
      }}
    >
      <SplitView
        data-testid="sidebar-splitview"
        orientation="vertical"
        style={{ width: '100%', height: '100%' }}
      >
        <Pane
          title={t('sidebar.workspace')}
          collapsible={false}
          minSize={180}
          headerActions={
            <>
              <Button
                data-testid="sidebar-add-request-button"
                secondary
                small
                icon="add"
                options={{ ariaLabel: t('sidebar.addRequest'), title: t('sidebar.addRequest') }}
                onClick={onAddRequest}
              />
              <Button
                data-testid="sidebar-collapse-all-button"
                secondary
                small
                icon="collapse-all"
                options={{ ariaLabel: t('sidebar.collapseAll'), title: t('sidebar.collapseAll') }}
                onClick={onCollapseAll}
              />
            </>
          }
        >
          <div
            style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
            onClick={handleEmptyAreaClick}
            onContextMenu={handleEmptyAreaContextMenu}
          >
            <ListView
              items={items}
              rootRole="tree"
              ariaLabel={t('sidebar.workspace')}
              selectedIds={selectedItemId ? [selectedItemId] : []}
              activeId={activeId}
              expandedIds={expandedIds}
              isRenameable
              expandOnChevronOnly
              onItemToggle={onItemToggle}
              onItemClick={handleItemClick}
              onItemDrop={onItemDrop}
              onItemRename={onItemRename}
              editingItemId={editingItemId}
              onEditingStart={onEditingStart}
              onEditingEnd={onEditingEnd}
              onDeleteRequest={onDeleteRequest}
              data-testid="sidebar-listview"
            />
            <div style={{ flex: 1, minHeight: 20 }} />
          </div>
          <ContextMenu
            visible={emptyAreaMenu.visible}
            x={emptyAreaMenu.x}
            y={emptyAreaMenu.y}
            items={[
              {
                id: 'create-folder',
                label: t('sidebar.contextMenu.createFolder'),
                onClick: () => { onCreateRootFolder(); closeEmptyAreaMenu() }
              },
              {
                id: 'create-env-folder',
                label: t('sidebar.contextMenu.createEnvironmentFolder'),
                onClick: () => { onCreateRootEnvironmentFolder(); closeEmptyAreaMenu() }
              }
            ]}
            onRequestClose={closeEmptyAreaMenu}
          />
        </Pane>
      </SplitView>
    </div>
  )
}

export default RestormSidebar
