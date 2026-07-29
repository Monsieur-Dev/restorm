# MCP tools reference

This page lists every tool the Restorm MCP server exposes. Tools split across two layers:

- **Restorm-domain tools** (`restorm/src/main/mcp/tools/`) — read / navigate / mutate / execute the open project.
- **ECUI built-in tools** (`electron-core-ui/src/main/services/McpService.ts`) — generic dev tools that ship with every consumer of `McpService` (screenshot, evaluate, refresh, …). Useful for integration tests and ad-hoc debugging.

For the authoritative input schema of any tool, see the linked source file — the zod schemas there are the source of truth. This page is intentionally a tour rather than a verbatim copy.

## Read

Read-only tools that give the AI awareness of the open project. None mutate state.

| Tool | Summary |
|---|---|
| `list_folders` | List every folder, or the direct children of `parentId`. |
| `list_requests` | List every request, or the direct request children of `folderId`. |
| `get_request` | Full typed JSON of a request, with `PasswordValue` masked. |
| `search` | Typed search across folders / requests / environments via the in-memory index. `kinds` filter + `maxResults` cap. |
| `get_active_env` | Active env-folder selection + resolved Handlebars variables. |
| `get_current_tab` | `{ tabId, itemId, kind }` for the active workbench tab. |
| `list_value_sources` | List the registered secret value sources a `{ type: "secret", source, params }` value can reference (`{ id, label, canWrite, isObject, params }`). The plaintext is resolved main-side at run time and is never returned. |

Source: [`restorm/src/main/mcp/tools/read.ts`](../../src/main/mcp/tools/read.ts).

## Navigation

Tools that focus the UI on a specific item — useful when the AI wants the user's attention on a particular tree row or workbench tab.

| Tool | Summary |
|---|---|
| `open_tab` | Open (or focus) the workbench tab for `{ itemId, kind }`. Same effect as the user double-clicking the sidebar row. |
| `reveal_in_tree` | Expand the sidebar tree to make `itemId` visible + flash a highlight. |
| `close_tab` | Close the workbench tab for `itemId`. No-op if the tab isn't open. |

Source: [`restorm/src/main/mcp/tools/navigation.ts`](../../src/main/mcp/tools/navigation.ts).

## Project

Lifecycle tools for the .restorm file itself.

| Tool | Summary |
|---|---|
| `create_project` | Create a new empty .restorm file at the given absolute path and open it. Format defaults to YAML. |
| `open_project` | Open an existing .restorm file or folder. Triggers the same `file:opened` flow as the File menu. |
| `save_project` | Trigger the autosave pipeline so any pending mutations land on disk. |

Source: [`restorm/src/main/mcp/tools/project.ts`](../../src/main/mcp/tools/project.ts).

## Write

Mutate the open project. Every write goes through `CollectionStore`, fires the standard PubSub / EventBus events, and triggers the renderer's autosave path so the change persists.

| Tool | Summary |
|---|---|
| `create_folder` | Create a folder under `parentId` (root env-folder when `parentId` is omitted). |
| `create_request` | Create a bare request of a given protocol (HTTP / GraphQL / gRPC / SOAP / WebSocket / OData / auth). Fill it in with `update_request`. |
| `rename_item` | Update the `name` of a folder, env-folder, or request. |
| `delete_item` | Delete a folder / env-folder / request. Folder deletes cascade. |
| `update_request` | Apply an arbitrary patch (URL / method / body / notes / headers / params / pathParams / metadata / tags / …). KV arrays are reified per-element so row identity is preserved in open tabs. |
| `update_folder` | Same shape for folders + env-folders. |
| `set_favorite` | Toggle (or set explicit `true` / `false`) the favourite flag on any item kind. |

Source: [`restorm/src/main/mcp/tools/write.ts`](../../src/main/mcp/tools/write.ts).

### `update_request` patch fields

The full patch surface mirrors the request shape. Useful keys:

- `url`, `method`, `notes`, `tags`, `metadata`
- `headers`, `params`, `pathParams` — array of `{ key, value, description?, enabled? }`
- `body` — `{ type: 'text'|'file'|'form-data'|'x-www-form-urlencoded', content?, path?, fields? }`
- Protocol-specific fields (e.g. `query` / `variables` for GraphQL, `service` / `rpcMethod` for gRPC, `soapAction` for SOAP, `event` / `protocol` for WebSocket)

The server strips `id` and `type` from the patch before applying it (those are immutable per request).

## Environments & secrets

Manage the environment tree of an env-folder and the variables each environment ships. Every write triggers the autosave path. Secret variables persist only `{ type: "secret", source, params }` — the resolved plaintext is produced main-side at run time and is never written to disk or returned to a client.

| Tool | Summary |
|---|---|
| `list_environments` | Return the environment tree of an env-folder: every top-level environment with its nested `subEnvironments`, each as `{ id, name, subEnvironments? }`. |
| `create_environment` | Add a new environment to an env-folder. Omit `parentEnvironmentId` for a top-level environment, or pass an existing environment id to nest the new one under it. |
| `rename_environment` | Rename an environment (or sub-environment) by id. |
| `update_environment` | Patch one or more of `name` / `icon` / `color` on an environment (or sub-environment) by id. Every field is optional; only the fields passed are changed. `icon` is `{ type, value }` (`type` one of `emoji`/`codicon`/`iconoir`/`phosphor`/`material`/`simpleicons`/`feather`/`fontawesome`/`none`); `color` is a hex string (e.g. `"#ff6600"`). Invalid values are rejected, not silently persisted. |
| `delete_environment` | Remove an environment and, recursively, its sub-environments by id. Returns `removed: false` when the id isn't found. |
| `refresh_environment` | Force a re-resolution of every secret variable the environment **owns**: drops the resolution cache, blanks the resolved plaintext, and re-fetches from each provider. The renderer's spinner / error badges update from the broadcast status. |
| `list_env_variables` | Return every key + serialised value for the given environment. Secret values come back as `{ type: "secret", source, params }` — never the plaintext. |
| `set_env_variable` | Upsert one variable on an environment (replaces by key, keeping the id; appends otherwise). `value` takes the persisted `ValueType` POJO — `{ type: "string"\|"expression"\|"numeric"\|"boolean"\|"color"\|"datetime", value }`, or `{ type: "secret", source: "<sourceId>", params: { … } }` for a secret. |
| `delete_env_variable` | Remove a variable by key from an environment. No-op (`removed: false`) when the key isn't present. |

Pair these with [`list_value_sources`](#read) to discover the available `source` ids and their param shape before writing a secret variable.

Source: [`restorm/src/main/mcp/tools/write.ts`](../../src/main/mcp/tools/write.ts).

## Import

| Tool | Summary |
|---|---|
| `import_from_url` | Fetch a Swagger / OpenAPI / GraphQL SDL / Postman / Bruno / curl spec from a URL and commit it into the open project. With `parentFolderId`, nests the imports under that folder; without, appends as a root collection. Optional `headers` map can pass auth headers (e.g. `Authorization: Bearer <token>`) to the spec endpoint. |

The tool fires `ENVIRONMENT_CREATED` for every imported environment so `ContextService` loads the variables before any subsequent `run_request` resolves Handlebars.

### `import_from_url` parameters

- `url` (required): HTTP(S) URL of the spec to import.
- `parentFolderId` (optional): Folder id to nest the imported items under. Omit to import as root collections.
- `headers` (optional): HTTP headers map to pass with the spec fetch. Useful for gated specs that require authentication (e.g. `{ "Authorization": "Bearer <token>" }`). The import fetch's diagnostic log redacts Authorization/Cookie header values.

Source: [`restorm/src/main/mcp/tools/import.ts`](../../src/main/mcp/tools/import.ts).

## Execute

I/O tools — the AI can ping endpoints and read responses.

| Tool | Summary |
|---|---|
| `run_request` | Execute a request and return the structured response. Unary protocols (HTTP / OData / GraphQL / SOAP / gRPC) return `{ status, statusText, headers, body, durationMs, protocol, error? }` with JSON bodies parsed in-place. Streaming (WebSocket) returns the first frames + a `continuationToken`. |
| `cancel_request` | Abort the in-flight execution. Routes to the matching execution service per protocol. Safe to call when nothing is in flight (returns `cancelled: false`). |
| `run_request_batch` | Sequential `run_request` over an array of ids. Preserves input order, partial-on-unknown (returns the partial array + an error envelope). Not to be confused with the generic [`batch`](#batch) tool. |
| `read_stream` | Pull more frames from a streaming request started by `run_request`. Pass the `continuationToken`; returns the next slice + a fresh token. `done: true` when the connection closed. `cursorReset: true` if the buffer was rebuilt mid-session and the cursor overshot. |
| `get_response_history` | Lightweight summary of stored responses for a request: `[{ guid, requestId, status, durationMs, executedAt, protocol, pinned }]`. |
| `get_response` | Full payload of a stored response. Already redacted by `ResponseHistoryService` when the project's "redact secrets" setting is on (default on). |

Source: [`restorm/src/main/mcp/tools/execute.ts`](../../src/main/mcp/tools/execute.ts).

### How `run_request` actually runs

For unary protocols, the tool delegates to the renderer's Send-button flow:

1. Broadcasts `mcp:open-tab` so the request tab is open + active in the workbench.
2. Broadcasts `mcp:run-request`. The renderer-side `useMcpRunRequest` hook clicks the protocol's Send/Connect button.
3. The Send handler runs the same IPC + execution-service path as a real user click. The response panel + history panel populate naturally.
4. Main polls `responseHistoryService.list(requestId)` until a new entry lands, reads its detail, returns the structured shape.

For WebSocket, the tool returns immediately with the first frames buffered + a `continuationToken`. The MCP channel stays responsive; the AI pulls subsequent frames via `read_stream`.

## Instances (multi-instance lifecycle)

Multiple Restorm instances coexist; each exposes its own MCP endpoint and is addressed by session `name` via the reserved `__session` key on any `tools/call`. These tools manage the set of instances. See [the safety model](./safety.md#instance-lifecycle-create--terminate--cut) for the full rationale.

| Tool | Summary |
|---|---|
| `list-instances` | Return every instance that **accepts MCP**, each with the open `fileName` (basename, when any), full `projectPath`, session `name`, `pid`, and `endpoint`. Instances on which the user has **cut** MCP are excluded — they refuse commands and are unroutable. (ECUI built-in.) |
| `create_instance` | Explicitly launch a NEW MCP-accepting instance, optionally opening `file` and/or with an explicit `name`. The launcher never auto-spawns, so this is how you get one. **Refused** if another instance (MCP-active OR cut) already has that `name`, or already has that `file` open — one instance per file. |
| `terminate_instance` | Close an instance with **File→Quit semantics** — never a pid-kill. Target via `__session`; omit to terminate the connected one. Autosave on / nothing dirty → closes now. Autosave off + dirty → pass `save: true` (save then close) or `save: false` (discard then close); **omit `save`** to show the user the save-confirmation modal and return **non-blocking** (`"awaiting user confirmation"`). |

Source: [`restorm/src/main/mcp/tools/instances.ts`](../../src/main/mcp/tools/instances.ts), decision logic in [`restorm/src/main/mcp/instanceLifecycle.ts`](../../src/main/mcp/instanceLifecycle.ts).

## ECUI built-in tools

These ship with every `McpService` consumer (Restorm + the demo app). Documented in detail at [`electron-core-ui/docs/McpService/README.md`](../../../electron-core-ui/docs/McpService/README.md).

| Tool | Summary |
|---|---|
| `screenshot` | Capture a PNG of the active window (or the named one). Returns base64 + a metadata block. |
| `refresh` | Reload the renderer (`webContents.reload()`). |
| `dom-query` | Run `document.querySelectorAll(selector)` and return shape info per match. |
| `console-logs` | Snapshot the in-memory log buffer the service collects from every renderer. |
| `dispatch-event` | Synthesise a real DOM event on a CSS-selected target. Picks the right Event constructor by event type. |
| `type-text` | Drive `keydown` / `keypress` / `keyup` against the focused element with character timing. |
| `evaluate` | Power-tool escape hatch: run a JS expression in the active renderer's main world. |
| `keyboard-shortcut` | Synthesise a keyboard chord (`Ctrl+S` etc.) at the document level. |
| `inject-css` | Mount a `<style>` tag in the active renderer with the given CSS text. |
| `get-computed-style` | Return the resolved CSS for a queried element. |
| `scroll-into-view` | Scroll an element into view, optionally aligned. |
| `wait` | Sleep for N ms inside the renderer. |
| `wait-for` | Poll a selector / predicate until it matches or times out. |
| `storage` | Read / write `localStorage` / `sessionStorage`. |
| `get-windows` | List all open BrowserWindows + their main bounds. |
| `window-info` | Return geometry + dom-ready / load timing for a target window. |
| `devtools` | Open the renderer's devtools panel. |
| `drag-drop` | Synthesise a full drag-and-drop sequence between two CSS selectors. |
| `exit` | Quit Restorm — useful for end-of-test cleanup. |
| `list-instances` | List every MCP-accepting instance (open `fileName`, `projectPath`, `name`, `pid`, `endpoint`). See [Instances](#instances-multi-instance-lifecycle). |
| `list_themes` | List all available color themes with their `id`, `name`, and `family` (`dark`/`light`/`hcDark`/`hcLight`). |
| `get_current_theme` | Return the `id`, `name`, and `family` of the currently active color theme. |
| `get_settings` | List every application setting at a `scope` (`user`, the default, or `workspace`), each with its current value, its accepted values (type / enum members / numeric range) and a description of what it does. Optional `query` filter. |
| `set_setting` | Set one setting by `key`, validated against its accepted values. Applies live — this is how the theme and the UI language are changed. |
| `patch_settings` | Set several settings at once from a `values` object. All-or-nothing: one invalid value refuses the whole batch and lists every rejection. |
| `reset_setting` | Drop a setting's value at a `scope` so it falls back to the layer beneath (workspace → user → default). |

These are intentionally generic. Restorm's domain tools layer above them, but the AI can drop down to these for ad-hoc work that the domain tools don't cover.

The settings routes are dynamic: they enumerate the same registry that builds the Settings page — electron-core-ui's own settings plus the ones Restorm registers in `resources/settings.yaml` — so a setting added there is readable and writable over MCP with no further work. Both scopes are covered: `user` is the global layer, `workspace` is the per-project overlay in `<project>/.restorm/settings.json` (available only while a project is open, and never for a `userOnly` setting such as the UI language). Full request / reply shapes are in the [electron-core-ui McpService doc](../../../electron-core-ui/docs/McpService/README.md#settings-routes).

## Error envelope

Every tool returns the standard MCP `CallToolResult` shape:

```jsonc
{
  "content": [{ "type": "text", "text": "<JSON or error message>" }],
  "isError": true        // present only on failure
}
```

Restorm-domain tools serialise their result as JSON inside the `text` field. On failure, `isError: true` is set and `text` carries a human-readable diagnostic — never a stack trace, never a secret. The full inventory of error paths per tool is in the unit-test files (`<tool>.test.ts` next to each implementation file).
