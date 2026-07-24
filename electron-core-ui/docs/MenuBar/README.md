# MenuBar Component

## Overview

The `MenuBar` component is a React implementation of the MenuBar widget. It provides a complete menu bar system with top-level menu items, dropdown menus, submenus, separators, and full keyboard navigation support. The component features theme styling, theme integration, accessibility support, and internationalization.

## API

### TypeScript Interfaces

```typescript
export interface MenuBarProps {
  children: React.ReactNode
  className?: string
  id?: string
  /** Below this container width the bar collapses into a single hamburger button. Default 200. */
  hamburgerBelowPx?: number
  'data-testid'?: string
}

export type MenuBarLayoutMode = 'full' | 'overflow' | 'hamburger'

export interface MenuBarItemProps {
  /** Display text or any React node — the responsive bar passes a codicon for the icon-only `...` / `☰` buttons. */
  title: React.ReactNode
  children?: React.ReactNode
  className?: string
  id?: string
  'aria-label'?: string
  'data-testid'?: string
}

export interface MenuItemProps {
  title: string
  shortcut?: string
  onClick?: () => void
  checked?: boolean
  disabled?: boolean
  icon?: string | React.ReactNode
  children?: React.ReactNode
  className?: string
  id?: string
  'data-testid'?: string
}

export interface MenuItemSeparatorProps {
  className?: string
  id?: string
  'data-testid'?: string
}
```

### Props

#### MenuBar
- **children** (`React.ReactNode`) : MenuBarItem components
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the menu bar
- **hamburgerBelowPx** (`number`, default `200`) : Below this container width, the bar collapses every menu into a single hamburger (`☰`) button. Above it, items that don't fit get rolled into a trailing overflow (`...`) button instead. See "Responsive layout" below.

#### MenuBarItem
- **title** (`React.ReactNode`) : Display text or React node for the menu item. Strings work as before; passing a node is what lets the responsive bar render the icon-only `...` / `☰` buttons.
- **children** (`React.ReactNode`) : MenuItem components for dropdown
- **isFocused** (`boolean`) : Internal focus state (managed by MenuBar)
- **isActive** (`boolean`) : Internal active state (managed by MenuBar)
- **isTabStop** (`boolean`) : Whether this item is the bar's roving-tabindex stop — the one item reachable via `Tab` from the rest of the UI (managed by MenuBar; see "Keyboard Navigation" below)
- **onMouseEnter** (`() => void`) : Mouse enter handler (managed by MenuBar)
- **onMouseLeave** (`() => void`) : Mouse leave handler (managed by MenuBar)
- **onClick** (`() => void`) : Click handler (managed by MenuBar)
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the menu item

#### MenuItem
- **title** (`string`) : Display text for the menu item
- **shortcut** (`string`) : Keyboard shortcut display text
- **onClick** (`() => void`) : Click handler
- **checked** (`boolean`) : Whether the item is checked
- **disabled** (`boolean`) : Whether the item is disabled
- **role** (`string`) : Native platform role (`'undo' | 'copy' | 'paste' | …`), used only where the host renders menus natively (macOS system bar). The platform then performs the action on the focused element — the only thing that makes ⌘C/⌘V/⌘Z work in text fields — and **owns the item's enabled state**, so a role item ignores `disabled` in the native menu. Validated against an allow-list; `togglefullscreen` is excluded. See [Native roles](#native-roles--declared-by-the-host-not-inferred).
- **children** (`React.ReactNode`) : MenuItem components for submenu
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the menu item

#### MenuItemSeparator
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the separator

## Usage Examples

### Basic MenuBar

```tsx
import { MenuBar, MenuBarItem, MenuItem } from 'electron-core-ui/renderer'

<MenuBar>
  <MenuBarItem title="File">
    <MenuItem title="New" onClick={() => console.log('New file')} />
    <MenuItem title="Open" onClick={() => console.log('Open file')} />
    <MenuItem title="Save" onClick={() => console.log('Save file')} />
  </MenuBarItem>
  <MenuBarItem title="Edit">
    <MenuItem title="Undo" onClick={() => console.log('Undo')} />
    <MenuItem title="Redo" onClick={() => console.log('Redo')} />
  </MenuBarItem>
</MenuBar>
```

### MenuBar with Submenus

```tsx
<MenuBar>
  <MenuBarItem title="File">
    <MenuItem title="New" shortcut="Ctrl+N" onClick={() => console.log('New file')} />
    <MenuItem title="Open" shortcut="Ctrl+O" onClick={() => console.log('Open file')} />
    <MenuItem title="Open Recent">
      <MenuItem title="File 1" onClick={() => console.log('Recent file 1')} />
      <MenuItem title="File 2" onClick={() => console.log('Recent file 2')} />
      <MenuItem title="File 3" onClick={() => console.log('Recent file 3')} />
    </MenuItem>
    <MenuItem title="Save" shortcut="Ctrl+S" onClick={() => console.log('Save file')} />
  </MenuBarItem>
</MenuBar>
```

### MenuBar with Separators

```tsx
<MenuBar>
  <MenuBarItem title="File">
    <MenuItem title="New" onClick={() => console.log('New file')} />
    <MenuItem title="Open" onClick={() => console.log('Open file')} />
    <MenuItemSeparator />
    <MenuItem title="Auto-save" checked onClick={() => console.log('Auto-save')} />
    <MenuItemSeparator />
    <MenuItem title="Revert" disabled onClick={() => console.log('Revert file')} />
  </MenuBarItem>
</MenuBar>
```

### MenuBar with Internationalization

```tsx
import { useTranslation } from 'react-i18next'

const MyComponent = () => {
  const { t } = useTranslation()
  
  return (
    <MenuBar>
      <MenuBarItem title={t('menuBar.file')}>
        <MenuItem 
          title={t('menuBar.new')} 
          shortcut="Ctrl+N" 
          onClick={() => console.log('New file')} 
        />
        <MenuItem 
          title={t('menuBar.open')} 
          shortcut="Ctrl+O" 
          onClick={() => console.log('Open file')} 
        />
        <MenuItem title={t('menuBar.openRecent')}>
          <MenuItem title="File 1" onClick={() => console.log('Recent file 1')} />
          <MenuItem title="File 2" onClick={() => console.log('Recent file 2')} />
        </MenuItem>
        <MenuItemSeparator />
        <MenuItem 
          title={t('menuBar.autoSave')} 
          checked 
          onClick={() => console.log('Auto-save')} 
        />
        <MenuItemSeparator />
        <MenuItem 
          title={t('menuBar.revert')} 
          disabled 
          onClick={() => console.log('Revert file')} 
        />
      </MenuBarItem>
      <MenuBarItem title={t('menuBar.edit')}>
        <MenuItem 
          title={t('menuBar.undo')} 
          shortcut="Ctrl+Z" 
          onClick={() => console.log('Undo')} 
        />
        <MenuItem 
          title={t('menuBar.redo')} 
          shortcut="Ctrl+Y" 
          onClick={() => console.log('Redo')} 
        />
      </MenuBarItem>
    </MenuBar>
  )
}
```

### Complex MenuBar with All Features

```tsx
<MenuBar>
  <MenuBarItem title="File">
    <MenuItem title="New" shortcut="Ctrl+N" onClick={handleNew} />
    <MenuItem title="Open" shortcut="Ctrl+O" onClick={handleOpen} />
    <MenuItem title="Open Recent">
      {recentFiles.map(file => (
        <MenuItem 
          key={file.id}
          title={file.name} 
          onClick={() => handleOpenRecent(file)} 
        />
      ))}
    </MenuItem>
    <MenuItemSeparator />
    <MenuItem title="Save" shortcut="Ctrl+S" onClick={handleSave} />
    <MenuItem title="Save As" shortcut="Ctrl+Shift+S" onClick={handleSaveAs} />
    <MenuItemSeparator />
    <MenuItem 
      title="Auto-save" 
      checked={autoSaveEnabled} 
      onClick={toggleAutoSave} 
    />
    <MenuItemSeparator />
    <MenuItem 
      title="Revert" 
      disabled={!hasUnsavedChanges} 
      onClick={handleRevert} 
    />
  </MenuBarItem>
  
  <MenuBarItem title="Edit">
    <MenuItem title="Undo" shortcut="Ctrl+Z" onClick={handleUndo} />
    <MenuItem title="Redo" shortcut="Ctrl+Y" onClick={handleRedo} />
    <MenuItemSeparator />
    <MenuItem title="Cut" shortcut="Ctrl+X" onClick={handleCut} />
    <MenuItem title="Copy" shortcut="Ctrl+C" onClick={handleCopy} />
    <MenuItem title="Paste" shortcut="Ctrl+V" onClick={handlePaste} />
    <MenuItemSeparator />
    <MenuItem title="Select All" shortcut="Ctrl+A" onClick={handleSelectAll} />
  </MenuBarItem>
  
  <MenuBarItem title="View">
    <MenuItem title="Toggle Word Wrap" onClick={toggleWordWrap} />
    <MenuItem title="Toggle Full Screen" shortcut="F11" onClick={toggleFullScreen} />
    <MenuItemSeparator />
    <MenuItem title="Zoom In" shortcut="Ctrl+=" onClick={zoomIn} />
    <MenuItem title="Zoom Out" shortcut="Ctrl+-" onClick={zoomOut} />
    <MenuItem title="Reset Zoom" shortcut="Ctrl+0" onClick={resetZoom} />
  </MenuBarItem>
</MenuBar>
```

## Responsive layout

The MenuBar measures its own container width via a `ResizeObserver` and switches between three modes:

| Mode | Trigger | Render |
|------|---------|--------|
| `full` | Container ≥ sum of item widths | Every `MenuBarItem` inline. |
| `overflow` | Container < sum but ≥ `hamburgerBelowPx` | Items that fit render inline, the rest collapse into a trailing `...` button (`codicon-more`). |
| `hamburger` | Container < `hamburgerBelowPx` | All items live inside a single `☰` button (`codicon-menu`). |

The current mode is exposed on the root via `data-mode="full|overflow|hamburger"` plus `data-visible-count="N"` (the number of inline items). The collapsed buttons carry `data-testid="<menubar-id>-overflow-button"` and `data-testid="<menubar-id>-hamburger-button"`.

When an item is in the overflow / hamburger bucket, the original `<MenuBarItem>` becomes a `<MenuItem>` with the same children — its dropdown is rendered as a submenu of the collapsed button. Mnemonic shortcuts (`Alt-letter`) still work: when the matching item is hidden, the bar opens the collapsed button and focuses the matching submenu entry so a follow-up `Enter` / `ArrowRight` drills in.

Container layout note: hosting layouts must let the MenuBar's slot shrink. The bar's CSS uses `width: 100%; min-width: 0` so a flex parent must be `flex: 0 1 auto; min-width: 0; overflow: hidden` (or equivalent). The library's own `Titlebar` already does this for its `titlebar-left` zone.

```tsx
<MenuBar data-testid="app-menubar" hamburgerBelowPx={220}>
  <MenuBarItem title="File">…</MenuBarItem>
  <MenuBarItem title="Edit">…</MenuBarItem>
  <MenuBarItem title="View">…</MenuBarItem>
</MenuBar>
```

## DOM Structure

### Top-level MenuBar

`tabindex="0"` sits on whichever item is the current roving-tabindex stop
(`File` here, since it's the default / first item) — it moves to a different
item once the user focuses/opens one, see "Keyboard Navigation" above.

```html
<div class="menubar" role="menubar">
  <div class="menubar-menu-button" role="menuitem" tabindex="0" aria-haspopup="true">
    <div class="menubar-menu-title" role="none" aria-hidden="true">File</div>
  </div>
  <div class="menubar-menu-button" role="menuitem" tabindex="-1" aria-haspopup="true">
    <div class="menubar-menu-title" role="none" aria-hidden="true">Edit</div>
  </div>
</div>
```

### Dropdown Menu Structure

```html
<div class="menubar-menu-items-holder monaco-menu-container" style="position: fixed; z-index: 2000; left: 100px; top: 50px;">
  <div class="monaco-menu">
    <ul class="actions-container" role="menu">
      <li class="action-item" role="presentation">
        <a class="action-menu-item" role="menuitem" tabindex="0">
          <span class="codicon codicon-check" aria-hidden="true"></span>
          <span class="action-label">Auto-save</span>
          <span class="keybinding">Ctrl+Shift+S</span>
        </a>
      </li>
      <li class="action-item separator" role="presentation">
        <div class="action-menu-item separator" role="separator"></div>
      </li>
      <li class="action-item" role="presentation">
        <a class="action-menu-item disabled" role="menuitem" tabindex="-1" aria-disabled="true">
          <span class="codicon-placeholder" aria-hidden="true"></span>
          <span class="action-label">Revert</span>
        </a>
      </li>
    </ul>
  </div>
</div>
```

### Submenu Structure

```html
<li class="action-item submenu-item" role="presentation">
  <a class="action-menu-item submenu" role="menuitem" tabindex="0" aria-haspopup="true" aria-expanded="false">
    <span class="codicon-placeholder" aria-hidden="true"></span>
    <span class="action-label">Open Recent</span>
    <span class="codicon codicon-chevron-right" aria-hidden="true"></span>
  </a>
  <div class="menubar-menu-items-holder monaco-menu-container" style="position: fixed; z-index: 2000; left: 200px; top: 100px;">
    <div class="monaco-menu">
      <ul class="actions-container" role="menu">
        <li class="action-item" role="presentation">
          <a class="action-menu-item" role="menuitem" tabindex="0">
            <span class="codicon-placeholder" aria-hidden="true"></span>
            <span class="action-label">File 1</span>
          </a>
        </li>
      </ul>
    </div>
  </div>
</li>
```

## CSS Classes Used

### MenuBar Classes
- **menubar** : Main container for the menu bar
- **menubar-menu-button** : Individual menu button container
- **menubar-menu-title** : Text content of menu buttons
- **menubar-menu-items-holder** : Container for dropdown menus
- **monaco-menu-container** : Menu container styling

### Menu Classes
- **monaco-menu** : Main menu container
- **actions-container** : List container for menu items (no bullet points)
- **action-item** : Individual menu item container (no bullet points)
- **action-menu-item** : Clickable menu item element
- **separator** : Menu item separator
- **submenu-item** : Menu item with submenu
- **submenu** : Submenu indicator
- **disabled** : Disabled menu item
- **checked** : Checked menu item

### List Style Reset
All `<ul>` and `<li>` elements are styled to remove default browser styling:
- **No bullet points** : `list-style: none` applied to all list elements
- **No margins/padding** : Reset to 0 for consistent spacing
- **Proper display** : Block display for proper layout

### Icon Classes
- **codicon** : icon font
- **codicon-check** : Check mark icon
- **codicon-chevron-right** : Right arrow for submenus
- **codicon-placeholder** : Placeholder for alignment

## Theme Variables

The component uses the following CSS variables:

- `--menubar-background` : Background color of the menu bar
- `--menubar-foreground` : Text color of menu items
- `--menu-background` : Background color of dropdown menus (opaque, not transparent)
- `--menu-foreground` : Text color of menu items
- `--menu-border` : Border color of dropdown menus
- `--list-hoverBackground` : Background color of hovered menu items
- `--list-hoverForeground` : Text color of hovered menu items
- `--list-activeSelectionBackground` : Background color of focused menu items
- `--list-activeSelectionForeground` : Text color of focused menu items
- `--menu-separatorBackground` : Color of menu separators
- `--descriptionForeground` : Color of keyboard shortcuts
- `--disabledForeground` : Color of disabled menu items
- `--focusBorder` : Focus border color
- `--widget-shadow` : Dropdown menu shadow

## Keyboard Navigation

### Roving tabindex

Only ONE top-level item is ever a `Tab` stop (`tabIndex={0}`) — the rest carry
`tabIndex={-1}`, per the standard [ARIA menubar
pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/). That item is the
first one on initial render, then tracks whichever item was last
focused/opened (mouse click, hover-follow while a menu is open, or keyboard),
so re-entering the bar with `Tab` resumes where the user left off. Because
only one item is ever tabbable, `Tab` / `Shift+Tab` naturally move focus to
the next/previous focusable element *outside* the bar — the bar never traps
keyboard focus.

### MenuBar Navigation
- **Tab** : Enter the bar at the current roving-tabindex stop; from there, `Tab` again leaves the bar for the next focusable element in the rest of the UI (arrow keys, not `Tab`, move *within* the bar — see below)
- **Arrow Left/Right** : Navigate between top-level menu items. If a menu is currently open, the sibling's menu opens in its place
- **Arrow Down / Enter / Space** : Open the focused menu. `ArrowDown` additionally moves focus onto the dropdown's first item once it renders
- **Arrow Up** : Open the focused menu with focus on its LAST item
- **Escape** : Close menu and return focus
- **Alt + Key** : Open menu by mnemonic (e.g., Alt+F for File)

### Menu Navigation
- **Arrow Up/Down** : Navigate between sibling items of the open menu (wraps at either end)
- **Arrow Right** : Open submenu
- **Arrow Left** : Close submenu
- **Enter/Space** : Activate menu item
- **Escape** : Close menu

### Accessibility Features
- Full keyboard navigation support
- ARIA roles and attributes
- Focus management
- Screen reader support
- High contrast theme support

## State Management

The component automatically handles:
- Focus state management
- Menu open/close states
- Click interactions (top-level menus open on click only)
- Hover interactions (submenus open on hover)
- Keyboard navigation
- Click outside to close
- Submenu positioning

## Floating Menu Positioning

All dropdown menus and submenus are positioned using `position: fixed` with high z-index (2000) to ensure they float above other content without affecting the layout of parent elements:

- **Main menus**: Positioned below the menu bar button
- **Submenus**: Positioned to the right of the parent menu item
- **Z-index**: 2000 to ensure menus appear above other UI elements
- **No layout impact**: Menus don't affect the size or position of parent elements
- **Height control**: Maximum height of 600px with custom scrolling
- **ScrollableElement integration**: Uses the project's custom scrollable component
- **Proper sizing**: Menus adapt to content height, not screen height
- **Menu bar height**: Fixed at 30px height for consistent appearance
- **Menu button height**: 30px with proper padding and font sizing

### ScrollableElement Integration
- **Custom scrollbars**: Consistent with the rest of the application
- **Smooth scrolling**: Enhanced user experience
- **Theme integration**: Scrollbars match theme variables
- **Mouse wheel support**: Native mouse wheel scrolling
- **Shadow effects**: Visual feedback for scrollable content

#### ScrollableElement Options
```typescript
{
  vertical: 'auto',           // Show vertical scrollbar when needed
  horizontal: 'hidden',        // Hide horizontal scrollbar
  verticalScrollbarSize: 7,   // Thin scrollbar (7px)
  useShadows: true,           // Show scroll shadows
  handleMouseWheel: true      // Enable mouse wheel scrolling
}
```

This ensures a clean, professional menu system that behaves like native desktop applications.

## Visual Styling

### Background Colors
- **Menu containers**: Use `var(--menu-background)` for opaque, solid backgrounds
- **Menu items**: Transparent background with hover/focus states
- **Borders**: `var(--menu-border)` for consistent theming
- **Shadows**: Subtle drop shadows for depth

### Color Consistency
The MenuBar component uses the same color scheme as other components:
- **DropdownButton**: Same background colors as dropdown components
- **SelectBox**: Consistent with select box styling
- **Button**: Matching button component colors

This ensures visual consistency across the entire application.

## Interaction Behavior

### Top-level Menus (File, Edit, etc.)
- **Click to open**: Menus only open when clicked, not on hover
- **Click to close**: Clicking the same menu again closes it
- **Click outside**: Clicking elsewhere closes the menu
- **Keyboard navigation**: Arrow keys, Enter, Escape work as expected

### Submenus (within dropdown menus)
- **Hover to open**: Submenus open when hovering over the parent item
- **Hover to close**: Moving mouse away closes the submenu
- **Click to open**: Submenus can also be opened by clicking
- **Keyboard navigation**: Right arrow opens submenus, left arrow closes them

## Theme Integration

The component automatically adapts to themes through CSS variables. No additional configuration is required.

## Performance

The component uses:
- `useCallback` for optimized re-renders
- `useRef` for DOM element references
- Efficient event handling
- Minimal re-renders with proper state management

## Native application menu (macOS)

On Windows/Linux the `MenuBar` renders **inside** the window title bar. On macOS,
applications render their menus in the **system menu bar**, outside the window.
Rather than maintaining a second menu definition, the same `MenuBar` JSX is walked
into a native menu template — so the two renderings cannot drift apart.

### Pieces

| Piece | Location | Role |
|-------|----------|------|
| `buildNativeMenuTemplate(jsx)` | `renderer/utils/menuTemplate.ts` | Walks the MenuBar JSX into a serializable `NativeMenuNode[]` template + an `id → onClick` handler map. |
| `toAccelerator(shortcut)` | `renderer/utils/menuTemplate.ts` | Maps an ECUI `shortcut` (`"Ctrl+N"`) to an Electron accelerator (`"CmdOrCtrl+N"`), so macOS renders and binds **⌘** while Windows/Linux keep **Ctrl** — no per-platform strings. |
| `useNativeAppMenu(jsx, enabled)` | `renderer/hooks/useNativeAppMenu.ts` | Publishes the template over IPC when `enabled` (macOS), and runs the matching `onClick` when the main process echoes an activation back. |
| `native-menu:set` / `native-menu:clear` / `native-menu:invoke` | main `ipc/nativeMenuHandlers.ts` | Build/clear the `Menu` in the main process; echo an item id back to the renderer on click. |

`Titlebar` calls `useNativeAppMenu(leftContent, isMac)` for you — a consumer that
uses `Titlebar` gets the native menu automatically and does not call these
utilities directly.

### How the walk works

`buildNativeMenuTemplate` reads React elements as plain objects (no rendering).
It matches nodes by **`displayName`** — `MenuBar`, `MenuBarItem`, `MenuItem`,
`MenuItemSeparator` — rather than by importing the components, which avoids a
renderer import cycle and, crucially, **survives production minification** (a
minified function `name` would not). Each of those components sets an explicit
`displayName`.

- `React.Children.toArray` flattens fragments and drops `false`/`null`/`undefined`,
  so conditional entries — e.g. `{fileName && <><MenuItemSeparator/><MenuItem …/></>}` —
  work unchanged.
- A top-level `MenuBarItem` whose children all vanished (everything conditionally
  hidden) is dropped, so no dead menu title is left behind.
- Unknown element types are traversed **through**, so a wrapper component around
  some items does not silently swallow them.
- `data-testid` becomes the item **id**; the item's `onClick` is stored under that
  id. `shortcut` → accelerator, `disabled` → `enabled: false`, `checked` →
  checkbox, `opensDialog` appends the `…` ellipsis.

### Clicks round-trip

The main process cannot hold a renderer callback, so activating a native item
sends `native-menu:invoke` with the item id; `useNativeAppMenu` looks the id up
in its handler map and runs the original `onClick`. The handler map is refreshed
on every publish (its closures capture the latest props), but the IPC `set` is
skipped when the serialized template is unchanged — so a title-bar re-render does
not needlessly rebuild the whole native menu.

### Native roles — declared by the host, not inferred

Some items should be performed by the **platform** rather than by an app
handler. Declare that with the `role` prop on `MenuItem`:

```tsx
<MenuItem title={t('menuBar.copy')} shortcut="Ctrl+C" role="copy" disabled />
```

This matters most on macOS: routing edit operations through an IPC round-trip to
a renderer handler does **not** reliably act on the focused element (native
fields, Monaco, webviews), and an app whose menu carries no Edit roles has no
working ⌘C/⌘V/⌘Z **at all** — the well-known Electron trap.

Two consequences worth knowing:

- **The role owns enablement.** An item carrying a role ignores `disabled` in the
  native menu — the platform enables it exactly when it applies (there is a
  selection to copy, something to undo…). So a host can mark an item `disabled`
  for its own in-window bar, as restorm does for its not-yet-wired Edit menu,
  without killing the native shortcut.
- **The library never infers a role from an item's identity.** The role travels
  in the template because the alternative — mapping well-known `data-testid`s to
  roles inside the library — would make this package depend on one host app's
  test identifiers, and a rename there would silently drop the role with no
  failing test.

`role` is validated against an allow-list before reaching
`Menu.buildFromTemplate`; unknown values are ignored and the item stays a plain
action. **`togglefullscreen` is deliberately excluded**: AppKit appends its own
"Enter Full Screen" next to any menu carrying that selector, so a host asking for
it would get two fullscreen entries. Toggle the window over the
`toggle-fullscreen` IPC channel instead.

The application menu is prepended with `{ role: 'appMenu' }` so macOS gets its
standard About/Services/Hide/**⌘Q** items.

## Testing

### `data-testid` API

`MenuBar` now supports test hooks via `data-testid` props:

- `MenuBar`: `data-testid` (default: `menubar`)
  - root attributes: `data-is-open`, `data-focused-menu-index`, `data-active-menu-index`, `data-menu-count`
- `MenuBarItem`: `data-testid`
  - root attributes: `data-is-focused`, `data-is-active`, `data-has-children`
- `MenuItem`: `data-testid`
  - root attributes: `data-disabled`, `data-checked`, `data-has-submenu`, `data-submenu-open`
- `MenuItemSeparator`: `data-testid`

### Derived test ids (sub-elements)

When a base `data-testid` is provided, these sub-elements are exposed:

- Menu bar item title: `${menuId}-title`
- Dropdown container: `${menuId}-menu`
- Dropdown scrollable element: `${menuId}-scrollable` (this is a `ScrollableElement`)
- Menu item label: `${itemId}-label`
- Menu item shortcut: `${itemId}-shortcut`
- Submenu container: `${itemId}-submenu`
- Submenu scrollable element: `${itemId}-submenu-scrollable` (this is a `ScrollableElement`)

### Recommended conventions

- Prefer explicit ids for top-level menus and important items:
  - Example: `menubar-basic-file`, `menubar-basic-edit`, `menubar-basic-file-open`
- Auto-generated ids are also provided when absent (for convenience), but explicit ids make `.feature` files more readable.

### Selectors (electron-core-ui/testing)

Available helpers:

- `menuBarRootSelector(testId)`
- `menuBarMenuButtonSelector(menuId)`
- `menuBarMenuTitleSelector(menuId)`
- `menuBarMenuDropdownSelector(menuId)`
- `menuBarMenuScrollableSelector(menuId)`
- `menuBarItemSelector(itemId)`
- `menuBarItemLabelSelector(itemId)`
- `menuBarItemShortcutSelector(itemId)`
- `menuBarItemSubmenuSelector(itemId)`
- `menuBarItemSubmenuScrollableSelector(itemId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register steps:

- `defineMenuBarBddSteps(bdd)`

Core steps:

- `Then menu bar {string} should be visible`
- `When I open menu bar {string} menu {string}`
- `Then menu bar {string} menu {string} should be open`
- `Then menu bar {string} menu {string} should be closed`
- `When I click outside to close menu bar {string}`
- `When I click menu bar item {string}`
- `When I hover menu bar item {string}`
- `Then menu bar submenu {string} should be visible`
- `When I press keys {string} in menu bar {string}` (comma-separated, ex: `ArrowRight,ArrowDown,Escape`)
- `When I trigger menu shortcut {string}` (ex: `Ctrl+O`)

Roving-tabindex steps (generic — not scoped to a single menu bar):

- `When I focus {string}` (calls `.focus()` on any element by `data-testid`, for a deterministic starting point)
- `When I press the {string} key` (a single raw key press wherever focus currently sits, ex: `Tab`)
- `Then the focused element should be {string}`
- `Then the focused element should not be inside {string}`
- `Then menu bar {string} tab-reachable item should be {string}` (asserts exactly one top-level item carries `tabindex="0"`, and which one)

### Wrapping `ScrollableElement`

Since dropdowns/submenus use `ScrollableElement`, you can reuse its steps by targeting:

- `${menuId}-scrollable`
- `${itemId}-submenu-scrollable`

Register with:

- `defineScrollableElementBddSteps(bdd)`

## Notes for AI Usage

### Recommended Configuration

For optimal usage, always use theme variables and proper internationalization:

```typescript
// Use i18n for all user-facing strings
const { t } = useTranslation()

<MenuBar>
  <MenuBarItem title={t('menuBar.file')}>
    <MenuItem 
      title={t('menuBar.new')} 
      shortcut="Ctrl+N" 
      onClick={handleNew} 
    />
  </MenuBarItem>
</MenuBar>
```

### Common Patterns

1. **File Menu**: New, Open, Open Recent (submenu), Save, Auto-save (checked), Revert (disabled)
2. **Edit Menu**: Undo, Redo, Cut, Copy, Paste, Select All
3. **View Menu**: Toggle Word Wrap, Toggle Full Screen, Zoom controls
4. **Help Menu**: About, Documentation, Report Issue

### Integration with State Management

```tsx
const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

<MenuBar>
  <MenuBarItem title="File">
    <MenuItem 
      title="Auto-save" 
      checked={autoSaveEnabled} 
      onClick={() => setAutoSaveEnabled(!autoSaveEnabled)} 
    />
    <MenuItem 
      title="Revert" 
      disabled={!hasUnsavedChanges} 
      onClick={handleRevert} 
    />
  </MenuBarItem>
</MenuBar>
```

### Dynamic Menu Items

```tsx
const [recentFiles, setRecentFiles] = useState([])

<MenuBar>
  <MenuBarItem title="File">
    <MenuItem title="Open Recent">
      {recentFiles.map(file => (
        <MenuItem 
          key={file.id}
          title={file.name} 
          onClick={() => handleOpenRecent(file)} 
        />
      ))}
    </MenuItem>
  </MenuBarItem>
</MenuBar>
```

### Error Handling

```tsx
const handleMenuAction = (action: string) => {
  try {
    // Perform action
    logger.info(`Menu action: ${action}`)
  } catch (error) {
    logger.error(`Menu action failed: ${action}`, { error })
    // Show error to user
  }
}

<MenuItem title="Save" onClick={() => handleMenuAction('save')} />
```
