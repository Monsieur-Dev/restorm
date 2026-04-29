# ContextMenu Component

Context (right-click) menu component for React applications, sharing the same look and feel as the main menu bar.

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
  /**
   * Codicon name (without the `codicon-` prefix) when a string, or any
   * React node for custom glyphs (colored method badges, protocol
   * pills, SVGs, etc.). Strings get wrapped in a `codicon codicon-…`
   * `<i>`; nodes are rendered as-is. The icon slot reserves a 16 px
   * minimum but grows to fit wider glyphs and push the label right —
   * a wide Badge stays in its lane without overlapping the text.
   */
  icon?: string | React.ReactNode
  shortcut?: string
  /** When true, this entry is rendered as a visual separator line. */
  isSeparator?: boolean
  disabled?: boolean
  checked?: boolean
  onClick?: () => void
  /** Optional submenu items */
  items?: ContextMenuItem[]
}
```

The `icon` slot accepts either a codicon name (string) or any React
node. Use a node when you need a glyph that doesn't exist in the
codicon set — for example a colored HTTP-method badge. The slot
pushes the label right when the glyph is wider than the default
16 px codicon width:

```tsx
items: [
  { id: 'add-get', label: 'HTTP – GET', icon: <MethodBadge method="GET" /> },
  { id: 'add-post', label: 'HTTP – POST', icon: <MethodBadge method="POST" /> }
]
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
  /** Optional test id applied to the root element. */
  'data-testid'?: string
}
```

## Single-instance behaviour

Only one `ContextMenu` is visible at a time. When a menu becomes visible it asks every other currently-visible `ContextMenu` to close itself via the shared open-menu registry (`openContextMenuRegistry.ts`). This holds even when the new menu opens in response to a `contextmenu` event that bubbled up *through* an already-open menu's overlay — the registry catches sequences the document-level `mousedown` outside-click dismissal misses.

The component also stops `contextmenu` event propagation from its own root, so a right-click on top of an open menu does not reach surrounding `onContextMenu` handlers (e.g. an outer empty-area dispatcher).

This coordination is scoped to in-page `ContextMenu` instances; native Electron menus and other popover primitives (`CustomDropdown`, `MenuBar`) manage their own dismissal independently.

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
      data-testid="contextmenu-main"
      onRequestClose={() => {
        setMenu(prev => ({ ...prev, visible: false }))
      }}
    />
  </>
)
```

## Testing

### Recommended stable hooks

If you pass a `data-testid` to the component, you can target:

- Root: `[data-testid="..."]` (element has `.ecui-context-menu`)
- Menu container: `[role="menu"]`
- Menu items: `a[role="menuitem"]` (uses `aria-disabled`, `aria-checked`, and `aria-expanded` for submenus)
- Separators: `[role="separator"]`

The root element also exposes:

- `data-x` and `data-y` (stringified coordinates)

### E2E helpers

`electron-core-ui/testing` exports selector helpers:

- `contextMenuRootSelector(testId)`
- `contextMenuMenuSelector(testId)`
- `contextMenuSeparatorSelector(testId)`
- `contextMenuItemSelectorByLabel(testId, label)`
- `contextMenuItemIconSelector(testId, label, icon)`
- `contextMenuSubmenuIndicatorSelector(testId, label)`
- `contextMenuOpenSubmenuItemSelector(testId, label)`
- `contextMenuOpenSubmenuContainerSelector(testId, label)`
- `contextMenuOpenSubmenuItemByLabelSelector(testId, parentLabel, childLabel)`

### Playwright-BDD steps

`electron-core-ui/testing/playwright-bdd` exports `defineContextMenuBddSteps(bdd)`.
It registers generic steps such as:

- `Then context menu {string} should be visible`
- `When I click context menu {string} item {string}`
- `Then context menu {string} item {string} should be disabled`
- `When I open context menu {string} submenu {string} with keyboard`
- `When I open context menu {string} submenu {string} with hover`

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
