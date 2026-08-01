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

  /**
   * Optional onboarding text forwarded to clients in the `initialize`
   * response (`instructions`). A fresh client — often an AI agent —
   * reads it first to orient itself: what the server is for, the core
   * workflows, the key tool groups, conventions. Keep it concise but
   * self-sufficient so the server is usable out-of-the-box.
   */
  instructions?: string

  /**
   * Optional bearer token. When set, every incoming HTTP request must
   * carry `Authorization: Bearer <token>`; mismatched / missing headers
   * get a `401 Unauthorized`. When omitted, no auth is enforced —
   * existing callers (tests, ECUI consumers without an auth need)
   * keep working unchanged.
   *
   * The token is opaque to the service: caller picks the entropy and the
   * propagation channel. The standard recipe is "32 hex chars from
   * `crypto.randomBytes(16)`, written into a discovery file the launcher
   * reads back" — see consuming app `restorm` for a worked example.
   */
  authToken?: string

  /**
   * Optional human-readable name for THIS instance. Enables the
   * cross-instance routing bridge: a `tools/call` may carry a reserved
   * `__session` key in its `arguments`. Absent / equal to this name →
   * the key is stripped and the call runs locally (unchanged). Names a
   * DIFFERENT instance → forwarded to the peer that owns that name
   * (resolved in `discoveryDir`). Omitted → no routing layer at all.
   */
  sessionName?: string

  /**
   * Discovery directory holding the per-pid lockfiles of every live
   * instance of this app (see `resolveMcpDiscoveryDir`). Set together with
   * `sessionName` to activate the bridge: a `__session` naming another
   * instance is resolved here and forwarded to its loopback MCP endpoint
   * (port + bearer token from its lockfile), the response relayed verbatim.
   * The app writes its OWN lockfile into this dir on startup (see the
   * discovery helpers below); McpService only consumes it for forwarding.
   */
  discoveryDir?: string

  /**
   * Optional path to an `ffmpeg` executable used to remux a captured
   * screencast WebM into a seekable, correctly-timed MP4 (see
   * `screencast-stop`). ECUI never bundles ffmpeg — that is a packaging
   * concern of the consuming app. Omitted → ECUI runs a bare `ffmpeg`, i.e.
   * whatever is on `PATH`. When no ffmpeg is reachable, the remux degrades
   * gracefully and the raw WebM is served instead. So MP4 is a best-effort
   * upgrade, never a hard dependency.
   */
  ffmpegPath?: string
}
```

#### ffmpeg / screencast MP4 remux (optional, used-if-present)

`screencast-stop` records via `MediaRecorder` (WebM). A WebM has no duration in
its container header, so a `<video>` reports `Infinity` until fully buffered. To
fix that, the service remuxes the WebM into an MP4 (H.264 / yuv420p /
`+faststart`) with a real duration, and serves the MP4 when the remux succeeds.

The remux shells out to **ffmpeg**, resolved in this order:

1. `options.ffmpegPath` — an absolute path the consuming app injects (only an
   app that chooses to bundle its own ffmpeg sets this; ECUI itself never
   bundles one — bundling per-OS static binaries adds ~70-90 MB per installer
   and a libx264/GPL licensing burden).
2. A bare `ffmpeg` on the process `PATH` — i.e. a system install.
3. **Graceful fallback** — when neither is reachable (or the remux fails for any
   reason), `screencast-stop` serves the **raw WebM**. It still plays; only the
   `<video>` duration self-corrects as it buffers.

So ffmpeg is an **optional** dependency: install it (or have it on `PATH`) for
the cleaner MP4, otherwise the feature still works on WebM. Restorm relies on a
system ffmpeg and does not bundle one.

#### Cross-instance routing bridge

Multiple MCP-enabled instances of the **same** app can run at once (parallel
agents, multiple checkouts). The bridge lets a single MCP client reach a
specific one by name. The whole mechanism — discovery, transport, and the
routing-key plumbing — lives in ECUI, so any consuming app gets it by
setting two options + writing its lockfile.

When both `sessionName` and `discoveryDir` are set, `McpService` peels an
optional reserved key off each `tools/call` **before** per-tool Zod
validation:

- The key is `MCP_SESSION_ROUTING_KEY` (`"__session"`), exported alongside
  `McpService`. A client adds it to a tool's `arguments`, e.g.
  `{ "name": "screenshot", "arguments": { "__session": "agent-b" } }`.
- Absent, empty, or equal to this instance's `sessionName` → the key is
  stripped and the call runs locally. Individual tools never see it.
- Naming another instance → the original JSON-RPC is forwarded to the peer
  whose lockfile in `discoveryDir` records that exact name (port + bearer
  token from the lockfile), and the peer's HTTP response is relayed verbatim.
- An unknown / dead / unreachable target → a JSON-RPC error
  (`code -32001`), never a hang (bounded timeout).
- Forwarded requests carry the `MCP_FORWARDED_HEADER`
  (`x-mcp-forwarded`) header; a request that already crossed one hop is
  never forwarded again (loop break, on top of the self-name check).

Consumers that never set these options are unaffected — the request body
is handed straight to the SDK with zero added overhead.

#### Discovery helpers (lockfile lifecycle)

The lockfile mechanism is generic and exported so any app reuses it without
re-coding it. The app owns *when* to write (it knows its bound port + token
+ what it has open); ECUI owns *how*.

- `resolveMcpDiscoveryDir(appDirName, override?)` → the conventional dir:
  the `override` (an env var both the app and its launcher read) pins a
  fixed path; otherwise `os.tmpdir()/<appDirName>`. App + launcher must
  resolve to the same path.
- `writeMcpDiscoveryFile(dir, entry, extraPath?)` → atomically write this
  instance's lockfile (owner-only perms; carries the bearer token). Call it
  on startup once the port is bound, and again whenever the open-document
  path changes. `extraPath` writes a second copy at an exact path (e.g. a
  launcher polling a known file).
- `cleanupMcpDiscoveryFile(dir, pid, extraPath?)` → remove the lockfile(s)
  on quit.
- `findLiveSessionByName(dir, name)` / `forwardToNamedSession(dir, name,
  jsonRpcText, timeoutMs?)` → the discovery + transport the bridge uses
  internally; exported for advanced consumers.

`McpDiscoveryEntry` is the on-disk shape (`port`, `pid`, `startedAt`,
`token`, `name`, `projectPath`). Treat it as a stable contract: external
launchers read it without importing this module, so keep the JSON shape
backward-compatible.

```typescript
import {
  resolveMcpDiscoveryDir, writeMcpDiscoveryFile, cleanupMcpDiscoveryFile
} from 'electron-core-ui'

const discoveryDir = resolveMcpDiscoveryDir('myapp-mcp', process.env.MYAPP_MCP_DIR)
const mcp = new McpService({ authToken, sessionName: 'agent-a', discoveryDir })
await mcp.start(0)
await writeMcpDiscoveryFile(discoveryDir, {
  port: mcp.getPort()!, projectPath: null, pid: process.pid,
  startedAt: new Date().toISOString(), token: authToken, name: 'agent-a'
})
app.on('before-quit', () => { void cleanupMcpDiscoveryFile(discoveryDir, process.pid) })
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

### `registerResource(name, uri, config, handler)`

Stores a resource in the in-memory registry; mirrors `registerTool` but wires into MCP's resource primitive. Resources are the read-once-at-the-top primitive of the protocol — clients can pull a snapshot of state without learning the tool surface.

```typescript
interface McpResourceConfig {
  title?: string
  description?: string
  /** Defaults to `application/json` for text payloads. */
  mimeType?: string
}

type McpResourceHandler = (uri: URL) =>
  | { text?: string; blob?: string; mimeType?: string }
  | Promise<{ text?: string; blob?: string; mimeType?: string }>
```

Pass an exact URI (`my-app://project`) for a static resource, or a URI template (`my-app://request/{id}`) for a templated one — the SDK matches the template and the handler receives the parsed `URL`, so it can pull the bound variables from `uri.pathname` itself. The wrapper finalizes the result into the SDK's `{contents: [...]}` shape; you only return text or blob plus an optional `mimeType`. Throws if a resource with the same `name` is already registered.

```typescript
// Static URI — single readout
mcp.registerResource(
  'project',
  'my-app://project',
  { title: 'Project summary', description: 'Open project metadata.' },
  () => ({ text: JSON.stringify({ name: getProjectName(), path: getProjectPath() }) })
)

// Templated URI — variable in the path
mcp.registerResource(
  'request',
  'my-app://request/{id}',
  { title: 'Single request payload' },
  (uri) => {
    const id = uri.pathname.split('/').filter(Boolean).pop() ?? ''
    const req = findRequestById(id)
    if (!req) return { text: JSON.stringify({ error: `No request with id ${id}` }) }
    return { text: JSON.stringify(serializeRequest(req)) }
  }
)
```

The handler can be sync or async; both branches are funneled through the same finalization. `mimeType` resolution order: handler return value → resource config → `application/json` default for text payloads (no default for blob payloads — set `mimeType` explicitly when you mean binary).

### `invokeTool(name, args, extra?)`

Invokes a registered tool by name from inside the host process, returning whatever the tool's handler returns (sync value or `Promise`). Throws if `name` is not registered. Used by the built-in `batch` tool to chain calls without a round-trip through the HTTP transport; consuming apps can also use it to compose tools.

```typescript
const result = await Promise.resolve(mcp.invokeTool('screenshot', {}))
```

### Served-call log buffer

The service retains a ring buffer of the `tools/call`s it executed **locally**, so a host can surface "what MCP calls has this app served" in a viewer (see the [McpLogs](../McpLogs/README.md) component). A call the cross-instance bridge **forwards** to a peer is answered before local dispatch, so passthrough calls are never recorded — only this instance's own traffic.

| Member | Notes |
|--------|-------|
| `getServedCalls(): McpServedCallEntry[]` | Snapshot, newest-first. |
| `onServedCall(cb): () => void` | Fires on record / clear / cap-trim. Returns an unsubscribe fn. |
| `getLogRetentionCap(): number` | Current cap (default `DEFAULT_SERVED_CALL_CAP` = 100). |
| `setLogRetentionCap(cap: number)` | Floored to a non-negative integer; lowering it evicts the oldest entries immediately. `0` disables retention and drops the buffer. |
| `getCaptureRetentionCap(): number` | Current capture-retention cap (default `DEFAULT_CAPTURE_RETENTION_CAP` = 20) — how many recent entries keep their heavy capture payload (image base64 / video temp file). |
| `setCaptureRetentionCap(cap: number)` | Floored to a non-negative integer; lowering it prunes now — older captures drop their payload and a video's on-disk temp file is deleted. `0` keeps no capture payloads. |
| `clearServedCalls()` | Empties the buffer. |

Each `McpServedCallEntry` carries `timestamp`, `tool`, `payload` (JSON-stringified arguments, truncated past ~8 KB with a `…(truncated)` marker + the original `payloadBytes`), and — for `screenshot` / `screencast-stop` — an inline `capture` (base64 PNG or temp video path). Capture payloads are kept only for the most recent few entries to bound memory.

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

Default `timeoutMs` is 5000 (max 60000), `pollMs` 100 (min 20, max 2000). Returns `isError: true` on timeout with a descriptive message, and on an invalid CSS selector — which is a hard error rather than a condition that polls to a timeout.

A successful reply reports what the renderer actually saw:

```jsonc
{
  "ok": true,
  "elapsedMs": 42,
  "matchCount": 1,        // elements the selector matched
  "condition": "present",
  "selector": ".modal",
  "windowId": 1           // the window that was polled
}
```

Check both before trusting a pass. `ok: true` alone is ambiguous — a satisfied `absent` and a satisfied `present` are indistinguishable without `matchCount` — and with more than one window open, `windowId` tells you whether the window polled is the one you go on to screenshot (omit `windowId` in the request and the active window is picked).

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

### `batch`

Chains multiple MCP tool calls into a single request. Runs each step in order; the next step only fires after the previous one resolves **and** the renderer has had an implicit "1 frame + 1 microtask" settle (override per step with `waitFor`, or skip globally via `skipImplicitSettle`). Aborts on the first step that throws or returns `isError: true` — subsequent steps are skipped.

The implicit settle is **bounded** (1000 ms). Chromium produces no frames at all for a window that is unfocused, minimised or occluded, so an unbounded frame wait would never resolve there and every batch would hang — including one whose steps never touch the DOM. On timeout the batch continues, the step carries `"settle": "timed-out"`, and the envelope gains a `settleNote`. Pass `skipImplicitSettle: true` when driving a background window, or a per-step `waitFor` to wait on something real.

```jsonc
{
  "steps": [
    { "name": "dispatch-event", "args": { "selector": ".open-btn", "type": "click" },
      "waitFor": { "selector": ".modal" } },
    { "name": "screenshot" }
  ],
  "windowId": 1,              // optional — window for the implicit settle frame-tick
  "skipImplicitSettle": false // optional — drop the inter-step settle
}
```

Per-step `waitFor` overrides the implicit settle. Pick one shape:

| shape | meaning |
| --- | --- |
| `{ ms }` | Fixed delay in ms |
| `{ selector, timeoutMs?, pollMs? }` | Poll until at least one element matches `selector` |
| `{ predicate, timeoutMs?, pollMs? }` | Poll until the JS expression evaluates truthy in the renderer |

`timeoutMs` defaults to 5000 (a timed-out / throwing `waitFor` aborts the batch). The response aggregates every step's `content` parts in order — embedded images / resources reach the client inline — followed by a final text part with the structured envelope:

```jsonc
{
  "ranCount": 2,
  "totalCount": 2,
  "aborted": false,
  "abortedAt": null,
  "results": [
    { "index": 0, "name": "dispatch-event", "ok": true },
    // `settle` appears only when the implicit settle did not complete
    { "index": 1, "name": "screenshot", "ok": true, "settle": "timed-out" }
  ],
  // present only when at least one step's settle timed out
  "settleNote": "One or more implicit settles timed out after 1000ms — …"
}
```

When a step is `screencast-stop`, the recorded `.webm` is read from disk and inlined as a `resource` content part (base64 `blob` + `video/webm` `mimeType`), so a `screencast-start → actions → screencast-stop` chain returns the video bytes without a follow-up file read. Not to be confused with consuming-app tools like restorm's `run_request_batch`, which batches HTTP / protocol requests.

### `open_mini_browser`

Broadcasts `MINI_BROWSER_OPEN_CHANNEL` to open / focus the host app's Mini browser panel. Optional `url` navigates the embedded webview immediately (bare hosts like `example.com` are normalised by the renderer). Requires the host to render `MiniBrowserPanel` and wire `useMcpMiniBrowserBridge` — see the [MiniBrowser doc](../MiniBrowser/README.md).

```jsonc
{ "url": "https://example.com" }   // url optional
```

### `mini_browser_execute`

Runs a JavaScript expression inside the Mini browser's `<webview>` **guest** context (not the host renderer) and returns the result. Broadcasts `MINI_BROWSER_EXECUTE_CHANNEL` with a request id, waits for the renderer's reply on `MINI_BROWSER_EXECUTE_REPLY_CHANNEL`. Use it to fill a login form in the embedded site, read a token from the page's `localStorage`, click a button, etc.

```jsonc
{
  "code": "(() => localStorage.getItem('jwt'))()",
  "timeoutMs": 5000   // optional, default 5000, max 60000
}
```

Returns an error if no Mini browser tab is open or the webview hasn't finished its initial load.

### `open_console`

Broadcasts `CONSOLE_OPEN_CHANNEL` to open / focus the host app's Console panel (the read-only audit feed of intercepted network traffic). Requires the host to render `ConsolePanel` and wire its tab — see the [Console doc](../Console/README.md). No parameters.

### `console_clear`

Broadcasts `CONSOLE_CLEAR_CHANNEL` to wipe the renderer-side Console feed buffer — same effect as the toolbar's Clear button. The host wires it to `clearConsoleFeed()`. Useful to reset the log before a focused experiment. No parameters.

### `list_themes`

Returns the list of color themes available in the app. Reads from `ThemeService` (must be initialised by the host). Returns an error when the service is uninitialised.

```jsonc
// No parameters
// Reply:
{
  "themes": [
    { "id": "dark/Default Dark+", "name": "Default Dark+", "family": "dark" },
    { "id": "light/Default Light+", "name": "Default Light+", "family": "light" }
  ]
}
```

`family` maps `ThemeInfo.type`: `dark` | `light` | `hcDark` | `hcLight`.

### `get_current_theme`

Returns the `id`, `name`, and `family` of the currently active color theme. Reads the persisted selection from `StorageService` (key `currentTheme`) and resolves it against the available themes from `ThemeService`. Falls back to the first dark theme (or first available theme) when the stored id is absent or unrecognised. Returns an error when `ThemeService` is uninitialised.

```jsonc
// No parameters
// Reply:
{ "id": "dark/Default Dark+", "name": "Default Dark+", "family": "dark" }
```

There is no dedicated route to CHANGE the theme: the theme is an ordinary setting, so `set_setting` with the theme's key does it (and reports the installed ids as that setting's allowed values). See [Settings routes](#settings-routes).

### `set_tab_maximized`

Broadcasts `SET_TAB_MAXIMIZED_CHANNEL` to open a workbench tab fullscreen (in the same modal a double-click on the tab opens) or restore it back to its split-pane slot. The maximized and normal views share one React instance, so no edits / responses / scroll state are lost in either direction. Requires the host to wire `EditorWorkbench`'s `setFullscreenTabId` imperative handle to the channel — see the [Workbench doc](../Workbench/README.md).

```jsonc
{ "tabId": "request-id:abc", "maximized": true }   // maximize
{ "maximized": false }                             // restore (tabId ignored)
```

`tabId` is required when `maximized` is `true`; on restore it is ignored since at most one tab can be maximized at a time. Only tabs the host marked maximizable (`allowFullscreen`) actually maximize.

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

Pair with the `windowId` parameter that every renderer-facing tool now accepts (`screenshot`, `refresh`, `dom-query`, `console-logs`, `dispatch-event`, `type-text`, `evaluate`, `wait-for`, `keyboard-shortcut`, `devtools`, `window-info`, `storage`, `scroll-into-view`, `inject-css`, `get-computed-style`, `drag-drop`, `mouse-input`) to target a specific window. When `windowId` is omitted those tools fall back to the focused / first-visible window.

### `list-instances`

Return every running instance of this app that has an active MCP endpoint. Only instances whose endpoint actually answers an authenticated `initialize` probe are reported — stale lockfiles from crashed runs are silently skipped. The bearer token is never included in the output.

Requires `McpServiceOptions.discoveryDir` to be set (restorm wires this from the `RESTORM_MCP_DIR` env var / the conventional default). Returns an empty list when the option is absent or the directory is empty.

```jsonc
{
  "count": 2,
  "instances": [
    {
      "pid": 12345,
      "name": "my-project — feature/add-widget",
      "projectPath": "/home/user/projects/my-project.restorm",
      "endpoint": "127.0.0.1:39271",
      "startedAt": "2026-06-19T08:00:00.000Z"
    },
    {
      "pid": 12399,
      "name": "restorm",
      "projectPath": null,
      "endpoint": "127.0.0.1:41003",
      "startedAt": "2026-06-19T07:45:00.000Z"
    }
  ]
}
```

Use `__session: "<name>"` on any subsequent `tools/call` to target a specific instance (see [Cross-instance bridge](#cross-instance-bridge) above). The `name` comes from `--mcp-session-name` or `RESTORM_MCP_SESSION_NAME` set at launch time.

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

### `mouse-input`

Injects OS-level, **trusted** (`isTrusted=true`) mouse input via `webContents.sendInputEvent` — the mouse counterpart of `keyboard-shortcut`. Use it for interactions that ignore synthetic DOM events (which `dispatch-event` and `drag-drop` produce): pointer-capture drags (React Flow link/connection drags), hover-opened submenus (the ECUI `ContextMenu`, native-style menus), and Monaco wheel scrolling. The point comes from a `selector` (its rect centre) or explicit `x`/`y` (CSS px, viewport-relative).

```jsonc
{
  "gesture": "drag",          // 'move' (hover) | 'click' | 'drag' | 'wheel'
  "selector": ".react-flow__handle.source", // OR explicit "x"/"y"
  "toSelector": ".react-flow__pane",         // drag target — OR "toX"/"toY"
  "steps": 16,                // drag only, 1..60, default 16 (frame-paced moves)
  "button": "left",           // 'left' (default) | 'middle' | 'right'
  "deltaY": -120,             // wheel only (negative = scroll up)
  "windowId": 1               // optional
}
```

Why trusted input: React Flow's connection drag uses pointer capture and the ECUI submenu opens on a real hover — both ignore `isTrusted=false` synthetic events. `sendInputEvent` produces real pointer/mouse/wheel events Chromium dispatches like genuine user input, so these targets respond. Prefer `mouse-input` over `dispatch-event` / `drag-drop` whenever a target ignores synthetic events.

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

## Settings routes

Four generic routes read and write **every** setting the app declares, at either scope. They know no setting id: the catalogue is flattened from the same registry that builds the GUI settings page — this library's `resources/settings/defaults.yaml` plus whatever YAML the consuming app registers — so a newly-added setting appears on these routes, with its constraints, on the next call.

Writes go through `SettingsService.set()` / `setWorkspaceValue()`, i.e. the exact path a click in the settings page takes. That is what makes a change *apply* and not merely persist: the renderer's `SettingsProvider` listens to the resulting `settings:changed` broadcast and runs whatever side effect the key carries — swapping the palette for the theme key, calling `i18n.changeLanguage` + the `i18n:set-language` IPC for the language key (see [Settings architecture › Side Effects](../Architecture/Settings.md#side-effects)). Those side effects live in the renderer, so a change lands live only while a window is open; with no window the value is still persisted and applies on the next launch.

All four require the host to have initialised `SettingsService`, and return `SettingsService is not initialised` otherwise.

### Scopes

| `scope` | Layer |
|---------|-------|
| `user` (default) | The global, app-wide layer, persisted by `StorageService`. |
| `workspace` | The per-project overlay (`<workspace>/.restorm/settings.json`), available only while a project is open. |

Reading or writing the `workspace` scope with no project open is an error naming the reason. A setting declared `userOnly` (locale, for instance) reports `editableScopes: ["user"]` and refuses a workspace write.

Deliberate divergence from the UI: the settings page's Workspace tab *hides* `userOnly` settings, whereas `get_settings` at the `workspace` scope still lists them, with `editableScopes: ["user"]`. A caller enumerating the API is better served by seeing the setting and why it can't be written there than by a key that silently doesn't exist at one scope.

### `get_settings`

Returns every setting at the requested scope. `query` filters case-insensitively over key, title and description.

```jsonc
{ "scope": "user", "query": "font" }   // both optional
// Reply:
{
  "scope": "user",
  "workspacePath": "/home/me/projects/demo",   // null when no project is open
  "count": 1,
  "settings": [
    {
      "key": "appearance.editor:fontSize",     // pass this verbatim to set_setting
      "groupPath": ["appearance", "editor"],
      "title": "Font size",                    // translated
      "description": "Font size of the code editor, in pixels.",
      "type": "number",
      "default": 14,
      "allowed": { "kind": "number", "min": 8, "max": 72, "integer": true },
      "value": 18,                             // value AT THIS SCOPE, null when the layer doesn't override it
      "effective": 18,                         // value actually in force, across all layers
      "effectiveSource": "user",               // "workspace" | "user" | "default"
      "editableScopes": ["user", "workspace"],
      "capability": "pro.editor"               // present only when the setting declares one
    }
  ]
}
```

`allowed` is derived from the setting's declared `type` + `params`:

| `kind` | Setting type | Fields |
|--------|--------------|--------|
| `boolean` | `toggle` | -- |
| `enum` | `enum` | `values: [{ value, label }]` (labels translated) |
| `number` | `number` | `min?`, `max?`, `integer` |
| `text` | `text` | `maxLength?` |
| `theme` | `theme` | `values: [{ value, label, family }]` — the installed themes; empty when no `ThemeService` is running, in which case any id is accepted |
| `any` | a host-registered custom type | `valueType`: `string` \| `number` \| `boolean` |

Feature-gated settings whose flag is off are absent, exactly as they are absent from the settings page.

`capability` is reported for information only — these routes do NOT refuse a write to a capability-gated setting. `capability` names an entitlement in the HOST's plan system, which ECUI's main process knows nothing about (in the UI it is the renderer's `CapabilityGate` that greys the control). A host that gates paid features over MCP does it where it already owns that policy: the per-tool `McpToolGate`, installed with `setToolGate()`.

### `set_setting`

Sets one setting, validated against the `allowed` domain above. A refusal names the constraint and the accepted values; nothing is written.

```jsonc
{ "key": "appearance:theme", "value": "light/Default Light+" }   // scope optional
// Reply:
{
  "scope": "user",
  "key": "appearance:theme",
  "previous": null,
  "value": "light/Default Light+",
  "effective": "light/Default Light+",
  "effectiveSource": "user"
}
```

### `patch_settings`

Sets several settings together. Validation is **all-or-nothing**: every pair is checked first and, if any is refused, nothing is written and the reply lists every rejection — a partly-wrong patch never leaves the app half-updated.

```jsonc
{ "values": { "appearance:language": "fr", "appearance.editor:fontSize": 18 }, "scope": "user" }
// Reply:
{
  "scope": "user",
  "applied": 2,
  "settings": [
    { "key": "appearance:language", "value": "fr", "effective": "fr", "effectiveSource": "user" },
    { "key": "appearance.editor:fontSize", "value": 18, "effective": 18, "effectiveSource": "user" }
  ]
}
// On refusal (isError, nothing written):
{
  "scope": "user",
  "applied": 0,
  "rejected": [{ "key": "appearance:language", "error": "\"kl\" is not a valid value for \"appearance:language\". Allowed values: en, fr, …" }],
  "message": "Nothing was written — fix every rejected value and retry."
}
```

### `reset_setting`

Drops the value held at the requested scope so the setting falls back to the layer beneath — the user value for a workspace reset, the declared default for a user reset. Same effect as "Reset Setting" in the settings page gear menu.

```jsonc
{ "key": "appearance.editor:fontSize", "scope": "workspace" }
// Reply:
{ "scope": "workspace", "key": "appearance.editor:fontSize", "previous": 30, "value": null, "effective": 16, "effectiveSource": "user" }
```

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
- Optional bearer-token gate via `McpServiceOptions.authToken`. When set, requests without `Authorization: Bearer <token>` (or with a mismatched token) get a `401 Unauthorized` and never reach the JSON-RPC layer. When unset, no auth is enforced. Comparison is constant-time (`crypto.timingSafeEqual`) to avoid leaking the prefix-match length via response timing.

The token closes two attacks loopback alone leaves open:

1. **Other local processes** — any process on the same machine can POST to `http://127.0.0.1:<port>/` and call tools. Without a token, a rogue script gets full control over the user's app.
2. **CSRF from a browser tab** — a malicious site can issue `fetch('http://127.0.0.1:<port>/', { method: 'POST', mode: 'no-cors' })` and trigger mutations even though it can't read the response. The bearer header is blocked by CORS, so requiring it shuts the vector down.

The recommended propagation channel is "consuming app generates a per-process random token, writes it into a discovery file, the launcher reads it back and injects the header." See the restorm consumer (`restorm/src/main/index.ts`, which calls the discovery helpers above) + `scripts/mcp-launcher.mjs` for a worked example. The token rotates on every app restart — no persistent secret on disk.

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

## Testing

`electron-core-ui/testing` exports generic JSON-RPC-over-the-discovery-file helpers for driving an embedded `McpService` end-to-end the same way a real MCP client would — read the discovery file a launched host writes on boot, then call tools over Streamable HTTP:

```ts
import { readMcpDiscoveryWithRetry, callMcpToolOverJsonRpc, postMcpJsonRpc, type McpDiscovery } from 'electron-core-ui/testing'

// After launching the host with `--mcp-discovery-file=<path>` (or reading
// the default `os.tmpdir()/restorm-mcp/<pid>.json` location):
const discovery: McpDiscovery = await readMcpDiscoveryWithRetry(discoveryPath)

// `tools/call` convenience wrapper — throws on an MCP-level error reply:
const reply = await callMcpToolOverJsonRpc(discovery, 'screenshot', {})

// Raw JSON-RPC for anything that doesn't fit `tools/call` (e.g. `tools/list`):
const listReply = await postMcpJsonRpc(discovery, { method: 'tools/list' })
```

`postMcpJsonRpc` handles both the plain-JSON and SSE-framed (`event: message\ndata: …`) reply shapes the Streamable-HTTP transport can return, transparently. Consuming apps build their own Playwright fixture around these primitives (launch the host, resolve the discovery file, expose `callMcpTool`/`rawJsonRpc` as fixtures) — see restorm's `tests/e2e/bdd/fixtures/mcp-server.fixture.ts` for a worked example.
