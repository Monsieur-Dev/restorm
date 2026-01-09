import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListView,
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
  expandedIds: string[]
  editingItemId: string | null
  onItemClick: (itemId: string) => void
  onItemToggle: (payload: ListViewItemEventPayload, expanded: boolean) => void
  onItemDrop: (payload: ListViewDropEventPayload) => void
  onItemRename: (payload: ListViewItemEventPayload, newName: string) => void
  onDeleteRequest: (payload: ListViewItemEventPayload) => void
  onEditingEnd: () => void
  onAddRequest: () => void
  onCollapseAll: () => void
}

/**
 * Sidebar component with workspace navigation and folder tree
 */
export const RestormSidebar: React.FC<RestormSidebarProps> = ({
  items,
  selectedItemId,
  expandedIds,
  editingItemId,
  onItemClick,
  onItemToggle,
  onItemDrop,
  onItemRename,
  onDeleteRequest,
  onEditingEnd,
  onAddRequest,
  onCollapseAll
}) => {
  const { t } = useTranslation()

  const handleItemClick = useCallback((payload: ListViewItemEventPayload) => {
    const id = payload.item.id
    if (id) {
      onItemClick(id)
    }
  }, [onItemClick])

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
      <SplitView orientation="vertical" style={{ width: '100%', height: '100%' }}>
        <Pane
          title={t('sidebar.workspace')}
          collapsible={false}
          minSize={180}
          headerActions={
            <>
              <Button
                secondary
                small
                icon="add"
                options={{ ariaLabel: t('sidebar.addRequest'), title: t('sidebar.addRequest') }}
                onClick={onAddRequest}
              />
              <Button
                secondary
                small
                icon="collapse-all"
                options={{ ariaLabel: t('sidebar.collapseAll'), title: t('sidebar.collapseAll') }}
                onClick={onCollapseAll}
              />
            </>
          }
        >
          <ListView
            items={items}
            rootRole="tree"
            ariaLabel={t('sidebar.workspace')}
            selectedIds={selectedItemId ? [selectedItemId] : []}
            expandedIds={expandedIds}
            isRenameable
            expandOnChevronOnly
            onItemToggle={onItemToggle}
            onItemClick={handleItemClick}
            onItemDrop={onItemDrop}
            onItemRename={onItemRename}
            editingItemId={editingItemId}
            onEditingEnd={onEditingEnd}
            onDeleteRequest={onDeleteRequest}
          />
        </Pane>
      </SplitView>
    </div>
  )
}

export default RestormSidebar
