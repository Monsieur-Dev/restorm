# OYO-60 – ListView and Workbench integration

This document describes the `ListView` component added to the core UI library and its integration in Gitable via the `WorkbenchTab` test tab.

## ListView component

The `ListView` lives in the core UI library and is exported from the renderer entry:

- Module: `electron-core-ui/renderer`
- Exports:
  - `ListView`
  - `ListViewItem`
  - Types like `ListViewItemData`, `ListViewDropEventPayload`, `ListViewSelectionMode`, etc.

### Features

- Hierarchical data model (tree-like structure with children)
- Indentation based on depth, with indent guides visible on hover or focus
- Expand / collapse using codicon chevrons (right / down)
- Optional sticky headers using `position: sticky`
- Keyboard navigation (Up / Down / Left / Right / Enter)
- Single or multiple selection
- Drag & drop between items with basic visual feedback
- Context menu support per item
- Works inside a `ScrollableElement` for VSCode-like scrollbars

### Usage (JSX)

You can declare a hierarchy directly in JSX:

```tsx
import { ListView, ListViewItem } from 'electron-core-ui/renderer'

<ListView>
  <ListViewItem title="Parent" icon="root-folder">
    <ListViewItem title="Child 1" icon="file" />
    <ListViewItem title="Child 2" icon="file" />
  </ListViewItem>
</ListView>
```

### Usage (data driven)

You can also pass a hierarchical data source:

```tsx
import { ListView } from 'electron-core-ui/renderer'
import type { ListViewItemData } from 'electron-core-ui/renderer'

const items: ListViewItemData[] = [
  {
    id: 'group-1',
    title: 'Group 1',
    icon: 'root-folder',
    isStickyHeader: true,
    children: [
      { id: 'item-1', title: 'Item 1', icon: 'file' },
      { id: 'item-2', title: 'Item 2', icon: 'file' }
    ]
  }
]

<ListView items={items} />
```

### Events

The component emits events so that the parent can react and update its own state:

- `onItemClick(payload, event)`
- `onItemDoubleClick(payload, event)`
- `onSelectionChange(selectedIds, payload)`
- `onItemToggle(payload, expanded, event)`
- `onItemDrop(payload)` – used for reordering or reparenting
- `onItemContextMenu(payload, event)` – used to open a context menu

Each payload contains:

- The `ListViewItemData` for the item
- Its `path` (ids and indices from root to the item)

## WorkbenchTab test tab in Gitable

The `WorkbenchTab` test tab lives in the Gitable renderer:

- File: `src/renderer/src/components/test-tabs/EditorTabsTab.tsx`
- Exported from: `src/renderer/src/components/test-tabs/index.ts` as `WorkbenchTab`
- Used in `ThemeTestPage` as a demo tab

### Layout

`WorkbenchTab` displays:

- On the **left**: a `ListView` inside a resizable panel
- In the **center/right**: the existing `Workbench` component (tabs + Monaco view)
- Between them: a `Sash` to resize the two panes horizontally

The layout uses flexbox with a `Sash` whose `layoutProvider` computes the left panel width and height from the container.

### Synchronisation between ListView and Workbench

The left `ListView` represents the openable items in the workbench. Synchronisation works in both directions:

- **Click in ListView**:
  - If the corresponding tab already exists in the workbench, it becomes the active tab.
  - Otherwise, a new tab is created in the first available group and activated.
  - The selection in the list is updated accordingly.

- **Interaction in Workbench**:
  - The workbench exposes its hierarchical tab tree via the `onTreeChange` callback.
  - When the active tab changes, `WorkbenchTab` derives the active tab id from the tree and updates the `ListView` selection.
  - A small guard flag avoids infinite loops when updates originate from the list itself.

This provides a realistic example of list/tree + workbench synchronisation similar to VSCode.

### Context menu and dynamic nodes

The `ListView` is wired with a simple context menu:

- Right-click on an item opens an in-place menu near the cursor.
- The menu currently exposes a single **New** entry (label taken from `menuBar.new` translations).
- Clicking **New** adds a new child node under the targeted item in the list hierarchy.

This demonstrates how to:

- Use `onItemContextMenu` to open a custom context menu.
- Dynamically update the hierarchical data used by `ListView`.

## Internationalization

The demo tab reuses the existing `menuBar.new` translation key:

- English: `"New"`
- French: `"Nouveau"`

No additional translation keys are required for this feature.


