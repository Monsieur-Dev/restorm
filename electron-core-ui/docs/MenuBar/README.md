# MenuBar Component

## Overview

The `MenuBar` component is a React implementation of VSCode's MenuBar widget. It provides a complete menu bar system with top-level menu items, dropdown menus, submenus, separators, and full keyboard navigation support. The component features VSCode styling, theme integration, accessibility support, and internationalization.

## API

### TypeScript Interfaces

```typescript
export interface MenuBarProps {
  children: React.ReactNode
  className?: string
  id?: string
}

export interface MenuItemProps {
  title: string
  shortcut?: string
  onClick?: () => void
  checked?: boolean
  disabled?: boolean
  children?: React.ReactNode
  className?: string
  id?: string
}

export interface MenuItemSeparatorProps {
  className?: string
  id?: string
}

export interface MenuBarState {
  focusedMenuIndex: number | null
  isOpen: boolean
  activeMenuIndex: number | null
}

export interface MenuItemState {
  isHovered: boolean
  isFocused: boolean
}
```

### Props

#### MenuBar
- **children** (`React.ReactNode`) : MenuBarItem components
- **className** (`string`) : Additional CSS classes
- **id** (`string`) : HTML ID of the menu bar

#### MenuBarItem
- **title** (`string`) : Display text for the menu item
- **children** (`React.ReactNode`) : MenuItem components for dropdown
- **isFocused** (`boolean`) : Internal focus state (managed by MenuBar)
- **isActive** (`boolean`) : Internal active state (managed by MenuBar)
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

## DOM Structure

### Top-level MenuBar

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
- **monaco-menu-container** : VSCode menu container styling

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
- **codicon** : VSCode icon font
- **codicon-check** : Check mark icon
- **codicon-chevron-right** : Right arrow for submenus
- **codicon-placeholder** : Placeholder for alignment

## VSCode Theme Variables

The component uses the following CSS variables:

- `--vscode-menubar-background` : Background color of the menu bar
- `--vscode-menubar-foreground` : Text color of menu items
- `--vscode-menu-background` : Background color of dropdown menus (opaque, not transparent)
- `--vscode-menu-foreground` : Text color of menu items
- `--vscode-menu-border` : Border color of dropdown menus
- `--vscode-list-hoverBackground` : Background color of hovered menu items
- `--vscode-list-hoverForeground` : Text color of hovered menu items
- `--vscode-list-activeSelectionBackground` : Background color of focused menu items
- `--vscode-list-activeSelectionForeground` : Text color of focused menu items
- `--vscode-menu-separatorBackground` : Color of menu separators
- `--vscode-descriptionForeground` : Color of keyboard shortcuts
- `--vscode-disabledForeground` : Color of disabled menu items
- `--vscode-focusBorder` : Focus border color
- `--vscode-widget-shadow` : Dropdown menu shadow

## Keyboard Navigation

### MenuBar Navigation
- **Arrow Left/Right** : Navigate between top-level menu items
- **Arrow Down/Enter/Space** : Open focused menu
- **Escape** : Close menu and return focus
- **Tab** : Cycle through menu items
- **Alt + Key** : Open menu by mnemonic (e.g., Alt+F for File)

### Menu Navigation
- **Arrow Up/Down** : Navigate menu items
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
- **Theme integration**: Scrollbars match VSCode theme variables
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
- **Menu containers**: Use `var(--vscode-menu-background)` for opaque, solid backgrounds
- **Menu items**: Transparent background with hover/focus states
- **Borders**: `var(--vscode-menu-border)` for consistent theming
- **Shadows**: Subtle drop shadows for depth

### Color Consistency
The MenuBar component uses the same color scheme as other VSCode components:
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

The component automatically adapts to VSCode themes through CSS variables. No additional configuration is required.

## Performance

The component uses:
- `useCallback` for optimized re-renders
- `useRef` for DOM element references
- Efficient event handling
- Minimal re-renders with proper state management

## Notes for AI Usage

### Recommended Configuration

For optimal usage, always use VSCode theme variables and proper internationalization:

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
