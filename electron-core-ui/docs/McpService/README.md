# McpService

An embedded MCP (Model Context Protocol) server for the Electron main process. Lets AI tooling (Claude Code, Cursor, Continue, etc.) drive the running app — listing state, taking screenshots, running domain commands — over a local HTTP port.

## Overview

`McpService` wraps `@modelcontextprotocol/sdk`'s `McpServer` with a Node `http.Server` configured for the **Streamable HTTP** transport, bound to `127.0.0.1` only. The service is **off by default**: nothing listens until the consuming app calls `start(port)` with a positive port number — typically driven from a CLI flag so production / packaged builds never accidentally open a port.

The library ships one built-in tool — `screenshot` — that captures the focused `BrowserWindow`'s `webContents` as a PNG. Apps register their own domain tools via `registerTool(...)` to expose business actions ("list collections", "run request", …) without each app having to re-implement the MCP plumbing.

## Installation

```typescript
import { McpService } from 'electron-core-ui'
```

## Lifecycle

```typescript
const mcp = new McpService({ serverInfo: { name: 'my-app', version: '1.2.3' } })

// In your main-process bootstrap, after window creation:
const port = readPortFromCli()  // e.g. yargs '--mcp-port' option
await mcp.start(port)            // no-op if port is 0 / undefined / negative

// Graceful shutdown:
app.on('before-quit', () => { void mcp.stop() })
```

`start()` is idempotent only in the "no port" case — calling it twice with a real port throws. `stop()` is safe to call even when the service was never started.

## API

### `new McpService(options?)`

```typescript
interface McpServiceOptions {
  /** Display name + version sent to MCP clients during the `initialize` handshake. */
  serverInfo?: { name: string; version: string }
}
```

### `start(port: number | undefined): Promise<void>`

Opens the HTTP listener on `127.0.0.1:port`. When `port` is falsy / `<= 0`, the call is a no-op (sentinel for "MCP off").

### `stop(): Promise<void>`

Closes the HTTP listener, the MCP transport, and the `McpServer`. Safe to call multiple times.

### `registerTool(name, config, handler)`

Stores the tool in an in-memory registry; every incoming MCP request gets a fresh `McpServer` populated with all currently-registered tools (see "stateless transport" below). Safe to call **before or after** `start()` — the constructor itself uses it to wire the built-in tools. Throws only if a tool with the same `name` is already registered.

```typescript
import { z } from 'zod'

mcp.registerTool(
  'list-projects',
  {
    title: 'List projects',
    description: 'Return the names of all open projects.',
    inputSchema: { includeArchived: z.boolean().optional() }
  },
  async ({ includeArchived }) => ({
    content: [{ type: 'text', text: JSON.stringify(getProjects({ includeArchived })) }]
  })
)
```

## Built-in tools

### `screenshot`

Captures the currently focused `BrowserWindow` (falling back to the first visible non-destroyed window) and returns the PNG content base64-encoded. No parameters in this revision.

Useful as a smoke-test for the whole MCP pipeline: an MCP client can call `tools/call screenshot` and verify it gets back valid image content.

### `refresh`

Reloads the active window's renderer (equivalent to `Ctrl+R` / `Cmd+R`). Resolves once the renderer emits `did-finish-load`, so a downstream `screenshot` call sees the post-reload state. No parameters.

Useful for re-rolling randomized UI elements (wallpapers, wordmark animations, decorative props) or recovering from a renderer-side glitch without bouncing the whole process.

### `dom-query`

Runs a CSS selector against the active renderer's `document` and returns matching elements as structured JSON. Implemented via `webContents.executeJavaScript`, so the query runs in the renderer's main world.

```jsonc
{
  "selector": "[data-testid=\"welcome-new-button\"]",
  "maxMatches": 5  // optional, default 50, hard cap 200
}
```

Reply shape:

```jsonc
{
  "selector": "...",
  "matchCount": 1,         // total matches found in the DOM
  "truncated": false,      // true if matchCount > maxMatches
  "elements": [
    {
      "tag": "a",
      "id": null,
      "classes": ["button", "text-button", "appearance-rainbow", "xl-button"],
      "attributes": { "data-testid": "welcome-new-button", "role": "button", ... },
      "text": "New",
      "rect": { "x": 542, "y": 358, "width": 294, "height": 64 }
    }
  ]
}
```

Each element's `text` is trimmed and truncated to 500 chars; `id` and `class` attributes are surfaced as their own fields and stripped from `attributes` to avoid duplication. `rect` comes from `getBoundingClientRect()` rounded to integers.

Use cases: verifying a `data-testid` is present, reading a computed label, locating an element's coordinates for a downstream click tool, debugging why a selector doesn't match.

### `console-logs`

Returns recent `console.log` / `warn` / `error` / `debug` / `verbose` messages emitted by the renderer. The buffer fills automatically from the moment `McpService.start()` runs and caps at 1000 entries (oldest evicted first).

```jsonc
{
  "level": "error",      // optional — only this severity
  "since": 1714604000000, // optional — epoch ms; entries with timestamp >= since
  "limit": 50,            // optional — default 100, max 1000
  "windowId": 1           // optional — webContents.id
}
```

Reply shape:

```jsonc
{
  "count": 3,
  "totalBuffered": 142,
  "entries": [
    { "timestamp": 1714604012345, "level": "error", "message": "TypeError: ...", "source": "app://renderer/main.tsx", "line": 87, "windowId": 1 }
  ]
}
```

Entries come back **most-recent-first**.

### `dispatch-event`

Dispatches a synthetic event of any type on a CSS-selected element in the renderer. Picks the right `Event` constructor (`MouseEvent`, `KeyboardEvent`, `PointerEvent`, `WheelEvent`, `FocusEvent`, fallback `Event`) based on the event type, then merges the optional `init` dict over `{ bubbles: true, cancelable: true, composed: true }`. For mouse-family events, the element's bounding rect fills `clientX/clientY` automatically when the caller doesn't pass them.

```jsonc
// Click a button
{ "selector": "[data-testid=\"welcome-new-button\"]", "type": "click" }

// Hover (paired mouseenter/mouseleave on the same element)
{ "selector": ".my-card", "type": "mouseenter" }

// Press Enter on the focused input
{ "selector": "input.search", "type": "keydown", "init": { "key": "Enter", "code": "Enter" } }

// Custom event
{ "selector": "body", "type": "my-app:reset", "init": { "detail": { "scope": "all" } } }
```

For `focus` / `blur` the tool also calls `el.focus()` / `el.blur()` because synthetic FocusEvents can't move real focus on their own.

### `type-text`

Sets the value of an `<input>`, `<textarea>` or `[contenteditable]` element and fires `input` + `change`. Crucially, it uses the native `HTMLInputElement.prototype` value setter via `Object.getOwnPropertyDescriptor(...).set.call(el, text)` so **React controlled inputs see the change** — a plain `el.value = text` would be cached by React's value-tracker and ignored.

```jsonc
{
  "selector": "input[name=\"url\"]",
  "text": "https://example.com",
  "mode": "replace"  // optional: 'replace' (default) or 'append'
}
```

### `evaluate`

Power-tool escape hatch: runs an arbitrary JavaScript expression in the active renderer's main world and returns the result, JSON-stringified (so functions / `undefined` / circular refs become `null`).

```jsonc
{ "expression": "window.location.href" }
{ "expression": "(() => { const u = new URL(location.href); return u.searchParams.get('id') })()" }
```

Footgun by design — every other tool covers the safe cases. A misplaced statement here can break the running app or leave it in a state the user notices.

### `exit`

Gracefully quits the Electron app via `app.quit()`. Pending dirty / `before-quit` handlers still run, so this is **not** a kill — if the user has unsaved changes the app may prompt and bail. Use to wind the GUI app down between dev iterations without leaving zombie processes. No parameters.

### `wait-for`

Polls the renderer DOM until a condition is met (or `timeoutMs` elapses). Eliminates race conditions in tool-chains: `dispatch-event` click → `wait-for` modal appears → `screenshot`. Conditions:

| condition | meaning |
| --- | --- |
| `present` | At least one element matches `selector` |
| `absent` | No element matches |
| `text-equals` | Matched element's `textContent.trim()` equals `value` |
| `text-contains` | `textContent` includes `value` |
| `attribute-equals` | `getAttribute(attribute) === value` |

Default `timeoutMs` is 5000 (max 60000), `pollMs` 100 (min 20, max 2000). Returns `isError: true` on timeout with a descriptive message.

### `keyboard-shortcut`

Sends an OS-level keyboard event via `webContents.sendInputEvent`. Required for Electron menu accelerators (`File → Save = Ctrl+S` etc.) — `dispatch-event` with a `KeyboardEvent` only reaches DOM listeners, not the Electron-level accelerator dispatch.

```jsonc
{ "key": "S", "modifiers": ["Control"] }      // Ctrl+S
{ "key": "Escape" }
{ "key": "F12" }
```

`Cmd` aliases to `Meta`, `Ctrl` to `Control`.

### `devtools`

Open / close / toggle the renderer's Chromium DevTools panel.

```jsonc
{ "action": "open", "mode": "right" }   // dock right
{ "action": "toggle" }                   // default
{ "action": "close" }
```

Modes: `right` (default), `bottom`, `left`, `undocked`, `detach`.

### `window-info`

Returns a snapshot of the active `BrowserWindow`. Useful as a quick diagnostic before / after a `screenshot` (e.g. detect a minimized window — its capture would be empty).

```jsonc
{
  "id": 1,
  "title": "Restorm",
  "bounds": { "x": 0, "y": 0, "width": 1400, "height": 819 },
  "contentBounds": { "x": 0, "y": 32, "width": 1400, "height": 787 },
  "isFocused": true,
  "isVisible": true,
  "isMinimized": false,
  "isMaximized": false,
  "isFullScreen": false,
  "isAlwaysOnTop": false,
  "isDestroyed": false,
  "devToolsOpened": false
}
```

### `storage`

Read or modify the renderer's `localStorage` from outside the app. Actions:

| action | inputs | reply |
| --- | --- | --- |
| `get` | `key` | `{ value: string \| null }` |
| `set` | `key`, `value` | `{ ok: true }` |
| `remove` | `key` | `{ ok: true }` |
| `clear` | — | `{ ok: true }` |
| `keys` | — | `{ keys: string[] }` (sorted) |

`localStorage` only stores strings — JSON-stringify structured data before `set`, JSON-parse after `get`.

### `scroll-into-view`

`el.scrollIntoView(...)` on a CSS-selected element so a downstream `screenshot` / `dispatch-event` sees it.

```jsonc
{
  "selector": "[data-testid=\"folder-row-42\"]",
  "behavior": "instant",  // 'instant' (default) | 'auto' | 'smooth'
  "block": "center",      // default
  "inline": "nearest"
}
```

Returns the element's post-scroll bounding rect.

### `inject-css`

Appends a `<style>` tag with arbitrary CSS rules. Useful to debug hover/focus/active states (force a class), highlight elements with an outline, or test a layout tweak live without a rebuild. Idempotent per `id` — re-injecting with the same id replaces the previous rules.

```jsonc
{
  "rules": "[data-testid='welcome-new-button'] { outline: 3px solid red !important; }",
  "id": "debug-outline"   // optional
}
```

### `wait`

Block for `ms` milliseconds. Use only when nothing else fits — prefer `wait-for` (DOM condition) or `refresh` (waits for `did-finish-load`). Capped at 30000 ms.

### `get-windows`

Returns every active `BrowserWindow` with its `id` (= `webContents.id`), `title`, `bounds`, and focus / visible / minimized / maximized / fullscreen / always-on-top / devtools flags.

```jsonc
{
  "count": 2,
  "windows": [
    {
      "id": 1,
      "title": "Restorm",
      "bounds": { "x": 16, "y": 10, "width": 1400, "height": 819 },
      "isFocused": true,
      "isVisible": true,
      "isMinimized": false,
      "isMaximized": false,
      "isFullScreen": false,
      "isAlwaysOnTop": false,
      "devToolsOpened": false
    },
    {
      "id": 5,
      "title": "Detached tab — pets",
      "bounds": { "x": 600, "y": 200, "width": 800, "height": 600 },
      ...
    }
  ]
}
```

Pair with the `windowId` parameter that every renderer-facing tool now accepts (`screenshot`, `refresh`, `dom-query`, `console-logs`, `dispatch-event`, `type-text`, `evaluate`, `wait-for`, `keyboard-shortcut`, `devtools`, `window-info`, `storage`, `scroll-into-view`, `inject-css`, `get-computed-style`, `drag-drop`) to target a specific window. When `windowId` is omitted those tools fall back to the focused / first-visible window.

### `drag-drop`

Simulates a full HTML5 drag-and-drop from a source element to a target element. Fires the canonical event sequence with a fresh `DataTransfer` that the source's own `dragstart` handler can stamp data on:

```
dragstart (source)
  → dragenter + dragover walked across N intermediate positions
  → sustainedHovers extra dragover at the final position
  → drop (on whatever `elementFromPoint` hits at the drop point)
  → dragend (source)
```

```jsonc
{
  "sourceSelector": "[role=\"tab\"][data-testid$=\"request-idx:0.0.1\"]",
  "targetSelector": ".editor-group-container",
  "dropPosition": "right",   // 'center' (default), 'top', 'right', 'bottom', 'left'
  "steps": 10,                // 1..50, default 10. More = smoother emulation
  "sustainedHovers": 5,       // 0..20, default 5. Apps that throttle/debounce indicators may need more
  "windowId": 1               // optional
}
```

Why the walk + sustained hovers matter: many apps gate the drop indicator on the drag actually moving across nested zones (not just teleporting to the target), and on the cursor sitting still long enough for a debounced overlay to materialize. The default `steps: 10` + `sustainedHovers: 5` is enough to drive restorm's editor-group split overlay; tune up if your app needs more.

Use to reorder workbench tabs, split editor groups (drop near a group edge), reorder tree nodes — anything wired through HTML5 drag-and-drop. Verified against editor-group split.

### `get-computed-style`

Returns `getComputedStyle` values for an element. Pass a `properties` array to filter:

```jsonc
{
  "selector": ".text-button.appearance-rainbow",
  "properties": ["background-image", "border-color", "color", "--button-background"],
  "pseudoElement": "::before"  // optional
}
```

Reply: `{ selector, pseudoElement, properties: { name: value, ... } }`. Omitting `properties` returns the FULL computed style (long but exhaustive).

## System dialog bypass

Restorm-style apps trigger native modal dialogs (`dialog.showSaveDialog`, `showOpenDialog`, `showMessageBox`) deep inside their main-process logic — for example, to ask "where do you want to save this?" when the user picks **File → Save**. Those dialogs **block the main process** until the user clicks. An MCP client can't see / dismiss them, so any tool whose code path eventually hits one would hang.

`McpService` patches `electron.dialog.show*` once at `start()` time. The wrapper checks an `AsyncLocalStorage` flag :

- A real native dialog runs whenever the call originates **outside** an MCP request (menu clicks, keyboard shortcuts, normal app flows). The user's interactive experience is unchanged.
- When the call happens **inside** an MCP tool handler (the `handleRequest` body runs inside `mcpToolContext.run(...)`), the wrapper short-circuits with a synthetic result :
  - `showSaveDialog` → `{ canceled: !defaultPath, filePath: defaultPath ?? '' }`
  - `showOpenDialog` → `{ canceled: !defaultPath, filePaths: defaultPath ? [defaultPath] : [] }`
  - `showMessageBox` → `{ response: defaultId ?? 0, checkboxChecked: false }`

The synthetic answers lean on the dialog's own `defaultPath` / `defaultId` because those fields exist precisely so a UI can pre-fill the modal. Tools that need a specific path can pass it via `defaultPath` when they call the underlying service.

This solves the same problem an e2e Playwright fixture would otherwise need to handle per consumer, but at the library level so any consumer-domain tool added later (create-file, save-as, …) works immediately without one-off bypasses.

## Security

- Listens on `127.0.0.1` only (loopback). The HTTP server binds the IPv4 loopback explicitly; the OS will not accept connections from other interfaces.
- Per-request defence in depth: the handler rejects any request whose `socket.remoteAddress` is not loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`).
- No authentication tokens. Treat the MCP port like a Unix socket: trust that any process on the local machine can reach it.

If your threat model includes hostile processes on the same machine, pick a hard-to-guess port at runtime and pair it with a bearer token via `headers` in the client's `.mcp.json`. The service does not implement that today.

## Discovery from Claude Code

Add a `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "my-app": {
      "type": "http",
      "url": "http://localhost:39000"
    }
  }
}
```

Claude Code auto-loads project-scoped MCP servers at session start (after a one-time security prompt to trust the workspace). Once approved, the tools appear in the agent's toolbox under `mcp__my-app__*`.

## Why off-by-default

A packaged production binary opening a TCP port — even on loopback — surprises users and security scanners. The CLI flag pattern keeps the surface zero-cost for normal users and explicit for developers / AI integrations.
