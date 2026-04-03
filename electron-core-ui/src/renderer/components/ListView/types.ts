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
  source: ListViewItemData
  sourcePath: ListViewItemPath
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
   * Called when editing mode ends (either by commit or cancel).
   * Useful for controlled editingItemId to sync state.
   */
  onEditingEnd?: () => void

  onItemClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  onItemDoubleClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
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
