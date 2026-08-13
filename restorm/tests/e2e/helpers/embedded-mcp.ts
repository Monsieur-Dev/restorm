import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Minimal JSON-RPC client for the app's EMBEDDED MCP server — the same
 * surface `scripts/mcp-launcher.mjs` forwards to. A launched (unpackaged)
 * instance writes a per-pid lockfile to `/tmp/restorm-mcp/<pid>.json` holding
 * the HTTP port + bearer token; tools answer plain JSON-RPC `tools/call`
 * POSTs without a session handshake.
 *
 * Driving the app through its MCP tools IS driving the app (the writes go
 * through the main-process collection store, repaint open editors, and
 * autosave) — it is the supported programmatic authoring surface, and far
 * more robust than scripting the type-picker UI for graph construction.
 */

export interface EmbeddedMcp {
  port: number
  token: string
}

/** Read the lockfile of the instance whose MAIN process has this pid. */
export function readEmbeddedMcpLock(pid: number): EmbeddedMcp {
  const file = join('/tmp/restorm-mcp', `${String(pid)}.json`)
  const lock = JSON.parse(readFileSync(file, 'utf-8')) as { port: number; token: string }
  return { port: lock.port, token: lock.token }
}

let rpcId = 1

/** Call one MCP tool and return its parsed JSON payload; throws on tool error. */
export async function callEmbeddedMcpTool<T = unknown>(mcp: EmbeddedMcp, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${String(mcp.port)}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcp.token}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } })
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`MCP ${name} → HTTP ${String(res.status)}: ${raw.slice(0, 300)}`)

  // The streamable-HTTP transport may answer as SSE — the JSON-RPC reply is
  // the last `data:` line; a plain JSON body is used otherwise.
  const dataLines = raw.split('\n').filter((l) => l.startsWith('data:'))
  const body = dataLines.length > 0 ? (dataLines[dataLines.length - 1] ?? '').slice(5).trim() : raw
  const parsed = JSON.parse(body) as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: { type: string; text?: string }[] }
  }
  if (parsed.error) throw new Error(`MCP ${name} → RPC error: ${parsed.error.message ?? 'unknown'}`)
  const text = parsed.result?.content?.find((c) => c.type === 'text')?.text ?? ''
  if (parsed.result?.isError === true) throw new Error(`MCP ${name} → tool error: ${text.slice(0, 500)}`)
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}
