# Console

A read-only `xterm.js` panel that renders an audit feed of intercepted network traffic — each record formatted as a copy-pasteable `curl` / PowerShell command. Built for Electron apps with a firewall / proxy layer that wants to surface "what did the app actually send" to the user.

## Overview

The Console is **not** an interactive shell — it's a one-way log viewer. A consuming app feeds it `ConsoleRecord` objects (typically intercepted requests from a firewall layer); the panel renders each as an ANSI-coloured block: a dim header (`# <timestamp> <METHOD> <host>:<port>`) plus the request re-expressed as a shell command the user can replay.

Three pieces:

- **`ConsolePanel`** — workbench-tab-ready surface: toolbar (curl ⇄ powershell toggle + Clear) over the xterm panel, wired to the feed store.
- **`Console`** — the bare xterm.js component. Takes `records` + `shell` props, re-renders the scrollback on change. Use directly if you want your own toolbar / layout.
- **`useConsoleFeed`** + **`registerConsoleFeedSource`** — the module-level feed store. The host registers an IPC source once; the store buffers (cap 10 000, rAF-batched, deduped by `id`) and exposes a `useSyncExternalStore`-backed snapshot.

## Installation

```typescript
import {
  ConsolePanel,
  registerConsoleFeedSource,
  clearConsoleFeed
} from 'electron-core-ui/renderer'
import type { ConsoleRecord, ConsoleFeedSource } from 'electron-core-ui/renderer'
```

## The feed: `ConsoleRecord` + source registration

`ConsoleRecord` is a deliberately minimal, widened shape — any app-specific record type that structurally carries these fields satisfies it with no conversion:

```typescript
interface ConsoleRecord {
  id: string                  // dedupe key — re-emitting an id patches in place
  timestamp: string           // ISO-8601
  method: string
  url: string
  host: string
  port: number
  headers: Record<string, string>
  body?: string
  protocol: string            // 'http'|'grpc'|'websocket'|… — picks the renderer
  verdict: 'allow' | 'deny' | 'pending'
  status?: number
  durationMs?: number
  errorMessage?: string
}
```

The host wires the feed once at renderer bootstrap:

```typescript
// `ConsoleFeedSource` = { onRecord(cb): () => void }
registerConsoleFeedSource({ onRecord: window.myApp.firewall.onRecord })
```

The store subscribes to the source lazily — on the first `useConsoleFeed` consumer, or immediately if `registerConsoleFeedSource` is called after a consumer already mounted. So the audit log keeps filling even when no Console tab is open, and registration order doesn't matter.

`clearConsoleFeed()` is the imperative wipe (used by the `console_clear` MCP bridge); `useConsoleFeed()` returns `{ records, clear }` for in-component use.

## `ConsolePanel`

```tsx
<ConsolePanel onLineClick={(record) => focusSourceRequest(record.id)} />
```

| Prop | Type | Description |
|---|---|---|
| `onLineClick` | `(record: ConsoleRecord) => void` (optional) | Click-through hook — receives the record under the clicked row so the host can jump to the source request. |
| `data-testid` | `string` (optional) | Defaults to `console-panel`. |

The curl ⇄ powershell choice is persisted via the host's `useSetting('console:requestFormat')` and survives restarts.

## `Console`

The bare terminal, if you want a custom shell around it:

| Prop | Type | Description |
|---|---|---|
| `records` | `ConsoleRecord[]` | The scrollback. The component diffs against the last-written tail and appends incrementally when possible, full-rewrites otherwise (shell flip, clear, trim). |
| `shell` | `'curl' \| 'powershell'` | Which command renderer to use. |
| `onLineClick` | `(record: ConsoleRecord) => void` (optional) | Row click-through. |
| `data-testid` | `string` (optional) | Defaults to `console-xterm`. |

Behaviour notes:
- **Read-only** — `disableStdin`, cursor fully suppressed, middle-click paste + right-click selection-anchor swallowed (xterm defaults that don't belong in an audit feed).
- **Copy** — `Ctrl/Cmd+C` copies the xterm selection; `Ctrl/Cmd+A` selects all.
- **Font** — resolves the host's `--monospace-font` CSS var against the DOM (xterm needs a literal font string, not a `var()`).

## `renderRecord`

Pure formatter, exposed for direct use / testing:

```typescript
renderRecord(record: ConsoleRecord, shell: ConsoleShell): string
```

Dispatches by `record.protocol`: HTTP-family (`http`/`https`/`graphql`/`soap`/`odata`) → `curl` / `Invoke-RestMethod`; `grpc` → `grpcurl`; `websocket` → `wscat`. PowerShell has no native `grpcurl` / `wscat`, so those fall back to the Unix command with a `# No native PowerShell equivalent` comment.

## MCP integration

`McpService` registers two built-in tools:

- **`open_console`** — broadcasts `CONSOLE_OPEN_CHANNEL` to open / focus the host's Console tab.
- **`console_clear`** — broadcasts `CONSOLE_CLEAR_CHANNEL`; the host wires it to `clearConsoleFeed()`.

The host's preload subscribes to those channel-name constants (from `electron-core-ui/types`) and exposes `onMcpOpenConsole` / `onMcpConsoleClear` on its namespace.

## Dependencies

Pulls in `@xterm/xterm` + the `addon-fit` / `addon-search` / `addon-web-links` addons. `Console.tsx` imports `@xterm/xterm/css/xterm.css` directly — the consuming app's bundler must handle the CSS import (Vite does out of the box).

## Wiring checklist for a consuming app

1. Render `<ConsolePanel />` in a tab / panel.
2. Call `registerConsoleFeedSource({ onRecord })` once at renderer bootstrap, pointing at your IPC channel.
3. In preload, subscribe `onMcpOpenConsole` / `onMcpConsoleClear` to the `CONSOLE_*_CHANNEL` constants; wire the clear handler to `clearConsoleFeed()`.
4. `McpService` already registers the tools.
