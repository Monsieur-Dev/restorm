import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollableElement } from '../ScrollableElement'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { usePersistedState } from '../../hooks/usePersistedState'
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

interface PersistenceMap {
  idToKey: Map<string, string>
  keyToId: Map<string, string>
}

function buildPersistenceMap(items: readonly ListViewItemData[]): PersistenceMap {
  const idToKey = new Map<string, string>()
  const keyToId = new Map<string, string>()
  const walk = (nodes: readonly ListViewItemData[]): void => {
    for (const node of nodes) {
      if (node.persistenceKey !== undefined && node.persistenceKey.length > 0) {
        idToKey.set(node.id, node.persistenceKey)
        // Last writer wins on duplicate persistenceKeys — that's a consumer
        // bug; refusing to load is worse than applying the last occurrence.
        keyToId.set(node.persistenceKey, node.id)
      }
      if (node.children && node.children.length > 0) walk(node.children)
    }
  }
  walk(items)
  return { idToKey, keyToId }
}

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
  persistenceKey,
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
  onSelectionChange,
  onItemToggle,
  onItemDrop,
  onItemContextMenu,
  onItemRename,
  onItemMouseEnter,
  onItemMouseLeave,
  onDeleteRequest
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

  // Optional auto-persistence for uncontrolled expansion. Only active when
  // `persistenceKey` is set AND the parent isn't driving `expandedIdsProp`;
  // in controlled mode the parent is the source of truth and is expected to
  // pair with `usePersistedState` itself.
  //
  // Binding model: the stored record is `{ persistenceKey: [item.persistenceKey, …] }`.
  // Only items that carry an explicit `persistenceKey` contribute — items
  // without one are in-memory only. The internal Set continues to key by
  // `item.id` so the rest of the component (selection, toggles, events)
  // stays unchanged; translation id ↔ persistenceKey happens at the
  // persistence boundary.
  const persistenceActive = expandedIdsProp === undefined && !!persistenceKey
  const effectivePersistenceKey = persistenceActive ? persistenceKey : null

  // Persistence map rebuilt from the tree on every items change. Paired
  // with a mirror ref so async callbacks (e.g. `usePersistedState.onRestore`)
  // can read the latest map without React treating it as a dependency.
  const persistenceMap = useMemo<PersistenceMap>(
    () => buildPersistenceMap(initialItems),
    [initialItems]
  )
  const persistenceMapRef = useRef<PersistenceMap>(persistenceMap)
  useEffect(() => {
    persistenceMapRef.current = persistenceMap
  }, [persistenceMap])

  const [persistedExpandedKeys, setPersistedExpandedKeys] = usePersistedState<string[]>(
    effectivePersistenceKey,
    [],
    {
      // Drop any stored persistence key that no longer maps to an item in
      // the current tree (deleted / renamed / not present in this branch).
      onRestore: (stored) => stored.filter((key) => persistenceMapRef.current.keyToId.has(key))
    }
  )

  // Session-only expansion. Holds the ids of items with NO persistenceKey —
  // they're never written to storage but remain toggleable during the
  // session. Also used as the single source of truth when persistence is
  // disabled.
  const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(
    () => computeInitialExpandedIds(initialItems)
  )
  const [hasCustomExpansion, setHasCustomExpansion] = useState(false)

  const persistedExpandedSet = useMemo(() => {
    const map = persistenceMap.keyToId
    const out = new Set<string>()
    for (const key of persistedExpandedKeys) {
      const id = map.get(key)
      if (id !== undefined) out.add(id)
    }
    return out
  }, [persistedExpandedKeys, persistenceMap])

  // When persistence is active: union of persisted-item ids and volatile
  // (no-persistenceKey) ids. Otherwise the plain internal Set.
  const expandedIds = useMemo<Set<string>>(() => {
    if (!persistenceActive) return internalExpandedIds
    const union = new Set(persistedExpandedSet)
    const idToKey = persistenceMap.idToKey
    for (const id of internalExpandedIds) {
      if (!idToKey.has(id)) union.add(id)
    }
    return union
  }, [persistenceActive, persistedExpandedSet, internalExpandedIds, persistenceMap])

  const setExpandedIds = useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>(
    (valueOrUpdater) => {
      if (!persistenceActive) {
        setInternalExpandedIds(valueOrUpdater)
        return
      }
      // Compute the next full Set (persistable + volatile combined).
      const computeNext = (prev: Set<string>): Set<string> =>
        typeof valueOrUpdater === 'function'
          ? (valueOrUpdater as (p: Set<string>) => Set<string>)(prev)
          : valueOrUpdater

      // Fan the result out into the two backing stores based on whether
      // each id has a persistenceKey. Both updates happen in functional form
      // so React's batching keeps them in lockstep.
      setPersistedExpandedKeys((prevKeys) => {
        const map = persistenceMapRef.current
        const prevPersistedSet = new Set<string>()
        for (const key of prevKeys) {
          const id = map.keyToId.get(key)
          if (id !== undefined) prevPersistedSet.add(id)
        }
        const prevFull = new Set(prevPersistedSet)
        for (const id of internalExpandedIds) prevFull.add(id)

        const next = computeNext(prevFull)
        const keys: string[] = []
        for (const id of next) {
          const key = map.idToKey.get(id)
          if (key !== undefined) keys.push(key)
        }
        return keys
      })
      setInternalExpandedIds((prevVolatile) => {
        const map = persistenceMapRef.current
        const prevPersistedSet = new Set<string>()
        for (const key of persistedExpandedKeys) {
          const id = map.keyToId.get(key)
          if (id !== undefined) prevPersistedSet.add(id)
        }
        const prevFull = new Set(prevPersistedSet)
        for (const id of prevVolatile) prevFull.add(id)

        const next = computeNext(prevFull)
        const volatile = new Set<string>()
        for (const id of next) {
          if (!map.idToKey.has(id)) volatile.add(id)
        }
        return volatile
      })
    },
    [persistenceActive, internalExpandedIds, persistedExpandedKeys, setPersistedExpandedKeys]
  )

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
      onSelectionChange(Array.from(nextSelected), payload)
    },
    [onSelectionChange]
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
    [flatItems, activeId, selectionMode, emitSelectionChange, findFlatIndexById, handleToggle, isRenameable, renameShortcut, startRename, editingItemId, onDeleteRequest]
  )

  const handleContextMenu = useCallback(
    (flat: FlatItem, event: React.MouseEvent<HTMLDivElement>): void => {
      event.preventDefault()

      // Select the item on right-click
      setActiveId(flat.item.id)
      if (selectionMode === 'single') {
        const next = new Set([flat.item.id])
        setSelectedIds(next)
        const payload: ListViewItemEventPayload = { item: flat.item, path: flat.path }
        emitSelectionChange(payload, next)
      }

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
    [onItemContextMenu, selectionMode, emitSelectionChange]
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
    const flat = contextMenu.item
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
  }, [contextMenu, isRenameable, startRename])

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
                ref={renameInputRef}
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
                draggable={!isEditing}
                onClick={handleRowClick}
                onDoubleClick={handleRowDoubleClick}
                onMouseEnter={handleRowMouseEnter}
                onMouseLeave={handleRowMouseLeave}
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
