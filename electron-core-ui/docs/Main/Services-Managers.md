# Main Process Services & Managers

This document describes the services and managers available in `electron-core-ui/main` for the Electron main process.

## Table of Contents

- [Services](#services)
  - [logger](#logger)
  - [eventBusService](#eventbusservice)
  - [StorageService](#storageservice)
  - [ThemeService](#themeservice)
  - [FeatureFlippingService](#featureflippingservice)
  - [FileService](#fileservice)
  - [SearchService](#searchservice)
  - [I18nService](#i18nservice)
  - [GraphQLService](#graphqlservice)
  - [PersistenceService](#persistenceservice)
  - [GraphQLSchemaGenerator](#graphqlschemagenerator)
- [Managers](#managers)
  - [BaseWindow](#basewindow)
  - [IPCManager (setupIPC)](#ipcmanager-setupipc)
  - [App Lifecycle](#app-lifecycle)

---

## Services

### logger

Winston-based logging service with file and console output.

```typescript
import { logger } from 'electron-core-ui/main'

logger.debug('Debug message', { key: 'value' })
logger.info('Info message')
logger.warn('Warning message')
logger.error('Error message', { error: err })
```

**Command-line options:**
- `--verbose` / `-v`: Enable console output in production
- `--log-file <path>` / `-l <path>`: Write logs to file
- `--log-format <format>` / `-lf <format>`: `json` or `plain`

---

### eventBusService

Pub/sub event system for inter-service communication.

```typescript
import { eventBusService } from 'electron-core-ui/main'

// Subscribe to events
const subscription = eventBusService.subscribe('my-event', async (payload) => {
  console.log('Received:', payload)
})
subscription.unsubscribe()

// Emit to main process handlers
await eventBusService.emit('my-event', { data: 'value' })
eventBusService.emitSync('my-event', { data: 'value' }) // fire and forget

// Broadcast to all renderer windows via IPC
eventBusService.broadcast('channel-name', { data: 'value' })

// Utilities
eventBusService.hasSubscribers('my-event')
eventBusService.clear('my-event')
eventBusService.clearAll()
```

---

### StorageService

Simple key-value store backed by JSON file in user data directory.

```typescript
import { getStorageService } from 'electron-core-ui/main'

const storage = getStorageService()

// Basic operations
storage.set('key', { any: 'value' })
const value = storage.get('key')
storage.delete('key')
storage.has('key') // boolean

// Get all data
const all = storage.getAll()
```

**Storage location:** `{app.getPath('userData')}/config.json`

---

### ThemeService

Manages YAML-based themes with inheritance.

```typescript
import { getThemeService } from 'electron-core-ui/main'

const themeService = getThemeService(resourcesPath)

// List available themes
const themes = themeService.listThemes()
// Returns: ThemeInfo[] { id, name, type, description }

// Load a theme
const result = themeService.getThemeWithVariables('dark/monokai')
// Returns: { theme: ThemeDefinition, variables: ThemeVariables }
```

**Theme loading cascade:**
1. `base.yaml` - Common CSS variables
2. `{type}/_base.yaml` - Type-specific defaults (dark, light, hc_dark, hc_light)
3. `{type}/{theme}.yaml` - Theme-specific overrides

---

### FeatureFlippingService

Feature flags with configurable strategies.

```typescript
import { initFeatureService, getFeatureService } from 'electron-core-ui/main'

// Initialize (once at app startup)
initFeatureService('/path/to/features.yaml', 'desktop')

// Check features
const featureService = getFeatureService()
if (featureService.isEnabled('my-feature')) {
  // Feature enabled
}

// Get platform
featureService.getPlatform() // 'desktop' | 'web'

// Debug
featureService.listFeatures() // string[]
```

**Configuration file (features.yaml):**

```yaml
Features:
  - Name: my-feature
    Strategies:
      - Type: Basic
        Enabled: true
      - Type: Platform
        AvailableOn: [desktop]
```

**Strategies:** `Basic` (on/off), `Platform` (desktop/web). All strategies must return true (AND logic).

---

### FileService

File operations with dirty state tracking and recent files.

```typescript
import { initFileService, getFileService } from 'electron-core-ui/main'

// Initialize
initFileService({
  extension: '.myapp',
  defaultFormat: 'yaml',
  maxRecentFiles: 10,
  storagePrefix: 'myapp_'
})

const fileService = getFileService()

// File operations
await fileService.newFile()
const { success, content } = await fileService.openFile('/path/to/file')
await fileService.saveFile({ data: 'content' })
await fileService.saveFileAs({ data: 'content' }, 'filename.yaml', 'yaml')
await fileService.closeFile()

// State
fileService.getState()       // FileServiceState
fileService.getFileName()    // string | null
fileService.getFilePath()    // string | null
fileService.isDirty()        // boolean
fileService.markDirty()
fileService.clearDirty()

// Unsaved changes dialog
const result = await fileService.showUnsavedChangesDialog({
  title: 'Unsaved Changes',
  message: 'Save before closing?',
  save: 'Save',
  dontSave: "Don't Save",
  cancel: 'Cancel'
})
// Returns: 'save' | 'discard' | 'cancel'

// Recent files & favorites
fileService.getRecentFiles()  // FileMetadata[]
fileService.getFavorites()    // FileMetadata[]
await fileService.toggleFavorite('/path')
await fileService.removeFromRecent('/path')

// Checksum-based dirty tracking
await fileService.registerInitialChecksums(objectsMap)
await fileService.commitChecksums()
fileService.getDirtyStateDetails()
// Returns: { isDirty, changedIds, newIds, deletedIds }

// Events
fileService.onStateChange(callback)
fileService.onDirtyChange(callback)
```

---

### SearchService

Full-text search using MiniSearch.

```typescript
import { searchService } from 'electron-core-ui/main'

// Register categories
searchService.registerCategories({
  requests: { label: 'Requests', icon: 'symbol-method', order: 1 },
  folders: { label: 'Folders', icon: 'folder', order: 2 }
})

// Index documents
searchService.indexDocument({
  id: 'req-1',
  title: 'GET /users',
  category: 'requests',
  description: 'Fetch all users',
  keywords: 'api users list',
  icon: 'GET',
  navigation: { type: 'request', requestId: 'req-1' },
  metadata: { method: 'GET' }
})

// Batch indexing
searchService.indexDocuments([doc1, doc2, doc3])

// Search
const results = searchService.search('users')
// Returns: GroupedResults[] { category, label, icon, items: SearchResult[] }

// Maintenance
searchService.removeDocument('req-1')
searchService.clearIndex()
searchService.getDocumentCount()
```

---

### I18nService

Internationalization for main process dialogs.

```typescript
import { i18nService } from 'electron-core-ui/main'

// Initialize (once at startup)
i18nService.initialize('/path/to/locales', 'en')

// Translate
const text = i18nService.t('file.unsavedChanges.title')
const textWithParams = i18nService.t('file.message', { fileName: 'test.json' })

// Language
i18nService.setLanguage('fr')
i18nService.getLanguage() // 'fr'
```

**Translation files:** `{localesPath}/{lang}/translation.json`

---

### GraphQLService

GraphQL server for main process (using graphql-yoga).

```typescript
import { graphQLService, createSchema, createPubSub } from 'electron-core-ui/main'

// Create PubSub for subscriptions
const pubsub = createPubSub()

// Initialize
graphQLService.initialize({
  port: 4000,
  typeDefs: `
    type Query {
      hello: String
    }
    type Subscription {
      counter: Int
    }
  `,
  resolvers: {
    Query: {
      hello: () => 'Hello World'
    },
    Subscription: {
      counter: {
        subscribe: () => pubsub.subscribe('counter')
      }
    }
  },
  pubsub,
  context: () => ({ /* context data */ })
})

// Start server
await graphQLService.start()
// Server running at http://localhost:4000/graphql

// Publish to subscriptions
pubsub.publish('counter', { counter: 42 })

// Stop
graphQLService.stop()

// Status
graphQLService.isServerRunning()
graphQLService.getPort()
graphQLService.getEndpoint()
```

---

### PersistenceService

Advanced file persistence with folder mode support.

```typescript
import {
  initPersistenceService,
  getPersistenceService,
  serialize,
  deserialize,
  detectFormat,
  PERSISTENCE_FORMATS
} from 'electron-core-ui/main'

// Initialize
initPersistenceService({
  extension: 'myapp',
  format: 'yaml',
  mode: 'folder',
  indexFileName: 'index'
})

const persistence = getPersistenceService()

// Single file mode
await persistence.saveToFile(data, '/path/to/file.yaml')
const { success, data } = await persistence.loadFromFile('/path/to/file.yaml')

// Folder mode (with @separateFiles/@separateFolders decorators)
await persistence.saveToFolder(data, '/path/to/folder', { format: 'yaml' })
const { success, data } = await persistence.loadFromFolder('/path/to/folder')

// Utilities
serialize(data, 'yaml')        // string
deserialize(content, 'yaml')   // unknown
detectFormat('/path/file.json') // 'json' | 'yaml' | 'json5'

// Format constants
PERSISTENCE_FORMATS // ['json', 'json5', 'yaml']
```

**Decorators support:**
- `@separateFiles()` - Array properties saved as separate files
- `@separateFolders()` - Array properties saved as separate folders
- `@fileNaming({ pattern: '{index} - {name}' })` - Custom file naming

---

### GraphQLSchemaGenerator

Generates GraphQL schema from decorated TypeScript classes.

```typescript
import { graphQLSchemaGenerator } from 'electron-core-ui/main'

// Register enum
graphQLSchemaGenerator.registerEnum('Status', ['ACTIVE', 'INACTIVE'])

// Register class manually
graphQLSchemaGenerator.registerClass(MyClass, 'MyType', [
  { name: 'id', type: 'String', nullable: false, isArray: false },
  { name: 'name', type: 'String', nullable: false, isArray: false },
  { name: 'items', type: 'Item', nullable: true, isArray: true }
], {
  skipGenericQueries: true,
  skipGenericMutations: true,
  skipGenericSubscriptions: true
})

// Register class with @graphqlField decorators (auto-infer fields)
graphQLSchemaGenerator.registerClassAuto(MyClass, {
  skipGenericQueries: true
})

// Register union type
graphQLSchemaGenerator.registerUnion('FolderItem', ['Folder', 'Request'])

// Register custom types/queries/mutations/subscriptions
graphQLSchemaGenerator.registerCustomType(`
  type CustomType {
    field: String
  }
`)
graphQLSchemaGenerator.registerQuery('myQuery', 'id: ID!', 'MyType')
graphQLSchemaGenerator.registerMutation('myMutation', 'input: MyInput!', 'MyType')
graphQLSchemaGenerator.registerSubscription('mySubscription', '', 'MyType')

// Generate schema
const typeDefs = graphQLSchemaGenerator.generateSchema()
```

---

## Managers

### BaseWindow

Abstract base class for Electron windows with state persistence.

```typescript
import { BaseWindow } from 'electron-core-ui/main'

class MainWindow extends BaseWindow {
  constructor() {
    super({
      id: 'main',
      title: 'My App',
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      preloadScript: '/path/to/preload.js',
      entryFile: '/path/to/index.html',
      devEntryUrl: 'http://localhost:5173',
      titleBarStyle: 'hidden',
      titleBarOverlay: true
    })
  }

  // Override for custom window creation
  protected createWindow(): void {
    // Custom implementation
  }
}

const window = new MainWindow()

// Window operations
window.minimizeWindow()
window.maximizeWindow()
window.closeWindow()
window.setWindowTitle('New Title')
window.getWindow() // BrowserWindow | null
```

**Features:**
- Window state persistence (position, size, maximized)
- DevTools toggle (Ctrl+Shift+I)
- Window controls (minimize, maximize, close)
- Intercepted keyboard shortcuts

---

### IPCManager (setupIPC)

Sets up all core IPC handlers.

```typescript
import { setupIPC } from 'electron-core-ui/main'

// In app ready handler
app.whenReady().then(() => {
  setupIPC('/path/to/resources')
})
```

**Registered IPC handlers:**
- Theme: `theme:list`, `theme:load`, `theme:get-current`, `theme:set`, `theme:update-wco`
- Storage: `storage:get`, `storage:set`, `storage:delete`
- Feature: `feature:isEnabled`, `feature:getPlatform`
- File: `file:*` (all FileService operations)
- Search: `search:*` (all SearchService operations)
- EventBus: `eventBus:emit`, `eventBus:emitSync`
- Logger: `logger:log`

---

### App Lifecycle

Helper functions for app initialization.

```typescript
import {
  configureCommandLineSwitches,
  setupAppLifecycle,
  initializeApp,
  setupAppProtocol
} from 'electron-core-ui/main'

// Before app.ready
configureCommandLineSwitches()

// Setup lifecycle handlers
setupAppLifecycle()

// In app.ready
app.whenReady().then(async () => {
  // Setup custom protocol (optional)
  setupAppProtocol('myapp')
  
  // Initialize app
  await initializeApp({
    resourcesPath: '/path/to/resources',
    featuresConfigPath: '/path/to/features.yaml',
    localesPath: '/path/to/locales',
    platform: 'desktop'
  })
  
  // Create windows...
})
```

**configureCommandLineSwitches():**
- Disables sandbox and GPU for restricted environments (WSL, containers)

**setupAppLifecycle():**
- Handles `window-all-closed` (quit on non-macOS)
- Handles `activate` (recreate window on macOS dock click)

**setupAppProtocol(scheme):**
- Registers custom protocol for loading local resources

