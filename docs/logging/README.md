# Logging with Winston

This document describes the logging system implemented in Gitable using Winston logger.

## Overview

Gitable uses [Winston](https://github.com/winstonjs/winston) as its logging framework. The logging system is designed to work across the Electron application's different processes:

- **Main Process**: Native Winston logger with CLI argument parsing
- **Renderer Process**: Logger that sends messages to the main process via IPC
- **Preload Process**: Exposes a secure IPC bridge for logging

## Architecture

```
┌─────────────────────┐
│  Renderer Process   │
│                     │
│  logger.info(...)   │
└──────────┬──────────┘
           │ IPC
           │
┌──────────▼──────────┐
│   Preload Bridge    │
│                     │
│  window.api.logger  │
└──────────┬──────────┘
           │
           │
┌──────────▼──────────┐
│   Main Process      │
│                     │
│  Winston Logger     │
│  - Console output   │
│  - File output      │
└─────────────────────┘
```

## Usage

### In Main Process

```typescript
import { logger } from './services/LoggerService'

logger.debug('Debug message', { userId: 123 })
logger.info('Application started')
logger.warn('Deprecated API used', { api: 'oldMethod' })
logger.error('Failed to connect', { error: 'Connection timeout' })
```

### In Renderer Process

```typescript
import { logger } from './services/logger'

logger.debug('Component mounted', { component: 'ThemeSelector' })
logger.info('User action', { action: 'theme-change', themeId: 'dark-plus' })
logger.warn('Performance warning', { renderTime: 250 })
logger.error('Failed to load data', { error: 'Network error' })
```

## CLI Arguments

The logger behavior can be controlled via command-line arguments:

### `--verbose` / `-v`

Enables console logging in production builds.

```bash
# Production build with console logs
./gitable --verbose
./gitable -v
```

**Behavior**:
- Development: Console logs are always active (level: `debug`)
- Production without flag: No console output
- Production with flag: Console logs at `info` level (shows info/warn/error)

### `--log-file <path>` / `-l <path>`

Writes logs to a file.

```bash
# Write logs to a file
./gitable --log-file /tmp/gitable.log
./gitable -l ~/logs/app.log
```

### `--log-format <format>` / `-lf <format>`

Sets the file log format (only applies when `--log-file` is specified).

```bash
# JSON format (for programmatic parsing)
./gitable --log-file app.log --log-format json

# Plain text format (human-readable)
./gitable -l app.log -lf plain
```

**Supported formats**:
- `json`: Structured JSON logs
- `plain`: Human-readable text format (default)

## Log Levels

Winston supports multiple log levels. In Gitable:

| Level   | Usage                                    | Example                                      |
|---------|------------------------------------------|----------------------------------------------|
| `debug` | Detailed debugging information           | `logger.debug('State updated', { state })`   |
| `info`  | General informational messages           | `logger.info('User logged in')`              |
| `warn`  | Warning messages (non-critical issues)   | `logger.warn('Deprecated feature used')`     |
| `error` | Error messages (failures, exceptions)    | `logger.error('Database connection failed')` |

**Level hierarchy** (from most to least verbose):
`debug` > `info` > `warn` > `error`

## Log Format

### Console Output

Console logs are colorized for better readability:

```
2025-10-14 12:34:56 [info]: 🚀 Gitable application starting...
2025-10-14 12:34:56 [debug]: Loading theme { themeId: 'dark-plus' }
2025-10-14 12:34:57 [error]: Failed to load config { error: 'File not found' }
```

### File Output

#### Plain Text Format

```
2025-10-14 12:34:56 [info]: Application started
2025-10-14 12:34:57 [error]: Connection failed { error: 'Timeout' }
```

#### JSON Format

```json
{"timestamp":"2025-10-14T12:34:56.789Z","level":"info","message":"Application started"}
{"timestamp":"2025-10-14T12:34:57.123Z","level":"error","message":"Connection failed","error":"Timeout"}
```

## Configuration

### Main Process Configuration

The logger is configured in `src/main/services/LoggerService.ts`:

- Automatically detects development vs production environment
- Parses CLI arguments to determine verbosity and file output
- Configures Winston transports based on settings

### Renderer Process Configuration

The renderer logger (`src/renderer/src/services/logger.ts`) is lightweight:

- Forwards all log messages to the main process via IPC
- Adds `[Renderer]` prefix to identify the source
- Falls back to console only if IPC fails

## ESLint Integration

The project's ESLint configuration strictly forbids direct `console.*` usage:

```json
{
  "rules": {
    "no-console": ["error"]
  }
}
```

This ensures all logging goes through Winston. The only exception is the error handler in the renderer logger service itself, which uses `// eslint-disable-next-line no-console`.

## Migration from console.log

If you have existing code using `console.*`, follow this migration guide:

### Before

```typescript
console.log('User logged in', userId)
console.warn('Using deprecated API')
console.error('Failed to connect:', error)
```

### After

```typescript
import { logger } from './services/LoggerService' // or './services/logger' in renderer

logger.info('User logged in', { userId })
logger.warn('Using deprecated API')
logger.error('Failed to connect', { error: String(error) })
```

**Key differences**:
1. Import the logger service
2. Use `logger.info()` instead of `console.log()`
3. Pass metadata as an object in the second parameter
4. Convert error objects to strings: `String(error)` or `error.message`

## Examples

### Startup Logging

```typescript
// src/main/index.ts
app.whenReady().then(() => {
  logger.info('🚀 Gitable application starting...')
  logger.info(`Platform: ${process.platform}`)
  logger.info(`Node version: ${process.versions.node}`)
  logger.info(`Electron version: ${process.versions.electron}`)
  
  setupIPC()
  createWindow()
  
  logger.info('✅ Gitable application started successfully')
})
```

### Error Handling

```typescript
try {
  await loadConfiguration()
} catch (error) {
  logger.error('Failed to load configuration', {
    error: String(error),
    configPath: CONFIG_PATH
  })
}
```

### Debug Information

```typescript
logger.debug('Theme loaded', {
  themeId: theme.id,
  themeName: theme.name,
  colors: Object.keys(theme.colors).length
})
```

## Testing the Logger

### Development Mode

```bash
pnpm dev
```

All logs will be displayed in the console with colors.

### Production Mode (Silent)

```bash
pnpm build
./dist-electron/linux-unpacked/gitable
```

No console output (silent).

### Production Mode (Verbose)

```bash
./dist-electron/linux-unpacked/gitable --verbose
```

Console output active (info/warn/error levels).

### Production Mode (File Logging)

```bash
# Plain text
./dist-electron/linux-unpacked/gitable --log-file /tmp/gitable.log

# JSON format
./dist-electron/linux-unpacked/gitable -l /tmp/gitable.log -lf json

# Both console and file
./dist-electron/linux-unpacked/gitable -v -l /tmp/gitable.log
```

## Best Practices

1. **Use appropriate log levels**:
   - `debug`: Verbose debugging information (not shown in production)
   - `info`: Important state changes, user actions
   - `warn`: Recoverable issues, deprecation warnings
   - `error`: Errors, exceptions, failures

2. **Include context in metadata**:
   ```typescript
   // Good
   logger.error('Failed to save file', { 
     filename: 'config.json', 
     error: error.message 
   })
   
   // Bad
   logger.error('Failed to save file')
   ```

3. **Don't log sensitive information**:
   - Avoid logging passwords, tokens, API keys
   - Be careful with user data (PII)

4. **Convert errors properly**:
   ```typescript
   // Good
   logger.error('Operation failed', { error: String(error) })
   
   // Bad (may not serialize properly)
   logger.error('Operation failed', { error })
   ```

5. **Use descriptive messages**:
   ```typescript
   // Good
   logger.info('User authentication successful', { userId, method: 'oauth' })
   
   // Bad
   logger.info('OK', { userId })
   ```

## Troubleshooting

### Logs not appearing in development

- Check that `NODE_ENV` is set to `development`
- Verify that `app.isPackaged` returns `false`

### Logs not appearing in production

- Use `--verbose` flag to enable console output
- Use `--log-file` to write logs to a file

### IPC errors in renderer logs

- Check that the preload script is loaded correctly
- Verify that `window.api.logger` is available
- Check browser DevTools console for IPC errors

### Performance concerns

- In production without `--verbose`, logging has minimal overhead
- File logging has buffered writes (minimal performance impact)
- Avoid excessive logging in hot paths (loops, render cycles)

## Related Files

- `src/main/services/LoggerService.ts` - Main process logger
- `src/renderer/src/services/logger.ts` - Renderer process logger
- `src/preload/index.ts` - IPC bridge (logger API)
- `src/types/global.d.ts` - TypeScript types for logger API
- `.eslintrc.json` - ESLint no-console rule
- `.cursorrules` - Project rule for logging requirement

## References

- [Winston Documentation](https://github.com/winstonjs/winston)
- [Winston Transports](https://github.com/winstonjs/winston/blob/master/docs/transports.md)
- [Winston Formats](https://github.com/winstonjs/winston/blob/master/docs/formats.md)

