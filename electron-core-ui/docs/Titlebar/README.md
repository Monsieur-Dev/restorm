# Titlebar Component

## Overview

The `Titlebar` component is a React implementation of a window title bar for Electron applications with Window Controls Overlay support. It provides a draggable title bar with optional icon, title display, and child content (like a MenuBar). The component features VSCode styling, theme integration, and automatic detection of window controls position based on the desktop environment.

## API

### TypeScript Interface

```typescript
export interface TitlebarProps {
  icon?: string | React.ReactNode  // Icon (path or ReactNode)
  title: string                     // Window title
  children?: React.ReactNode        // Central content (MenuBar)
  className?: string
  id?: string
}
```

### Props

- **icon** (`string | React.ReactNode`) : Optional icon displayed on the left. Can be an image path (string) or a ReactNode for custom SVG/icons.
- **title** (`string`) : Required title text for the window (displayed when no children provided).
- **children** (`React.ReactNode`) : Optional content to display in the central area (typically a MenuBar component).
- **className** (`string`) : Additional CSS classes.
- **id** (`string`) : HTML ID of the titlebar.

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
      <MenuItem title="New" onClick={() => console.log('New')} />
      <MenuItem title="Open" onClick={() => console.log('Open')} />
    </MenuBarItem>
    <MenuBarItem title="Edit">
      <MenuItem title="Undo" onClick={() => console.log('Undo')} />
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
- **titlebar** : Main container for the title bar
- **titlebar-icon** : Container for the icon (32px width, draggable)
- **titlebar-content** : Container for the central content (flex: 1, non-draggable)
- **titlebar-title** : Text element for the title (displayed when no children)

### Drag Region Behavior
- **-webkit-app-region: drag** : Applied to `.titlebar` for window dragging
- **-webkit-app-region: no-drag** : Applied to interactive elements (icon, content area, children)

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

## VSCode Theme Variables

The component uses the following CSS variables:

- `--ecui-titleBar-activeBackground` : Background color when window is active
- `--ecui-titleBar-activeForeground` : Text color when window is active
- `--ecui-titleBar-inactiveBackground` : Background color when window is inactive
- `--ecui-titleBar-inactiveForeground` : Text color when window is inactive
- `--ecui-titleBar-border` : Border color of the title bar

### Theme Integration

The component automatically adapts to VSCode themes through CSS variables. No additional configuration is required.

The inactive state is triggered by adding the `.window-inactive` class to a parent element:

```css
.window-inactive .titlebar {
  background-color: var(--ecui-titleBar-inactiveBackground);
  color: var(--ecui-titleBar-inactiveForeground);
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
- **Height**: Fixed at 30px (standard VSCode titlebar height)
- **Icon size**: 16x16px within a 32px wide container
- **Font size**: 13px (VSCode standard)

### Color Scheme
The component automatically matches VSCode color schemes through CSS variables.

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

For optimal usage, always use VSCode theme variables and proper component nesting:

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
