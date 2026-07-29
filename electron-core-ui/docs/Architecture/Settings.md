# Settings Architecture

Declarative, YAML-driven settings system with search, storage persistence, sticky-header navigation, and runtime mutations.

## Overview

The settings system provides a complete settings management solution:

- **YAML-driven configuration**: Define groups and settings in YAML files
- **Full-text search**: MiniSearch-based fuzzy matching across setting titles and descriptions
- **Persistence**: Values stored via `StorageService` with automatic default fallback
- **Sticky-header navigation**: TOC sidebar with scroll-synced active group tracking
- **Runtime mutations**: Add, remove, or update groups and settings programmatically
- **Custom renderers**: Register app-specific renderer components via `registerSettingRenderer()`

## Architecture

```
Main Process                          IPC                      Renderer
+----------------------------+        |        +-------------------------------+
|  SettingsService           |        |        |  SettingsProvider             |
|  - groups (YAML-loaded)    | <------|------> |  - groups, settings state     |
|  - MiniSearch index        |  IPC   |        |  - search query / results     |
|  - StorageService (r/w)    |  Hndl  |        |  - side effects (i18n, theme) |
|  - BrowserWindow broadcast |        |        +-------------------------------+
+----------------------------+        |
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
# Optional: replace all default groups with this file's groups
overrideDefaultGroups: false

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
| `feature` | No | Feature-flag name (`FeatureFlippingService`) that gates this setting — HIDES it entirely when the flag is disabled |
| `featureDisabledDefault` | No | Value substituted when `feature` is disabled. Required when `feature` is set |
| `userOnly` | No | When `true`, only the user layer may set this — a workspace overlay can never override it |
| `capability` | No | Entitlement capability id (the host's Pro/plan system, distinct from `feature`) that gates this setting — see "Capability-gated settings" below |

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
| `enum` | `EnumRenderer` | `string` | `values: [{value, labelKey, flag?}]` |
| `theme` | `ThemeRenderer` (wraps `ThemeCarousel`) | `string` | -- |

Each `EnumValue`'s `flag` is optional and, when present, is prefixed to the
translated label as `"{flag} {label}"` via the shared
`formatLanguageOptionLabel` helper (`Settings/languages.ts`) -- the same
function the `PushModal` commit-language picker uses, so both pickers render
identically. An entry without `flag` renders its label alone; `EnumRenderer`
itself stays generic and applies no language-specific logic.

## Custom Renderers

Custom renderers are registered programmatically via `registerSettingRenderer()`. Call it before rendering the settings UI -- typically once per custom type at app startup.

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

2. Register it via `registerSettingRenderer()` before rendering:

```tsx
import { registerSettingRenderer } from 'electron-core-ui/renderer'

registerSettingRenderer('color-picker', MyColorPicker)
```

One call per custom type. Register all custom renderers before rendering the settings UI (e.g. in your app's entry point or top-level component).

3. Reference the type in your YAML config:

```yaml
- setting:
    id: "accentColor"
    titleKey: "settings.accentColor"
    type: "color-picker"
    default: "#0078d4"
```

> **Note:** If a setting references a `type` that has no registered renderer (built-in or custom), an error is logged to the console and the setting is rendered as empty.

The `SettingRendererProps` interface:

```typescript
interface SettingRendererProps {
  setting: ResolvedSetting
  value: SettingValue  // string | number | boolean
  onChange: (v: SettingValue) => void
}
```

## Capability-gated settings

A setting tagged with `capability: "some.capability.id"` in its YAML definition renders greyed + non-interactive (via `GatedControl`, the same "visible but locked with an upsell" primitive used elsewhere in the app) when the host reports that capability as locked — as opposed to `feature`, which HIDES the setting entirely. ECUI has no notion of the host's entitlement/auth system, so the host supplies the check + the upsell action via a `CapabilityGate`, threaded down through `ElectronCoreUiProvider`:

```tsx
import { ElectronCoreUiProvider, type CapabilityGate } from 'electron-core-ui/renderer'

const capabilityGate: CapabilityGate = {
  isLocked: (capability) => !hasCapability(myAuthState, capability),
  onSubscribe: () => { void myCheckoutFlow() }
}

<ElectronCoreUiProvider capabilityGate={capabilityGate}>
  {children}
</ElectronCoreUiProvider>
```

`capabilityGate` must be recomputed (a fresh object identity) whenever the underlying entitlement changes — e.g. build it inside a component that itself calls a reactive `useAuthState()`-style hook, memoized on that state, rather than a static object built once at bootstrap. Otherwise every capability-gated setting stays frozen at whatever entitlement existed when the app first rendered.

Omitting `capabilityGate` entirely (a host with no capability/entitlement concept) makes every `capability`-tagged setting render UNLOCKED — the gate fails open, never silently hiding a setting a host never wired a check for.

```yaml
- setting:
    id: "semiPullFrequency"
    titleKey: "git.semiPullFrequencyTitle"
    type: "enum"
    default: "1h"
    capability: "git.client"
    params:
      values: [...]
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
| `getAll()` | Flattened list of `ResolvedSetting` with current values, **including** feature-gated settings whose flag is off |
| `getFiltered()` | Same, minus the feature-gated settings the UI hides — use this whenever a consumer must mirror what the settings page actually shows |
| `getGroups()` | Raw group hierarchy |

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

Wraps the renderer tree to provide settings state. Automatically loads groups and settings from the main process on mount.

```tsx
<SettingsProvider>
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

3. Settings from both the library defaults and app config are merged. Use `overrideDefaultGroups: true` in the app config to replace default groups entirely. Custom renderers are registered separately via `registerSettingRenderer()` in the renderer process.

## Workspace overlay

A hosting app can activate a per-project settings overlay by calling `SettingsService.setWorkspacePath(absoluteDir)` whenever it opens a file or folder. The service then loads `<absoluteDir>/.restorm/settings.json` (sparse JSON, only overridden keys) and treats those values as a layer on top of the user file. Effective-value priority is `workspace > user > default`. Call `unsetWorkspacePath()` on close.

```typescript
// In your main-process file/folder open handler:
getSettingsService().setWorkspacePath(dirname(filePath))
// On close:
getSettingsService().unsetWorkspacePath()
```

The Settings UI surfaces this through two tabs at the top of `SettingsPage`: **User** (default) and **Workspace** (disabled when no project is open). Reads / writes / resets on the User tab go to the user file; on the Workspace tab they go to `<workspace>/.restorm/settings.json`. Writes are debounced ~200 ms and atomically committed via temp-rename. The file is auto-deleted when the workspace overlay becomes empty.

A setting flagged `userOnly: true` in the YAML schema can never be overridden at the workspace scope — `appearance.language` is the canonical example (locale is a per-machine preference, not a project decision). The Workspace tab hides such settings entirely with a "{N} user-only settings hidden on this tab" footer; if a workspace JSON file is hand-edited to carry a `userOnly` key, the load step ignores it with a warning.

API surface added to `SettingsService`:

- `setWorkspacePath(absoluteDir)` / `unsetWorkspacePath()` / `getWorkspacePath()`
- `getWorkspaceValue(key)` / `setWorkspaceValue(key, value)` / `resetWorkspaceValue(key)`
- `getUserValue(key)` (introspection — bypasses workspace overlay)
- `getResolvedValue(key)` returns `{ effective, source: 'workspace' | 'user' | 'default', overriddenBy?: 'workspace' }`

`get(key)` returns the effective value, so existing consumers transparently pick up workspace overrides.

## Side Effects

The `SettingsProvider` applies side effects when certain settings change:

| Storage Key | Side Effect |
|-------------|-------------|
| `appearance:language` | Calls `i18n.changeLanguage(value)` and `window.api.i18n.setLanguage(value)` |
| `appearance:theme` | Calls `window.api.theme.set(value)` |
| `files:autoSave` / `files:autoSaveDelay` | Drive the in-process `AutoSaveController` (see below) |

Because these hang off the `settings:changed` broadcast — not off the settings
page's click handler — they fire for **any** writer that goes through
`SettingsService.set()` / `setWorkspaceValue()`, at either scope. That is what
lets the MCP settings routes (below) change the theme or the UI language without
a line of per-setting code. It also means the side effect needs a live renderer:
with no window open the value is persisted but only takes effect on the next
launch.

## MCP settings routes

`McpService` exposes the whole registry to external tooling through four generic
routes — `get_settings`, `set_setting`, `patch_settings`, `reset_setting` —
covering both scopes. They flatten `getFiltered()` and derive each setting's
accepted values from its declared `type` + `params`, so a setting added to any
YAML config (this library's defaults or the app's own) becomes readable and
writable with no code change. The derivation, validation and per-scope write
helpers live in `main/services/settingsCatalog.ts`; the route definitions live in
`McpService`. See the [McpService doc](../McpService/README.md#settings-routes)
for the wire shapes.

## Subscribing from the main process

Main-process services that need to react to setting changes can call `SettingsService.onSettingChanged(storageKey, listener)`. It returns an unsubscribe function and fires from the same code path as the renderer broadcast (both `set()` and `resetSetting()`):

```typescript
const unsub = settingsService.onSettingChanged('files:autoSave', (value) => {
  logger.info('autoSave changed', { value })
})
// Later — typically from your service's stop() / dispose path:
unsub()
```

The `AutoSaveController` is the canonical consumer; see `AutoSaveController.ts` for a full subscribe + dispose pattern.

## AutoSave (`files:autoSave` + `files:autoSaveDelay`)

The library ships an in-process `AutoSaveController` that reacts to the two `files:` settings and fires the host app's "Save all" flow on the right trigger:

- `off` — disabled.
- `afterDelay` — debounce on `FileService.onDirtyChanged`; save after `files:autoSaveDelay` ms of inactivity.
- `onWindowChange` — save on `BrowserWindow` `'blur'`, provided anything is dirty.

A trigger is a no-op when no file is open (`FileService.getFilePath()` returns `null`) — there is nothing to save. Any pending afterDelay timer that fires while no file is open is silently dropped; the next dirty event after a file opens re-arms it normally.

Switching `autoSave` to `afterDelay` while a file is already open and dirty arms the timer immediately, so the user's unsaved work is picked up after the configured delay without needing to type one more character. Switching to `off` cancels any pending timer.

The controller resyncs its cached dirty state from `FileService.getSaveUnitsSnapshot()` on every `onStateChanged` event, so a close→reopen round-trip can never leave it with a stale flag — a fresh edit on the reopened file always rearmed reliably.

The controller does not know how a host app actually persists. It broadcasts `'file:autosave-trigger'` to every open window via `window.api.file.onAutoSaveTrigger(callback)`, and the renderer wires `callback` to its existing save-all flow.

Wire from main:

```typescript
import { initFileService, getFileService, getSettingsService, initAutoSaveController } from 'electron-core-ui'

initFileService({ /* … */ })
initAutoSaveController({
  settings: getSettingsService(),
  fileService: getFileService()
})
```

Wire from renderer:

```typescript
useEffect(() => {
  const unsub = window.api.file.onAutoSaveTrigger(() => {
    void handleMenuSaveAll()
  })
  return unsub
}, [handleMenuSaveAll])
```
