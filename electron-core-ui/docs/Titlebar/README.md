# Titlebar Component

## Overview

The `Titlebar` component is a React implementation of a window title bar for Electron applications with Window Controls Overlay support. It provides a draggable title bar with optional icon, title display, and child content (like a MenuBar). The component features theme styling, theme integration, and automatic detection of window controls position based on the desktop environment.

## API

### TypeScript Interface

```typescript
export interface TitlebarProps {
  icon?: string | React.ReactNode  // Icon (path or ReactNode)
  title: string                     // Window title
  leftContent?: React.ReactNode     // Left content (preferred)
  centerContent?: React.ReactNode   // Optional center override (when not showing SearchBar)
  rightContent?: React.ReactNode    // Right content (preferred)
  children?: React.ReactNode        // Deprecated: use leftContent
  className?: string
  id?: string
  'data-testid'?: string
  showSearchBar?: boolean
  onSearchResultClick?: (result: SearchResult) => void
  renderSearchTooltipContent?: (result: SearchResult) => React.ReactNode
  renderSearchBadge?: (method: string) => React.ReactNode
  searchBadgedCategories?: string[]
  searchFn?: (query: string) => Promise<GroupedResults[]>
  searchBarTestId?: string
  searchTooltipHideDelayMs?: number
  customWcoTestId?: string
  customWcoPlatform?: string
}
```

### Props

- **icon** (`string | React.ReactNode`) : Optional icon displayed on the left. Can be an image path (string) or a ReactNode for custom SVG/icons.
- **title** (`string`) : Required title text for the window (displayed when no children provided).
- **leftContent** (`React.ReactNode`) : Optional content displayed on the left zone.
- **centerContent** (`React.ReactNode`) : Optional content displayed in the center (when `showSearchBar` is false).
- **rightContent** (`React.ReactNode`) : Optional content displayed on the right zone.
- **children** (`React.ReactNode`) : Deprecated, use `leftContent`.
- **className** (`string`) : Additional CSS classes.
- **id** (`string`) : HTML ID of the titlebar.
- **data-testid** (`string`) : Optional test id for stable E2E selectors.
- **showSearchBar** (`boolean`) : When enabled, renders an internal `SearchBar` in the center.
- **searchFn** (`(query: string) => Promise<GroupedResults[]>`) : Optional override to make E2E search deterministic.
- **searchBarTestId** (`string`) : Optional override test id for the internal `SearchBar`.
- **searchTooltipHideDelayMs** (`number`) : Forwarded to the internal `SearchBar` as `tooltipHideDelayMs` — the delay (default `300`) before the result tooltip hides once the pointer leaves it.
- **customWcoTestId** (`string`) : Optional override test id for the internal `CustomWCO`.
- **customWcoPlatform** (`string`) : Optional platform override passed to the internal `CustomWCO` (useful for deterministic web E2E harnesses).

## Usage Examples

### Basic Titlebar

```tsx
import { Titlebar } from 'electron-core-ui/renderer'

<Titlebar title="Demo" />
```

### Titlebar with Icon

```tsx
<Titlebar 
  icon="icon.png" 
  title="Demo" 
/>
```

### Titlebar with MenuBar

```tsx
<Titlebar icon="icon.png" title="Demo">
  <MenuBar>
    <MenuBarItem title="File">
      <MenuItem title="New" onClick={handleNew} />
      <MenuItem title="Open" onClick={handleOpen} />
    </MenuBarItem>
    <MenuBarItem title="Edit">
      <MenuItem title="Undo" onClick={handleUndo} />
    </MenuBarItem>
  </MenuBar>
</Titlebar>
```

### Titlebar with Custom Icon (ReactNode)

```tsx
import { Titlebar } from 'electron-core-ui/renderer'

const CustomIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="6" fill="currentColor" />
  </svg>
)

<Titlebar 
  icon={<CustomIcon />} 
  title="Demo"
/>
```

## DOM Structure

### Basic Titlebar

```html
<div class="titlebar" style="width: 100%; height: 30px; display: flex; align-items: center; box-sizing: border-box;">
  <img src="icon.png" alt="" class="titlebar-icon" />
  <div class="titlebar-content">
    <span class="titlebar-title">Demo</span>
  </div>
</div>
```

### Titlebar with MenuBar

```html
<div class="titlebar" style="width: 100%; height: 30px; display: flex; align-items: center; box-sizing: border-box;">
  <div class="titlebar-icon">
    <svg>...</svg>
  </div>
  <div class="titlebar-content">
    <div class="menubar">
      <div class="menubar-menu-button">...</div>
    </div>
  </div>
</div>
```

## CSS Classes Used

### Titlebar Classes
- **titlebar** : Main container for the title bar (CSS Grid `1fr 600px 1fr auto`-style track sizing — see `titlebar.css` for the exact `minmax()` template; the centre track caps the search bar at 600px, the 1fr left / right tracks let the menubar's responsive overflow react to a varying container width, and the auto tail reserves the WCO grid cell.)
- **titlebar-icon** : Container for the icon (32px width, draggable)
- **titlebar-left / titlebar-center / titlebar-right** : Layout zones (grid items)
- **titlebar-title** : Text element for the title (displayed when no children)

### Drag Region Behavior

The whole title bar opts in to OS-level window dragging by default; only interactive children opt back out. Concretely:

- **`.titlebar`** carries `-webkit-app-region: drag`.
- **`.titlebar-left`** is `drag` (so empty space inside the MenuBar element — which fills its parent at `width: 100%` for ResizeObserver sizing — stays draggable). The MenuBar's `.menubar-menu-button` children declare `no-drag` so menu clicks still fire.
- **`.titlebar-center`** is `drag`. The `SearchBar` component declares `no-drag` on its own root.
- **`.titlebar-right`** is `drag`, with a wildcard `.titlebar-right > * { -webkit-app-region: no-drag }` rule that flips every direct child back to `no-drag` automatically. **Hosted `rightContent` doesn't need to opt in** — pass any `Button` / `Popover` trigger / similar primitive as `rightContent` and it will remain clickable while the empty grid track around it stays draggable. (Caveat: a non-interactive direct child wrapper, e.g. a `<span>` for spacing, will also be `no-drag` — keep `rightContent` flat or wrap with a class you can re-`drag` if the trade-off matters.)
- **`.custom-wco`** (the WCO placeholder; sized to `var(--wco-width, 92px)`) is `no-drag` so clicks reach the controls. The actual button row is portalled to `document.body` — see [`CustomWCO`](../CustomWCO/README.md).

## Testing

### `data-testid` API

`Titlebar` exposes stable E2E hooks via `data-testid` (default: `titlebar`).
When `data-testid="my-titlebar"` is provided:

- Root: `my-titlebar`
  - attributes:
    - `data-show-searchbar`: `true|false`
    - `data-has-icon`: `true|false`
    - `data-has-left`: `true|false`
    - `data-has-center`: `true|false`
    - `data-has-right`: `true|false`
- Left zone: `my-titlebar-left`
- Center zone: `my-titlebar-center`
- Right zone: `my-titlebar-right`
- Icon container (when present): `my-titlebar-icon`
- Title text (when `showSearchBar` is false): `my-titlebar-title`
- Internal `SearchBar` (when enabled): `my-titlebar-searchbar` (override via `searchBarTestId`)
- Internal `CustomWCO`: `my-titlebar-customwco` (override via `customWcoTestId`)

### Selectors (electron-core-ui/testing)

- `titlebarRootSelector(testId)`
- `titlebarLeftSelector(testId)`
- `titlebarCenterSelector(testId)`
- `titlebarRightSelector(testId)`
- `titlebarIconSelector(testId)`
- `titlebarTitleSelector(testId)`
- `titlebarSearchBarTestId(testId)`
- `titlebarCustomWcoTestId(testId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineTitlebarBddSteps(bdd)`

Steps:

- `Then titlebar {string} should be visible`
- `Then titlebar {string} left zone should be visible`
- `Then titlebar {string} center zone should be visible`
- `Then titlebar {string} right zone should be visible`
- `Then titlebar {string} showSearchBar should be {string}`
- `Then titlebar {string} icon should be visible`
- `Then titlebar {string} icon should be hidden`
- `Then titlebar {string} title should be {string}`

You can reuse internal component steps as well:
- `defineSearchBarBddSteps(bdd)` (when `showSearchBar` is enabled)
- `defineCustomWcoBddSteps(bdd)`

## Window Controls Overlay

The component supports Window Controls Overlay API for platform-native window controls.

### Automatic Position Detection

The position of window controls is automatically detected via CSS environment variables:

- **Controls on the right** (XFCE, KDE): `env(titlebar-area-x) = 0px`
- **Controls on the left** (GNOME): `env(titlebar-area-x) > 0px`

The component reserves space for native controls using a `::before` pseudo-element:

```css
.titlebar::before {
  content: '';
  position: absolute;
  top: 0;
  left: env(titlebar-area-x, 0);
  width: env(titlebar-area-width, 0);
  height: env(titlebar-area-height, 0);
  -webkit-app-region: no-drag;
  pointer-events: none;
}
```

### Configuring Window Controls Overlay

In your Electron main process, enable Window Controls Overlay:

```typescript
import { BrowserWindow } from 'electron'

const win = new BrowserWindow({
  titleBarStyle: 'hidden',
  titleBarOverlay: {
    color: '#181818',
    symbolColor: '#cccccc',
    height: 30
  }
})
```

## Theme Variables

The component uses the following CSS variables:

- `--titleBar-activeBackground` : Background color when window is active
- `--titleBar-activeForeground` : Text color when window is active
- `--titleBar-inactiveBackground` : Background color when window is inactive
- `--titleBar-inactiveForeground` : Text color when window is inactive
- `--titleBar-border` : Border color of the title bar

### Theme Integration

The component automatically adapts to themes through CSS variables. No additional configuration is required.

The inactive state is triggered by adding the `.window-inactive` class to a parent element:

```css
.window-inactive .titlebar {
  background-color: var(--titleBar-inactiveBackground);
  color: var(--titleBar-inactiveForeground);
}
```

## Drag Behavior

### Window Dragging

The entire titlebar allows dragging the window, except for interactive elements:

1. **Main titlebar**: Draggable (`-webkit-app-region: drag`)
2. **Icon area**: Non-draggable (`-webkit-app-region: no-drag`) but takes minimal space
3. **Content area**: Non-draggable (`-webkit-app-region: no-drag`) for interaction
4. **Title text**: Draggable when no children are present (`-webkit-app-region: drag`)

### Best Practices

- Keep interactive elements (MenuBar, buttons) within the `children` prop
- Use simple icons in the `icon` prop to maintain clean appearance
- Ensure sufficient space for Window Controls Overlay on all platforms

## Visual Styling

### Dimensions
- **Height**: Fixed at 30px (standard titlebar height)
- **Icon size**: 16x16px within a 32px wide container
- **Font size**: 13px (standard)

### Color Scheme
The component automatically matches theme color schemes through CSS variables.

## Integration with MenuBar

The Titlebar is designed to work seamlessly with the MenuBar component:

```tsx
import { Titlebar, MenuBar, MenuBarItem, MenuItem } from 'electron-core-ui/renderer'

<Titlebar icon="icon.png" title="Demo">
  <MenuBar>
    <MenuBarItem title="File">
      <MenuItem title="New File" onClick={handleNew} />
      <MenuItem title="Open File" onClick={handleOpen} />
      <MenuItem title="Save" onClick={handleSave} />
    </MenuBarItem>
    <MenuBarItem title="Edit">
      <MenuItem title="Undo" onClick={handleUndo} />
      <MenuItem title="Redo" onClick={handleRedo} />
    </MenuBarItem>
    <MenuBarItem title="View">
      <MenuItem title="Toggle Full Screen" onClick={handleFullScreen} />
    </MenuBarItem>
  </MenuBar>
</Titlebar>
```

## Performance

The component uses:
- Minimal re-renders with proper React patterns
- CSS-only drag region management
- Efficient icon rendering (string or ReactNode)

## Notes for AI Usage

### Recommended Configuration

For optimal usage, always use theme variables and proper component nesting:

```tsx
import { Titlebar, MenuBar, MenuBarItem, MenuItem } from 'electron-core-ui/renderer'

const AppTitlebar = () => {
  return (
    <Titlebar 
      icon="/assets/icon.png" 
      title="Demo"
    >
      <MenuBar>
        <MenuBarItem title="File">
          <MenuItem 
            title="New File" 
            shortcut="Ctrl+N"
            onClick={handleNew} 
          />
        </MenuBarItem>
      </MenuBar>
    </Titlebar>
  )
}
```

### Common Patterns

1. **Basic Application**: Icon + Title without MenuBar
2. **Full Application**: Icon + MenuBar (most common)
3. **Custom Branding**: Custom ReactNode icon + MenuBar

### Integration with Electron

When using this component, ensure your Electron BrowserWindow is configured correctly:

```typescript
// main/main.ts
new BrowserWindow({
  titleBarStyle: 'hidden',
  titleBarOverlay: {
    color: '#181818',
    symbolColor: '#cccccc',
    height: 30
  },
  webPreferences: {
    // ... your preferences
  }
})
```

### Handling Window State

Monitor window focus to apply inactive state styling:

```typescript
// main/main.ts
win.on('blur', () => {
  webContents.executeJavaScript(`
    document.body.classList.add('window-inactive')
  `)
})

win.on('focus', () => {
  webContents.executeJavaScript(`
    document.body.classList.remove('window-inactive')
  `)
})
```
