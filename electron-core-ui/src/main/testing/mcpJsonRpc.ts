import { existsSync, readFileSync } from 'fs'

/**
 * Generic JSON-RPC-over-the-MCP-discovery-file test helpers — driving an
 * embedded `McpService` server end-to-end the same way a real MCP client
 * (Claude, Cursor, ...) would: read the discovery file the host writes on
 * boot (`port` + `token` + `pid`), then call tools over Streamable HTTP.
 * Zero project-specific logic — any electron-core-ui consumer embedding
 * `McpService` can drive it with these exact same primitives.
 */

export interface McpDiscovery {
  port: number
  token: string
  projectPath: string | null
  pid: number
  startedAt: string
}

export interface McpJsonRpcResponse {
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

export interface McpToolReply {
  content?: { type: string; text?: string }[]
  isError?: boolean
}

let nextRpcId = 1

/** Issue a raw JSON-RPC call against the discovered MCP server. Useful for
 * `tools/list` / `initialize` roundtrips that don't fit the `tools/call`
 * shape — `callMcpTool` below is the `tools/call` convenience wrapper. */
export async function postMcpJsonRpc(discovery: McpDiscovery, body: Record<string, unknown>): Promise<McpJsonRpcResponse> {
  // The MCP Streamable-HTTP transport accepts JSON-RPC over POST. The SDK
  // negotiates a session via headers; for a stateless server one request =
  // one response is fine. Accept both `application/json` and
  // `text/event-stream` so the SDK's negotiation doesn't 406.
  const url = `http://127.0.0.1:${String(discovery.port)}/mcp`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${discovery.token}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextRpcId++, ...body })
  })
  if (!response.ok) {
    throw new Error(`MCP HTTP error ${String(response.status)}: ${await response.text()}`)
  }
  // Streamable HTTP can reply as SSE-framed `event: message\ndata: …` or as
  // a single JSON object. Detect by content-type and parse the right shape
  // — the JSON-RPC envelope is the same either way.
  const ct = response.headers.get('content-type') ?? ''
  if (ct.includes('text/event-stream')) {
    const raw = await response.text()
    const dataLine = raw.split('\n').find((l) => l.startsWith('data:'))
    if (!dataLine) throw new Error(`MCP SSE reply had no data frame: ${raw.slice(0, 200)}`)
    return JSON.parse(dataLine.slice(5).trim()) as McpJsonRpcResponse
  }
  return await response.json() as McpJsonRpcResponse
}

/** Call an MCP tool over JSON-RPC (`tools/call`). Throws on an MCP-level
 * error reply so callers don't have to check `.error` on every call site;
 * returns the raw result envelope otherwise — callers assert on the
 * parsed text content. */
export async function callMcpToolOverJsonRpc(discovery: McpDiscovery, name: string, args: Record<string, unknown> = {}): Promise<McpToolReply> {
  const reply = await postMcpJsonRpc(discovery, {
    method: 'tools/call',
    params: { name, arguments: args }
  })
  if (reply.error) throw new Error(`MCP tool ${name} failed: ${reply.error.message}`)
  return (reply.result ?? {}) as McpToolReply
}

/** Poll for the discovery file a launched host writes on boot (`--mcp-
 * discovery-file=<path>` or the default `os.tmpdir()/restorm-mcp/<pid>.json`
 * location) — main-process boot finishes writing it asynchronously, so a
 * bare `existsSync` right after launch is a race. */
export async function readMcpDiscoveryWithRetry(path: string, timeoutMs = 15_000): Promise<McpDiscovery> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      if (existsSync(path)) {
        const raw = readFileSync(path, 'utf-8')
        const parsed = JSON.parse(raw) as McpDiscovery
        if (parsed.port && parsed.token) return parsed
      }
    } catch (err) {
      lastError = err
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out reading MCP discovery file at ${path}: ${String(lastError)}`)
}
