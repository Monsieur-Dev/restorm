import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollableElement } from '../ScrollableElement'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import type {
  ListViewDropEventPayload,
  ListViewDropPosition,
  ListViewItemData,
  ListViewItemEventPayload,
  ListViewItemPath,
  ListViewItemProps,
  ListViewProps
} from './types'
import './listView.css'

const ROW_HEIGHT = 22

interface FlatItem {
  item: ListViewItemData
  depth: number
  path: ListViewItemPath
  parent: ListViewItemData | null
  isLeaf: boolean
  isExpanded: boolean
}

/**
 * Marker component used only for JSX declaration.
 * It does not render anything by itself; the parent ListView
 * inspects its props and children to build the hierarchy.
 */
export const ListViewItem: React.FC<ListViewItemProps> = () => null

ListViewItem.displayName = 'ListViewItem'

function ensureIdFromPath(path: number[]): string {
  return `listview-${path.join('-')}`
}

function buildItemsFromChildren(children: React.ReactNode, parentPath: number[] = []): ListViewItemData[] {
  const items: ListViewItemData[] = []

  React.Children.forEach(children, (child, index) => {
    if (!React.isValidElement(child)) return
    if (child.type !== ListViewItem) return

    const props = child.props as ListViewItemProps
    const path = [...parentPath, index]

    const id = props.id ?? ensureIdFromPath(path)
    const item: ListViewItemData = {
      id,
      title: props.title,
      icon: props.icon,
      isExpanded: props.isExpanded ?? false,
      // Only include isExpandable when explicitly provided to satisfy
      // exactOptionalPropertyTypes and avoid passing `undefined`.
      ...(props.isExpandable !== undefined ? { isExpandable: props.isExpandable } : {}),
      isSelectable: props.isSelectable ?? true,
      isStickyHeader: props.isStickyHeader ?? false,
      data: props.data
    }

    if (props.children) {
      item.children = buildItemsFromChildren(props.children, path)
    }

    items.push(item)
  })

  return items
}

function createPath(ids: string[], indices: number[]): ListViewItemPath {
  return { ids, indices }
}

function flattenItems(
  items: ListViewItemData[],
  expanded: Set<string>,
  parent: ListViewItemData | null = null,
  depth = 0,
  parentIds: string[] = [],
  parentIndices: number[] = []
): FlatItem[] {
  const result: FlatItem[] = []

  items.forEach((item, index) => {
    const hasChildren = Array.isArray(item.children) && item.children.length > 0
    const pathIds = [...parentIds, item.id]
    const pathIndices = [...parentIndices, index]

    let isExpanded = hasChildren
    if (hasChildren && expanded.size > 0) {
      isExpanded = expanded.has(item.id)
    } else if (hasChildren && item.isExpanded !== undefined) {
      isExpanded = item.isExpanded
    }

    const flatItem: FlatItem = {
      item,
      depth,
      path: createPath(pathIds, pathIndices),
      parent,
      isLeaf: !hasChildren,
      isExpanded
    }

    result.push(flatItem)

    if (hasChildren && isExpanded) {
      result.push(...flattenItems(item.children ?? [], expanded, item, depth + 1, pathIds, pathIndices))
    }
  })

  return result
}

function computeInitialExpandedIds(items: ListViewItemData[]): Set<string> {
  const initial = new Set<string>()
  const visit = (list: ListViewItemData[]): void => {
    list.forEach((item) => {
      const hasChildren = Array.isArray(item.children) && item.children.length > 0
      if (!hasChildren) {
        return
      }
      if (item.isExpanded !== undefined) {
        if (item.isExpanded) {
          initial.add(item.id)
        }
      } else {
        initial.add(item.id)
      }
      visit(item.children ?? [])
    })
  }
  visit(items)
  return initial
}

function getDropPosition(event: React.DragEvent<HTMLDivElement>): ListViewDropPosition {
  const target = event.currentTarget
  const rect = target.getBoundingClientRect()
  const offsetY = event.clientY - rect.top
  const ratio = offsetY / rect.height

  if (ratio < 0.25) return 'before'
  if (ratio > 0.75) return 'after'
  return 'into'
}

interface DropIndicatorState {
  targetId: string
  position: ListViewDropPosition
}

export const ListView: React.FC<ListViewProps> = ({
  items,
  children,
  className,
  style,
  selectedIds: selectedIdsProp,
  activeId: activeIdProp,
  expandedIds: expandedIdsProp,
  selectionMode = 'single',
  rootRole = 'tree',
  ariaLabel,
  isRenameable = false,
  renameShortcut = 'F2',
  expandOnChevronOnly = false,
  onItemClick,
  onItemDoubleClick,
  onSelectionChange,
  onItemToggle,
  onItemDrop,
  onItemContextMenu,
  onItemRename
}) => {
  const initialItems = useMemo<ListViewItemData[]>(() => {
    if (items && items.length > 0) {
      return items
    }
    return buildItemsFromChildren(children)
  }, [items, children])

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => computeInitialExpandedIds(initialItems))
  const [hasCustomExpansion, setHasCustomExpansion] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dragSource, setDragSource] = useState<ListViewItemEventPayload | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    item: FlatItem | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    item: null
  })

  // Inline rename state
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState<string>('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  // Controlled selection support
  React.useEffect(() => {
    if (!selectedIdsProp) return
    const next = new Set(selectedIdsProp)
    setSelectedIds(next)
  }, [selectedIdsProp])

  // Controlled expansion support
  React.useEffect(() => {
    if (expandedIdsProp === undefined) return
    setExpandedIds(new Set(expandedIdsProp))
  }, [expandedIdsProp])

  // Controlled active item support + ensure parents are expanded
  React.useEffect(() => {
    if (activeIdProp === undefined || activeIdProp === null) return
    setActiveId(activeIdProp)

    // Expand all ancestors of the active item when activeId is controlled
    const findPath = (nodes: ListViewItemData[], targetId: string, parentIds: string[] = []): ListViewItemPath | null => {
      for (const item of nodes) {
        const ids = [...parentIds, item.id]
        if (item.id === targetId) {
          return createPath(ids, [])
        }
        if (item.children && item.children.length > 0) {
          const childPath = findPath(item.children, targetId, ids)
          if (childPath) return childPath
        }
      }
      return null
    }

    const path = findPath(initialItems, activeIdProp)
    if (!path) return

    const ancestorIds = path.ids.slice(0, -1)
    if (ancestorIds.length === 0) return

    setExpandedIds((prev) => {
      const next = new Set(prev)
      ancestorIds.forEach((id) => next.add(id))
      return next
    })
  }, [activeIdProp, initialItems])

  const flatItems = useMemo<FlatItem[]>(() => {
    return flattenItems(initialItems, expandedIds)
  }, [initialItems, expandedIds])

  // Scroll the active item into view when activeId changes
  React.useEffect(() => {
    if (!activeId) return
    const container = listRef.current
    if (!container) return

    const row = container.querySelector<HTMLDivElement>('.list-view-row.is-active')
    if (!row) return

    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId, flatItems.length])

  const findFlatIndexById = useCallback(
    (id: string | null): number => {
      if (!id) return -1
      return flatItems.findIndex((fi) => fi.item.id === id)
    },
    [flatItems]
  )

  const emitSelectionChange = useCallback(
    (payload: ListViewItemEventPayload, nextSelected: Set<string>): void => {
      if (!onSelectionChange) return
      onSelectionChange(Array.from(nextSelected), payload)
    },
    [onSelectionChange]
  )

  const handleToggle = useCallback(
    (flat: FlatItem, event: React.KeyboardEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>): void => {
      const hasChildren = Array.isArray(flat.item.children) && flat.item.children.length > 0
      if (!hasChildren) return
      setHasCustomExpansion(true)
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(flat.item.id)) {
          next.delete(flat.item.id)
        } else {
          next.add(flat.item.id)
        }
        return next
      })

      if (onItemToggle) {
        const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
        onItemToggle(payload, !flat.isExpanded, event)
      }
    },
    [onItemToggle]
  )

  // Recompute initial expansion when the item tree changes,
  // but only until the user has interacted with expansion state.
  React.useEffect(() => {
    if (hasCustomExpansion) {
      return
    }
    setExpandedIds(computeInitialExpandedIds(initialItems))
  }, [initialItems, hasCustomExpansion])

  const handleSelect = useCallback(
    (flat: FlatItem, event: React.MouseEvent<HTMLDivElement>): void => {
      if (flat.item.isSelectable === false) return

      const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
      setActiveId(flat.item.id)

      setSelectedIds((prev) => {
        const next = new Set(prev)
        const isSelected = next.has(flat.item.id)

        if (selectionMode === 'single') {
          next.clear()
          next.add(flat.item.id)
        } else {
          const isCtrlLike = event.metaKey || event.ctrlKey
          const isShiftLike = event.shiftKey

          if (isShiftLike && activeId) {
            next.clear()
            const startIndex = findFlatIndexById(activeId)
            const endIndex = findFlatIndexById(flat.item.id)
            if (startIndex >= 0 && endIndex >= 0) {
              const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
              for (let i = from; i <= to; i++) {
                const fi = flatItems[i]
                if (fi && fi.item.isSelectable !== false) {
                  next.add(fi.item.id)
                }
              }
            } else {
              next.add(flat.item.id)
            }
          } else if (isCtrlLike) {
            if (isSelected) {
              next.delete(flat.item.id)
            } else {
              next.add(flat.item.id)
            }
          } else {
            next.clear()
            next.add(flat.item.id)
          }
        }

        emitSelectionChange(payload, next)
        return next
      })

      if (onItemClick) {
        onItemClick(payload, event)
      }
    },
    [
      selectionMode,
      onItemClick,
      emitSelectionChange,
      activeId,
      findFlatIndexById,
      flatItems
    ]
  )

  const handleDoubleClick = useCallback(
    (flat: FlatItem, event: React.MouseEvent<HTMLDivElement>): void => {
      const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
      if (onItemDoubleClick) {
        onItemDoubleClick(payload, event)
      } else {
        // Delegate to toggle handler when no custom double-click is provided
        handleToggle(flat, event)
      }
    },
    [onItemDoubleClick, handleToggle]
  )

  // Start inline rename for an item
  const startRename = useCallback(
    (flat: FlatItem): void => {
      if (!isRenameable) return
      const titleStr = typeof flat.item.title === 'string' ? flat.item.title : ''
      setEditingItemId(flat.item.id)
      setEditingValue(titleStr)
    },
    [isRenameable]
  )

  // Commit the rename and notify parent
  const commitRename = useCallback(
    (flat: FlatItem): void => {
      if (!editingItemId) return
      const trimmed = editingValue.trim()
      const originalTitle = typeof flat.item.title === 'string' ? flat.item.title : ''
      setEditingItemId(null)
      if (trimmed && trimmed !== originalTitle && onItemRename) {
        const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
        onItemRename(payload, trimmed)
      }
    },
    [editingItemId, editingValue, onItemRename]
  )

  // Cancel rename without saving
  const cancelRename = useCallback((): void => {
    setEditingItemId(null)
    setEditingValue('')
  }, [])

  // Focus the rename input when editing starts
  useEffect(() => {
    if (editingItemId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [editingItemId])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      // Ignore keyboard navigation when editing
      if (editingItemId) return

      if (flatItems.length === 0) return

      const currentIndex = findFlatIndexById(activeId ?? (flatItems[0]?.item.id ?? null))
      let nextIndex = currentIndex

      // Check for rename shortcut
      if (isRenameable && event.key === renameShortcut) {
        const flat = flatItems[currentIndex]
        if (flat) {
          event.preventDefault()
          startRename(flat)
        }
        return
      }

      switch (event.key) {
        case 'ArrowDown':
          nextIndex = Math.min(flatItems.length - 1, currentIndex + 1)
          event.preventDefault()
          break
        case 'ArrowUp':
          nextIndex = Math.max(0, currentIndex - 1)
          event.preventDefault()
          break
        case 'ArrowRight': {
          const flat = flatItems[currentIndex]
          if (flat && !flat.isLeaf && !flat.isExpanded) {
            handleToggle(flat, event)
          }
          event.preventDefault()
          return
        }
        case 'ArrowLeft': {
          const flat = flatItems[currentIndex]
          if (flat && !flat.isLeaf && flat.isExpanded) {
            handleToggle(flat, event)
          }
          event.preventDefault()
          return
        }
        case 'Enter': {
          const flat = flatItems[currentIndex]
          if (flat) {
            handleToggle(flat, event)
          }
          event.preventDefault()
          return
        }
        default:
          return
      }

      const flat = nextIndex !== currentIndex ? flatItems[nextIndex] : undefined
      if (flat) {
        setActiveId(flat.item.id)
        const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }

        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (selectionMode === 'single') {
            next.clear()
            next.add(flat.item.id)
          }
          emitSelectionChange(payload, next)
          return next
        })
      }
    },
    [flatItems, activeId, selectionMode, emitSelectionChange, findFlatIndexById, handleToggle, isRenameable, renameShortcut, startRename, editingItemId]
  )

  const handleContextMenu = useCallback(
    (flat: FlatItem, event: React.MouseEvent<HTMLDivElement>): void => {
      event.preventDefault()

      const hasBuiltinMenu = Array.isArray(flat.item.contextMenuItems) && flat.item.contextMenuItems.length > 0

      if (hasBuiltinMenu) {
        setContextMenu({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          item: flat
        })
      }

      if (onItemContextMenu) {
        const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
        onItemContextMenu(payload, event)
      }
    },
    [onItemContextMenu]
  )

  const handleDragStart = useCallback(
    (flat: FlatItem, event: React.DragEvent<HTMLDivElement>): void => {
      const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
      setDragSource(payload)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', flat.item.id)
    },
    []
  )

  const handleDragOver = useCallback(
    (flat: FlatItem, event: React.DragEvent<HTMLDivElement>): void => {
      if (!dragSource) return
      event.preventDefault()
      const position = getDropPosition(event)
      setDropIndicator({ targetId: flat.item.id, position })
    },
    [dragSource]
  )

  const handleDragLeave = useCallback((): void => {
    setDropIndicator(null)
  }, [])

  const handleDrop = useCallback(
    (flat: FlatItem, event: React.DragEvent<HTMLDivElement>): void => {
      if (!dragSource || !onItemDrop) {
        setDropIndicator(null)
        return
      }
      event.preventDefault()
      const position = getDropPosition(event)
      const payload: ListViewDropEventPayload = {
        item: flat.item,
        path: flat.path,
        source: dragSource.item,
        sourcePath: dragSource.path,
        position,
        originalEvent: event
      }
      setDropIndicator(null)
      onItemDrop(payload)
    },
    [dragSource, onItemDrop]
  )

  const rootClasses = ['list-view-root', className].filter(Boolean).join(' ')

  const contextMenuItems: ContextMenuItem[] | null = useMemo(() => {
    if (!contextMenu.visible || !contextMenu.item) return null
    const sourceItems = contextMenu.item.item.contextMenuItems
    if (!sourceItems || sourceItems.length === 0) return null
    return sourceItems
  }, [contextMenu])

  return (
    <div className={rootClasses} style={style}>
      <ScrollableElement
        className="list-view-scrollable"
        options={{
          vertical: 'auto',
          horizontal: 'hidden',
          handleMouseWheel: true,
          mouseWheelSmoothScroll: true
        }}
        contentRef={listRef}
        contentClassName="list-view"
        role={rootRole}
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {flatItems.map((flat) => {
            const { item, depth, isLeaf, isExpanded } = flat
            const isSelected = selectedIds.has(item.id)
            const isActive = activeId === item.id
            const dropForThisRow =
              dropIndicator && dropIndicator.targetId === item.id ? dropIndicator.position : null

            const rowClasses = [
              'list-view-row',
              isSelected ? 'is-selected' : '',
              isActive ? 'is-active' : '',
              !isLeaf ? 'has-children' : '',
              dropForThisRow === 'before' ? 'drop-before' : '',
              dropForThisRow === 'after' ? 'drop-after' : '',
              dropForThisRow === 'into' ? 'drop-into' : ''
            ]
              .filter(Boolean)
              .join(' ')

            const ariaRole = rootRole === 'tree' ? 'treeitem' : 'listitem'

            const handleRowClick = (event: React.MouseEvent<HTMLDivElement>): void => {
              handleSelect(flat, event)

              // If expandOnChevronOnly is true, don't toggle on row click
              // (expansion is handled only by the chevron button)
              if (expandOnChevronOnly) {
                return
              }

              // If the item is expandable (has children or explicitly marked as expandable),
              // also toggle its expanded state when clicking anywhere on the row.
              const isExpandable = !isLeaf || item.isExpandable
              if (isExpandable) {
                handleToggle(flat, event)
              }
            }

            const handleRowDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
              handleDoubleClick(flat, event)
            }

            const isEditing = editingItemId === item.id
            const titleContent = isEditing ? (
              <input
                ref={renameInputRef}
                type="text"
                className="list-view-rename-input"
                value={editingValue}
                onChange={(e): void => { setEditingValue(e.target.value) }}
                onBlur={(): void => { commitRename(flat) }}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitRename(flat)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelRename()
                  }
                }}
                onClick={(e): void => { e.stopPropagation() }}
              />
            ) : (
              item.title
            )
            const iconContent =
              typeof item.icon === 'string' ? (
                <i className={`codicon codicon-${item.icon}`} aria-hidden="true" />
              ) : (
                item.icon
              )

            const rowStyle: React.CSSProperties = { height: ROW_HEIGHT }

            return (
              <div
                key={item.id}
                className={rowClasses}
                style={rowStyle}
                data-sticky-level={isLeaf ? 0 : depth+1}
                role={ariaRole}
                aria-level={depth + 1}
                aria-expanded={!isLeaf ? isExpanded : undefined}
                aria-selected={isSelected}
                draggable={!isEditing}
                onClick={handleRowClick}
                onDoubleClick={handleRowDoubleClick}
                onContextMenu={(event): void => {
                  handleContextMenu(flat, event)
                }}
                onDragStart={(event): void => {
                  handleDragStart(flat, event)
                }}
                onDragOver={(event): void => {
                  handleDragOver(flat, event)
                }}
                onDragLeave={handleDragLeave}
                onDrop={(event): void => {
                  handleDrop(flat, event)
                }}
              >
                <div className="list-view-row-inner">
                  <div className="list-view-indents" aria-hidden="true">
                    {Array.from({ length: depth }).map((_, idx) => (
                      <span key={idx} className="indent-guide" />
                    ))}
                    {depth > 0 && <span className="indent-spacer" />}
                  </div>
                  {(!isLeaf || item.isExpandable) && (
                    <button
                      type="button"
                      className="list-view-expander"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      onClick={(event): void => {
                        event.stopPropagation()
                        handleToggle(flat, event as unknown as React.MouseEvent<HTMLDivElement>)
                      }}
                    >
                      <i
                        className={`codicon ${
                          isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                  {iconContent && <span className="list-view-icon">{iconContent}</span>}
                  {item.leftActions && (
                    <span
                      className="list-view-left-actions"
                      onClick={(e): void => { e.stopPropagation() }}
                    >
                      {item.leftActions}
                    </span>
                  )}
                  <span className="list-view-title">{titleContent}</span>
                  {item.rightActions && (
                    <span
                      className={`list-view-right-actions${item.rightActionsOnHoverOnly ? ' hover-only' : ''}`}
                      onClick={(e): void => { e.stopPropagation() }}
                    >
                      {item.rightActions}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
      </ScrollableElement>
      {contextMenuItems && (
        <ContextMenu
          visible={contextMenu.visible}
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onRequestClose={() => {
            setContextMenu((prev) => ({ ...prev, visible: false }))
          }}
        />
      )}
    </div>
  )
}

export default ListView


