import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { createServer, type Server } from 'node:http'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { on: vi.fn(), off: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  protocol: { handle: vi.fn() },
  net: { fetch: vi.fn() }
}))
vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { McpService } from './McpService'
import {
  writeMcpDiscoveryFile,
  cleanupMcpDiscoveryFile,
  readAllLiveEntries,
  probeMcpEndpoint,
  type McpDiscoveryEntry
} from './mcpDiscovery'

// Each suite gets an isolated temp discovery dir.
let DIR: string
beforeAll(async () => { DIR = await fs.mkdtemp(join(tmpdir(), 'ecui-list-instances-')) })
afterAll(async () => { await fs.rm(DIR, { recursive: true, force: true }) })

// ─── helpers ────────────────────────────────────────────────────────────────

interface RpcContent { type: string; text: string }
interface RpcResult { content?: RpcContent[] }
interface RpcError { code: number; message: string }
interface RpcReply { result?: RpcResult; error?: RpcError }

function parseRpc(body: string): RpcReply {
  const m = /^data: (.*)$/m.exec(body)
  const json = m?.[1] ?? body
  return JSON.parse(json) as RpcReply
}

function post(port: number, payload: unknown, token?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(body)
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/', method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => { chunks.push(c) })
        res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }) })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function listInstancesCall(port: number, token: string): Promise<RpcReply> {
  return post(port, {
    jsonrpc: '2.0', id: 1,
    method: 'tools/call',
    params: { name: 'list-instances', arguments: {} }
  }, token).then((r) => parseRpc(r.body))
}

function getResultText(reply: RpcReply): string {
  const text = reply.result?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error(`Expected text content in reply: ${JSON.stringify(reply)}`)
  return text
}

// ─── readAllLiveEntries ──────────────────────────────────────────────────────

describe('readAllLiveEntries', () => {
  const LIVE_PID = process.pid
  afterEach(async () => { await cleanupMcpDiscoveryFile(DIR, LIVE_PID) })

  it('returns an empty array when the directory does not exist', () => {
    expect(readAllLiveEntries(join(DIR, 'nonexistent'))).toEqual([])
  })

  it('returns entries for alive pids with parseable lockfiles', async () => {
    await writeMcpDiscoveryFile(DIR, {
      pid: LIVE_PID, port: 49001, token: 'tok-live', name: 'live-session',
      projectPath: '/tmp/proj.restorm', startedAt: '2026-01-01T00:00:00.000Z'
    })
    const entries = readAllLiveEntries(DIR)
    const found = entries.find((e) => e.pid === LIVE_PID)
    expect(found).toBeDefined()
    expect(found?.name).toBe('live-session')
    expect(found?.port).toBe(49001)
    expect(found?.projectPath).toBe('/tmp/proj.restorm')
    // Token must be present so the tool handler can use it for the HTTP probe.
    expect(found?.token).toBe('tok-live')
  })

  it('excludes entries whose pid is dead', async () => {
    const deadPid = -(Math.abs(process.pid) + 3_000_000)
    await writeMcpDiscoveryFile(DIR, {
      pid: deadPid, port: 49002, token: 'tok-dead', name: 'dead-session',
      projectPath: null, startedAt: '2026-01-01T00:00:00.000Z'
    })
    try {
      const entries = readAllLiveEntries(DIR)
      expect(entries.find((e) => e.pid === deadPid)).toBeUndefined()
    } finally {
      await cleanupMcpDiscoveryFile(DIR, deadPid)
    }
  })

  it('ignores unparseable lockfiles without throwing', async () => {
    const badPath = join(DIR, 'bad.json')
    await fs.writeFile(badPath, 'not-json', 'utf8')
    try {
      expect(() => readAllLiveEntries(DIR)).not.toThrow()
    } finally {
      await fs.unlink(badPath).catch(() => undefined)
    }
  })
})

// ─── probeMcpEndpoint ────────────────────────────────────────────────────────

describe('probeMcpEndpoint', () => {
  let server: Server
  let serverPort: number

  beforeAll(async () => {
    server = createServer((req, res) => {
      const authHeader = req.headers.authorization
      req.on('data', () => { /* drain */ })
      req.on('end', () => {
        res.statusCode = authHeader === 'Bearer valid-token' ? 200 : 401
        res.setHeader('Content-Type', 'application/json')
        res.end('{"jsonrpc":"2.0","id":"ecui-probe","result":{}}')
      })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const addr = server.address()
    serverPort = typeof addr === 'object' && addr ? addr.port : 0
  })

  afterAll(async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) })

  it('returns true when the endpoint responds 200 with the correct token', async () => {
    expect(await probeMcpEndpoint(serverPort, 'valid-token')).toBe(true)
  })

  it('returns false when the token is wrong (401 from server)', async () => {
    expect(await probeMcpEndpoint(serverPort, 'wrong-token')).toBe(false)
  })

  it('returns false for an invalid port number', async () => {
    expect(await probeMcpEndpoint(-1, 'tok')).toBe(false)
  })

  it('returns false when no server is listening (connection refused)', async () => {
    // Port 1 is reserved and never open; probe with short timeout.
    expect(await probeMcpEndpoint(1, 'tok', 200)).toBe(false)
  })
})

// ─── list-instances MCP tool ─────────────────────────────────────────────────

describe('list-instances MCP tool', () => {
  let svc: McpService
  let svcPort: number
  const SVC_TOKEN = 'svc-bearer-token'

  // A minimal stub MCP server standing in for a "peer" instance.
  let peerServer: Server
  let peerPort: number
  const PEER_TOKEN = 'peer-bearer-token'
  const PEER_PID = process.pid  // Live pid so the pid-alive check passes.
  const PEER_NAME = `peer-${String(PEER_PID)}`

  beforeAll(async () => {
    // Minimal HTTP server: 200 on correct auth, 401 otherwise.
    peerServer = createServer((req, res) => {
      const auth = req.headers.authorization
      req.on('data', () => { /* drain */ })
      req.on('end', () => {
        res.statusCode = auth === `Bearer ${PEER_TOKEN}` ? 200 : 401
        res.setHeader('Content-Type', 'application/json')
        res.end('{"jsonrpc":"2.0","id":"ecui-probe","result":{}}')
      })
    })
    await new Promise<void>((resolve) => { peerServer.listen(0, '127.0.0.1', resolve) })
    const addr = peerServer.address()
    peerPort = typeof addr === 'object' && addr ? addr.port : 0

    svc = new McpService({ authToken: SVC_TOKEN, discoveryDir: DIR, sessionName: 'test-service' })
    await svc.start(0)
    svcPort = svc.getPort() ?? 0
  })

  afterAll(async () => {
    await svc.stop()
    await new Promise<void>((resolve) => { peerServer.close(() => { resolve() }) })
  })

  afterEach(async () => { await cleanupMcpDiscoveryFile(DIR, PEER_PID) })

  it('returns an empty list when no other instances are registered', async () => {
    const reply = await listInstancesCall(svcPort, SVC_TOKEN)
    expect(reply.error).toBeUndefined()
    const text = getResultText(reply)
    const parsed = JSON.parse(text) as { count: number; instances: unknown[] }
    expect(parsed.count).toBe(0)
    expect(parsed.instances).toEqual([])
  })

  it('returns a live peer with correct metadata; bearer token absent from output', async () => {
    const entry: McpDiscoveryEntry = {
      pid: PEER_PID, port: peerPort, token: PEER_TOKEN, name: PEER_NAME,
      projectPath: '/home/user/my-project.restorm', startedAt: '2026-01-15T10:00:00.000Z'
    }
    await writeMcpDiscoveryFile(DIR, entry)

    const reply = await listInstancesCall(svcPort, SVC_TOKEN)
    expect(reply.error).toBeUndefined()
    const text = getResultText(reply)
    const parsed = JSON.parse(text) as {
      count: number
      instances: { pid: number; name: string; fileName: string | null; projectPath: string | null; endpoint: string; startedAt: string }[]
    }
    expect(parsed.count).toBe(1)
    const inst = parsed.instances[0]
    expect(inst?.pid).toBe(PEER_PID)
    expect(inst?.name).toBe(PEER_NAME)
    // The open file's NAME (basename) is surfaced alongside the full path.
    expect(inst?.fileName).toBe('my-project.restorm')
    expect(inst?.projectPath).toBe('/home/user/my-project.restorm')
    expect(inst?.endpoint).toBe(`127.0.0.1:${String(peerPort)}`)
    expect(inst?.startedAt).toBe('2026-01-15T10:00:00.000Z')
    // Bearer token must not appear anywhere in the serialised response.
    expect(text).not.toContain(PEER_TOKEN)
  })

  it('excludes a peer whose HTTP endpoint is unreachable', async () => {
    // Write a lockfile pointing at port 1 (reserved, never listening).
    // Use a numeric filename that won't collide with the real PEER_PID lockfile.
    const unreachEntry: McpDiscoveryEntry = {
      pid: PEER_PID, port: 1, token: PEER_TOKEN, name: 'unreachable-instance',
      projectPath: null, startedAt: '2026-01-15T09:00:00.000Z'
    }
    await fs.writeFile(join(DIR, '99999.json'), JSON.stringify(unreachEntry), 'utf8')
    try {
      const reply = await listInstancesCall(svcPort, SVC_TOKEN)
      expect(reply.error).toBeUndefined()
      const parsed = JSON.parse(getResultText(reply)) as { instances: { endpoint: string }[] }
      // The unreachable entry (port 1) must be absent.
      expect(parsed.instances.every((i) => !i.endpoint.endsWith(':1'))).toBe(true)
    } finally {
      await fs.unlink(join(DIR, '99999.json')).catch(() => undefined)
    }
  })

  it('returns empty list without error when discoveryDir is not configured', async () => {
    const bare = new McpService({ authToken: 'bare-token' })
    await bare.start(0)
    const barePort = bare.getPort() ?? 0
    try {
      const reply = await listInstancesCall(barePort, 'bare-token')
      expect(reply.error).toBeUndefined()
      const parsed = JSON.parse(getResultText(reply)) as { count: number; instances: unknown[] }
      expect(parsed.count).toBe(0)
      expect(parsed.instances).toEqual([])
    } finally {
      await bare.stop()
    }
  })
})
