# Restorm MCP

Restorm ships an embedded **Model Context Protocol** (MCP) server. When enabled, AI assistants like Claude Code or Cursor can drive Restorm directly: open a project, import a swagger, edit a request, run it, and read the response — all without the user touching the GUI. The user still sees every change live in the workbench.

The server is **opt-in**, listens on **loopback only**, and gates every request behind a per-process **bearer token**. There is no remote attack surface.

## What an AI client can do

- Inspect the open project (folders, requests, environments, current tab, search index)
- Create, rename, delete, move folders and requests
- Update any request field (URL, method, body, headers, params, path-params, tags, notes…)
- Update folders + env-folders the same way
- Toggle favourites
- Import a Swagger / OpenAPI / GraphQL SDL / Postman / Bruno / curl spec from a URL
- Execute requests (HTTP / OData / GraphQL / SOAP / gRPC, plus WebSocket streaming) and read responses
- Pull the response history for any request (already-redacted)
- Take a screenshot of the workbench
- Open / close / reveal items in the sidebar tree

The full inventory lives in [tools-reference.md](./tools-reference.md) and [resources-reference.md](./resources-reference.md).

## Quickstart

1. Launch Restorm with `--mcp` (or set `ECUI_MCP=1`) — see [getting-started.md](./getting-started.md).
2. Point your MCP client at the launcher script that ships in this repo (`scripts/mcp-launcher.mjs`) — Claude Code config:

   ```json
   {
     "mcpServers": {
       "restorm": {
         "command": "node",
         "args": ["scripts/mcp-launcher.mjs"]
       }
     }
   }
   ```

3. The launcher reads the discovery file, injects the bearer token, and forwards JSON-RPC. Your client just sees a `restorm` server with the full tool surface.

## Security model

- **Loopback only.** The HTTP listener binds `127.0.0.1` and rejects every non-loopback caller with `403 Forbidden` before any handler runs.
- **Bearer token.** Every request needs `Authorization: Bearer <token>` matching the per-process token written to the discovery file (`os.tmpdir()/restorm-mcp/<pid>.json`). The launcher reads it and injects it transparently. A constant-time string compare protects against timing oracles.
- **Off by default.** Without `--mcp` (or `ECUI_MCP=1`), the HTTP server never starts. The discovery file is never written.
- **Secrets stay redacted.** `get_request` strips `PasswordValue` fields via `CollectionStore.serializeRequest`. `get_response` and `get_response_history` go through `ResponseHistoryService`, which honours the project's "redact secrets in response history" toggle (default on). The AI never sees plaintext credentials even if the live response carried them.
- **Real network effects.** `run_request` performs real HTTP / GraphQL / SOAP / etc. calls against whatever target the request points at. The MCP client's approval flow is the gate; Restorm itself does not show an extra confirmation modal. See [safety.md](./safety.md).

## Doc map

- [getting-started.md](./getting-started.md) — enable the server, pick a transport, copy a client config snippet
- [tools-reference.md](./tools-reference.md) — every tool with its inputs, outputs, error paths
- [resources-reference.md](./resources-reference.md) — every `restorm://*` resource the server exposes
- [safety.md](./safety.md) — approvals, secrets, network effects, what the AI can and can't do
- [runbook.md](./runbook.md) — enable, diagnose connection failures, stop the server, known limits

## Contributing

Tools live under `restorm/src/main/mcp/tools/`. Resources are in `restorm/src/main/mcp/resources.ts`. The server itself is the generic [`McpService`](../../../electron-core-ui/docs/McpService/README.md) from `electron-core-ui` — Restorm only registers the domain tools on top of it.

To add a tool, mirror an existing one (`read.ts` for read-only / `write.ts` for mutations / `execute.ts` for I/O), wire it into `restorm/src/main/mcp/index.ts`, write unit tests against the same `FakeMcpService` pattern those files use, and add a row to [tools-reference.md](./tools-reference.md). The new tool surfaces in the next session — `notifications/tools/list_changed` is emitted automatically when Restorm boots so the launcher reloads cached tool lists.
