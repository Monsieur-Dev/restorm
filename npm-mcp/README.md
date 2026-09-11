# restorm-mcp

Connect your AI assistant to your running [Restorm](https://restorm.app)
instance over the [Model Context Protocol](https://modelcontextprotocol.io).

`restorm-mcp` is a tiny, zero-dependency bridge between an MCP client that speaks
**stdio** (Claude Desktop, Cursor, Claude Code, …) and the **HTTP** MCP server
that every Restorm instance runs locally. It discovers the Restorm instance on
your machine automatically — you never copy a port or a token — and forwards
tool calls to it.

## Usage

Point your MCP client at it with `npx` (no install, always the latest):

```json
{
  "mcpServers": {
    "restorm": {
      "command": "npx",
      "args": ["-y", "restorm-mcp"]
    }
  }
}
```

Then launch Restorm (the embedded MCP server is on by default). The first time
your assistant calls a Restorm tool, the bridge finds the running instance and
forwards the call.

See the full guide — client-by-client configuration, prerequisites, and the
security model — at **<https://restorm.app/en/docs/outils/mcp>**.

## How it works

Restorm writes a per-instance discovery file (port + bearer token) to a
well-known directory; `restorm-mcp` reads it, injects the token, and proxies
JSON-RPC between your client's stdin/stdout and Restorm's HTTP endpoint. It
answers `initialize` / `tools/list` instantly from a built-in manifest so your
client starts fast without waiting for Restorm to boot, then serves the real,
live tool list once a call goes through.

> **Security:** connecting an AI to Restorm gives it full access to your
> Restorm tools (running requests, your project files, Pro tools). The
> discovery token is per-instance and readable only by your local user. Only
> connect assistants you trust. See the guide for details.

## Requirements

- Node.js ≥ 18 (for `npx`).
- A Restorm instance running with the MCP server enabled (the default).

`restorm-mcp` bundles no Restorm code — it is only the bridge. The exact same
launcher also ships inside the Restorm app (as a bundled resource) and can be
run directly; the npx package is the install-free way to get it.
