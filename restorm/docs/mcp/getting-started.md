# Getting started with the Restorm MCP server

This page walks through the smallest path from "fresh checkout" to "Claude Code can run a real request via Restorm".

## 1. Enable the MCP server

The server is **off by default**. Two ways to switch it on:

```bash
# CLI flag (preferred for one-off / dev runs)
restorm --mcp

# or environment variable (preferred for shell wrappers)
ECUI_MCP=1 restorm
```

Either flag tells Restorm to:

- Pick a free OS-assigned port at boot (no hardcoded ports → multiple Restorm instances coexist).
- Generate a per-process bearer token.
- Write a discovery file at `os.tmpdir()/restorm-mcp/<pid>.json` with `{port, token, projectPath, pid, startedAt}`.
- Start a stateless JSON-RPC HTTP server on `127.0.0.1:<port>` (loopback only).

The status bar shows an MCP indicator that pulses on every incoming request — a quick way to confirm the server is up and being talked to.

## 2. Pick a transport

You have two options, depending on whether you want the AI to spawn Restorm or to talk to one you already have running.

### Option A — Launcher (recommended)

`scripts/mcp-launcher.mjs` (in this repo) is a stdio↔HTTP proxy designed for Claude Code / Cursor. It does three things:

1. Answers `initialize` and `tools/list` from a small built-in manifest at session start, so the client never blocks on a missing Restorm.
2. On the first `tools/call`, probes the discovery directory for a live Restorm. If none is running, spawns `pnpm dev:restorm -- --mcp` detached, waits for the port to open, then forwards the call.
3. Reads the discovery file to recover `port + token`, injects `Authorization: Bearer <token>` on every forwarded HTTP request, and emits `notifications/tools/list_changed` whenever it (re)connects to a fresh restorm instance.

Result: the user never thinks about ports or tokens.

#### Claude Code config

`.claude/settings.json` (project-scoped) or `~/.claude/settings.json` (global):

```jsonc
{
  "mcpServers": {
    "restorm": {
      "command": "node",
      "args": ["scripts/mcp-launcher.mjs"]
    }
  }
}
```

The repo also ships a top-level `.mcp.json` with the same content, picked up by Claude Code automatically when you `cd` into the repo.

#### Cursor config

`~/.cursor/mcp.json` (or `.cursor/mcp.json` per-project):

```json
{
  "mcpServers": {
    "restorm": {
      "command": "node",
      "args": ["/absolute/path/to/restorm-checkout/scripts/mcp-launcher.mjs"]
    }
  }
}
```

Cursor needs the absolute path because it doesn't resolve `args` relative to the workspace root the way Claude Code does.

### Option B — Direct HTTP (advanced)

If you want to skip the launcher and have your client talk JSON-RPC directly:

1. Boot Restorm with `--mcp`.
2. Read `os.tmpdir()/restorm-mcp/<pid>.json` and grab `port` + `token`.
3. POST JSON-RPC 2.0 to `http://127.0.0.1:<port>/mcp` with header `Authorization: Bearer <token>` and `Accept: application/json, text/event-stream`.

Example with `curl`:

```bash
PID=$(ls $TMPDIR/restorm-mcp/ | head -1 | sed 's/.json//')
ENTRY="$TMPDIR/restorm-mcp/$PID.json"
PORT=$(jq -r .port "$ENTRY")
TOKEN=$(jq -r .token "$ENTRY")

curl -s "http://127.0.0.1:$PORT/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "0" }
    }
  }'
```

Most MCP clients have a built-in HTTP / SSE transport that takes a URL + headers — feed it the same URL + `Authorization` and it negotiates the rest.

## 3. First call

Once the client is connected, ask it to:

```
List the folders in my Restorm project.
```

Behind the scenes this resolves to a `tools/call` with `name: list_folders`. The tool reads the in-memory `CollectionStore` and returns a JSON array.

If the project is empty, ask:

```
Create a project at /tmp/mcp-demo.restorm and import https://petstore.swagger.io/v2/swagger.json into it.
```

This chains `create_project` → `import_from_url` and you'll see the tree appear in Restorm's sidebar in real time. Nothing in the GUI distinguishes "user did this" from "AI did this" beyond the MCP status-bar indicator.

## 4. Run a request

```
Run the "Find pet by ID" request.
```

The `run_request` tool dispatches the request via the same code path the user's Send button uses — so the response panel populates exactly as if the user had clicked Send themselves. The structured response (status + headers + parsed body + duration) comes back to the AI, and a history entry lands as usual.

## 5. Disable when you're done

```bash
# stop the running Restorm
pkill -f 'restorm.*--mcp'

# discovery file is auto-cleaned on graceful exit, but a SIGKILL leaves
# a stale entry — safe to delete by hand:
rm -f $TMPDIR/restorm-mcp/*.json
```

The launcher tolerates stale entries: it probes `process.kill(pid, 0)` before forwarding and falls back to a fresh spawn when no live instance answers.

## See also

- [tools-reference.md](./tools-reference.md) — full tool list with inputs / outputs
- [resources-reference.md](./resources-reference.md) — `restorm://*` URI scheme
- [safety.md](./safety.md) — security model + secret handling
- [runbook.md](./runbook.md) — diagnose connection failures
