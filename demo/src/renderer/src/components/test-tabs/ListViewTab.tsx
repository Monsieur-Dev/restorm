import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ListView } from 'electron-core-ui/renderer'
import type { ListViewDropEventPayload, ListViewItemData, ListViewItemEventPayload } from 'electron-core-ui/renderer'

interface LastSelectionEvent {
  listId: string
  selectedIds: string[]
  itemId: string
}

interface LastToggleEvent {
  listId: string
  itemId: string
  expanded: boolean
}

interface LastRenameEvent {
  listId: string
  itemId: string
  newValue: string
}

interface LastDeleteEvent {
  listId: string
  itemId: string
}

interface LastDropEvent {
  listId: string
  sourceId: string
  targetId: string
  position: string
}

function makeLeafItems(prefix: string, count: number): ListViewItemData[] {
  const out: ListViewItemData[] = []
  for (let i = 0; i < count; i += 1) {
    out.push({ id: `${prefix}-${i}`, title: `${prefix} ${i}`, icon: 'file' })
  }
  return out
}

function updateListAfterDrop(items: ListViewItemData[], payload: ListViewDropEventPayload): ListViewItemData[] {
  const sourceId = payload.source.id
  const targetId = payload.item.id

  if (sourceId === targetId) return items

  const removeItem = (nodes: ListViewItemData[]): { nodes: ListViewItemData[]; removed: ListViewItemData | null } => {
    let removed: ListViewItemData | null = null
    const nextNodes: ListViewItemData[] = []

    for (const node of nodes) {
      if (node.id === sourceId) {
        removed = node
        continue
      }

      if (node.children && node.children.length > 0) {
        const childRes = removeItem(node.children)
        if (childRes.removed) {
          removed = childRes.removed
          nextNodes.push({ ...node, children: childRes.nodes })
        } else {
          nextNodes.push(node)
        }
      } else {
        nextNodes.push(node)
      }
    }

    return { nodes: nextNodes, removed }
  }

  const removal = removeItem(items)
  const dragged = removal.removed
  const withoutSource = removal.nodes
  if (dragged === null) return items

  const insertInto = (nodes: ListViewItemData[]): ListViewItemData[] => {
    return nodes.map((node) => {
      if (node.id === targetId && payload.position === 'into') {
        const children = node.children ? [...node.children, dragged] : [dragged]
        return { ...node, children }
      }
      if (node.children && node.children.length > 0) {
        return { ...node, children: insertInto(node.children) }
      }
      return node
    })
  }

  const insertAtSameLevel = (nodes: ListViewItemData[]): ListViewItemData[] => {
    const result: ListViewItemData[] = []
    for (const node of nodes) {
      if (node.id === targetId) {
        if (payload.position === 'before') {
          result.push(dragged)
          result.push(node)
        } else if (payload.position === 'after') {
          result.push(node)
          result.push(dragged)
        } else {
          result.push(node)
        }
      } else {
        result.push(node)
      }
    }
    return result
  }

  const insertBeforeAfterDeep = (nodes: ListViewItemData[]): ListViewItemData[] => {
    const atLevel = insertAtSameLevel(nodes)
    return atLevel.map((node) => {
      if (node.children && node.children.length > 0) {
        return { ...node, children: insertBeforeAfterDeep(node.children) }
      }
      return node
    })
  }

  if (payload.position === 'into') return insertInto(withoutSource)
  return insertBeforeAfterDeep(withoutSource)
}

const ListViewTab: React.FC = () => {
  const { t } = useTranslation()

  const contextMenuItems = useMemo(() => ([
    { id: 'rename-item', label: 'Rename' },
    { id: 'action', label: 'Action' }
  ]), [])

  const initialBasicItems = useMemo<ListViewItemData[]>(() => ([
    {
      id: 'folder-a',
      title: 'Folder A',
      isExpandable: true,
      isStickyHeader: true,
      children: [
        {
          id: 'folder-a-sub',
          title: 'Subfolder A',
          isExpandable: true,
          isStickyHeader: true,
          children: makeLeafItems('a-sub', 40)
        }
      ]
    },
    {
      id: 'folder-b',
      title: 'Folder B (collapsed by isExpanded=false)',
      isExpandable: true,
      isStickyHeader: true,
      isExpanded: false,
      children: [
        { id: 'b-0', title: 'B 0', icon: 'file' }
      ]
    },
    {
      id: 'file-root-0',
      title: 'Root file 0',
      icon: 'file',
      contextMenuItems
    }
  ]), [contextMenuItems])

  const initialControlledItems = useMemo<ListViewItemData[]>(() => ([
    {
      id: 'ctrl-folder',
      title: 'Ctrl folder',
      isExpandable: true,
      isStickyHeader: true,
      children: [{ id: 'ctrl-child-0', title: 'Ctrl child 0', icon: 'file' }]
    }
  ]), [])

  const initialMultiItems = useMemo<ListViewItemData[]>(() => (makeLeafItems('m', 12)), [])
  // Virtualisation harness: far more rows than the 200px box can show.
  const initialVirtualItems = useMemo<ListViewItemData[]>(() => (makeLeafItems('v', 5000)), [])

  const [basicItems, setBasicItems] = useState<ListViewItemData[]>(initialBasicItems)
  // Follow-tail harness: a short list that grows by 20 rows per click.
  const [tailItems, setTailItems] = useState<ListViewItemData[]>(() => makeLeafItems('t', 20))
  const appendTailRows = useCallback(() => {
    setTailItems((prev) => [...prev, ...makeLeafItems('t', 20).map((_item, i) => ({ id: `t-${String(prev.length + i)}`, title: `Tail ${String(prev.length + i)}` }))])
  }, [])
  const [controlledExpandedIds] = useState<string[]>([])

  const [lastSelection, setLastSelection] = useState<LastSelectionEvent | null>(null)
  const [lastToggle, setLastToggle] = useState<LastToggleEvent | null>(null)
  const [lastRename, setLastRename] = useState<LastRenameEvent | null>(null)
  const [lastDelete, setLastDelete] = useState<LastDeleteEvent | null>(null)
  const [lastDrop, setLastDrop] = useState<LastDropEvent | null>(null)

  const onSelectionChange = useCallback((listId: string) => (selectedIds: string[], payload: ListViewItemEventPayload) => {
    setLastSelection({ listId, selectedIds, itemId: payload.item.id })
  }, [])

  const onItemToggle = useCallback((listId: string) => (payload: ListViewItemEventPayload, expanded: boolean) => {
    setLastToggle({ listId, itemId: payload.item.id, expanded })
  }, [])

  const onItemRename = useCallback((listId: string) => (payload: ListViewItemEventPayload, newValue: string) => {
    setLastRename({ listId, itemId: payload.item.id, newValue })
  }, [])

  const onDeleteRequest = useCallback((listId: string) => (payload: ListViewItemEventPayload) => {
    setLastDelete({ listId, itemId: payload.item.id })
  }, [])

  const onItemDrop = useCallback((listId: string) => (payload: ListViewDropEventPayload) => {
    setLastDrop({ listId, sourceId: payload.source.id, targetId: payload.item.id, position: payload.position })
    if (listId === 'listview-basic') {
      setBasicItems((prev) => updateListAfterDrop(prev, payload))
    }
  }, [])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 980, padding: 20 }}>
      <div data-testid="listview-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('listView.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ opacity: 0.7 }}>{t('listView.harness.basic')}</div>
        <div style={{ height: 260, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
          <ListView
            data-testid="listview-basic"
            items={basicItems}
            rootRole="tree"
            ariaLabel="ListView basic"
            isRenameable
            onSelectionChange={onSelectionChange('listview-basic')}
            onItemToggle={onItemToggle('listview-basic')}
            onItemRename={onItemRename('listview-basic')}
            onDeleteRequest={onDeleteRequest('listview-basic')}
            onItemDrop={onItemDrop('listview-basic')}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ opacity: 0.7 }}>{t('listView.harness.controlledExpansion')}</div>
        <div style={{ height: 200, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
          <ListView
            data-testid="listview-controlled"
            items={initialControlledItems}
            rootRole="tree"
            ariaLabel="ListView controlled expansion"
            expandedIds={controlledExpandedIds}
            onItemToggle={onItemToggle('listview-controlled')}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ opacity: 0.7 }}>{t('listView.harness.multipleSelection')}</div>
        <div style={{ height: 200, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
          <ListView
            data-testid="listview-multi"
            items={initialMultiItems}
            rootRole="list"
            ariaLabel="ListView multiple selection"
            selectionMode="multiple"
            onSelectionChange={onSelectionChange('listview-multi')}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ opacity: 0.7 }}>{t('listView.harness.virtualized')}</div>
        <div style={{ height: 200, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
          <ListView
            data-testid="listview-virtual"
            items={initialVirtualItems}
            rootRole="list"
            ariaLabel="ListView virtualised"
            virtualized
            rowHeight={26}
            onSelectionChange={onSelectionChange('listview-virtual')}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ opacity: 0.7 }}>{t('listView.harness.followTail')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button data-testid="listview-tail-append" onClick={appendTailRows}>{t('listView.harness.appendRows')}</Button>
        </div>
        <div style={{ height: 130, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
          <ListView
            data-testid="listview-tail"
            items={tailItems}
            rootRole="list"
            ariaLabel="ListView follow tail"
            virtualized
            rowHeight={26}
            followTail
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="listview-last-selection-listid">{lastSelection?.listId ?? ''}</div>
        <div data-testid="listview-last-selection-itemid">{lastSelection?.itemId ?? ''}</div>
        <div data-testid="listview-last-selection-ids">{lastSelection ? lastSelection.selectedIds.join(',') : ''}</div>

        <div data-testid="listview-last-toggle-listid">{lastToggle?.listId ?? ''}</div>
        <div data-testid="listview-last-toggle-itemid">{lastToggle?.itemId ?? ''}</div>
        <div data-testid="listview-last-toggle-expanded">{lastToggle ? String(lastToggle.expanded) : ''}</div>

        <div data-testid="listview-last-rename-listid">{lastRename?.listId ?? ''}</div>
        <div data-testid="listview-last-rename-itemid">{lastRename?.itemId ?? ''}</div>
        <div data-testid="listview-last-rename-value">{lastRename?.newValue ?? ''}</div>

        <div data-testid="listview-last-delete-listid">{lastDelete?.listId ?? ''}</div>
        <div data-testid="listview-last-delete-itemid">{lastDelete?.itemId ?? ''}</div>

        <div data-testid="listview-last-drop-listid">{lastDrop?.listId ?? ''}</div>
        <div data-testid="listview-last-drop-sourceid">{lastDrop?.sourceId ?? ''}</div>
        <div data-testid="listview-last-drop-targetid">{lastDrop?.targetId ?? ''}</div>
        <div data-testid="listview-last-drop-position">{lastDrop?.position ?? ''}</div>
      </div>
    </div>
  )
}

export default ListViewTab
