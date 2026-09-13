import type React from 'react'

export type ListViewSelectionMode = 'single' | 'multiple'

export type ListViewDropPosition = 'before' | 'after' | 'into'

export interface ListViewItemData {
  id: string
  title?: React.ReactNode
  /**
   * Icon can be:
   * - a React node (custom JSX)
   * - a string (codicon name, without the `codicon-` prefix)
   */
  icon?: React.ReactNode | string
  children?: ListViewItemData[]
  /**
   * Optional initial expanded state. If omitted, non-leaf nodes default to expanded.
   */
  isExpanded?: boolean
  /**
   * When true, the item should display an expander/chevron even if it currently
   * has no children. Useful for folders that are empty but still expandable.
   */
  isExpandable?: boolean
  /**
   * Whether this specific row can be dragged. Defaults to true. Set false for
   * rows that are not real, movable entities (e.g. virtual section entries) so
   * they never start a drag even when the list otherwise allows dragging.
   */
  draggable?: boolean
  /**
   * Whether the item can be selected. Defaults to true.
   */
  isSelectable?: boolean
  /**
   * Whether the row should behave as a sticky header when scrolling.
   */
  isStickyHeader?: boolean
  /**
   * Optional custom payload preserved and passed back in events.
   */
  data?: unknown

  /**
   * Optional context menu definition for this item.
   * When provided, the ListView can render a contextual menu using these items.
   */
  contextMenuItems?: import('../ContextMenu/ContextMenu').ContextMenuItem[]

  /**
   * Optional content to display on the left side of the item (before the title).
   * Always visible.
   */
  leftActions?: React.ReactNode

  /**
   * Optional content to display on the right side of the item (after the title).
   * Can be configured to show only on hover via `rightActionsOnHoverOnly`.
   */
  rightActions?: React.ReactNode

  /**
   * When true, rightActions are only visible when hovering the row.
   * Defaults to false (always visible).
   */
  rightActionsOnHoverOnly?: boolean
}

export interface ListViewItemPath {
  /**
   * Array of item ids from root to the current item.
   */
  ids: string[]
  /**
   * Array of indexes from root to the current item.
   */
  indices: number[]
}

export interface ListViewItemEventPayload {
  item: ListViewItemData
  path: ListViewItemPath
}

export interface ListViewDropEventPayload extends ListViewItemEventPayload {
  /** The row the drag started from (the anchor of a multi-item drag). */
  source: ListViewItemData
  sourcePath: ListViewItemPath
  /**
   * Every dragged row, in visual order. A single-item drag carries exactly
   * one entry (the anchor); a drag started on a row that belongs to a
   * multi-selection carries the whole selection. `source`/`sourcePath`
   * stay the anchor so single-selection consumers keep working unchanged.
   */
  sources: ListViewItemEventPayload[]
  position: ListViewDropPosition
  originalEvent: React.DragEvent<HTMLDivElement>
}

export interface ListViewProps {
  /**
   * Hierarchical data source. If provided, it takes precedence over JSX children.
   */
  items?: ListViewItemData[]
  /**
   * JSX usage, e.g.:
   * <ListView>
   *   <ListViewItem title="Root">
   *     <ListViewItem title="Child" />
   *   </ListViewItem>
   * </ListView>
   */
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties

  /**
   * Optional test id for the ListView root.
   * When provided, internal test ids are derived for nested components unless overridden.
   */
  'data-testid'?: string

  /**
   * Optional test id for the internal ScrollableElement wrapper.
   * Defaults to `${data-testid}-scrollable` when `data-testid` is provided.
   */
  scrollableTestId?: string

  /**
   * Optional test id for the internal ContextMenu.
   * Defaults to `${data-testid}-contextmenu` when `data-testid` is provided.
   */
  contextMenuTestId?: string

  /**
   * Optional controlled selection. When provided, the ListView will mirror
   * these ids as selected rows.
   */
  selectedIds?: string[]

  /**
   * Optional controlled active item id. When provided, the ListView will
   * treat this item as the keyboard focus anchor.
   */
  activeId?: string | null | undefined

  /**
   * Selection behaviour. Defaults to single selection.
   */
  selectionMode?: ListViewSelectionMode

  /**
   * ARIA role for the root container. Defaults to `tree`.
   */
  rootRole?: 'list' | 'tree'
  ariaLabel?: string

  /**
   * Whether items can be renamed inline. Defaults to false.
   */
  isRenameable?: boolean

  /**
   * Keyboard shortcut to trigger inline rename. Defaults to 'F2'.
   */
  renameShortcut?: string

  /**
   * When true, clicking on a row only selects it (triggers onItemClick).
   * Expansion/collapse is only triggered by clicking the chevron.
   * When false (default), clicking anywhere on an expandable row toggles expansion.
   */
  expandOnChevronOnly?: boolean

  /**
   * Controlled expanded IDs. When provided, the component will use these IDs
   * to determine which items are expanded, instead of internal state.
   */
  expandedIds?: string[]

  /**
   * Controlled editing item ID. When provided, the item with this ID will be
   * in rename/edit mode. Set to null to exit edit mode.
   */
  editingItemId?: string | null

  /**
   * Called when editing mode starts (F2, context menu rename).
   * Useful for controlled editingItemId to sync state.
   */
  onEditingStart?: (itemId: string) => void
  /**
   * Called when editing mode ends (either by commit or cancel).
   * Useful for controlled editingItemId to sync state.
   */
  onEditingEnd?: () => void

  onItemClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  onItemDoubleClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  /**
   * Fires on auxiliary mouse button presses (middle-click / mouse wheel button).
   * Consumers typically use this to implement "open in background" semantics —
   * the row selection and onItemClick handler are NOT invoked, so the caller is
   * free to decide whether to focus the underlying view or leave it unfocused.
   */
  onItemAuxClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  onSelectionChange?: (selectedIds: string[], payload: ListViewItemEventPayload) => void
  onItemToggle?: (
    payload: ListViewItemEventPayload,
    expanded: boolean,
    event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>
  ) => void
  onItemDrop?: (payload: ListViewDropEventPayload) => void
  onItemContextMenu?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  /**
   * Called when an item is renamed via inline editing.
   */
  onItemRename?: (payload: ListViewItemEventPayload, newValue: string) => void

  /**
   * Optional mouse enter handler for a row.
   */
  onItemMouseEnter?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void

  /**
   * Optional mouse leave handler for a row.
   */
  onItemMouseLeave?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void

  /**
   * Called when the Delete key is pressed on the active item.
   */
  onDeleteRequest?: (payload: ListViewItemEventPayload) => void

  /**
   * When `true`, rows are no longer draggable and the drop handlers
   * are no-ops. Use for read-only / selection-only views (e.g. an
   * import preview tree) where accidental drags would interfere
   * with a surrounding drop target. Default `false` — rows keep the
   * standard drag-to-reorder UX.
   */
  disableDrag?: boolean

  /**
   * Validates a drop while it is being HOVERED. Called on every dragover
   * with the dragged rows, the hovered row, and the would-be position.
   * Returning `false` suppresses the drop indicator, switches the drag
   * ghost into its error state (codicon badge), reports `dropEffect:
   * 'none'` and rejects the drop. Absent, every drop is considered valid
   * (the consumer can still refuse it in `onItemDrop`, but without any
   * visual feedback during the hover).
   */
  canDrop?: (
    sources: ListViewItemEventPayload[],
    target: ListViewItemEventPayload,
    position: ListViewDropPosition
  ) => boolean

  /**
   * Context menu for a MULTI-selection. When the selection holds more than
   * one row and the right-clicked row belongs to it, this builder is called
   * with the selected ids (visual order) and its result replaces the row's
   * own `contextMenuItems`. Right-clicking OUTSIDE the selection first
   * collapses the selection to that row (standard tree behaviour), then the
   * per-row menu applies. Only consulted in `selectionMode="multiple"`.
   */
  selectionContextMenuItems?: (selectedIds: string[]) => import('../ContextMenu/ContextMenu').ContextMenuItem[] | null

  /**
   * Delay (ms) before a COLLAPSED container hovered during a drag expands
   * itself, so the user can dive into it without dropping first. Expansion
   * goes through the normal toggle path (`onItemToggle` fires — a
   * controlled `expandedIds` parent sees it like a chevron click).
   * OPT-IN: default `null` (disabled) — existing drag consumers keep their
   * behaviour; a tree that wants mid-drag expansion passes e.g. 1000.
   */
  dragExpandDelayMs?: number | null

  /**
   * Drop released on the list's EMPTY AREA (below/beside the rows). Receives
   * every dragged row — the consumer typically moves them to the top level.
   * Absent, the empty area is not a drop target (unchanged behaviour).
   */
  onEmptyAreaDrop?: (sources: ListViewItemEventPayload[], originalEvent: React.DragEvent<HTMLElement>) => void

  /**
   * OPT-IN virtualisation: only the rows inside the viewport (plus `overscan`
   * rows above and below it) are mounted; two spacers keep the scrollbar
   * true to the full list. PREREQUISITE — every row must be exactly
   * `rowHeight` px tall: the window is computed from that height, never
   * measured (measuring would mean rendering every row once), so a row that
   * wraps or grows breaks the alignment. Collapsing a node removes its
   * children from the virtual set, so the total height follows the tree.
   * Sticky headers are not supported in this mode (a header scrolled out of
   * the window unmounts). Default `false`: every row is mounted, as before.
   */
  virtualized?: boolean

  /**
   * Fixed row height in px the virtualised window is computed from; the rows
   * are forced to it. Default 26 (the stylesheet's `min-height`). Ignored
   * unless `virtualized` is set.
   */
  rowHeight?: number

  /**
   * Rows mounted beyond each edge of the viewport when virtualised, so a
   * scroll shows content before the window catches up. Default 10.
   */
  overscan?: number
}

export interface ListViewItemProps {
  id?: string
  title?: React.ReactNode
  icon?: React.ReactNode | string
  isExpanded?: boolean
  /**
   * Force the item to show an expander/chevron even if it has no children.
   */
  isExpandable?: boolean
  isSelectable?: boolean
  isStickyHeader?: boolean
  data?: unknown
  children?: React.ReactNode
}
