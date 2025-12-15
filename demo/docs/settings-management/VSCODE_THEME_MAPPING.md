# VSCode Theme Integration Mapping

This document describes how the VSCode theme and styles are integrated into the Demo settings page.

## Overview

The settings page uses VSCode's official class names, CSS variables, and styling conventions to provide a consistent look and feel with Visual Studio Code.

## Theme Files

### Location
All theme-related files are located in `src/renderer/src/styles/`:

- `vscode-variables.css` - Main CSS variables file and imports
- `vscode-settings.css` - Structural styles for the settings page
- `vscode-classes.json` - Mapping of VSCode class names used
- `themes/` - Theme-specific CSS variable definitions

### Available Themes

| Theme | File | Description |
|-------|------|-------------|
| Dark+ | `themes/vscode-dark.css` | Default dark theme |
| Light+ | `themes/vscode-light.css` | Default light theme |
| High Contrast Dark | `themes/vscode-hc-dark.css` | High contrast dark theme |
| High Contrast Light | `themes/vscode-hc-light.css` | High contrast light theme |

## Theme Selection

Themes are applied using the `data-theme` attribute on the `<html>` element:

```typescript
document.documentElement.setAttribute('data-theme', 'vscode-dark')
```

Available values:
- `vscode-dark` - Dark+ theme
- `vscode-light` - Light+ theme
- `vscode-hc-dark` - High Contrast Dark
- `vscode-hc-light` - High Contrast Light

## CSS Class Names

The following VSCode class names are used throughout the settings interface:

### Main Structure

| Class Name | Purpose |
|------------|---------|
| `.settings-editor` | Root container for the entire settings page |
| `.settings-header` | Header section containing the search bar |
| `.settings-body` | Main body container with sidebar and content |

### Search

| Class Name | Purpose |
|------------|---------|
| `.settings-search-container` | Container for the search input |
| `.settings-search-input` | The search input field |
| `.settings-search-clear-button` | Clear button for the search input |

### Tree View (Table of Contents)

| Class Name | Purpose |
|------------|---------|
| `.settings-toc-container` | Left sidebar container |
| `.settings-toc-tree` | Tree view list container |
| `.settings-tree-item` | Individual tree item |
| `.settings-tree-item.active` | Active/selected tree item |
| `.settings-tree-item.nested` | Nested/child tree item |
| `.settings-tree-icon` | Icon container (chevron) |

### Content Area

| Class Name | Purpose |
|------------|---------|
| `.settings-editor-content` | Main content area (scrollable) |
| `.settings-group-container` | Container for a category group |
| `.settings-group-title-label` | Category title (sticky header) |
| `.settings-group-title-label.subcategory` | Subcategory title |

### Setting Items

| Class Name | Purpose |
|------------|---------|
| `.setting-item` | Individual setting container |
| `.setting-item.focused` | Focused setting item |
| `.setting-item-title-container` | Container for gear icon + title |
| `.setting-item-gear-icon` | Settings gear icon button |
| `.setting-item-title` | Setting title text |
| `.setting-item-description` | Setting description text |
| `.setting-item-control` | Container for the setting control |

### Context Menu

| Class Name | Purpose |
|------------|---------|
| `.setting-item-context-menu` | Context menu container |
| `.setting-item-context-menu-item` | Individual menu item |

## CSS Variables

The theme system uses CSS custom properties (variables) that match VSCode's variable names.

### Core Variables

```css
/* Editor colors */
--vscode-editor-background
--vscode-editor-foreground

/* UI colors */
--vscode-sideBar-background
--vscode-sideBar-foreground
--vscode-panel-border

/* Input controls */
--vscode-input-background
--vscode-input-foreground
--vscode-input-border

/* Dropdown */
--vscode-dropdown-background
--vscode-dropdown-foreground
--vscode-dropdown-border

/* Checkbox */
--vscode-checkbox-background
--vscode-checkbox-foreground
--vscode-checkbox-border

/* Buttons */
--vscode-button-background
--vscode-button-foreground
--vscode-button-hoverBackground

/* List/Tree */
--vscode-list-activeSelectionBackground
--vscode-list-activeSelectionForeground
--vscode-list-hoverBackground
--vscode-list-focusBackground

/* Focus */
--vscode-focusBorder

/* Text */
--vscode-foreground
--vscode-descriptionForeground
```

### Settings-Specific Variables

```css
--vscode-settings-headerForeground
--vscode-settings-checkboxBackground
--vscode-settings-checkboxForeground
--vscode-settings-checkboxBorder
--vscode-settings-textInputBackground
--vscode-settings-textInputForeground
--vscode-settings-textInputBorder
--vscode-settings-dropdownBackground
--vscode-settings-dropdownForeground
--vscode-settings-dropdownBorder
```

## Component Styles

### Inputs

All input fields (text, number) use VSCode input styling:

```css
input[type="text"], input[type="number"] {
  background-color: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
}

input:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}
```

### Checkboxes

```css
input[type="checkbox"] {
  background-color: var(--vscode-checkbox-background);
  border: 1px solid var(--vscode-checkbox-border);
}
```

### Dropdowns/Selects

```css
select {
  background-color: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border);
}
```

## Sticky Headers

Category and subcategory titles use `position: sticky` to remain visible when scrolling:

```css
.settings-group-title-label {
  position: sticky;
  top: 0;
  background-color: var(--vscode-editor-background);
  z-index: 10;
}
```

## Scrollbar Customization

Custom scrollbar styles matching VSCode:

```css
::-webkit-scrollbar {
  width: 10px;
}

::-webkit-scrollbar-thumb {
  background-color: var(--vscode-scrollbarSlider-background);
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--vscode-scrollbarSlider-hoverBackground);
}
```

## Integration with React Components

### Example: Using VSCode Classes

```tsx
// SettingsView.tsx
<div className="settings-editor">
  <div className="settings-header">
    <SettingsSearchBar />
  </div>
  <div className="settings-body">
    <div className="settings-toc-container">
      <SettingsTreeView />
    </div>
    <div className="settings-editor-content">
      <SettingsContent />
    </div>
  </div>
</div>
```

### Example: Using VSCode Variables

```tsx
// Custom inline styles using variables
<p style={{ color: 'var(--vscode-descriptionForeground)' }}>
  This text uses the VSCode description color
</p>
```

## Differences from VSCode

While we strive to match VSCode's appearance, there are some intentional differences:

1. **No Shadow DOM**: Unlike VSCode's webview components, we don't use Web Components with Shadow DOM
2. **Simplified Structure**: Some nested divs from VSCode are simplified for our use case
3. **Custom Controls**: Some controls (like range sliders) may have custom implementations

## Updating Themes

### Manual Updates

To update theme variables:

1. Edit the appropriate theme file in `src/renderer/src/styles/themes/`
2. Use VSCode's DevTools to inspect actual variable values
3. Update the CSS variable values

### Automated Updates (Future)

The `scripts/scrape-vscode-theme.ts` script is designed to automatically extract theme variables from vscode.dev, but currently has limitations due to the complexity of the VSCode web interface.

## References

- [VSCode Source Code](https://github.com/microsoft/vscode)
- [VSCode Theme Color Reference](https://code.visualstudio.com/api/references/theme-color)
- [VSCode Webview UI Toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit) (deprecated but useful reference)
- [@vscode/codicons](https://microsoft.github.io/vscode-codicons/) - Official VSCode icons

## Browser Compatibility

The theme system requires:
- CSS Custom Properties (CSS Variables)
- `::-webkit-scrollbar` pseudo-elements (for custom scrollbar)
- `position: sticky` (for sticky headers)

These features are supported in:
- Chrome/Chromium 88+
- Electron 12+ (used in Demo)
- Edge 88+
- Safari 13.1+
- Firefox 72+ (except custom scrollbar)
