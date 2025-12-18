# VSCode Theme Integration Mapping

This document describes how the VSCode theme and styles are integrated into the Gitable settings page.

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
--editor-background
--editor-foreground

/* UI colors */
--sideBar-background
--sideBar-foreground
--panel-border

/* Input controls */
--input-background
--input-foreground
--input-border

/* Dropdown */
--dropdown-background
--dropdown-foreground
--dropdown-border

/* Checkbox */
--checkbox-background
--checkbox-foreground
--checkbox-border

/* Buttons */
--button-background
--button-foreground
--button-hoverBackground

/* List/Tree */
--list-activeSelectionBackground
--list-activeSelectionForeground
--list-hoverBackground
--list-focusBackground

/* Focus */
--focusBorder

/* Text */
--foreground
--descriptionForeground
```

### Settings-Specific Variables

```css
--settings-headerForeground
--settings-checkboxBackground
--settings-checkboxForeground
--settings-checkboxBorder
--settings-textInputBackground
--settings-textInputForeground
--settings-textInputBorder
--settings-dropdownBackground
--settings-dropdownForeground
--settings-dropdownBorder
```

## Component Styles

### Inputs

All input fields (text, number) use VSCode input styling:

```css
input[type="text"], input[type="number"] {
  background-color: var(--input-background);
  color: var(--input-foreground);
  border: 1px solid var(--input-border);
}

input:focus {
  outline: 1px solid var(--focusBorder);
  outline-offset: -1px;
}
```

### Checkboxes

```css
input[type="checkbox"] {
  background-color: var(--checkbox-background);
  border: 1px solid var(--checkbox-border);
}
```

### Dropdowns/Selects

```css
select {
  background-color: var(--dropdown-background);
  color: var(--dropdown-foreground);
  border: 1px solid var(--dropdown-border);
}
```

## Sticky Headers

Category and subcategory titles use `position: sticky` to remain visible when scrolling:

```css
.settings-group-title-label {
  position: sticky;
  top: 0;
  background-color: var(--editor-background);
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
  background-color: var(--scrollbarSlider-background);
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--scrollbarSlider-hoverBackground);
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
<p style={{ color: 'var(--descriptionForeground)' }}>
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
- Electron 12+ (used in Gitable)
- Edge 88+
- Safari 13.1+
- Firefox 72+ (except custom scrollbar)
