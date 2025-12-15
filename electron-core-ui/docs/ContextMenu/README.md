# ContextMenu Component

VSCode-style context (right-click) menu component for React applications, sharing the same look and feel as the main menu bar.

## Overview

`ContextMenu` is a lightweight wrapper that reuses existing `MenuItem` / `MenuItemSeparator` styling, but positions the menu at arbitrary screen coordinates (typically the mouse cursor).
It is designed to be used by higher-level components (such as `ListView`) that decide *when* and *where* to show the menu.

## Component Location

- Source: `electron-core-ui/src/renderer/components/ContextMenu/ContextMenu.tsx`

## API

### `ContextMenuItem`

```typescript
export interface ContextMenuItem {
  id: string
  label: string
  /** Optional Codicon name without the `codicon-` prefix. */
  icon?: string
  /** When true, this entry is rendered as a visual separator line. */
  isSeparator?: boolean
  disabled?: boolean
  onClick?: () => void
}
```

### `ContextMenu`

```typescript
export interface ContextMenuProps {
  visible: boolean
  /** Absolute screen coordinates where the menu should be placed. */
  x: number
  y: number
  /** Menu entries to render, in order. */
  items: ContextMenuItem[]
  /** Called when the menu should close (click outside, item click, etc.). */
  onRequestClose: () => void
}
```

## Basic Usage

```tsx
const [menu, setMenu] = useState({
  visible: false,
  x: 0,
  y: 0,
  items: [] as ContextMenuItem[]
})

const handleRightClick = (event: React.MouseEvent) => {
  event.preventDefault()
  setMenu({
    visible: true,
    x: event.clientX,
    y: event.clientY,
    items: [
      { id: 'clone', label: 'Clone', icon: 'copy', onClick: () => {/* … */} },
      { id: 'sep-1', isSeparator: true, label: '' },
      { id: 'delete', label: 'Delete', icon: 'trash', onClick: () => {/* … */} }
    ]
  })
}

return (
  <>
    <div onContextMenu={handleRightClick}>Right-click me</div>
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
      { id: 'delete-folder', label: 'Delete', icon: 'trash' }
    ]
  }

  return [
    { id: 'clone', label: 'Clone', icon: 'copy' },
    { id: 'sep-1', isSeparator: true, label: '' },
    { id: 'delete', label: 'Delete', icon: 'trash' }
  ]
}
```

## Notes for AI Usage

- Keep `ContextMenuItem.id` values **stable and semantic** (e.g. `'rename'`, `'delete-folder'`) so agents can reason about actions without parsing labels.
- Build menu item arrays from small, pure helper functions (like `buildContextMenuForItem`) instead of inlining complex logic in JSX; this simplifies reuse and automated modification.
- Treat `visible`, `x`, `y`, and `items` as derived UI state from your domain model (selected node, pointer position), so agents can reconstruct or adjust menus from high-level descriptions.
- For destructive actions, centralize confirmation logic (dialogs, undo, etc.) in a single place called from `onClick` handlers rather than scattering it across multiple components.
