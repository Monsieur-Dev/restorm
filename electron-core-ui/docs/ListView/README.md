# ListView Component

## Overview

`ListView` is a hierarchical list/tree component used to render file trees and sticky headers in the demo project.  
It supports keyboard navigation, drag and drop, sticky headers, and both controlled and uncontrolled selection.

## API

### Types

```typescript
export type ListViewSelectionMode = 'single' | 'multiple'
export type ListViewDropPosition = 'before' | 'after' | 'into'

export interface ListViewItemData {
  id: string
  title?: React.ReactNode
  icon?: React.ReactNode | string
  children?: ListViewItemData[]
  isExpanded?: boolean
  isExpandable?: boolean
  isSelectable?: boolean
  isStickyHeader?: boolean
  data?: unknown
}

export interface ListViewItemPath {
  ids: string[]
  indices: number[]
}

export interface ListViewItemEventPayload {
  item: ListViewItemData
  path: ListViewItemPath
}

export interface ListViewDropEventPayload extends ListViewItemEventPayload {
  source: ListViewItemData
  sourcePath: ListViewItemPath
  /** Every dragged row in visual order; a single-item drag carries one
   *  entry. `source`/`sourcePath` stay the drag's anchor row. */
  sources: ListViewItemEventPayload[]
  position: ListViewDropPosition
  originalEvent: React.DragEvent<HTMLDivElement>
}

export interface ListViewProps {
  items?: ListViewItemData[]
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

  selectedIds?: string[]
  activeId?: string | null
  selectionMode?: ListViewSelectionMode
  rootRole?: 'list' | 'tree'
  ariaLabel?: string
  onItemClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  onItemDoubleClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  /** Middle-click on a row (mouse button 1). Receives the same payload as
   *  onItemClick. Useful for "open in background" gestures: the row is
   *  not selected, onItemClick is not invoked, and the consumer decides
   *  what to do (typically opening a tab without focusing it). */
  onItemAuxClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  onSelectionChange?: (selectedIds: string[], payload: ListViewItemEventPayload) => void
  onItemToggle?: (
    payload: ListViewItemEventPayload,
    expanded: boolean,
    event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>
  ) => void
  onItemDrop?: (payload: ListViewDropEventPayload) => void
  onItemContextMenu?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void

  /** Hover-time drop validation: return false to suppress the indicator,
   *  flip the drag ghost into its error state, and reject the drop. */
  canDrop?: (
    sources: ListViewItemEventPayload[],
    target: ListViewItemEventPayload,
    position: ListViewDropPosition
  ) => boolean

  /** Group context menu for a MULTI-selection (selectionMode="multiple"):
   *  called with the selected ids when the right-clicked row belongs to a
   *  selection of more than one row. Right-clicking outside the selection
   *  collapses it to the clicked row first. */
  selectionContextMenuItems?: (selectedIds: string[]) => ContextMenuItem[] | null

  /** Delay (ms) before a collapsed container hovered during a drag expands
   *  itself (through the normal onItemToggle path). OPT-IN: default null
   *  (disabled); pass e.g. 1000 to enable. Leaving the hovered row (or
   *  reaching the empty area) disarms the pending expansion. */
  dragExpandDelayMs?: number | null

  /** Drop released on the list's EMPTY AREA (below/beside the rows).
   *  Receives every dragged row — consumers typically move them to the
   *  top level. Absent, the empty area is not a drop target. */
  onEmptyAreaDrop?: (sources: ListViewItemEventPayload[], originalEvent: React.DragEvent<HTMLElement>) => void
}

export interface ListViewItemProps {
  id?: string
  title?: React.ReactNode
  icon?: React.ReactNode | string
  isExpanded?: boolean
  isExpandable?: boolean
  isSelectable?: boolean
  isStickyHeader?: boolean
  data?: unknown
  children?: React.ReactNode
}
```

## Usage (data-driven)

```tsx
import React, { useState } from 'react'
import { ListView, type ListViewItemData } from 'electron-core-ui/renderer'

const items: ListViewItemData[] = [
  {
    id: 'root',
    title: 'Workspace',
    isStickyHeader: true,
    children: [
      { id: 'src', title: 'src', isExpandable: true },
      { id: 'README.md', title: 'README.md', data: { filePath: 'README.md' } }
    ]
  }
]

const FileTree: React.FC = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  return (
    <ListView
      items={items}
      selectedIds={selectedIds}
      rootRole="tree"
      ariaLabel="Project files"
      onSelectionChange={(ids) => {
        setSelectedIds(ids)
      }}
      onItemClick={(payload) => {
        const filePath = (payload.item.data as { filePath?: string } | undefined)?.filePath
        if (filePath) {
          // open file…
        }
      }}
    />
  )
}
```

## Behavior

- **Data or JSX**: you can either pass an `items` tree, or use JSX children (`<ListViewItem>`).
- **Sticky headers**: any item with `isStickyHeader: true` will stick to the top while scrolling.
- **Expandable folders**:
  - `isExpandable` forces a chevron even when `children` is empty.
  - `isExpanded` controls initial open/closed state.
- **Selection**:
  - `selectionMode` controls single vs multiple selection.
  - `selectedIds` + `onSelectionChange` allow controlled selection. The
    controlled mirror is guarded by CONTENT: a parent that rebuilds the same
    array every render does not reset an in-flight multi-selection; a prop
    whose content actually differs always wins.
  - In `multiple` mode: **ctrl/cmd+click** toggles a row, **shift+click**
    selects the range from the active row, **ctrl/cmd+A** selects every
    VISIBLE selectable row (collapsed subtrees excluded).
  - Right-clicking a row inside a multi-selection keeps the selection (so a
    group menu can act on it); right-clicking outside collapses it to the
    clicked row.
- **Drag and drop**:
  - `onItemDrop` receives the target, the anchor `source`, EVERY dragged row
    in `sources`, plus position (`before` / `after` / `into`).
  - A drag started on a row that belongs to a multi-selection carries the
    whole selection; the `dataTransfer` then also carries
    `LIST_VIEW_MULTI_DRAG_MIME` (`application/x-listview-items`) whose data
    is the JSON array of dragged ids — its PRESENCE in `types` lets an
    external target detect a multi-drag during `dragover`, and its payload
    is readable at `drop`. `text/plain` keeps the anchor id.
  - `canDrop` validates the hovered target live: invalid targets show no
    indicator, report `dropEffect: 'none'`, and reveal an error codicon on
    the drag ghost (`.list-view-row-drag-ghost.is-invalid`). A multi-drag's
    ghost carries a count badge.
  - A `drop-into` hover paints the container row with
    `var(--list-dropBackground)` (themed in every theme family).
  - A COLLAPSED container hovered for `dragExpandDelayMs` (opt-in — pass
    e.g. 1000) expands itself through the normal toggle path, so controlled
    `expandedIds` parents see it as a chevron click.

## Notes for AI Usage

- Prefer **pure data trees** (`ListViewItemData[]`) over JSX when integrating with backends or IPC, since they are easy to serialize and diff.
- Use the `data` field to attach stable metadata (like `filePath`, ids, etc.) instead of encoding those values in `id` or `title`.
- When implementing complex drag/drop logic, handle all structural updates in a **pure helper** (e.g. `updateListAfterDrop`) and call it from `onItemDrop`; avoid mutating the `items` array in place.

## Testing

### `data-testid` API

`ListView` exposes stable E2E hooks via `data-testid` (default: `list-view`).
When `data-testid="my-list"` is provided, the following test ids are available:

- Root: `my-list`
- Internal ScrollableElement: `my-list-scrollable`
  - Content: `my-list-scrollable-content`
- Internal ContextMenu (when enabled): `my-list-contextmenu`
- Rename input (when renaming): `my-list-rename-input` (attributes: `data-item-id`)

Per-row data attributes are available on `.list-view-row`:

- `data-item-id`
- `data-depth`
- `data-is-leaf`
- `data-is-expanded` (only for non-leaf)

### Selectors (electron-core-ui/testing)

Use the pure string selectors from `electron-core-ui/testing`:

- `listViewRootSelector(testId)`
- `listViewScrollableTestId(testId)`
- `listViewScrollableContentSelector(testId)`
- `listViewContextMenuTestId(testId)`
- `listViewRowSelectorByItemId(testId, itemId)`
- `listViewRowExpanderSelectorByItemId(testId, itemId)`
- `listViewRowTitleSelectorByItemId(testId, itemId)`
- `listViewRenameInputSelector(testId, itemId?)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineListViewBddSteps(bdd)`
- `defineScrollableElementBddSteps(bdd)` (for `${testId}-scrollable`)

Steps:

- `Then list view {string} should be visible`
- `When I focus list view {string}`
- `When I press {string} in list view {string}`
- `When I click list view {string} item {string}`
- `When I double click list view {string} item {string}`
- `Then list view {string} item {string} should be selected`
- `Then list view {string} item {string} should not be selected`
- `Then list view {string} item {string} aria-expanded should be {string}`
- `When I click list view {string} item {string} expander`

Sticky helpers:

- `Then list view {string} item {string} should have position sticky`
- `Then list view {string} item {string} top should be >= {int}`
- `Then list view {string} item {string} top should be > item {string} top`

Rename helpers:

- `When I start renaming list view {string} item {string}`
- `When I type {string} in list view {string} rename input`
- `When I type {string} in list view {string} rename input letter by letter` (legacy alias)
- `When I submit list view {string} rename with Enter`
- `When I cancel list view {string} rename with Escape`

Context menu:

- `When I open list view {string} context menu on item {string}`

Drag and drop:

- `When I drag list view {string} item {string} before item {string}`
- `When I drag list view {string} item {string} into item {string}`
- `When I drag list view {string} item {string} after item {string}`
