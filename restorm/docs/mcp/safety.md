# MCP safety model

This page documents what an AI client connected to Restorm via MCP can and can't do, where the trust boundaries are, and how secrets stay protected.

## Network boundary

The MCP HTTP server binds **`127.0.0.1` only**. Defence in depth: even though the listener never appears on a non-loopback interface, the request handler explicitly rejects every non-loopback caller with `403 Forbidden` before any tool runs. A misconfigured proxy or future binding regression can't accidentally open the surface.

## Authentication

Every request must carry `Authorization: Bearer <token>` matching the per-process token written to the discovery file. The compare is constant-time so a malicious local process can't extract the token by timing oracle.

The token is generated fresh on every Restorm boot, written to `os.tmpdir()/restorm-mcp/<pid>.json`, and disappears with the process. A new boot = a new token.

The launcher reads the token from the discovery file and injects it on every forwarded request. The user never sees it; the AI client never holds it.

## What the AI can do

When the user authorises a `tools/call`, the AI gets to:

1. **Read project state** (`list_*`, `get_*`, `search`, `restorm://*` resources). Returns serialised data with `PasswordValue` masked.
2. **Mutate the project** (`create_*`, `update_*`, `rename_*`, `delete_*`, `set_favorite`, `import_from_url`). Goes through `CollectionStore` exactly the same way the GUI does — drafts, dirty state, autosave, GraphQL subscriptions all work identically.
3. **Execute requests** (`run_request`, `run_request_batch`, `read_stream`). Performs **real** HTTP / GraphQL / SOAP / gRPC / WebSocket calls to whatever target the request points at.
4. **Drive the UI** (`open_tab`, `reveal_in_tree`, `close_tab`, plus the ECUI built-ins like `screenshot` / `dispatch-event` / `evaluate`). Useful for E2E harnesses; the user sees every change live.

## What the AI cannot do

- **Open the network port.** `--mcp` is the only switch and the user owns it.
- **Skip the bearer-token check.** No tool short-circuits it — the gate is in `McpService.handleRequest` before any tool dispatch.
- **Reach files outside the open project.** The mutation tools take ids resolved against the open `CollectionStore`. There's no `read_file(path)` / `write_file(path)` general-purpose escape hatch.
- **Read plaintext secrets.** `PasswordValue` and `SecretValue` shape go through `CollectionStore.serialize*` on the way out and become `{ "type": "password" }`. Same masking applies to `restorm://request/{id}` and to history payloads when the project's "redact secrets" toggle is on (default on).
- **Persist a token across reboots.** Each boot mints a fresh token and writes a fresh discovery file.

## Approval flow

Restorm itself does **not** show an extra confirmation modal per tool call. The MCP **client** is the gate: Claude Code and Cursor both prompt the user before running a `tools/call`, with the tool name, arguments, and a quick summary. The user's "approve once" / "approve for the session" / "deny" choice is the trust decision.

This is the standard MCP convention (Q4 = A in the design doc): server tools are trusted-when-called; the client is responsible for surfacing approval. Putting the prompt in two places leads to confirmation fatigue and worse safety in practice.

If you want a per-tool **confirmation policy** at the Restorm side, the right shape is a settings toggle that gates the `handleRequest` function — none ships in v1; tracked as a follow-up if real-world usage shows it's needed.

## Network effects

- `run_request` performs real I/O. POST / DELETE / mutations all reach the target server. The only way to make a request "dry" is to point it at a mock server.
- `import_from_url` performs a real HTTP fetch of the spec URL. Same caveats — point at trusted hosts.
- Read tools (`list_*`, `get_*`, etc.) have no network side effect.

## Logs

The MCP request handler writes a single info line per inbound HTTP request (loopback rejection / auth failure / OK), then dispatches. Tool internals log at `info` / `debug` per the existing `electron-core-ui` `logger`. Logs do **not** contain the bearer token, request bodies, or response bodies. They name the tool that ran and its outcome.

If you turn on `LOG_LEVEL=debug` for diagnostic work, treat the resulting log file as you would any local debug log — wipe it before sharing.

## Threat model summary

| Threat | Mitigation |
|---|---|
| Remote attacker reaches the MCP port | Loopback-only bind + 403 on non-loopback |
| Other local process probes the port | Bearer-token gate, constant-time compare, per-process token |
| Browser-tab CSRF against the local port | Bearer-token gate (browser can't read the discovery file) |
| AI extracts plaintext secrets from a request payload | `CollectionStore.serialize*` masks `PasswordValue` before the handler returns |
| AI extracts plaintext secrets from a stored response | `ResponseHistoryService` redaction (default on) covers headers + body |
| AI runs destructive operations without user awareness | MCP-client approval flow prompts on every `tools/call` |
| AI launches Restorm without user consent | The launcher only spawns Restorm on the first forwarded `tools/call` — i.e. after the user approved a tool |
| Stale discovery file from a SIGKILLed Restorm | Launcher probes `process.kill(pid, 0)` before forwarding; ignores dead entries |

If you spot a class of threat that's not covered, file an issue — defence in depth is cheap to add and we'd rather extend this list than discover gaps in production.
