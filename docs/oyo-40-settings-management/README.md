# Settings Management System

## Overview

The Settings Management System provides a comprehensive solution for managing application settings in Gitable. It features a hierarchical settings structure, persistent storage, and a VSCode-like user interface.

## Features

- **Hierarchical Settings Structure**: Organize settings into categories and subcategories
- **Multiple Setting Types**: Support for boolean, number, string, enum, and range (slider) types
- **Persistent Storage**: Settings are saved to local storage and loaded on application start
- **Search Functionality**: Search settings by name, key, or description with debouncing
- **VSCode-like Interface**: Familiar tree view navigation with resizable panels
- **Internationalization**: Full support for multiple languages (English and French)
- **Type-Safe**: Full TypeScript support with strict typing

## Architecture

The system follows Electron's architecture with three main components:

1. **Main Process** (`src/main/`):
   - `SettingsService`: Core service for managing settings
   - Schema loading from JSON file
   - IPC handlers for communication with renderer

2. **Preload Script** (`src/preload/`):
   - Secure bridge between main and renderer processes
   - Exposes `settingsAPI` to the renderer

3. **Renderer Process** (`src/renderer/`):
   - React components for the UI
   - Settings view with tree navigation and controls
   - Integration with i18n for language settings

## File Structure

```
src/
├── main/
│   ├── types/
│   │   └── settings.types.ts          # TypeScript type definitions
│   ├── services/
│   │   └── SettingsService.ts         # Main settings service
│   └── index.ts                       # IPC handlers registration
├── preload/
│   └── index.ts                       # Settings API exposure
├── renderer/
│   └── src/
│       ├── types/
│       │   └── settings.types.ts      # Renderer type definitions
│       ├── components/
│       │   └── settings/
│       │       ├── SettingsView.tsx   # Main settings view
│       │       ├── SettingsTreeView.tsx
│       │       ├── SettingsContent.tsx
│       │       ├── SettingsSearchBar.tsx
│       │       ├── SettingControl.tsx
│       │       ├── ResizablePanel.tsx
│       │       └── Settings.css       # Styles
│       └── i18n.ts                    # i18n integration
└── resources/
    └── settings-schema.json           # Settings schema definition
```

## Usage

### Opening Settings

Click the "Settings" button on the main page to open the settings view.

### Navigating Settings

- Use the tree view on the left to navigate between categories
- Click on a category to view its settings
- Use the search bar to find specific settings
- Drag the divider between panels to resize them

### Modifying Settings

- Each setting type has an appropriate control:
  - **Boolean**: Checkbox
  - **Number**: Numeric input
  - **String**: Text input
  - **Enum**: Dropdown select
  - **Range**: Slider with min/max values
- Changes are saved automatically
- Click the reset button (↺) to restore default value

### Current Settings

#### Workbench → Appearance
- **Language**: Select display language (English/French)
- **Color Theme**: Choose color theme (dark/light/high-contrast)
- **Zoom Level**: Adjust UI zoom level (50%-200%)

#### Workbench → Editor
- **Font Size**: Set editor font size in pixels
- **Line Numbers**: Show/hide line numbers
- **Font Family**: Set editor font family

#### Test Settings
- Demo settings showcasing all available control types

## Technical Details

- Settings are stored in `userData/config.json`
- Schema is loaded from `resources/settings-schema.json`
- Full path keys are used (e.g., `workbench.appearance.language`)
- Changes are persisted immediately on modification
- Language setting is synchronized with i18n

## See Also

- [Architecture](./ARCHITECTURE.md): Detailed architecture documentation
- [Usage Guide](./USAGE.md): Guide for adding new settings
- [Schema Documentation](./SCHEMA.md): JSON schema format reference

