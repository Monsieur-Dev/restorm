# Renderer Hooks, Services & Contexts

This document describes the React hooks, services, and contexts available in `electron-core-ui/renderer`.

## Table of Contents

- [Hooks](#hooks)
  - [useTheme](#usetheme)
  - [useFeature](#usefeature)
  - [useFileService](#usefileservice)
  - [useStorage](#usestorage)
  - [usePlatform](#useplatform)
  - [useKeyboardShortcut](#usekeyboardshortcut)
  - [useDirtyState](#usedirtystate)
- [Services](#services)
  - [logger](#logger)
  - [eventBus](#eventbus)
  - [navigationService](#navigationservice)
  - [searchService](#searchservice)
  - [keyboardShortcutService](#keyboardshortcutservice)
  - [graphQLClient](#graphqlclient)
- [Contexts](#contexts)
  - [ThemeProvider / ThemeContext](#themeprovider--themecontext)

---

## Hooks

### useTheme

Manages application themes (loading, switching, applying CSS variables).

```typescript
import { useTheme } from 'electron-core-ui/renderer'

const {
  themes,           // ThemeInfo[] - Available themes
  currentThemeId,   // string | null - Active theme ID
  currentTheme,     // ThemeDefinition | null - Theme metadata
  currentVariables, // ThemeVariables | null - CSS variables
  isLoading,        // boolean
  error,            // string | null
  setTheme,         // (themeId: string) => Promise<void>
  refreshThemes     // () => Promise<void>
} = useTheme()
```

**Note:** If wrapped in `ThemeProvider`, uses shared context. Otherwise, manages its own state.

---

### useFeature

Checks if feature flags are enabled (for feature flipping).

```typescript
import { useFeature, useIsDesktop, usePlatformFeature, checkFeature, getPlatform } from 'electron-core-ui/renderer'

// Hook: Check a specific feature
const { isEnabled, isLoading } = useFeature('my-feature')

// Hook: Check if running on desktop
const { isDesktop, isLoading } = useIsDesktop()

// Hook: Get current platform
const { platform, isLoading } = usePlatformFeature() // 'desktop' | 'web'

// Utility: Imperative check (not a hook)
const enabled = await checkFeature('my-feature')
const platform = await getPlatform()
```

---

### useFileService

Manages file operations (new, open, save, close). Dirty state is a
read-only projection of the save-unit registry — to flip it, mutate
units via `upsertSaveUnit` / `markSaveUnitDeleted` / the registry API,
and the global `isDirty` follows automatically.

```typescript
import { useFileService, useFileDirty, useFileEvents } from 'electron-core-ui/renderer'

// Main hook
const {
  state,          // FileServiceState | null
  isLoading,      // boolean
  fileName,       // string | null
  filePath,       // string | null
  isDirty,        // boolean (derived)
  recentFiles,    // FileMetadata[]
  favorites,      // FileMetadata[]
  newFile,        // () => Promise<boolean>
  open,           // (path?: string) => Promise<{ success, content? }>
  save,           // (content: unknown) => Promise<boolean>
  saveAs,         // (content, filename?, format?) => Promise<boolean>
  close,          // () => Promise<boolean>
  showUnsavedChangesDialog, // (labels?) => Promise<'save'|'discard'|'cancel'>
  toggleFavorite, // (path: string) => Promise<boolean>
  removeFromRecent, // (path: string) => Promise<void>
  refresh         // () => Promise<void>
} = useFileService()

// Read-only global dirty state
const { isDirty } = useFileDirty()

// Per-unit dirty dot (single document)
const { isDirty, reason } = useUnitDirtyState(runtimeId)

// Aggregate view of every dirty unit — ReadonlySet<runtimeId>
const dirtyIds = useDirtyUnitsSet()

// File events hook
useFileEvents(
  (state) => { /* onFileOpened */ },
  () => { /* onFileClosed */ }
)
```

**Additional utilities:**

```typescript
import {
  getContentChecksum,
  setContentChecksum,
  hasContentChanged,
  finishLoading,
  // save-unit registry (main-process IPC)
  hydrateSaveUnit,
  upsertSaveUnit,
  markSaveUnitDeleted,
  commitSaveUnit,
  revertSaveUnit,
  saveUnitToDisk,
  saveUnitsToDiskBatch,
  getSaveUnitsSnapshot,
  useDraftsRestored
} from 'electron-core-ui/renderer'
```

---

### useStorage

Persists values to electron-store via IPC.

```typescript
import { useStorage, saveToStorage, loadFromStorage } from 'electron-core-ui/renderer'

// Hook: Load/save with automatic persistence
const [value, setValue, isLoading] = useStorage<MyType>('storage-key', defaultValue)

// Utilities: Imperative operations
await saveToStorage('key', value)
const stored = await loadFromStorage('key')
```

---

### usePlatform

Detects the OS platform (Mac, Windows, Linux).

```typescript
import { usePlatform, isMacintosh } from 'electron-core-ui/renderer'

// Hook
const { isMacintosh, isWindows, isLinux } = usePlatform()

// Constant (available immediately)
if (isMacintosh) {
  // Mac-specific logic
}
```

---

### useKeyboardShortcut

Registers keyboard shortcuts that auto-cleanup on unmount.

```typescript
import { useKeyboardShortcut } from 'electron-core-ui/renderer'

// Register a shortcut
useKeyboardShortcut('Ctrl+S', () => {
  handleSave()
})

// With enable/disable control
useKeyboardShortcut('F2', handleRename, isEditing)

// Supported formats: "Ctrl+O", "Ctrl+Shift+S", "F2", "Delete", "Alt+F4"
```

---

### useDirtyState

Tracks dirty state for multiple items/tabs independently.

```typescript
import { useDirtyState, computeChecksum } from 'electron-core-ui/renderer'

const {
  isItemDirty,       // (id: string) => boolean
  hasAnyDirty,       // boolean
  dirtyItemIds,      // string[]
  registerItem,      // (id: string, checksum: string) => void
  updateItemChecksum, // (id: string, checksum: string) => void
  markItemSaved,     // (id: string) => void
  markAllSaved,      // () => void
  removeItem,        // (id: string) => void
  clear              // () => void
} = useDirtyState()

// Compute checksum from object
const checksum = computeChecksum(myObject)

// Example workflow:
registerItem('tab-1', computeChecksum(initialData))
// ... user modifies data ...
updateItemChecksum('tab-1', computeChecksum(newData))
// ... user saves ...
markItemSaved('tab-1')
```

---

## Services

### logger

Sends log messages to the main process via IPC.

```typescript
import { logger } from 'electron-core-ui/renderer'

logger.debug('Debug message', { key: 'value' })
logger.info('Info message')
logger.warn('Warning message')
logger.error('Error message', { error: err })
```

---

### eventBus

Pub/sub system for events (local and to main process).

```typescript
import { eventBus } from 'electron-core-ui/renderer'

// Subscribe to events (local renderer only)
const subscription = eventBus.subscribe('my-event', (payload) => {
  console.log('Received:', payload)
})
subscription.unsubscribe()

// Emit to main process
await eventBus.emit('my-event', { data: 'value' })
eventBus.emitSync('my-event', { data: 'value' }) // fire and forget

// Emit locally only (does not go to main)
await eventBus.emitLocal('ui-event', { data: 'value' })
eventBus.emitLocalSync('ui-event', { data: 'value' })

// Utilities
eventBus.hasSubscribers('my-event') // boolean
eventBus.clear('my-event')          // Remove all subscribers for event
eventBus.clearAll()                  // Remove all subscribers
```

---

### navigationService

Manages navigation with history support (back/forward).

```typescript
import { navigationService } from 'electron-core-ui/renderer'

// Navigate to an item
navigationService.navigateTo('item-123', 'sidebar', { type: 'folder' })

// Listen to navigation events
const unsubscribe = navigationService.onNavigate((event) => {
  // event: { key, source, params, isHistoryNavigation }
})

// History navigation
navigationService.goBack()
navigationService.goForward()

// Check history state
navigationService.canGoBack()    // boolean
navigationService.canGoForward() // boolean

// Listen to history state changes
const unsubscribe = navigationService.onHistoryChange((canBack, canForward) => {
  // Update UI buttons
})

// Get current navigation
const current = navigationService.getCurrent() // { key, params } | null
```

---

### searchService

Client for the main process search index.

```typescript
import { searchService } from 'electron-core-ui/renderer'

// Register categories
await searchService.registerCategory('requests', {
  label: 'Requests',
  icon: 'codicon-symbol-method',
  order: 1
})

// Index documents
await searchService.indexDocument({
  id: 'req-1',
  title: 'GET /users',
  category: 'requests',
  description: 'Fetch all users',
  keywords: 'api users list',
  navigation: { type: 'request', requestId: 'req-1' }
})

// Search
const results = await searchService.search('users')
// Returns: GroupedResults[] (grouped by category)

// Maintenance
await searchService.removeDocument('req-1')
await searchService.clearIndex()
const count = await searchService.getDocumentCount()
```

---

### keyboardShortcutService

Low-level keyboard shortcut management (prefer `useKeyboardShortcut` hook).

```typescript
import { keyboardShortcutService } from 'electron-core-ui/renderer'

// Register a shortcut
const unregister = keyboardShortcutService.register('Ctrl+S', () => {
  handleSave()
})

// Later: unregister
unregister()

// Enable/disable all shortcuts
keyboardShortcutService.setEnabled(false)

// Check if enabled
keyboardShortcutService.isEnabled() // boolean
```

---

### graphQLClient

Generic GraphQL client with SSE subscriptions support.

```typescript
import { graphQLClient } from 'electron-core-ui/renderer'

// Initialize
graphQLClient.initialize({
  endpoint: 'http://localhost:4000/graphql',
  headers: { Authorization: 'Bearer token' }
})

// Query
const result = await graphQLClient.query<MyData>(`
  query GetUser($id: ID!) {
    user(id: $id) { name email }
  }
`, { id: '123' })

// Mutation
const result = await graphQLClient.mutate<MyData>(`
  mutation UpdateUser($id: ID!, $name: String!) {
    updateUser(id: $id, name: $name) { id name }
  }
`, { id: '123', name: 'New Name' })

// Subscription (SSE)
const unsubscribe = graphQLClient.subscribe<MyData>(
  `subscription OnUserUpdated { userUpdated { id name } }`,
  {},
  (data) => { console.log('Update:', data) },
  (error) => { console.error('Error:', error) }
)
```

---

## Contexts

### ThemeProvider / ThemeContext

Centralizes theme management. Wrap your app root with `ThemeProvider`.

```tsx
import { ThemeProvider, useTheme } from 'electron-core-ui/renderer'

// App root
function App() {
  return (
    <ThemeProvider>
      <MyApp />
    </ThemeProvider>
  )
}

// Child components use useTheme()
function ThemeSelector() {
  const { themes, currentThemeId, setTheme } = useTheme()
  
  return (
    <select 
      value={currentThemeId ?? ''} 
      onChange={e => setTheme(e.target.value)}
    >
      {themes.map(t => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  )
}
```

**Features:**
- Loads and applies CSS variables from themes
- Persists selected theme
- Updates Window Controls Overlay (WCO) colors
- Listens for theme changes from other windows

