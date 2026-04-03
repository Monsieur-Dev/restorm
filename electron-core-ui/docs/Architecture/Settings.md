# Settings Architecture

Declarative, YAML-driven settings system with search, storage persistence, sticky-header navigation, and runtime mutations.

## Overview

The settings system provides a complete settings management solution:

- **YAML-driven configuration**: Define groups, settings, and renderers in YAML files
- **Full-text search**: MiniSearch-based fuzzy matching across setting titles and descriptions
- **Persistence**: Values stored via `StorageService` with automatic default fallback
- **Sticky-header navigation**: TOC sidebar with scroll-synced active group tracking
- **Runtime mutations**: Add, remove, or update groups and settings programmatically
- **Custom renderers**: Register app-specific renderer components for new setting types

## Architecture

```
Main Process                          IPC                      Renderer
+----------------------------+        |        +-------------------------------+
|  SettingsService           |        |        |  SettingsProvider             |
|  - groups (YAML-loaded)    | <------|------> |  - groups, settings state     |
|  - renderers               |  IPC   |        |  - search query / results     |
|  - MiniSearch index        |  Hndl  |        |  - side effects (i18n, theme) |
|  - StorageService (r/w)    |        |        +-------------------------------+
|  - BrowserWindow broadcast |        |                    |
+----------------------------+        |        +-------------------------------+
                                      |        |  SettingsView                 |
                                      |        |  - TOC sidebar (25%)          |
                                      |        |  - Scrollable content (75%)   |
                                      |        |  - Sticky group headers       |
                                      |        +-------------------------------+
                                      |                    |
                                      |        +-------------------------------+
                                      |        |  SettingItem                  |
                                      |        |  - Renderer per type          |
                                      |        |  - Gear menu (reset, copy ID) |
                                      |        |  - Modified indicator         |
                                      |        +-------------------------------+
```

## YAML Configuration Format

Settings are declared in YAML files. A default config ships with `electron-core-ui`, and consumer apps can provide their own to add or replace settings.

```yaml
# Optional: replace all default renderers with this file's renderers
overrideDefaultRenderers: false

# Optional: replace all default groups with this file's groups
overrideDefaultGroups: false

# Renderer mappings (type -> component)
renderers:
  - type: theme
    component: "__builtin__/ThemeCarousel"
  - type: toggle
    component: "__builtin__/Toggle"
  - type: custom
    component: "./components/MyCustomRenderer"

# Settings hierarchy
groups:
  - id: "appearance"
    titleKey: "settings.appearance"
    items:
      - setting:
          id: "theme"
          titleKey: "settings.theme"
          descriptionKey: "settings.themeDesc"
          type: "theme"
          default: "dark-default"
      - group:
          id: "editor"
          titleKey: "settings.editor"
          items:
            - setting:
                id: "fontSize"
                titleKey: "settings.fontSize"
                descriptionKey: "settings.fontSizeDesc"
                type: "number"
                default: 14
                params:
                  min: 8
                  max: 72
                  integer: true

  - id: "behavior"
    titleKey: "settings.behavior"
    items:
      - setting:
          id: "autoSave"
          titleKey: "settings.autoSave"
          type: "toggle"
          default: true
```

### Top-level Fields

| Field | Required | Description |
|-------|----------|-------------|
| `groups` | Yes | Array of `SettingsGroup` |
| `renderers` | No | Maps setting `type` to a renderer component |
| `overrideDefaultRenderers` | No | If `true`, clears all default renderers before merging |
| `overrideDefaultGroups` | No | If `true`, replaces all default groups entirely |

### Setting Definition

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique within its group |
| `titleKey` | Yes | i18n key for the label |
| `descriptionKey` | No | i18n key for the description |
| `type` | Yes | Renderer type (`toggle`, `number`, `text`, `enum`, `theme`, or custom) |
| `default` | Yes | Default value (`string`, `number`, or `boolean`) |
| `params` | No | Type-specific params (e.g. `min`/`max` for number, `values` for enum) |

### Groups / Settings Hierarchy

Groups can contain two kinds of items:

- `setting:` -- a leaf setting with its definition
- `group:` -- a nested sub-group (recursive), enabling arbitrary depth

```yaml
items:
  - setting:
      id: "fontSize"
      ...
  - group:
      id: "advanced"
      titleKey: "settings.advanced"
      items:
        - setting:
            id: "debugMode"
            ...
```

## Built-in Renderer Types

| Type | Component | Value Type | Params |
|------|-----------|------------|--------|
| `toggle` | `ToggleRenderer` | `boolean` | -- |
| `number` | `NumberInput` | `number` | `min`, `max`, `integer` |
| `text` | `TextInput` | `string` | `maxLength` |
| `enum` | `EnumRenderer` | `string` | `values: [{value, labelKey}]` |
| `theme` | `ThemeRenderer` (wraps `ThemeCarousel`) | `string` | -- |

## Custom Renderers

To add a custom renderer:

1. Create a component implementing `SettingRendererProps`:

```tsx
import type { SettingRendererProps } from 'electron-core-ui/renderer'

const MyColorPicker: React.FC<SettingRendererProps> = ({ setting, value, onChange }) => {
  return (
    <input
      type="color"
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
```

2. Register it via the `customRenderers` prop on `ElectronCoreUiProvider`:

```tsx
import { ElectronCoreUiProvider } from 'electron-core-ui/renderer'

const customRenderers = {
  'color-picker': MyColorPicker
}

function App() {
  return (
    <ElectronCoreUiProvider customRenderers={customRenderers}>
      <MyApp />
    </ElectronCoreUiProvider>
  )
}
```

3. Reference the type in your YAML config:

```yaml
- setting:
    id: "accentColor"
    titleKey: "settings.accentColor"
    type: "color-picker"
    default: "#0078d4"
```

The `SettingRendererProps` interface:

```typescript
interface SettingRendererProps {
  setting: ResolvedSetting
  value: SettingValue  // string | number | boolean
  onChange: (v: SettingValue) => void
}
```

## SettingsService API (Main Process)

### Initialization

```typescript
initSettingsService(defaultConfigPath: string, appConfigPath?: string): SettingsService
getSettingsService(): SettingsService
isSettingsServiceInitialized(): boolean
```

### Read / Write

| Method | Description |
|--------|-------------|
| `get(storageKey)` | Get current value (persisted or default) |
| `set(storageKey, value)` | Persist value, broadcast `settings:changed` to all windows |
| `resetSetting(storageKey)` | Delete persisted value, broadcast default value |
| `getAll()` | Flattened list of `ResolvedSetting` with current values |
| `getGroups()` | Raw group hierarchy |
| `getRenderers()` | Renderer type-to-component map |

### Runtime Mutations

| Method | Description |
|--------|-------------|
| `addGroup(parentId, group)` | Add group at root (`null`) or under a parent |
| `removeGroup(groupId)` | Remove a group by ID (recursive) |
| `addSetting(groupId, setting)` | Add a setting to an existing group |
| `updateSetting(storageKey, updates)` | Patch a setting definition in place |
| `removeSetting(storageKey)` | Remove a setting by storage key |

### Search

| Method | Description |
|--------|-------------|
| `search(query)` | Fuzzy search settings by title/description, returns `ResolvedSetting[]` |
| `reindexSearch()` | Rebuild the MiniSearch index (call after language change) |

### Config Loading

| Method | Description |
|--------|-------------|
| `loadConfig(configPath)` | Load and merge an additional YAML file at runtime; re-indexes search and broadcasts `settings:config-loaded` |

## Storage Key Format

Storage keys are derived from the group path and setting ID:

```
<group1>.<group2>.<groupN>:<settingId>
```

Examples:
- `appearance:theme` -- setting `theme` in root group `appearance`
- `appearance.editor:fontSize` -- setting `fontSize` in nested group `editor` under `appearance`

Values are persisted via `StorageService` with the prefix `settings:`, resulting in actual storage keys like `settings:appearance.editor:fontSize`.

## IPC Channels

### Request/Response (ipcMain.handle)

| Channel | Args | Returns | Description |
|---------|------|---------|-------------|
| `settings:get` | `storageKey: string` | `SettingValue` | Get a single setting value |
| `settings:set` | `storageKey: string, value: SettingValue` | `boolean` | Set and persist a value |
| `settings:get-all` | -- | `ResolvedSetting[]` | All settings (flattened) |
| `settings:get-groups` | -- | `SettingsGroup[]` | Raw group hierarchy |
| `settings:get-renderers` | -- | `Record<string, string>` | Renderer type map |
| `settings:search` | `query: string` | `ResolvedSetting[]` | Fuzzy search |
| `settings:reset` | `storageKey: string` | `boolean` | Reset to default |
| `settings:reindex` | -- | `void` | Rebuild search index |

### Events (webContents.send)

| Channel | Payload | Description |
|---------|---------|-------------|
| `settings:changed` | `storageKey: string, value: SettingValue` | Broadcast when a setting value changes |
| `settings:config-loaded` | -- | Broadcast when a new config file is loaded via `loadConfig()` |

## Renderer Context

### SettingsProvider

Wraps the renderer tree to provide settings state. Automatically loads groups, settings, and renderers from the main process on mount.

```tsx
<SettingsProvider customRenderers={customRenderers}>
  {children}
</SettingsProvider>
```

Listens for `settings:changed` and `settings:config-loaded` events to stay in sync. Re-indexes search on language change.

### useSettings Hook

Returns the full `SettingsContextValue`:

```typescript
const {
  groups,           // SettingsGroup[]
  settings,         // Map<string, ResolvedSetting>
  renderers,        // Record<string, string>
  customRenderers,  // Record<string, ComponentType<SettingRendererProps>>
  isLoading,        // boolean
  getSetting,       // (storageKey) => ResolvedSetting | undefined
  setSetting,       // (storageKey, value) => Promise<void>
  resetSetting,     // (storageKey) => Promise<void>
  searchQuery,      // string
  setSearchQuery,   // (query) => void
  filteredSettings  // ResolvedSetting[]
} = useSettings()
```

### useSetting Hook

Convenience hook for a single setting:

```typescript
const [value, setValue, isModified] = useSetting('appearance:theme')
```

## UI Components

### SettingsView

The main settings UI. Layout:

- **Search bar** at the top (`InputBox`)
- **TOC sidebar** (left ~25%) -- tree of group names, scroll-synced with content, auto-expands active path
- **Scrollable content** (right ~75%) -- groups rendered with sticky headers using `data-sticky-level` attribute, nesting depth controls heading level (h1-h4)

When a search query is active, the TOC and content panels filter to show only matching groups/settings.

### SettingItem

Renders a single setting:

- **Title** (translated via `titleKey`)
- **Description** (translated via `descriptionKey`, hidden for toggle type)
- **Renderer** chosen by `type` field (built-in or custom)
- **Gear menu** (visible on focus) with "Reset Setting" and "Copy Setting ID" actions via `ContextMenu`
- **Modified indicator** -- CSS class `setting-item--modified` when value differs from default

### SettingsModal

`SettingsModalProvider` wraps the app and exposes `useSettingsModal()`:

```tsx
const { isOpen, showSettingsModal, hideSettingsModal } = useSettingsModal()
```

Renders a `Modal` containing `SettingsPage`.

### SettingsPage

Conditional rendering:

- If `SettingsProvider` is active and has groups: renders `SettingsView` (dynamic YAML-driven UI)
- Otherwise: falls back to hardcoded theme carousel + language select

## Search

Settings are indexed using MiniSearch with fuzzy matching (`fuzzy: 0.2`) and prefix search. The index is built from:

- `title` (boosted 2x) -- resolved via i18n from `titleKey`
- `description` -- resolved via i18n from `descriptionKey`
- `id` -- the setting's `storageKey`

Call `reindexSearch()` after a language change to update translated strings in the index. The `SettingsProvider` handles this automatically.

## Adding App-specific Settings

1. Create a YAML config file in your app's resources:

```yaml
groups:
  - id: "myapp"
    titleKey: "myapp.settings"
    items:
      - setting:
          id: "syncEnabled"
          titleKey: "myapp.syncEnabled"
          type: "toggle"
          default: true
```

2. Pass the path when initializing via `initializeApp()`:

```typescript
import { initializeApp } from 'electron-core-ui/main'

initializeApp(
  'MyApp',
  createWindow,
  devResourcesPath,
  onActivate,
  rendererPath,
  path.join(__dirname, '../resources/settings.yaml')  // appSettingsConfigPath
)
```

Or use `setupIPC` directly:

```typescript
setupIPC(devResourcesPath, appSettingsConfigPath)
```

3. Settings from both the library defaults and app config are merged. Use `overrideDefaultGroups: true` or `overrideDefaultRenderers: true` in the app config to replace defaults entirely.

## Side Effects

The `SettingsProvider` applies side effects when certain settings change:

| Storage Key | Side Effect |
|-------------|-------------|
| `appearance:language` | Calls `i18n.changeLanguage(value)` and `window.api.i18n.setLanguage(value)` |
| `appearance:theme` | Calls `window.api.theme.set(value)` |
