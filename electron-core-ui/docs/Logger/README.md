# Logger

Main-process logging service (winston-backed), plus the renderer-side proxy
that forwards over IPC. One singleton per process tree: the renderer's
`logger` calls `window.api.logger.log(...)`, whose IPC handler replays the
entry through the main-process `logger` — so every log line from either
process ends up in the same winston instance, same transports, same level.

```ts
// main process
import { logger } from 'electron-core-ui/main'

logger.info('Server started', { port: 8080 })
logger.error('Request failed', { code: 500 })
```

```ts
// renderer process
import { logger } from 'electron-core-ui/renderer'

logger.warn('Falling back to defaults')
```

## Transports and configuration

Configured from the command line at first use:

| Flag | Effect |
|---|---|
| `--verbose` / `-v` | Attach the console transport outside dev |
| `--quiet` / `-q` | Never attach the console transport (stdout reserved for program output) |
| `--log-file <path>` / `-l` | Also write to a file |
| `--log-format json\|plain` / `-lf` | File transport format |

In dev (`NODE_ENV=development` or unpackaged) the console transport is on by
default and the level is `debug`; packaged builds default to `info` with no
console transport (a silent transport is attached so winston never warns
about an empty transport list).

## API (`LoggerInterface`)

| Member | Description |
|---|---|
| `debug/info/warn/error(message, meta?)` | Write one entry at that level. |
| `setLevel(level)` | Override the active level at runtime, on the logger and every transport. |
| `onError(listener)` | Observe every **error-level** entry; returns an unsubscribe. |

## `onError` — observing error-level entries

The seam for piping error logs into an observability sink (a crash reporter,
alerting, a test asserting "nothing errored"). Main-process only — but because
the renderer proxy funnels through the main logger, renderer `logger.error`
calls are observed too (their message carries the `[Renderer] ` prefix).

```ts
import { logger, type ErrorLogListener } from 'electron-core-ui/main'

const unsubscribe = logger.onError((message, meta) => {
  observability.captureMessage(message, { level: 'error', extra: meta })
})
// later
unsubscribe()
```

Guarantees, so an observer can never break the logging it observes:

- Fires **after** the entry reached the transports — a failing listener cannot
  lose the log line.
- Listener exceptions are swallowed; remaining listeners still run.
- A listener that itself calls `logger.error` is not re-entered: the nested
  entry is written normally but not re-broadcast. This is what breaks the loop
  "observer logs an error about the error it observed".
- Only `error`-level entries are broadcast — `warn` and below never fire it.
