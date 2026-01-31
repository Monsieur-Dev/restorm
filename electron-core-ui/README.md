# Electron Core UI

A generic Electron + React foundation library with UI components and services.

## Features

- **Main Process Services**:
  - `LoggerService`: Winston-based logging with file and console support
  - `StorageService`: Simple key-value store backed by JSON files
  - `ThemeService`: Theme management and loading
  - `WindowManager`: Window state persistence and restoration
  - `BaseWindow`: Abstract base class for window management

- **Renderer Process Components**:
  - `CustomDropdown`: Styled dropdown component
  - `Tabs` (formerly `CustomTabs`): Styled tabs component
  - `ListView` & `ListViewDropdown`: hierarchical lists and dropdown tree selector
  - `KeyValueTable`: editable table for key/value style data
  - `useTheme`: React hook for theme management
  - `logger`: Renderer logger that communicates with main process

- **Types**:
  - Complete TypeScript type definitions for themes
  - Global type definitions for Electron IPC

## Installation

```bash
npm install electron-core-ui
# or
pnpm add electron-core-ui
```

## Usage

### Main Process

```typescript
import { getLoggerService, getStorageService, getThemeService, BaseWindow } from 'electron-core-ui/main'

// Use services
const logger = getLoggerService()
const storage = getStorageService()
const theme = getThemeService('/path/to/resources')
```

### Renderer Process

```typescript
import { CustomDropdown, Tabs, useTheme, logger } from 'electron-core-ui/renderer'

// Use components and hooks in your React app
const MyComponent = () => {
  const { currentTheme, setTheme, themes } = useTheme()
  
  return <CustomDropdown options={themes} value={currentTheme} onChange={setTheme} />
}
```

## Development

```bash
# Install dependencies
pnpm install

# Build the library
pnpm build

# Watch mode
pnpm dev

# Lint
pnpm lint
```

## License

MIT
