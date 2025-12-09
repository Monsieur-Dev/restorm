# ContextMenu Component

VSCode-style context (right-click) menu component for React applications, sharing the same look and feel as the main menu bar.

## Overview

`ContextMenu` is a lightweight wrapper that reuses the existing `MenuItem` / `MenuItemSeparator` styling, but positions the menu at arbitrary screen coordinates (typically the mouse cursor).

It is designed to be used by higher-level components (such as `ListView`) that decide *when* and *where* to show the menu.

## Installation

```typescript
import {
  ContextMenu,
  type ContextMenuItem,
} from 'electron-core-ui/renderer'
```

## API

### `ContextMenuItem`

```typescript
interface ContextMenuItem {
  id: string
  label: string
  /**
   * Optional Codicon name without the `codicon-` prefix.
   * Example: "copy", "trash", "new-folder".
   */
  icon?: string
  /**
   * When true, this entry is rendered as a visual separator line.
   */
  isSeparator?: boolean
  disabled?: boolean
  onClick?: () => void
}
```

### `ContextMenu`

```typescript
interface ContextMenuProps {
  /**
   * Whether the menu should be rendered.
   */
  visible: boolean
  /**
   * Absolute screen coordinates where the menu should be placed.
   */
  x: number
  y: number
  /**
   * Menu entries to render, in order.
   */
  items: ContextMenuItem[]
  /**
   * Called when the menu should close (click outside, item click, etc.).
   */
  onRequestClose: () => void
}
```

## Basic Usage

```tsx
const [menu, setMenu] = useState({
  visible: false,
  x: 0,
  y: 0,
  items: [] as ContextMenuItem[],
})

// Somewhere in your component (for example on right-click):
const handleRightClick = (event: React.MouseEvent) => {
  event.preventDefault()
  setMenu({
    visible: true,
    x: event.clientX,
    y: event.clientY,
    items: [
      { id: 'clone', label: 'Clone', icon: 'copy', onClick: () => /* ... */ undefined },
      { id: 'sep-1', isSeparator: true, label: '' },
      { id: 'delete', label: 'Delete', icon: 'trash', onClick: () => /* ... */ undefined },
    ],
  })
}

return (
  <>
    <div onContextMenu={handleRightClick}>
      Right-click me
    </div>
    <ContextMenu
      visible={menu.visible}
      x={menu.x}
      y={menu.y}
      items={menu.items}
      onRequestClose={() => {
        setMenu(prev => ({ ...prev, visible: false }))
      }}
    />
  </>
)
```

## Integration with `ListView`

`ListView` can use `ContextMenu` automatically when items define `contextMenuItems`.

```typescript
import type { ListViewItemData, ContextMenuItem } from 'electron-core-ui/renderer'

const buildContextMenuForItem = (item: ListViewItemData): ContextMenuItem[] => {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0
  const isFolder = item.isExpandable ?? hasChildren

  if (isFolder) {
    return [
      { id: 'new-folder', label: 'New folder', icon: 'new-folder' },
      { id: 'sep-1', isSeparator: true, label: '' },
      { id: 'delete-folder', label: 'Delete', icon: 'trash' },
    ]
  }

  return [
    { id: 'clone', label: 'Clone', icon: 'copy' },
    { id: 'sep-1', isSeparator: true, label: '' },
    { id: 'delete', label: 'Delete', icon: 'trash' },
  ]
}

const itemsWithMenus: ListViewItemData[] = items.map(item => ({
  ...item,
  contextMenuItems: buildContextMenuForItem(item),
}))
```

When a user right-clicks on a row that defines `contextMenuItems`, the `ListView` will open a `ContextMenu` at the cursor position using those items.

