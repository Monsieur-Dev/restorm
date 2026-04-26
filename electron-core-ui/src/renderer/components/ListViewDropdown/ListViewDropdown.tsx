import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../Button'
import type { ButtonProps } from '../Button'
import { ListView } from '../ListView'
import { ScrollableElement } from '../ScrollableElement/ScrollableElement'
import { useFilterableDropdown } from '../../hooks/useFilterableDropdown'
import { DropdownFilterRow } from '../DropdownFilterRow'
import type {
  ListViewItemData,
  ListViewItemEventPayload,
  ListViewSelectionMode,
  ListViewProps
} from '../ListView'

export interface ListViewDropdownProps {
  items: ListViewItemData[]
  selectedIds?: string[]
  expandedIds?: string[]
  selectionMode?: ListViewSelectionMode
  rootRole?: 'tree' | 'list'
  /** Accessible label for the list inside the dropdown */
  menuAriaLabel?: string
  /** Alignment of the dropdown relative to the button (default: right) */
  align?: 'left' | 'right'
  /** Minimum width of the dropdown panel (default: 220) */
  minWidth?: number
  /** Maximum height of the dropdown panel (default: 320) */
  maxHeight?: number
  /** Props forwarded to the underlying Button (except onClick and children) */
  buttonProps?: Omit<ButtonProps, 'onClick' | 'children'>
  /** Content rendered inside the trigger button */
  buttonContent: React.ReactNode
  /** Called when an item is clicked. The dropdown closes after this callback. */
  onItemClick?: (payload: ListViewItemEventPayload) => void
  /** Called when an item is expanded/collapsed. */
  onItemToggle?: (payload: ListViewItemEventPayload, expanded: boolean) => void
  /** Optional test id applied to the root element. Defaults to `listviewdropdown`. */
  'data-testid'?: string
  /**
   * Item count at or above which a sticky filter row appears at the
   * top of the popup. Default: `15` (`DEFAULT_FILTER_THRESHOLD`).
   * The filter walks the entire tree (top-level + descendants), so a
   * tree of 20 nodes — even split across nested groups — will show
   * the row. Pass a large value to opt out per-instance.
   */
  filterThreshold?: number
  /** Localised placeholder for the filter input. */
  filterPlaceholder?: string
  /** Localised label for the Select-all action (multi-select only). */
  selectAllLabel?: string
  /** Localised label for the Deselect-all action (multi-select only). */
  deselectAllLabel?: string
  /** Optional test id forwarded to the filter row. */
  filterTestId?: string
}

/**
 * Walk a `ListViewItemData` tree depth-first, accumulating titles.
 * Used by the dropdown's filter to count nodes at every depth (so a
 * tree of grouped children correctly crosses the threshold) and to
 * pull the searchable display text from each node.
 */
function flattenItems(items: readonly ListViewItemData[]): ListViewItemData[] {
  const out: ListViewItemData[] = []
  const visit = (node: ListViewItemData): void => {
    out.push(node)
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child)
    }
  }
  for (const root of items) visit(root)
  return out
}

/**
 * Build a `(id → ListViewItemPath)` map by walking the tree once.
 * The bulk-select callbacks need a real path payload because the
 * host's `onItemClick` listener may key off `path.indices` for tab
 * placement / drag-target semantics. Computed lazily on filter
 * change.
 */
function indexNodePaths(
  items: readonly ListViewItemData[]
): Map<string, { ids: string[]; indices: number[] }> {
  const out = new Map<string, { ids: string[]; indices: number[] }>()
  const visit = (
    node: ListViewItemData,
    parentIds: string[],
    parentIndices: number[],
    indexInParent: number
  ): void => {
    const ids = [...parentIds, node.id]
    const indices = [...parentIndices, indexInParent]
    out.set(node.id, { ids, indices })
    if (Array.isArray(node.children)) {
      node.children.forEach((child, i) => { visit(child, ids, indices, i) })
    }
  }
  items.forEach((root, i) => { visit(root, [], [], i) })
  return out
}

/**
 * Keep nodes whose own title matches OR which have at least one
 * matching descendant. The descendant case preserves the path to a
 * matched leaf so the user can still see where the result lives.
 * Returns a new tree with non-matching subtrees pruned.
 */
function filterTree(
  items: readonly ListViewItemData[],
  matches: ReadonlySet<string>
): ListViewItemData[] {
  const out: ListViewItemData[] = []
  for (const node of items) {
    const childMatches = Array.isArray(node.children)
      ? filterTree(node.children, matches)
      : []
    const selfMatches = matches.has(node.id)
    if (selfMatches || childMatches.length > 0) {
      // Preserve the original node identity but swap in the filtered
      // children — `ListView` reads `children` to decide expansion.
      out.push(childMatches.length > 0 ? { ...node, children: childMatches } : node)
    }
  }
  return out
}

const ListViewDropdownInner: React.FC<ListViewDropdownProps> = ({
  items,
  selectedIds,
  expandedIds,
  selectionMode = 'single',
  rootRole = 'tree',
  menuAriaLabel,
  align = 'right',
  minWidth = 220,
  maxHeight = 320,
  buttonProps,
  buttonContent,
  onItemClick,
  onItemToggle,
  'data-testid': dataTestId,
  filterThreshold,
  filterPlaceholder,
  selectAllLabel,
  deselectAllLabel,
  filterTestId
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Flat node list drives the count check (so a tree of 20 nested
  // nodes crosses the 15-node threshold even though there are only
  // 3 root entries) and the substring filter.
  const flatItems = useMemo(() => flattenItems(items), [items])
  const getNodeLabel = useCallback((node: ListViewItemData): string => {
    if (typeof node.title === 'string') return node.title
    if (typeof node.title === 'number' || typeof node.title === 'boolean') return String(node.title)
    return node.id
  }, [])

  const filterArgs = filterThreshold === undefined
    ? { items: flatItems, getLabel: getNodeLabel }
    : { items: flatItems, threshold: filterThreshold, getLabel: getNodeLabel }
  const {
    shouldRenderFilter,
    filterValue,
    setFilterValue,
    clearFilter,
    filteredItems: flatFilteredItems,
    handleFilterKeyDown
  } = useFilterableDropdown<ListViewItemData>(filterArgs)

  // Reduce the filtered flat slice back to a pruned tree so the
  // ListView still renders parent groups when their leaves match.
  const visibleItems = useMemo(() => {
    if (!shouldRenderFilter || filterValue.trim() === '') return items
    const matchSet = new Set(flatFilteredItems.map((node) => node.id))
    return filterTree(items, matchSet)
  }, [items, flatFilteredItems, shouldRenderFilter, filterValue])

  // Reset filter on close.
  useEffect(() => {
    if (!isOpen) clearFilter()
  }, [isOpen, clearFilter])

  const pathIndex = useMemo(() => indexNodePaths(items), [items])

  // Bulk-select fires `onItemClick` on every visible *leaf*. The host's
  // `onItemClick` is also invoked for direct row clicks on parent rows
  // (where its meaning is host-defined — usually "toggle expand"); to
  // keep "Select all visible" unambiguous across hosts we synthesise
  // the call only for nodes without children.
  const isLeaf = useCallback(
    (node: ListViewItemData): boolean =>
      !Array.isArray(node.children) || node.children.length === 0,
    []
  )

  const selectAllVisible = useCallback((): void => {
    if (selectionMode !== 'multiple' || flatFilteredItems.length === 0 || !onItemClick) return
    const alreadySelected = new Set(selectedIds ?? [])
    for (const node of flatFilteredItems) {
      if (!isLeaf(node)) continue
      if (!alreadySelected.has(node.id)) {
        const path = pathIndex.get(node.id) ?? { ids: [node.id], indices: [0] }
        onItemClick({ item: node, path })
      }
    }
  }, [selectionMode, onItemClick, selectedIds, flatFilteredItems, pathIndex, isLeaf])

  const deselectAllVisible = useCallback((): void => {
    if (selectionMode !== 'multiple' || flatFilteredItems.length === 0 || !onItemClick) return
    const alreadySelected = new Set(selectedIds ?? [])
    for (const node of flatFilteredItems) {
      if (!isLeaf(node)) continue
      if (alreadySelected.has(node.id)) {
        const path = pathIndex.get(node.id) ?? { ids: [node.id], indices: [0] }
        onItemClick({ item: node, path })
      }
    }
  }, [selectionMode, onItemClick, selectedIds, flatFilteredItems, pathIndex, isLeaf])

  const rootTestId = dataTestId ?? 'listviewdropdown'
  const buttonTestId = `${rootTestId}-button`
  const panelTestId = `${rootTestId}-panel`
  const scrollableTestId = `${rootTestId}-scrollable`
  const listViewTestId = `${rootTestId}-listview`

  // Bridge filter-input keyboard to the listbox. Esc handling stays in
  // the hook (clear-then-fall-through). ArrowDown moves focus into the
  // ListView root so the user can navigate without leaving the
  // keyboard. The ListView itself owns the rest of the navigation
  // (Up/Down/Enter) once focus lands on its `tabIndex=0` element.
  const handleFilterInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      handleFilterKeyDown(event)
      if (event.defaultPrevented) return
      if (event.key === 'ArrowDown' && panelRef.current) {
        const listViewRoot = panelRef.current.querySelector<HTMLElement>(
          `[data-testid="${listViewTestId}"]`
        )
        if (listViewRoot) {
          event.preventDefault()
          listViewRoot.focus()
        }
      }
    },
    [handleFilterKeyDown, listViewTestId]
  )

  const selectedIdsAttr = (selectedIds ?? []).join('|')
  const expandedIdsAttr = (expandedIds ?? []).join('|')

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent): void => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div
      ref={containerRef}
      data-testid={rootTestId}
      data-is-open={isOpen ? 'true' : 'false'}
      data-align={align}
      data-selection-mode={selectionMode}
      data-root-role={rootRole}
      data-selected-ids={selectedIdsAttr}
      data-expanded-ids={expandedIdsAttr}
      style={{
        position: 'relative',
        display: 'inline-block'
      }}
    >
      <Button
        {...buttonProps}
        data-testid={buttonProps?.['data-testid'] ?? buttonTestId}
        onClick={() => {
          setIsOpen((prev) => !prev)
        }}
      >
        {buttonContent}
      </Button>

      {isOpen && (
        <div
          ref={panelRef}
          data-testid={panelTestId}
          style={{
            position: 'absolute',
            right: align === 'right' ? 0 : undefined,
            left: align === 'left' ? 0 : undefined,
            marginTop: 4,
            minWidth,
            maxHeight,
            zIndex: 1000,
            backgroundColor: 'var(--editor-background)',
            border: '1px solid var(--dropdown-border)',
            boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {shouldRenderFilter && (
            <DropdownFilterRow
              value={filterValue}
              onChange={setFilterValue}
              onKeyDown={handleFilterInputKeyDown}
              {...(filterPlaceholder !== undefined && { placeholder: filterPlaceholder })}
              {...(selectionMode === 'multiple' && { onSelectAllVisible: selectAllVisible })}
              {...(selectionMode === 'multiple' && { onDeselectAllVisible: deselectAllVisible })}
              {...(selectAllLabel !== undefined && { selectAllLabel })}
              {...(deselectAllLabel !== undefined && { deselectAllLabel })}
              {...(filterTestId !== undefined ? { 'data-testid': filterTestId } : { 'data-testid': `${rootTestId}-filter` })}
            />
          )}
          <ScrollableElement
            data-testid={scrollableTestId}
            style={{
              height: maxHeight || 400,
              width: '100%'
            }}
          >
            {visibleItems.length === 0 ? (
              <div
                data-testid={`${rootTestId}-no-matches`}
                style={{ padding: '8px 12px', fontSize: 13, opacity: 0.7, fontStyle: 'italic' }}
              >
                No matches
              </div>
            ) : (() => {
              const listViewProps: ListViewProps = {
                items: visibleItems,
                rootRole,
                ariaLabel: menuAriaLabel ?? '',
                selectedIds: selectedIds ?? [],
                selectionMode,
                'data-testid': listViewTestId,
                onItemClick: (payload) => {
                  onItemClick?.(payload)
                  setIsOpen(false)
                }
              }

              if (expandedIds) {
                listViewProps.expandedIds = expandedIds
              }
              if (onItemToggle) {
                listViewProps.onItemToggle = onItemToggle
              }

              return <ListView {...listViewProps} />
            })()}
          </ScrollableElement>
        </div>
      )}
    </div>
  )
}

export const ListViewDropdown = React.memo(ListViewDropdownInner)
