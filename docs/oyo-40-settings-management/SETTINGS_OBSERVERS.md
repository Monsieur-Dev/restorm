# Settings Observer Pattern

## Overview

The Settings Observer Pattern provides a mechanism for application components to subscribe to setting changes and react accordingly. This pattern is particularly useful for settings that affect application behavior beyond the UI, such as language, theme, or feature toggles.

## Architecture

### Main Process Components

#### 1. SettingsService (Enhanced)

**Location**: `src/main/services/SettingsService.ts`

The `SettingsService` has been enhanced with an event listener system:

```typescript
class SettingsService {
  private listeners: Map<string, Set<SettingChangeListener>>
  
  // Subscribe to changes on a specific setting key
  subscribe(key: string, listener: SettingChangeListener): () => void
  
  // Notify all listeners when a setting changes
  private notifyListeners(key: string, newValue: unknown, oldValue: unknown): void
}

type SettingChangeListener = (key: string, newValue: unknown, oldValue: unknown) => void
```

**Key Features**:
- Subscribe to specific setting keys
- Automatic notification on setting changes
- Returns unsubscribe function for cleanup
- Error handling for individual listeners

#### 2. Base Setting Class

**Location**: `src/main/settings/_Setting.ts`

Abstract base class for all setting handlers:

```typescript
abstract class Setting<T = unknown> {
  constructor(settingKey: string, settingsService: SettingsService)
  
  // Initialize the handler and subscribe to changes
  initialize(): void
  
  // Clean up subscriptions
  dispose(): void
  
  // Called when setting value changes
  protected onChange(newValue: T, oldValue: T): void
  
  // Apply the setting (must be implemented by subclasses)
  protected abstract apply(value: T, previousValue: T): void
  
  // Get current value
  getValue(): T | undefined
}
```

**Lifecycle**:
1. **Construction**: Store setting key and service reference
2. **Initialization**: Load initial value, subscribe to changes
3. **Change Detection**: Receive notifications via `onChange`
4. **Application**: Implement `apply` to affect application state
5. **Disposal**: Clean up subscriptions

#### 3. Language Setting Handler

**Location**: `src/main/settings/LangSetting.ts`

Concrete implementation for the language setting:

```typescript
class LangSetting extends Setting<string> {
  constructor(settingsService: SettingsService)
  
  protected apply(value: string, previousValue: string): void {
    // Notify all renderer windows to change language
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('settings:language-changed', value)
    })
  }
}
```

**Key Features**:
- Listens to `workbench.appearance.language` setting
- Sends IPC message to all renderer windows
- Automatic initialization on application start

### IPC Communication

#### Main → Renderer

**Channel**: `settings:language-changed`

**Payload**: `string` (language code)

**Purpose**: Notify renderer processes when language setting changes

### Renderer Process Integration

#### Preload API

**Location**: `src/preload/index.ts`

```typescript
contextBridge.exposeInMainWorld('settingsAPI', {
  // ... other methods
  onLanguageChanged: (callback: (language: string) => void) => {
    ipcRenderer.on('settings:language-changed', (_event, language: string) => {
      callback(language)
    })
  }
})
```

#### i18n Integration

**Location**: `src/renderer/src/i18n.ts`

```typescript
// Listen for language changes from the main process
window.settingsAPI.onLanguageChanged((language: string) => {
  console.log('Language changed to:', language)
  if (language === 'en' || language === 'fr') {
    i18n.changeLanguage(language).catch(console.error)
  }
})
```

## Usage

### Creating a New Setting Handler

1. **Create Handler Class**:

```typescript
// src/main/settings/MyCustomSetting.ts
import { Setting } from './_Setting'
import { SettingsService } from '../services/SettingsService'

export class MyCustomSetting extends Setting<string> {
  constructor(settingsService: SettingsService) {
    super('my.custom.setting', settingsService)
  }

  protected apply(value: string, previousValue: string): void {
    // Implement your logic here
    console.log(`Setting changed from ${previousValue} to ${value}`)
    
    // Example: Update application state, send IPC messages, etc.
  }
}
```

2. **Register in Main Process**:

```typescript
// src/main/index.ts
import { MyCustomSetting } from './settings/MyCustomSetting'

let _myCustomSetting: MyCustomSetting | null = null

function initializeSettingsService(): void {
  const settingsService = getSettingsService(schemaPath)
  
  // ... existing code
  
  // Initialize your setting handler
  _myCustomSetting = new MyCustomSetting(settingsService)
  _myCustomSetting.initialize()
}
```

3. **Clean Up on Exit** (optional):

```typescript
app.on('before-quit', () => {
  if (_myCustomSetting) {
    _myCustomSetting.dispose()
  }
})
```

### Best Practices

1. **Error Handling**: Always wrap `apply` logic in try-catch to prevent crashes
2. **Async Operations**: Handle async operations properly in `apply`
3. **Cleanup**: Always call `dispose()` when removing a setting handler
4. **Type Safety**: Use generic type parameter for type-safe value handling
5. **Single Responsibility**: Each setting handler should manage one specific concern

### Example: Theme Setting

```typescript
export class ThemeSetting extends Setting<'light' | 'dark'> {
  constructor(settingsService: SettingsService) {
    super('workbench.appearance.theme', settingsService)
  }

  protected apply(value: 'light' | 'dark', previousValue: 'light' | 'dark'): void {
    // Update native theme
    nativeTheme.themeSource = value
    
    // Notify all windows
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('settings:theme-changed', value)
    })
  }
}
```

## Flow Diagram

```
┌─────────────────┐
│ User Changes    │
│ Setting in UI   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ SettingsService │
│ .setSetting()   │
└────────┬────────┘
         │
         ├─── Save to Storage
         │
         ▼
┌─────────────────┐
│ Notify All      │
│ Listeners       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ LangSetting     │
│ .onChange()     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ LangSetting     │
│ .apply()        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Send IPC to     │
│ All Windows     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Renderer        │
│ onLanguageChg   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ i18n.change     │
│ Language()      │
└─────────────────┘
```

## Benefits

1. **Decoupling**: Settings logic is separated from UI and service layers
2. **Reusability**: Base class provides common functionality
3. **Extensibility**: Easy to add new setting handlers
4. **Type Safety**: Generic types ensure correct value handling
5. **Maintainability**: Clear separation of concerns
6. **Testability**: Easy to unit test individual handlers

## Limitations

1. **Main Process Only**: Handlers run in main process, not renderer
2. **IPC Overhead**: Cross-process communication for each change
3. **Synchronous Apply**: Apply method should be synchronous (use async carefully)

## Future Enhancements

1. **Priority System**: Order handler execution based on dependencies
2. **Batching**: Group multiple setting changes into single notification
3. **Conditional Subscription**: Subscribe to multiple keys with filters
4. **Async Support**: Better handling of async apply operations
5. **Unsubscribe Patterns**: More sophisticated cleanup mechanisms

