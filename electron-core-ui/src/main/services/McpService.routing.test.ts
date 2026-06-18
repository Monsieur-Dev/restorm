import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    off: vi.fn()
  },
  BrowserWindow: {
    getAllWindows: () => []
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn()
  }
}))

vi.mock('./LoggerService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import { z } from 'zod'
import { McpService, MCP_SESSION_ROUTING_KEY, MCP_FORWARDED_HEADER, type McpToolConfig } from './McpService'
import { writeMcpDiscoveryFile, cleanupMcpDiscoveryFile } from './mcpDiscovery'

interface ProbeResult { status: number; body: string }

/** Raw HTTP POST of one JSON-RPC payload, returning status + body. */
function post(port: number, payload: unknown, headers: Record<string, string> = {}): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          ...headers
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }) })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

interface RpcReply {
  result?: { content?: { text: string }[]; tools?: { name: string }[] }
  error?: { code: number; message: string }
}

/** Pull the JSON object off a streamable-HTTP `data:` line (or plain JSON). */
function parseRpc(body: string): RpcReply {
  const m = /^data: (.*)$/m.exec(body)
  const json = m?.[1] ?? body
  return JSON.parse(json) as RpcReply
}

/** Decode the JSON the echo tool embedded in its single text content part. */
function echoPayload(reply: RpcReply): { ranOn: string; args: Record<string, unknown> } {
  const text = reply.result?.content?.[0]?.text ?? '{}'
  return JSON.parse(text) as { ranOn: string; args: Record<string, unknown> }
}

describe('McpService cross-instance routing bridge', () => {
  // Both instances share one discovery dir; A resolves + forwards to B
  // entirely through the ECUI discovery+transport (no hand-rolled forwarder),
  // so this exercises the real bridge end-to-end. Synchronous path (mkdir'd
  // in beforeAll) so it can be passed at construction time.
  const DIR = join(tmpdir(), `ecui-mcp-routing-${String(process.pid)}`)

  // Instance B is the "peer". It registers a tool that echoes back its
  // own name + the args it received, so a test can prove which instance
  // actually executed the call and that the routing key was stripped. It
  // gates on a bearer token; the forward must present the token from B's
  // lockfile for the relay to succeed.
  const serviceB = new McpService({ sessionName: 'session-b', authToken: 'token-b', discoveryDir: DIR })
  let portB: number

  // Instance A is the entry point clients talk to. Given `sessionName` +
  // `discoveryDir`, the bridge resolves a `__session` peer in the dir and
  // forwards over loopback HTTP — all inside ECUI.
  const serviceA = new McpService({ sessionName: 'session-a', discoveryDir: DIR })
  let portA: number

  const echoTool = (label: string): [string, McpToolConfig, (args: Record<string, unknown>) => unknown] => [
    'echo',
    {
      titleKey: 'mcpToolTitles.echo',
      title: 'Echo',
      description: 'Echo received args + which instance ran.',
      // Declare `foo` so the SDK's Zod validation keeps it (an empty
      // schema would strip every arg). Crucially `__session` is NOT
      // declared — proving the bridge peels it off before validation,
      // since otherwise the strict object would reject the unknown key.
      inputSchema: { foo: z.string().optional() }
    },
    (args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify({ ranOn: label, args }) }]
    })
  ]

  beforeAll(async () => {
    await fs.mkdir(DIR, { recursive: true })
    serviceA.registerTool(...echoTool('A'))
    serviceB.registerTool(...echoTool('B'))
    await serviceA.start(0)
    await serviceB.start(0)
    const a = serviceA.getPort()
    const b = serviceB.getPort()
    if (a === null || b === null) throw new Error('failed to bind')
    portA = a
    portB = b
    // Publish B's lockfile so A's bridge can discover it by name and forward
    // with B's bearer token. (A needs no lockfile — nothing forwards to it.)
    await writeMcpDiscoveryFile(DIR, {
      port: portB,
      projectPath: null,
      pid: process.pid,
      startedAt: '2026-05-03T00:00:00.000Z',
      token: 'token-b',
      name: 'session-b'
    })
  })

  afterAll(async () => {
    await cleanupMcpDiscoveryFile(DIR, process.pid)
    await fs.rm(DIR, { recursive: true, force: true })
    await serviceA.stop()
    await serviceB.stop()
  })

  function callEcho(port: number, args: Record<string, unknown>, headers: Record<string, string> = {}): Promise<ProbeResult> {
    return post(port, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo', arguments: args } }, headers)
  }

  it('runs locally when no routing key is present (backward-compatible)', async () => {
    const r = await callEcho(portA, { foo: 'bar' })
    const text = echoPayload(parseRpc(r.body))
    expect(text.ranOn).toBe('A')
    expect(text.args).toEqual({ foo: 'bar' })
  })

  it('runs locally when the routing key names this instance, and strips the key', async () => {
    const r = await callEcho(portA, { foo: 'bar', [MCP_SESSION_ROUTING_KEY]: 'session-a' })
    const text = echoPayload(parseRpc(r.body))
    expect(text.ranOn).toBe('A')
    // The reserved key never reaches the tool handler.
    expect(text.args).toEqual({ foo: 'bar' })
    expect(MCP_SESSION_ROUTING_KEY in text.args).toBe(false)
  })

  it('forwards to the named peer and relays its response verbatim', async () => {
    const r = await callEcho(portA, { foo: 'bar', [MCP_SESSION_ROUTING_KEY]: 'session-b' })
    const text = echoPayload(parseRpc(r.body))
    // Executed on B, and B saw the key stripped (it stripped it itself).
    expect(text.ranOn).toBe('B')
    expect(text.args).toEqual({ foo: 'bar' })
  })

  it('answers a clean JSON-RPC error for an unknown / unreachable target', async () => {
    const r = await callEcho(portA, { [MCP_SESSION_ROUTING_KEY]: 'session-nope' })
    const rpc = parseRpc(r.body)
    expect(rpc.error).toBeDefined()
    expect(rpc.error?.code).toBe(-32001)
    expect(rpc.result).toBeUndefined()
  })

  it('does not re-forward a request that already crossed one hop (loop break)', async () => {
    // Same call that WOULD forward to B, but tagged as already-forwarded:
    // the bridge must run it locally (on A) instead of bouncing onward.
    const r = await callEcho(portA, { [MCP_SESSION_ROUTING_KEY]: 'session-b' }, { [MCP_FORWARDED_HEADER]: '1' })
    const text = echoPayload(parseRpc(r.body))
    expect(text.ranOn).toBe('A')
  })

  it('leaves non-tools/call methods untouched (tools/list works through the bridge)', async () => {
    const r = await post(portA, { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} })
    const tools = parseRpc(r.body).result?.tools ?? []
    expect(tools.some((t) => t.name === 'echo')).toBe(true)
  })
})
