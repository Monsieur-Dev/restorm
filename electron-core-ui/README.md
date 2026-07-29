# Electron Core UI

A generic, reusable Electron + React foundation library providing UI components, services, decorators, and tooling for building desktop applications.

## Architecture

```
electron-core-ui/
  src/
    main/           # Electron main process (Node.js)
      services/     # ThemeService, FileService, StorageService, etc.
      managers/     # BaseWindow, IPCManager, App Lifecycle
      decorators/   # @trackable, @searchable, @separateFiles, etc.
      testing/      # E2E helpers, selectors, Playwright-BDD steps
    renderer/       # Electron renderer process (React)
      components/   # 30+ UI components
      hooks/        # useTheme, useFileService, useDirtyState, etc.
      services/     # EventBus, NavigationService, GraphQLClient, etc.
      contexts/     # ThemeProvider
    preload/        # IPC bridge (contextBridge)
    types/          # Shared TypeScript type definitions
    errors/         # Typed error classes (FileSystemError, etc.)
```

Communication between processes uses Electron IPC via a preload bridge:

```
┌─────────────────┐       IPC (invoke/on)       ┌──────────────────┐
│  Renderer        │◄──────────────────────────►│  Main Process     │
│  (React)         │    via window.api           │  (Node.js)        │
│                  │    via window.electronAPI   │                   │
│  Components      │                             │  Services         │
│  Hooks           │       contextBridge         │  Managers         │
│  Services        │◄──────────────────────────►│  Decorators       │
└─────────────────┘        (preload)             └──────────────────┘
```

See [Architecture documentation](./docs/Architecture/README.md) for details on decorators, events, GraphQL, and persistence.

## Entry Points

| Export Path | Content |
|-------------|---------|
| `electron-core-ui/main` | Main process services, managers, decorators, error classes |
| `electron-core-ui/renderer` | React components, hooks, services, contexts, error classes |
| `electron-core-ui/preload` | IPC bridge setup (`window.api` and `window.electronAPI`) |
| `electron-core-ui/types` | Shared TypeScript type definitions |
| `electron-core-ui/testing` | E2E selectors, system modal mocks, Playwright-BDD steps |

## Main Process

### Services

| Service | Description |
|---------|-------------|
| `logger` | Winston-based logging with configurable verbosity and file output |
| `getStorageService()` | JSON-backed key-value store in the app's userData directory |
| `getThemeService(path)` | YAML-based theme management with cascade inheritance |
| `initFileService(config)` | File operations with dirty state tracking, recent files, and native dialogs |
| `initFeatureService(path)` | Feature flags with strategy-based evaluation (Basic, Platform) |
| `i18nService` | Internationalization with resource loading and language persistence |
| `eventBusService` | Async pub/sub for inter-service communication |
| `searchService` | Full-text search engine using MiniSearch with category grouping |
| `graphQLService` | GraphQL server (graphql-yoga) running in the main process |
| `initPersistenceService(config)` | File persistence with JSON/JSON5/YAML in single-file or folder mode |
| `graphQLSchemaGenerator` | Auto-generates GraphQL schemas from decorated TypeScript classes |

```typescript
import {
  logger, getThemeService, initFileService, getFileService,
  initFeatureService, getFeatureService, i18nService,
  setupIPC, initializeApp, BaseWindow
} from 'electron-core-ui/main'

// Initialize services
const themeService = getThemeService('/path/to/resources')
initFileService({ extension: '.json', defaultFormat: 'json' })
initFeatureService('/path/to/features.yaml', 'desktop')

// Setup IPC handlers and app lifecycle
setupIPC()
initializeApp()
```

### Managers

| Manager | Description |
|---------|-------------|
| `BaseWindow` | Abstract base class for Electron windows with DevTools, state persistence, and controls |
| `setupIPC()` | Registers all IPC handlers (theme, storage, file, search, feature, logger, window) |
| `initializeApp()` | Configures app lifecycle (single instance, protocol, ready event) |
| `setupAppLifecycle()` | Quits when the last window closes; a watchdog armed on `window-all-closed` **and** `before-quit` force-exits a quit that never completed (see [App Lifecycle](./docs/Main/Services-Managers.md#app-lifecycle)) |

### Decorators

Decorators configure model behavior for persistence, search, and GraphQL schema generation.

| Decorator | Target | Description |
|-----------|--------|-------------|
| `@trackable()` | Class/Property | Marks for change detection |
| `@searchable(config)` | Class/Property | Configures full-text search indexing |
| `@NonSerialised()` | Property | Excludes from serialization |
| `@separateFiles(config)` | Property | Persists array items as separate files |
| `@separateFolders(config)` | Property | Persists array items in separate folders |
| `@fileNaming(config)` | Class | Dynamic file naming with pattern placeholders |
| `@graphqlType(config)` | Class | Registers as a GraphQL type |
| `@graphqlField(config)` | Property | Configures a GraphQL field |

```typescript
import {
  trackable, searchable, NonSerialised,
  separateFolders, fileNaming, graphqlType, graphqlField
} from 'electron-core-ui/main'

@trackable()
@searchable({ fields: ['name'] })
@fileNaming({ pattern: '{index} - {name}', nameProperty: 'name' })
@graphqlType({ name: 'Folder' })
class Folder {
  @graphqlField({ type: 'ID' })
  id: string

  @graphqlField({ type: 'String' })
  name: string

  @NonSerialised()
  runtimeState: unknown

  @separateFolders()
  children: Folder[]
}
```

See [Decorators documentation](./docs/Architecture/Decorators.md) for full API reference.

### Error Classes

Typed error classes with error codes and cause chain support.

```typescript
import { FileSystemError, PersistenceError, IpcError, errorMeta } from 'electron-core-ui/main'

try {
  // file operation
} catch (error) {
  const wrapped = new FileSystemError('Failed to read', 'FS_READ_FAILED', { cause: error })
  logger.error('Read failed', errorMeta(wrapped))
  // errorMeta extracts: { error, errorName, code, cause }
}
```

| Error Class | Codes |
|-------------|-------|
| `FileSystemError` | `FS_READ_FAILED`, `FS_WRITE_FAILED`, `FS_NOT_FOUND`, `FS_PARSE_FAILED` |
| `PersistenceError` | `PERSIST_LOAD_FAILED`, `PERSIST_SAVE_FAILED` |
| `IpcError` | `IPC_EMIT_FAILED`, `IPC_HANDLER_FAILED` |

## Renderer Process

### Components (30+)

| Component | Description |
|-----------|-------------|
| `Button`, `ButtonWithIcon`, `ButtonWithDropdown` | Clickable actions with variants |
| `InputBox` | Text input with validation |
| `VariableInputBox` | Input with variable substitution support |
| `SelectBox` | Dropdown select (list or native) |
| `Toggle`, `RadioGroup` | Boolean and choice inputs |
| `Tabs` | Tabbed interface |
| `Modal` | Dialog overlay |
| `Titlebar` | Window titlebar with search and custom content |
| `MenuBar` | Application menu bar |
| `Statusbar` | Window status bar |
| `SearchBar` | Full-text search with results |
| `ContextMenu` | Right-click menu |
| `Breadcrumb` | Navigation breadcrumb trail |
| `ListView`, `ListViewDropdown` | Tree/list with drag-and-drop and selection |
| `Table` | Generic controlled table with resizable columns, row reordering, and width persistence ([README](src/renderer/components/Table/README.md)) |
| `KeyValueTable` | Editable key-value pair table (built on top of `Table`) |
| `SplitView`, `Sash` | Resizable split panes |
| `CodeEditor` | Monaco-based code editor |
| `MarkdownEditor`, `MarkdownViewer` | Rich markdown editing and rendering |
| `ColorPicker` | Color selection widget |
| `DateTimePicker` | Date and time selection |
| `IconSelect` | Icon picker with multiple libraries |
| `TagsView` | Tag input and display |
| `Tooltip`, `Callout` | Information overlays |
| `Toaster`, `toasterService`, `useToasts` | Portal-rendered toast container driven by a singleton service ([README](src/renderer/components/Toaster/README.md)) |
| `ProgressBar` | Progress indicator |
| `ScrollableElement` | Custom scrollable container |
| `Workbench`, `EditorWorkbench` | Multi-tab editor layout with groups |
| `SettingsPage` | Settings UI |
| `ElectronCoreUiProvider` | Root context provider |

Each component has its own documentation in [`docs/`](./docs/).

```typescript
import {
  Button, InputBox, Modal, ListView, Tabs, Table,
  Titlebar, MenuBar, SplitView, CodeEditor,
  ElectronCoreUiProvider
} from 'electron-core-ui/renderer'
```

### Hooks

| Hook | Description |
|------|-------------|
| `useTheme()` | Theme state and switching |
| `useFeature(name)` | Feature flag checking |
| `useFileService()` | File operations (open, save, dirty state) |
| `useStorage(key, default)` | Persistent key-value storage |
| `usePlatform()` | Runtime platform detection (desktop/web) |
| `useKeyboardShortcut(shortcut, handler)` | Register keyboard shortcuts |
| `useDirtyState()` | Per-item dirty state tracking with checksums |
| `useVerticalSash()`, `useHorizontalSash()` | Resizable pane management |
| `useModalState()` | Modal dialog state |

```typescript
import { useTheme, useFeature, useFileService } from 'electron-core-ui/renderer'

function MyComponent() {
  const { currentTheme, setTheme, themes } = useTheme()
  const isEnabled = useFeature('my-feature')
  const { fileName, isDirty, save } = useFileService()
}
```

### Services

| Service | Description |
|---------|-------------|
| `eventBus` | Renderer pub/sub (emits to main process via IPC) |
| `navigationService` | History-based navigation with state management |
| `searchService` | Client-side search API (delegates to main) |
| `keyboardShortcutService` | Shortcut parsing and handling |
| `graphQLClient` | Query GraphQL server in main process |
| `logger` | Log messages sent to main process via IPC |

See [Renderer documentation](./docs/Renderer/Hooks-Services-Contexts.md) for full API reference.

## Testing

Testing utilities are exported from `electron-core-ui/testing`:

- **System modal mocks**: Mock file dialogs, confirmation dialogs for unit and E2E tests
- **Component selectors**: 40+ `data-testid` based selector functions
- **Playwright-BDD step libraries**: Pre-built step definitions for all components

```typescript
import {
  installSystemModalsMocking,
  configureNextOpenDialog,
  buttonRootSelector
} from 'electron-core-ui/testing'
```

See [Testing documentation](./docs/Testing/readme.md).

## Development

```bash
pnpm install         # Install dependencies
pnpm build           # Build the library
pnpm dev             # Watch mode
pnpm lint            # Lint (ESLint + Stylelint)
pnpm lint:fix        # Auto-fix lint issues
pnpm typecheck       # Type check
pnpm test            # Run unit tests
```

## Documentation

Detailed documentation is available in [`docs/`](./docs/):

- [Architecture Overview](./docs/Architecture/README.md) — Process model, IPC flow, architecture diagram
- [Decorators](./docs/Architecture/Decorators.md) — All decorator APIs with examples
- [Events](./docs/Architecture/Events.md) — EventBus, Document Events, PubSub
- [GraphQL](./docs/Architecture/GraphQL.md) — Schema generation, subscriptions
- [Persistence](./docs/Architecture/Persistence.md) — Single-file and folder modes
- [Main Process Services & Managers](./docs/Main/Services-Managers.md) — Full service API reference
- [Renderer Hooks, Services & Contexts](./docs/Renderer/Hooks-Services-Contexts.md) — Full hook/service API reference
- [Design Tokens](./docs/design-tokens/README.md) — CSS variable naming and theming
- [Testing](./docs/Testing/readme.md) — E2E utilities, selectors, BDD steps
- Component docs — Each component has its own README in `docs/{ComponentName}/`

## License

MIT
