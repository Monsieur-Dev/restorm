import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollableElement } from '../ScrollableElement'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { startDragPreview } from '../../utils/dragPreview'
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

/**
 * MIME type stamped on a ListView drag's `dataTransfer`, in addition to
 * the item id carried on `text/plain`. It lets a drop target recognise a
 * ListView-originated drag during `dragover` (when payload data is not
 * yet readable, only the type list is) and distinguish it from arbitrary
 * text drags. The workbench external-drop channel keys on this to light
 * its split overlay for a dragged sidebar item.
 */
export const LIST_VIEW_DRAG_MIME = 'application/x-listview-item'

/**
 * MIME type stamped IN ADDITION to {@link LIST_VIEW_DRAG_MIME} when the drag
 * carries MORE THAN ONE row (a drag started on a row that belongs to a
 * multi-selection). Its data is the JSON array of the dragged ids in visual
 * order; its mere PRESENCE in `dataTransfer.types` lets a drop target tell a
 * multi-item drag apart during `dragover`, when the payload itself is not
 * yet readable — e.g. a workbench that accepts single sidebar items as
 * split-drops but must not light its overlay for a multi-item drag.
 */
export const LIST_VIEW_MULTI_DRAG_MIME = 'application/x-listview-items'

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

    let isExpanded = false
    if (hasChildren) {
      isExpanded = expanded.has(item.id)
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

const ListViewInner: React.FC<ListViewProps> = ({
  items,
  children,
  className,
  style,
  'data-testid': dataTestId,
  scrollableTestId: scrollableTestIdProp,
  contextMenuTestId: contextMenuTestIdProp,
  selectedIds: selectedIdsProp,
  activeId: activeIdProp,
  expandedIds: expandedIdsProp,
  editingItemId: editingItemIdProp,
  onEditingStart,
  onEditingEnd,
  selectionMode = 'single',
  rootRole = 'tree',
  ariaLabel,
  isRenameable = false,
  renameShortcut = 'F2',
  expandOnChevronOnly = false,
  onItemClick,
  onItemDoubleClick,
  onItemAuxClick,
  onSelectionChange,
  onItemToggle,
  onItemDrop,
  onItemContextMenu,
  onItemRename,
  onItemMouseEnter,
  onItemMouseLeave,
  onDeleteRequest,
  disableDrag = false,
  canDrop,
  selectionContextMenuItems,
  dragExpandDelayMs = null,
  onEmptyAreaDrop
}) => {
  const rootTestId = dataTestId ?? 'list-view'
  const scrollableTestId = scrollableTestIdProp ?? `${rootTestId}-scrollable`
  const contextMenuTestId = contextMenuTestIdProp ?? `${rootTestId}-contextmenu`

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
  // Anchor payload + every dragged row (== [anchor] outside a multi-drag).
  const [dragSource, setDragSource] = useState<ListViewItemEventPayload | null>(null)
  const dragSourcesRef = useRef<ListViewItemEventPayload[]>([])
  // The live ghost element, so dragover validation can flip its error badge
  // without re-rendering anything.
  const dragGhostRef = useRef<HTMLElement | null>(null)
  // Pending expand-on-hover timer for a collapsed container hovered mid-drag.
  const dragExpandTimerRef = useRef<{ targetId: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  // Ref mirrors so the drag/context handlers can read the live selection
  // without listing it as a dependency — every dependency added to a row
  // handler recreates the handler on each selection change, re-rendering
  // every row mid-interaction (a real click's mousedown→click window is
  // wide enough for that re-render to detach the clicked node and swallow
  // the click entirely).
  const selectedIdsRef = useRef(selectedIds)
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])
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

  // Inline rename state (supports controlled mode via editingItemIdProp)
  const [internalEditingItemId, setInternalEditingItemId] = useState<string | null>(null)
  // Store both the itemId and value to avoid effect-based sync
  const [editingState, setEditingState] = useState<{ itemId: string | null; value: string }>({ itemId: null, value: '' })
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  
  // Use controlled editingItemId if provided, otherwise use internal state
  const isEditingControlled = editingItemIdProp !== undefined
  const editingItemId = isEditingControlled ? editingItemIdProp : internalEditingItemId
  
  const setEditingItemId = useCallback((id: string | null) => {
    if (!isEditingControlled) {
      setInternalEditingItemId(id)
    }
    if (id !== null && isEditingControlled && onEditingStart) {
      onEditingStart(id)
    }
    if (id === null && onEditingEnd) {
      onEditingEnd()
    }
  }, [isEditingControlled, onEditingStart, onEditingEnd])

  // Controlled selection support. Guarded by CONTENT, not identity: a parent
  // that rebuilds the array every render (`selectedIds={sel ? [sel] : []}`)
  // would otherwise clobber a ctrl+click multi-selection on the very next
  // render — the mirror must only fire when the mirrored ids actually moved.
  React.useEffect(() => {
    if (!selectedIdsProp) return
    setSelectedIds((prev) => {
      if (prev.size === selectedIdsProp.length && selectedIdsProp.every((id) => prev.has(id))) {
        return prev
      }
      const next = new Set(selectedIdsProp)
      selectedIdsRef.current = next
      return next
    })
  }, [selectedIdsProp])

  // Controlled expansion support
  React.useEffect(() => {
    if (expandedIdsProp === undefined) return
    setExpandedIds(new Set(expandedIdsProp))
  }, [expandedIdsProp, setExpandedIds])

  // Track previous activeIdProp to detect real changes
  const prevActiveIdPropRef = useRef<string | null | undefined>(undefined)

  // Controlled active item support + ensure parents are expanded
  React.useEffect(() => {
    if (activeIdProp === undefined || activeIdProp === null) return
    
    // Only update if activeIdProp actually changed (not just when initialItems changed)
    const activeIdPropChanged = prevActiveIdPropRef.current !== activeIdProp
    prevActiveIdPropRef.current = activeIdProp
    
    if (!activeIdPropChanged) return
    
    shouldScrollRef.current = true // Enable scroll when controlled activeId changes
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
  }, [activeIdProp, initialItems, setExpandedIds])

  const flatItems = useMemo<FlatItem[]>(() => {
    return flattenItems(initialItems, expandedIds)
  }, [initialItems, expandedIds])

  // Ref mirror for the same reason as `selectedIdsRef` above: lets the drag
  // handlers walk the visible rows without re-creating themselves whenever
  // the flattened tree changes.
  const flatItemsRef = useRef(flatItems)
  useEffect(() => { flatItemsRef.current = flatItems }, [flatItems])

  // Derive editingValue: if editingState was set for a different item, compute initial value
  const editingValue = useMemo(() => {
    if (!editingItemId) return ''
    if (editingState.itemId === editingItemId) return editingState.value
    // Compute initial value for the current editing item
    const flat = flatItems.find((f) => f.item.id === editingItemId)
    return flat && typeof flat.item.title === 'string' ? flat.item.title : ''
  }, [editingItemId, editingState, flatItems])

  // Wrapper to update editing value while keeping track of itemId
  const setEditingValue = useCallback((value: string) => {
    setEditingState({ itemId: editingItemId, value })
  }, [editingItemId])

  // Track if scroll should happen (only on user interaction, not on expand/collapse)
  const shouldScrollRef = useRef(false)

  // Function to scroll active item into view (called explicitly when needed)
  const scrollActiveIntoView = useCallback(() => {
    const container = listRef.current
    if (!container) return

    const row = container.querySelector<HTMLDivElement>('.list-view-row.is-active')
    if (!row) return

    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  // Scroll to active item only when explicitly requested
  React.useEffect(() => {
    if (!activeId) return
    if (!shouldScrollRef.current) return

    // Clear flag and scroll in RAF to avoid sync mutation
    requestAnimationFrame(() => {
      shouldScrollRef.current = false
      scrollActiveIntoView()
    })
  }, [activeId, scrollActiveIntoView])

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
      // Emit in VISUAL order, not Set-insertion order: consumers feed this
      // straight into clipboard/menu actions, and ctrl+clicking A, C, B
      // must not deliver a click-order list. Ids not currently visible
      // (inside a collapsed subtree) keep their insertion order at the end.
      const visualOrder = flatItems.filter((fi) => nextSelected.has(fi.item.id)).map((fi) => fi.item.id)
      const visible = new Set(visualOrder)
      for (const id of nextSelected) {
        if (!visible.has(id)) visualOrder.push(id)
      }
      onSelectionChange(visualOrder, payload)
    },
    [onSelectionChange, flatItems]
  )

  const handleToggle = useCallback(
    (flat: FlatItem, event: React.KeyboardEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>): void => {
      const hasChildren = Array.isArray(flat.item.children) && flat.item.children.length > 0
      if (!hasChildren) return

      // Controlled expansion: delegate state to parent via onItemToggle only.
      if (expandedIdsProp !== undefined) {
        if (onItemToggle) {
          const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
          onItemToggle(payload, !flat.isExpanded, event)
        }
        return
      }

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
    [expandedIdsProp, onItemToggle, setExpandedIds]
  )

  // Recompute initial expansion when the item tree changes,
  // but only until the user has interacted with expansion state.
  React.useEffect(() => {
    // Controlled expansion: do not recompute internal state.
    if (expandedIdsProp !== undefined) {
      return
    }
    if (hasCustomExpansion) {
      return
    }
    setExpandedIds(computeInitialExpandedIds(initialItems))
  }, [initialItems, hasCustomExpansion, expandedIdsProp, setExpandedIds])

  const handleSelect = useCallback(
    (flat: FlatItem, event: React.MouseEvent<HTMLDivElement>): void => {
      if (flat.item.isSelectable === false) return

      const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
      setActiveId(flat.item.id)

      // The next selection is computed OUTSIDE the state updater: emitting
      // the change from inside `setSelectedIds`'s updater ran a parent
      // setState during THIS component's render — React flags it in dev
      // ("Cannot update a component while rendering a different component")
      // and may drop or defer the update in production. Reading the live
      // ref (kept in sync below) keeps rapid click→ctrl+click sequences
      // accurate even when React batches the renders.
      const prev = selectedIdsRef.current
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

      selectedIdsRef.current = next
      setSelectedIds(next)
      emitSelectionChange(payload, next)

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
    [isRenameable, setEditingItemId, setEditingValue]
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
    [editingItemId, editingValue, onItemRename, setEditingItemId]
  )

  // Cancel rename without saving
  const cancelRename = useCallback((): void => {
    setEditingItemId(null)
    setEditingValue('')
  }, [setEditingItemId, setEditingValue])

  // Focus the rename input when editing starts. Two complementary paths:
  //
  // 1. The effect handles "editingItemId changed while the input is already
  //    mounted".
  // 2. The callback ref handles "the input mounts AFTER the effect ran" —
  //    e.g. creating the FIRST child of a previously-leaf parent drops the new
  //    row into edit mode, but that row only renders once the parent's
  //    expansion state lands, a commit after the editingItemId effect fired
  //    with a null ref. Focusing at attach time makes the behavior immune to
  //    that ordering: whenever the rename input enters the DOM, it grabs
  //    focus and selects its text so the user can type the name right away.
  useEffect(() => {
    if (editingItemId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [editingItemId])
  const attachRenameInput = useCallback((el: HTMLInputElement | null): void => {
    renameInputRef.current = el
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

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

      // Select-all — every VISIBLE selectable row (collapsed subtrees stay
      // out: selecting what the user cannot see invites surprise bulk
      // operations). Only meaningful in multiple mode.
      if (selectionMode === 'multiple' && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        const next = new Set<string>()
        for (const fi of flatItems) {
          if (fi.item.isSelectable !== false) next.add(fi.item.id)
        }
        const anchor = flatItems[currentIndex] ?? flatItems[0]
        if (anchor) {
          selectedIdsRef.current = next
          setSelectedIds(next)
          emitSelectionChange({ item: anchor.item, path: anchor.path }, next)
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
        case 'Delete': {
          const flat = flatItems[currentIndex]
          if (flat && onDeleteRequest) {
            event.preventDefault()
            const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
            onDeleteRequest(payload)
          }
          return
        }
        default:
          return
      }

      const flat = nextIndex !== currentIndex ? flatItems[nextIndex] : undefined
      if (flat) {
        requestAnimationFrame(() => {
          shouldScrollRef.current = true // Enable scroll for keyboard navigation
        })
        setActiveId(flat.item.id)
        const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }

        // Same out-of-updater emission rule as handleSelect.
        const next = new Set(selectedIdsRef.current)
        if (selectionMode === 'single') {
          next.clear()
          next.add(flat.item.id)
        }
        selectedIdsRef.current = next
        setSelectedIds(next)
        emitSelectionChange(payload, next)
      }
    },
    [flatItems, activeId, selectionMode, emitSelectionChange, findFlatIndexById, handleToggle, isRenameable, renameShortcut, startRename, editingItemId, onDeleteRequest]
  )

  const handleContextMenu = useCallback(
    (flat: FlatItem, event: React.MouseEvent<HTMLDivElement>): void => {
      event.preventDefault()

      // Select the item on right-click. In multiple mode the standard tree
      // behaviour applies: a right-click INSIDE the current selection keeps
      // it (so the group menu can act on it), a right-click OUTSIDE it
      // collapses the selection to the clicked row first. Selection is read
      // through its ref so this handler's identity doesn't follow it (see
      // the ref-mirror comment above).
      const liveSelected = selectedIdsRef.current
      setActiveId(flat.item.id)
      if (selectionMode === 'single' || !liveSelected.has(flat.item.id)) {
        const next = new Set([flat.item.id])
        selectedIdsRef.current = next
        setSelectedIds(next)
        const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
        emitSelectionChange(payload, next)
      }

      const hasBuiltinMenu = Array.isArray(flat.item.contextMenuItems) && flat.item.contextMenuItems.length > 0
      const isGroupMenu = selectionMode === 'multiple' && liveSelected.size > 1 &&
        liveSelected.has(flat.item.id) && selectionContextMenuItems !== undefined

      if (hasBuiltinMenu || isGroupMenu) {
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
    [onItemContextMenu, selectionMode, emitSelectionChange, selectionContextMenuItems]
  )

  const clearDragExpandTimer = useCallback((): void => {
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current.timer)
      dragExpandTimerRef.current = null
    }
  }, [])

  // Unmounting mid-drag must not leave the pending expansion firing into a
  // dead tree (handleToggle after unmount).
  useEffect(() => clearDragExpandTimer, [clearDragExpandTimer])

  const handleDragStart = useCallback(
    (flat: FlatItem, event: React.DragEvent<HTMLDivElement>): void => {
      const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
      // A drag that starts on a row belonging to a MULTI-selection carries
      // the whole selection (visual order); any other drag carries just the
      // grabbed row — including a drag on an unselected row while a
      // selection exists elsewhere, which matches every desktop tree.
      // Selection + rows come through refs so this handler's identity never
      // follows the selection (see the ref-mirror comment above).
      const liveSelected = selectedIdsRef.current
      const isMultiDrag = selectionMode === 'multiple' && liveSelected.size > 1 && liveSelected.has(flat.item.id)
      const sources: ListViewItemEventPayload[] = isMultiDrag
        ? flatItemsRef.current.filter((fi) => liveSelected.has(fi.item.id)).map((fi) => ({ item: fi.item, path: fi.path }))
        : [payload]

      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', flat.item.id)
      // Marker MIME so drop targets can recognise this as a ListView item
      // drag during `dragover` (the `text/plain` payload isn't readable
      // until `drop`). `setData` can throw in locked-down environments.
      try { event.dataTransfer.setData(LIST_VIEW_DRAG_MIME, flat.item.id) } catch { /* ignore */ }
      if (sources.length > 1) {
        // Presence of this MIME in `types` is how a target detects a
        // multi-item drag during dragover; its payload carries every id.
        try {
          event.dataTransfer.setData(LIST_VIEW_MULTI_DRAG_MIME, JSON.stringify(sources.map((s) => s.item.id)))
        } catch { /* ignore */ }
      }

      // Custom drag preview (native setDragImage is blank under Wayland).
      const row = event.currentTarget
      const rect = row.getBoundingClientRect()
      const preview = row.cloneNode(true) as HTMLElement
      preview.style.width = `${rect.width}px`
      preview.classList.add('list-view-row-drag-ghost')
      if (sources.length > 1) {
        const badge = document.createElement('span')
        badge.className = 'list-view-drag-ghost-badge'
        badge.textContent = String(sources.length)
        preview.appendChild(badge)
      }
      // Error badge, hidden until a dragover validation flags the hovered
      // target as invalid (`is-invalid` on the ghost reveals it).
      const errorBadge = document.createElement('span')
      errorBadge.className = 'list-view-drag-ghost-error codicon codicon-error-small'
      errorBadge.setAttribute('aria-hidden', 'true')
      preview.appendChild(errorBadge)

      startDragPreview(event, {
        preview,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        mountInto: row.closest<HTMLElement>('.workbench')
      })
      dragGhostRef.current = preview
      dragSourcesRef.current = sources
      setDragSource(payload)
    },
    [selectionMode]
  )

  const handleDragOver = useCallback(
    (flat: FlatItem, event: React.DragEvent<HTMLDivElement>): void => {
      if (!dragSource) return
      const position = getDropPosition(event)
      const target: ListViewItemEventPayload = { item: flat.item, path: flat.path }

      const isValid = canDrop === undefined || canDrop(dragSourcesRef.current, target, position)
      dragGhostRef.current?.classList.toggle('is-invalid', !isValid)

      // Expand a collapsed container after a hover delay, valid target or
      // not — mid-drag expansion is navigation, and the user may only be
      // passing through to reach a deeper valid target.
      if (dragExpandDelayMs !== null && !flat.isLeaf && !flat.isExpanded) {
        if (dragExpandTimerRef.current?.targetId !== flat.item.id) {
          clearDragExpandTimer()
          dragExpandTimerRef.current = {
            targetId: flat.item.id,
            timer: setTimeout(() => {
              dragExpandTimerRef.current = null
              handleToggle(flat, event as unknown as React.MouseEvent<HTMLDivElement>)
            }, dragExpandDelayMs)
          }
        }
      } else if (dragExpandTimerRef.current?.targetId === flat.item.id) {
        // The row expanded (or turned leaf) under the pending timer.
        clearDragExpandTimer()
      }

      if (!isValid) {
        // No preventDefault: the browser reports the row as a non-target
        // (forbidden cursor), and the indicator stays off.
        event.dataTransfer.dropEffect = 'none'
        setDropIndicator(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setDropIndicator({ targetId: flat.item.id, position })
    },
    [dragSource, canDrop, dragExpandDelayMs, clearDragExpandTimer, handleToggle]
  )

  const handleDragLeave = useCallback((): void => {
    setDropIndicator(null)
    dragGhostRef.current?.classList.remove('is-invalid')
    // Leaving the row must also disarm the pending expand-on-hover timer —
    // otherwise dragging PAST a collapsed container (e.g. into the empty
    // area below the list) still pops it open a second later.
    clearDragExpandTimer()
  }, [clearDragExpandTimer])

  const handleDragEnd = useCallback((): void => {
    clearDragExpandTimer()
    dragGhostRef.current = null
    dragSourcesRef.current = []
    setDragSource(null)
    setDropIndicator(null)
  }, [clearDragExpandTimer])

  // Empty-area drop target (below/beside the rows). Row events bubble up to
  // the scrollable content, so both handlers ignore anything whose target
  // sits inside a row — the row handlers own those. Only wired when the
  // consumer opted in via `onEmptyAreaDrop`.
  const handleEmptyAreaDragOver = useCallback((event: React.DragEvent<HTMLElement>): void => {
    if (!dragSource || !onEmptyAreaDrop) return
    if (event.target instanceof Element && event.target.closest('.list-view-row')) return
    // Hovering the empty area is never an "expand this container" gesture.
    clearDragExpandTimer()
    dragGhostRef.current?.classList.remove('is-invalid')
    setDropIndicator(null)
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [dragSource, onEmptyAreaDrop, clearDragExpandTimer])

  const handleEmptyAreaDrop = useCallback((event: React.DragEvent<HTMLElement>): void => {
    if (!dragSource || !onEmptyAreaDrop) return
    if (event.target instanceof Element && event.target.closest('.list-view-row')) return
    event.preventDefault()
    clearDragExpandTimer()
    setDropIndicator(null)
    const sources = dragSourcesRef.current.length > 0 ? dragSourcesRef.current : [dragSource]
    onEmptyAreaDrop(sources, event)
  }, [dragSource, onEmptyAreaDrop, clearDragExpandTimer])

  const handleDrop = useCallback(
    (flat: FlatItem, event: React.DragEvent<HTMLDivElement>): void => {
      clearDragExpandTimer()
      if (!dragSource || !onItemDrop) {
        setDropIndicator(null)
        return
      }
      const position = getDropPosition(event)
      const target: ListViewItemEventPayload = { item: flat.item, path: flat.path }
      // Final validation guard — dragover already filtered, but a drop can
      // land without a matching dragover (synthetic events in tests, odd
      // browser timing), and a consumer-refused move must never fire.
      if (canDrop !== undefined && !canDrop(dragSourcesRef.current, target, position)) {
        setDropIndicator(null)
        return
      }
      event.preventDefault()
      const payload: ListViewDropEventPayload = {
        item: flat.item,
        path: flat.path,
        source: dragSource.item,
        sourcePath: dragSource.path,
        sources: dragSourcesRef.current.length > 0 ? dragSourcesRef.current : [dragSource],
        position,
        originalEvent: event
      }
      setDropIndicator(null)
      onItemDrop(payload)
    },
    [dragSource, onItemDrop, canDrop, clearDragExpandTimer]
  )

  const rootClasses = ['list-view-root', className].filter(Boolean).join(' ')

  const contextMenuItems: ContextMenuItem[] | null = useMemo(() => {
    if (!contextMenu.visible || !contextMenu.item) return null
    const flat = contextMenu.item

    // A multi-selection that includes the clicked row gets the GROUP menu:
    // per-row entries close over one item id, which is exactly wrong when
    // three rows are selected — the consumer's builder receives the whole
    // selection instead. Falls through to the per-row menu when the builder
    // declines (returns null/empty).
    if (selectionMode === 'multiple' && selectedIds.size > 1 &&
        selectedIds.has(flat.item.id) && selectionContextMenuItems) {
      const orderedIds = flatItems.filter((fi) => selectedIds.has(fi.item.id)).map((fi) => fi.item.id)
      const groupItems = selectionContextMenuItems(orderedIds)
      if (groupItems && groupItems.length > 0) return groupItems
    }

    const sourceItems = flat.item.contextMenuItems
    if (!sourceItems || sourceItems.length === 0) return null
    // Wrap onClick handlers to intercept 'rename-item' action
    return sourceItems.map((menuItem) => ({
      ...menuItem,
      onClick: () => {
        if (menuItem.id === 'rename-item' && isRenameable) {
          startRename(flat)
        }
        menuItem.onClick?.()
      }
    }))
  }, [contextMenu, isRenameable, startRename, selectionMode, selectedIds, selectionContextMenuItems, flatItems])

  const isReady = flatItems.length > 0 || initialItems.length === 0

  return (
    <div className={rootClasses} style={style} data-testid={rootTestId} data-ready={isReady}>
      <ScrollableElement
        className="list-view-scrollable"
        data-testid={scrollableTestId}
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
        {...(onEmptyAreaDrop && !disableDrag ? {
          onDragOver: handleEmptyAreaDragOver,
          onDrop: handleEmptyAreaDrop
        } : {})}
      >
        {flatItems.map((flat) => {
            const { item, depth, isLeaf, isExpanded } = flat
            const isSelected = selectedIds.has(item.id)
            const isActive = activeId === item.id
            const dropForThisRow =
              dropIndicator?.targetId === item.id ? dropIndicator.position : null

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

            const handleRowAuxClick = (event: React.MouseEvent<HTMLDivElement>): void => {
              if (event.button !== 1) return
              if (!onItemAuxClick) return
              event.preventDefault()
              const payload: ListViewItemEventPayload = { item: item, path: flat.path }
              onItemAuxClick(payload, event)
            }

            const handleRowMouseEnter = (event: React.MouseEvent<HTMLDivElement>): void => {
              if (!onItemMouseEnter) return
              const payload: ListViewItemEventPayload = { item: item, path: flat.path }
              onItemMouseEnter(payload, event)
            }

            const handleRowMouseLeave = (event: React.MouseEvent<HTMLDivElement>): void => {
              if (!onItemMouseLeave) return
              const payload: ListViewItemEventPayload = { item: item, path: flat.path }
              onItemMouseLeave(payload, event)
            }

            const isEditing = editingItemId === item.id
            const titleContent = isEditing ? (
              <input
                ref={attachRenameInput}
                type="text"
                className="list-view-rename-input"
                data-testid={`${rootTestId}-rename-input`}
                data-item-id={item.id}
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

            const rowStyle: React.CSSProperties = {}
            const stickyLevel = item.isStickyHeader ? depth + 1 : 0

            return (
              <div
                key={item.id}
                className={rowClasses}
                style={rowStyle}
                data-sticky-level={stickyLevel}
                data-item-id={item.id}
                data-depth={depth}
                data-is-leaf={isLeaf ? 'true' : 'false'}
                {...(!isLeaf ? { 'data-is-expanded': isExpanded ? 'true' : 'false' } : {})}
                role={ariaRole}
                aria-level={depth + 1}
                aria-expanded={!isLeaf ? isExpanded : undefined}
                aria-selected={isSelected}
                draggable={!isEditing && !disableDrag}
                onClick={handleRowClick}
                onDoubleClick={handleRowDoubleClick}
                onAuxClick={handleRowAuxClick}
                onMouseEnter={handleRowMouseEnter}
                onMouseLeave={handleRowMouseLeave}
                onContextMenu={(event): void => {
                  handleContextMenu(flat, event)
                }}
                {...(disableDrag ? {} : {
                  onDragStart: (event: React.DragEvent<HTMLDivElement>): void => {
                    handleDragStart(flat, event)
                  },
                  onDragOver: (event: React.DragEvent<HTMLDivElement>): void => {
                    handleDragOver(flat, event)
                  },
                  onDragLeave: handleDragLeave,
                  onDragEnd: handleDragEnd,
                  onDrop: (event: React.DragEvent<HTMLDivElement>): void => {
                    handleDrop(flat, event)
                  }
                })}
              >
                {/* Indents positioned absolutely to span full row height */}
                <div className="list-view-indents" aria-hidden="true">
                  {Array.from({ length: depth }).map((_, idx) => (
                    <span key={idx} className="indent-guide" />
                  ))}
                  {depth > 0 && isLeaf && <span className="indent-spacer" />}
                </div>
                <div
                  className="list-view-row-inner"
                  style={{ paddingLeft: depth * 12 }}
                >
                  <button
                    type="button"
                    className="list-view-expander"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    style={isLeaf && !item.isExpandable ? { visibility: 'hidden' } : undefined}
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
          data-testid={contextMenuTestId}
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

export const ListView = React.memo(ListViewInner)
export default ListView
