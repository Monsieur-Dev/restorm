# MCP runbook

A short operational guide: how to enable the MCP server, diagnose connection failures, stop it, and what's known not to work yet.

## Enable / disable

MCP is **on by default** — just `restorm` boots with the listener. There is no CLI flag or env var; it is governed by:

- **Setting (persistent):** Settings → MCP → "Enable MCP server" (default ON). Turn it off to keep MCP off across launches.
- **Headless rule:** on a host with no usable display (no `DISPLAY`/`WAYLAND_DISPLAY`, e.g. a bare CI box) MCP never starts, whatever the setting says. A virtual display (xvfb) counts as a display, so MCP stays on there.
- **Runtime stop/resume:** the status-bar MCP indicator's stop/resume button cuts/resumes the server for the current session only — it does NOT change the persistent setting.

Per-instance state lives in `os.tmpdir()/restorm-mcp/<pid>.json`. The file is written when the listener binds and removed on graceful shutdown. SIGKILL leaves the file behind but launchers ignore stale entries (they probe `process.kill(pid, 0)`).

## Diagnose connection failures

### Symptom: client says "MCP server not responding"

1. **Confirm Restorm has MCP enabled.** The status bar shows the MCP icon when it's enabled; absence = not enabled (the setting is off, the host is headless, or it was stopped at runtime).
2. **Check the discovery dir:** `ls $TMPDIR/restorm-mcp/`. There must be at least one `<pid>.json` file. Empty dir → Restorm didn't write one (boot crashed, MCP was disabled via the setting / headless rule, or permissions blocked the write).
3. **Probe the port directly:**

   ```bash
   PID=$(ls $TMPDIR/restorm-mcp/ | head -1 | sed 's/.json//')
   PORT=$(jq -r .port "$TMPDIR/restorm-mcp/$PID.json")
   nc -zv 127.0.0.1 $PORT
   ```

   Expected: `Connection to 127.0.0.1 <port> port [tcp/*] succeeded!`. If `Connection refused`, Restorm crashed without removing the lockfile — delete it:

   ```bash
   rm $TMPDIR/restorm-mcp/$PID.json
   ```

### Symptom: client says "401 Unauthorized"

The token in the discovery file is per-process. If you copy a config that hardcodes a stale token (Option B in [getting-started.md](./getting-started.md)), it stops working after the next Restorm boot. Re-read the discovery file after every boot.

The launcher (Option A) reads the token fresh on every forwarded request, so it self-heals across boots.

### Symptom: tool call hangs for 30s then errors with `TIMEOUT`

`run_request` waits up to 30s for a new entry to land in the response history. Causes:

- The renderer's request tab didn't open. Check that `mcp:open-tab` was broadcast (logs around the time of the call). The MCP launcher sets `enabled: mcpEnabled` in the renderer hook tree — if the renderer didn't fetch the runtime config in time, the listener isn't registered. Reload the renderer (`Ctrl+R`) and retry.
- The Send-button click missed its target (multi-window setup, hidden tab). Bump `timeoutMs` on the call: `run_request({ id, timeoutMs: 60000 })`.
- The target server is slow / unreachable. Check the request manually in the UI.

### Symptom: tool call returns "Invalid URL: /pet/0"

The request's URL contains a `{{baseUrl}}` Handlebars variable that wasn't expanded. Causes:

- `ContextService` doesn't know about the env yet because the env wasn't loaded at boot. Cycle the env-folder selection in the UI to trigger a fresh `ENVIRONMENT_UPDATED`.
- `import_from_url` was called but `ENVIRONMENT_CREATED` didn't fire. Bug — file an issue with the import URL + the resulting tree.

### Symptom: launcher spawns Restorm but it never appears

The launcher detaches the Restorm process so the GUI keeps running after the launcher exits. Some shells or display managers don't surface detached GUIs. Check `pgrep -fa restorm` — if Restorm is running but invisible, it's a window-manager issue, not an MCP issue.

## Stop the MCP server

```bash
# graceful: quit Restorm (Cmd+Q / Ctrl+Q / window close)
# the discovery file is removed in the `before-quit` handler

# force-kill: leaves a stale discovery file
pkill -f restorm
rm -f $TMPDIR/restorm-mcp/*.json
```

## Reset everything

When in doubt:

```bash
pkill -f restorm
rm -rf $TMPDIR/restorm-mcp/
# restart Restorm (MCP is on by default)
```

Brutal but reliable.

## Known limitations (v1)

- **Single user.** No multi-tenant story. The bearer token gates one running Restorm against one user's launcher chain.
- **Local only.** Loopback bind by design. Remote MCP support would need a separate ticket with an explicit threat model.
- **Bearer-only auth on HTTP.** No OAuth flow, no per-client identity, no audit trail of which client did what.
- **gRPC streaming is a placeholder.** The current `GRPCExecutionService` doesn't speak real gRPC — `run_request` returns `UNIMPLEMENTED` for `grpc` requests until a real grpc-js integration lands.
- **WebSocket buffer isn't replayed across reconnects.** If a WS connection drops mid-stream and the server reconnects, `read_stream` flips `cursorReset: true` and starts again from index 0 of the new buffer. The AI is responsible for diffing if it needs to detect lost frames.
- **Run-batch has no top-level deadline.** A batch with several timeouts can pin the MCP channel for `n × timeoutMs`. Pass per-call `timeoutMs` to bound it.
- **No per-tool confirmation modal at the Restorm side.** The MCP client owns the approval flow. See [safety.md](./safety.md) for rationale.
- **Screencast MP4 needs a system `ffmpeg` (optional).** `screencast-stop` remuxes the recorded WebM into a seekable MP4 (correct duration, plays/seeks everywhere) via `ffmpeg` if one is on `PATH`. Restorm does **not** bundle ffmpeg, so when it's absent the tool falls back to serving the raw WebM — still viewable, but the `<video>` duration only self-corrects as it buffers. Install ffmpeg (`apt install ffmpeg`, `brew install ffmpeg`, …) for the cleaner MP4.

These are known limitations for v1 — none are blockers, follow-up work is scoped separately.

## Where to look when filing an issue

- The discovery file (`<TMPDIR>/restorm-mcp/<pid>.json`) — port, token, projectPath, pid, startedAt
- Restorm's renderer console (Devtools → Console)
- The main-process log (location depends on platform; the `appData/restorm/logs/` dir is the usual)
- The MCP client's transport log (Claude Code: `~/.claude/logs/mcp.log`; Cursor: per-config)

A failing tool call's full payload (input + result + isError) makes triage drastically faster than a screenshot of the chat — paste it into the issue.
