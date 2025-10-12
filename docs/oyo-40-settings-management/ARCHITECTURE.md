# Settings Management Architecture

## Overview

The settings management system is built on Electron's multi-process architecture, with clear separation between the main process (Node.js), preload scripts (bridge), and renderer process (React).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer Process (React)                 │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  SettingsView Component                              │  │
│  │  ┌────────────────┐  ┌──────────────────────────┐  │  │
│  │  │ SettingsTree   │  │  SettingsContent         │  │  │
│  │  │ View           │  │  ┌────────────────────┐  │  │  │
│  │  │                │  │  │  SettingControl    │  │  │  │
│  │  │  - Categories  │  │  │  - Boolean         │  │  │  │
│  │  │  - Navigation  │  │  │  - Number          │  │  │  │
│  │  │                │  │  │  - String          │  │  │  │
│  │  │                │  │  │  - Enum            │  │  │  │
│  │  │                │  │  │  - Range (Slider)  │  │  │  │
│  │  └────────────────┘  │  └────────────────────┘  │  │  │
│  │                       └──────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│                            ↓                                │
│                     window.settingsAPI                      │
└─────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                    Preload Script (Bridge)                   │
│                                                               │
│  contextBridge.exposeInMainWorld('settingsAPI', {            │
│    getSchema, getSetting, setSetting, resetSetting, ...      │
│  })                                                           │
└─────────────────────────────────────────────────────────────┘
                             ↓
                      IPC Communication
                             ↓
┌─────────────────────────────────────────────────────────────┐
│                   Main Process (Node.js)                     │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  IPC Handlers                                        │  │
│  │  - settings:get-schema                               │  │
│  │  - settings:get                                      │  │
│  │  - settings:set                                      │  │
│  │  - settings:reset                                    │  │
│  │  - settings:search                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                            ↓                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  SettingsService                                     │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  Schema Management                             │ │  │
│  │  │  - Load from JSON                              │ │  │
│  │  │  - Flatten hierarchy                           │ │  │
│  │  │  - Validate values                             │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  │                        ↓                             │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  StorageService (Persistence)                  │ │  │
│  │  │  - Load from userData/config.json              │ │  │
│  │  │  - Save on change                              │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Main Process Components

#### SettingsService
**Location**: `src/main/services/SettingsService.ts`

**Responsibilities**:
- Load and parse settings schema from JSON
- Flatten hierarchical structure for efficient access
- Manage setting values (get, set, reset)
- Validate setting values against schema
- Search settings by query
- Persist values using StorageService

**Key Methods**:
- `getSchema()`: Returns complete settings schema
- `getSetting<T>(key: string)`: Get value for a setting
- `setSetting(key: string, value: unknown)`: Set and validate a value
- `resetSetting(key: string)`: Reset to default value
- `searchSettings(query: string)`: Search by name/description/key

#### IPC Handlers
**Location**: `src/main/index.ts`

**Responsibilities**:
- Register IPC handlers for settings operations
- Bridge between renderer and SettingsService
- Initialize SettingsService on app ready

**Handlers**:
- `settings:get-schema`: Get schema
- `settings:get`: Get setting value
- `settings:set`: Set setting value
- `settings:reset`: Reset setting
- `settings:search`: Search settings
- `settings:get-all`: Get all settings

### Preload Script

**Location**: `src/preload/index.ts`

**Responsibilities**:
- Expose secure API to renderer process
- Use contextBridge to prevent prototype pollution
- Wrap IPC calls in Promise-based API

**Exposed API**:
```typescript
window.settingsAPI = {
  getSchema: () => Promise<SettingsSchema>
  getSetting: <T>(key: string) => Promise<T | undefined>
  setSetting: (key: string, value: unknown) => Promise<boolean>
  resetSetting: (key: string) => Promise<boolean>
  searchSettings: (query: string) => Promise<FlattenedSetting[]>
  getAllSettings: () => Promise<Record<string, unknown>>
}
```

### Renderer Process Components

#### SettingsView (Container)
**Location**: `src/renderer/src/components/settings/SettingsView.tsx`

**Responsibilities**:
- Main container for settings interface
- Load schema and values on mount
- Manage global state (selected category, search query, values)
- Handle setting changes and synchronize with i18n
- Coordinate between child components

#### SettingsTreeView (Navigation)
**Location**: `src/renderer/src/components/settings/SettingsTreeView.tsx`

**Responsibilities**:
- Display hierarchical category tree
- Handle category selection
- Expand/collapse categories
- Highlight selected category

#### SettingsContent (Display)
**Location**: `src/renderer/src/components/settings/SettingsContent.tsx`

**Responsibilities**:
- Display settings for selected category
- Show search results
- Render setting items with controls
- Handle empty states

#### SettingControl (Input)
**Location**: `src/renderer/src/components/settings/SettingControl.tsx`

**Responsibilities**:
- Render appropriate control for each setting type
- Handle value changes
- Implement type-specific controls:
  - `BooleanControl`: Checkbox with custom styling
  - `NumberControl`: Numeric input
  - `StringControl`: Text input
  - `EnumControl`: Dropdown select
  - `RangeControl`: Slider with min/max/step

#### ResizablePanel (Layout)
**Location**: `src/renderer/src/components/settings/ResizablePanel.tsx`

**Responsibilities**:
- Provide resizable split view layout
- Handle drag events for divider
- Maintain panel widths within constraints

#### SettingsSearchBar (Search)
**Location**: `src/renderer/src/components/settings/SettingsSearchBar.tsx`

**Responsibilities**:
- Search input with icon
- Debounce search queries (300ms)
- Trigger search callback

## Data Flow

### Loading Settings

```
1. User opens settings
   ↓
2. SettingsView mounts
   ↓
3. Parallel API calls:
   - window.settingsAPI.getSchema()
   - window.settingsAPI.getAllSettings()
   ↓
4. IPC to main process
   ↓
5. SettingsService:
   - Returns cached schema
   - Gets values from StorageService (with defaults)
   ↓
6. IPC response to renderer
   ↓
7. SettingsView updates state and renders UI
```

### Changing a Setting

```
1. User modifies control
   ↓
2. SettingControl onChange
   ↓
3. SettingsView handleSettingChange
   ↓
4. window.settingsAPI.setSetting(key, value)
   ↓
5. IPC to main process
   ↓
6. SettingsService:
   - Validates value against schema
   - Calls StorageService.set()
   - Returns success/failure
   ↓
7. StorageService persists to config.json
   ↓
8. IPC response to renderer
   ↓
9. SettingsView updates local state
   ↓
10. Special handling for language:
    - i18n.changeLanguage() called
    - UI re-renders with new language
```

### Searching Settings

```
1. User types in search bar
   ↓
2. Debounce timer (300ms)
   ↓
3. window.settingsAPI.searchSettings(query)
   ↓
4. IPC to main process
   ↓
5. SettingsService.searchSettings():
   - Search in flattened settings map
   - Match against key, name, description
   - Return matching FlattenedSetting[]
   ↓
6. IPC response to renderer
   ↓
7. SettingsView updates searchResults state
   ↓
8. SettingsContent displays results
```

## Type System

The system uses strict TypeScript types to ensure type safety across the codebase.

### Type Hierarchy

```typescript
SettingType (enum)
  ├─ BOOLEAN
  ├─ NUMBER
  ├─ STRING
  ├─ ENUM
  └─ RANGE

SettingDefinition (union)
  ├─ BooleanSettingDefinition
  ├─ NumberSettingDefinition
  ├─ StringSettingDefinition
  ├─ EnumSettingDefinition
  └─ RangeSettingDefinition

SettingCategory (recursive)
  ├─ key: string
  ├─ name: string
  ├─ description?: string
  ├─ categories?: Record<string, SettingCategory>
  └─ settings?: Record<string, SettingDefinition>

SettingsSchema
  └─ categories: Record<string, SettingCategory>

FlattenedSetting (extends SettingDefinition)
  ├─ fullPath: string
  └─ categoryPath: string[]
```

## Performance Considerations

1. **Schema Flattening**: Schema is flattened once on load for O(1) setting lookup
2. **Debounced Search**: Search is debounced to avoid excessive IPC calls
3. **Local State Cache**: Values are cached in renderer to avoid repeated IPC calls
4. **Lazy Loading**: Settings are only loaded when the settings view is opened

## Security Considerations

1. **Context Isolation**: Uses contextBridge for secure IPC exposure
2. **Input Validation**: All setting values are validated before saving
3. **No Direct Access**: Renderer cannot directly access Node.js APIs
4. **Type Safety**: TypeScript prevents type-related security issues

## Extension Points

The system is designed to be easily extensible:

1. **New Setting Types**: Add new type to `SettingType` enum and create corresponding control
2. **New Settings**: Add to `settings-schema.json` without code changes
3. **Custom Validation**: Extend `validateSettingValue()` method
4. **Custom Storage**: Replace StorageService implementation
5. **Themes**: Modify `Settings.css` for different themes

