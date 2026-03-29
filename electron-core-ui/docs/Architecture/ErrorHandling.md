# Error Handling

electron-core-ui uses typed error classes with error codes and cause chain support. All errors are caught and logged with structured metadata — services never throw to their callers (log-and-recover pattern).

## Error Classes

Three domain error classes, all extending `Error`:

### FileSystemError

For file I/O operations across FileService, ThemeService, I18nService, FeatureFlippingService.

| Code | Description |
|------|-------------|
| `FS_READ_FAILED` | File read failure |
| `FS_WRITE_FAILED` | File write failure |
| `FS_NOT_FOUND` | File or directory not found |
| `FS_PARSE_FAILED` | Deserialization failure (JSON/YAML) |

### PersistenceError

For StorageService JSON key-value store operations.

| Code | Description |
|------|-------------|
| `PERSIST_LOAD_FAILED` | Failed to load storage file |
| `PERSIST_SAVE_FAILED` | Failed to save storage file |

### IpcError

For EventBusService and renderer-to-main IPC communication.

| Code | Description |
|------|-------------|
| `IPC_EMIT_FAILED` | Event emission failure |
| `IPC_HANDLER_FAILED` | Individual handler threw during event dispatch |

## Usage

```typescript
import { FileSystemError, PersistenceError, IpcError, errorMeta } from 'electron-core-ui/main'
// or
import { FileSystemError, PersistenceError, IpcError, errorMeta } from 'electron-core-ui/renderer'
```

### Wrapping errors

```typescript
try {
  const data = readFileSync(path, 'utf-8')
} catch (error) {
  const wrapped = new FileSystemError(
    'Failed to read config file',
    'FS_READ_FAILED',
    { cause: error }
  )
  logger.error('Config read failed', errorMeta(wrapped))
}
```

### errorMeta helper

`errorMeta(error)` extracts structured information from any error:

```typescript
// For typed errors:
errorMeta(new FileSystemError('read failed', 'FS_READ_FAILED', { cause: originalError }))
// → { error: 'read failed', errorName: 'FileSystemError', code: 'FS_READ_FAILED', cause: 'original message' }

// For standard errors:
errorMeta(new Error('something broke'))
// → { error: 'something broke', errorName: 'Error' }

// For non-Error values:
errorMeta('string error')
// → { error: 'string error' }
```

## Design Principles

- **Never throw from services**: Services catch errors internally, log them with `errorMeta`, and return a failure value (`false`, `null`, `{}`)
- **Preserve cause chains**: Always pass the original error as `{ cause: error }` when wrapping
- **Structured logging**: Use `errorMeta()` instead of `{ error: String(error) }` for richer log output
- **Error codes**: Enable programmatic error handling and filtering in log analysis

## Intentionally Silent Catches

One catch is intentionally empty:

- `src/renderer/services/logger.ts` — Last-resort empty catch in the logger itself. Cannot log a logging failure.
