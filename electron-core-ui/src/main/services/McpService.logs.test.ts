import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
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
  },
  // `protocol.handle` registers the ecui-media screencast scheme on start;
  // a plain mock fn is enough (the handler body never runs under test).
  protocol: {
    handle: vi.fn()
  },
  net: {
    fetch: vi.fn()
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
import { McpService, MCP_SESSION_ROUTING_KEY, DEFAULT_SERVED_CALL_CAP, DEFAULT_CAPTURE_RETENTION_CAP, type McpServedCallEntry, type McpToolConfig } from './McpService'
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

const echoTool = (label: string): [string, McpToolConfig, (args: Record<string, unknown>) => unknown] => [
  'echo',
  {
    titleKey: 'mcpToolTitles.echo',
    title: 'Echo',
    description: 'Echo received args.',
    inputSchema: { foo: z.string().optional(), big: z.string().optional() }
  },
  (args: Record<string, unknown>) => ({
    content: [{ type: 'text', text: JSON.stringify({ ranOn: label, args }) }]
  })
]

function callEcho(port: number, args: Record<string, unknown>, headers: Record<string, string> = {}): Promise<ProbeResult> {
  return post(port, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo', arguments: args } }, headers)
}

/** Pull entry `i` from the buffer, asserting it exists (avoids `!`). */
function entryAt(service: McpService, i: number): McpServedCallEntry {
  const entry = service.getServedCalls()[i]
  if (!entry) throw new Error(`expected a served-call entry at index ${String(i)}`)
  return entry
}

/** Parse an entry's payload as a typed record (avoids `any` member access). */
function payloadOf(entry: McpServedCallEntry): Record<string, unknown> {
  return JSON.parse(entry.payload) as Record<string, unknown>
}

describe('McpService served-call logs buffer', () => {
  // A standalone instance (no routing) — exercises the buffering path that
  // the non-bridge majority of consumers hit.
  const service = new McpService()
  let port: number

  beforeAll(async () => {
    service.registerTool(...echoTool('local'))
    await service.start(0)
    const p = service.getPort()
    if (p === null) throw new Error('failed to bind')
    port = p
  })

  afterAll(async () => {
    await service.stop()
  })

  beforeEach(() => {
    service.clearServedCalls()
    service.setLogRetentionCap(DEFAULT_SERVED_CALL_CAP)
  })

  it('defaults the retention cap to 100', () => {
    expect(service.getLogRetentionCap()).toBe(100)
  })

  it('records a locally-executed tools/call with tool name, payload and timestamp', async () => {
    const before = Date.now()
    await callEcho(port, { foo: 'bar' })
    const calls = service.getServedCalls()
    expect(calls).toHaveLength(1)
    const entry = entryAt(service, 0)
    expect(entry.tool).toBe('echo')
    expect(payloadOf(entry)).toEqual({ foo: 'bar' })
    expect(entry.payloadTruncated).toBe(false)
    expect(entry.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('does not record initialize / tools/list (only tools/call)', async () => {
    await post(port, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(service.getServedCalls()).toHaveLength(0)
  })

  it('returns calls newest-first', async () => {
    await callEcho(port, { foo: 'one' })
    await callEcho(port, { foo: 'two' })
    const calls = service.getServedCalls()
    expect(calls).toHaveLength(2)
    expect(payloadOf(entryAt(service, 0))).toEqual({ foo: 'two' })
    expect(payloadOf(entryAt(service, 1))).toEqual({ foo: 'one' })
  })

  it('evicts the oldest entries once the cap is exceeded', async () => {
    service.setLogRetentionCap(2)
    await callEcho(port, { foo: '1' })
    await callEcho(port, { foo: '2' })
    await callEcho(port, { foo: '3' })
    const calls = service.getServedCalls()
    expect(calls).toHaveLength(2)
    // Newest-first: the two most recent survive, the oldest ('1') is gone.
    expect(calls.map((c) => payloadOf(c)['foo'])).toEqual(['3', '2'])
  })

  it('trims the buffer immediately when the cap is lowered', async () => {
    await callEcho(port, { foo: '1' })
    await callEcho(port, { foo: '2' })
    await callEcho(port, { foo: '3' })
    expect(service.getServedCalls()).toHaveLength(3)
    service.setLogRetentionCap(1)
    const calls = service.getServedCalls()
    expect(calls).toHaveLength(1)
    expect(payloadOf(entryAt(service, 0))['foo']).toBe('3')
  })

  it('disables retention (and drops the buffer) at cap 0', async () => {
    await callEcho(port, { foo: '1' })
    expect(service.getServedCalls()).toHaveLength(1)
    service.setLogRetentionCap(0)
    expect(service.getServedCalls()).toHaveLength(0)
    await callEcho(port, { foo: '2' })
    expect(service.getServedCalls()).toHaveLength(0)
  })

  it('truncates an oversized payload but keeps the original byte length', async () => {
    const big = 'x'.repeat(20_000)
    await callEcho(port, { big })
    const entry = entryAt(service, 0)
    expect(entry.payloadTruncated).toBe(true)
    expect(entry.payload.endsWith('…(truncated)')).toBe(true)
    expect(entry.payloadBytes).toBeGreaterThan(20_000)
    // The retained slice is bounded, far below the original.
    expect(entry.payload.length).toBeLessThan(20_000)
  })

  it('fires the change listener on record / clear', async () => {
    const fired: number[] = []
    const off = service.onServedCall(() => { fired.push(service.getServedCalls().length) })
    await callEcho(port, { foo: 'a' })
    service.clearServedCalls()
    off()
    // A `tools/call` fires twice: once when the request is recorded, and again
    // when the tool's result is attached to that entry (so the viewer fills in
    // the response live). Then clear → 0.
    expect(fired).toEqual([1, 1, 0])
  })

  it('drops both image base64 and the video path past the capture-retention cap, keeping metadata', async () => {
    // `attachCaptureToLatest` is private — exercise it the way the capture
    // tools do, via a typed accessor.
    const attach = (c: { kind: 'image' | 'video'; mimeType: string; base64?: string; path?: string }): void => {
      (service as unknown as { attachCaptureToLatest: (cap: typeof c) => void }).attachCaptureToLatest(c)
    }
    // Tighten the capture cap so a couple of pad calls push past it.
    service.setCaptureRetentionCap(2)
    await callEcho(port, { n: 'video' })
    attach({ kind: 'video', mimeType: 'video/webm', path: 'ecui-media://screencast/ecu-screencast-keepwindow.webm' })
    await callEcho(port, { n: 'image' })
    attach({ kind: 'image', mimeType: 'image/png', base64: 'AAAABBBBCCCC' })
    // Push both past the most-recent 2 entries.
    for (let i = 0; i < 4; i++) await callEcho(port, { pad: i })

    const calls = service.getServedCalls()
    const videoEntry = calls.find((c) => c.capture?.kind === 'video')
    const imageEntry = calls.find((c) => c.capture?.kind === 'image')
    // Both heavy payloads dropped past the cap; only metadata remains.
    expect(videoEntry?.capture?.path).toBeUndefined()
    expect(videoEntry?.capture?.kind).toBe('video')
    expect(imageEntry?.capture?.base64).toBeUndefined()
    expect(imageEntry?.capture?.kind).toBe('image')
    service.setCaptureRetentionCap(DEFAULT_CAPTURE_RETENTION_CAP)
  })

  it('deletes the on-disk screencast temp file when its log entry is evicted', async () => {
    // A real temp file standing in for a screencast clip.
    const name = `ecu-screencast-${String(Date.now())}.webm`
    const filePath = join(tmpdir(), name)
    await fs.writeFile(filePath, 'fake-webm-bytes')
    expect(await fs.access(filePath).then(() => true, () => false)).toBe(true)

    const attach = (c: { kind: 'image' | 'video'; mimeType: string; path?: string }): void => {
      (service as unknown as { attachCaptureToLatest: (cap: typeof c) => void }).attachCaptureToLatest(c)
    }
    await callEcho(port, { n: 'clip' })
    attach({ kind: 'video', mimeType: 'video/webm', path: `ecui-media://screencast/${name}` })

    // Lower the cap to 0 → the entry (and its media) is evicted.
    service.setLogRetentionCap(0)
    expect(await fs.access(filePath).then(() => true, () => false)).toBe(false)
  })

  it('deletes the on-disk screenshot temp file when its log entry is evicted', async () => {
    // A real temp file standing in for a screenshot PNG served on demand.
    const name = `ecu-screenshot-${String(Date.now())}.png`
    const filePath = join(tmpdir(), name)
    await fs.writeFile(filePath, 'fake-png-bytes')
    expect(await fs.access(filePath).then(() => true, () => false)).toBe(true)

    const attach = (c: { kind: 'image' | 'video'; mimeType: string; path?: string }): void => {
      (service as unknown as { attachCaptureToLatest: (cap: typeof c) => void }).attachCaptureToLatest(c)
    }
    await callEcho(port, { n: 'shot' })
    attach({ kind: 'image', mimeType: 'image/png', path: `ecui-media://screenshot/${name}` })

    // Lower the cap to 0 → the entry (and its media) is evicted.
    service.setLogRetentionCap(0)
    expect(await fs.access(filePath).then(() => true, () => false)).toBe(false)
  })
})

describe('McpService startup orphan-media sweep', () => {
  it('deletes leftover ecu-screencast-* and ecu-screenshot-* temp files on start (crashed-run orphans)', async () => {
    const orphan = join(tmpdir(), `ecu-screencast-orphan-${String(process.pid)}.webm`)
    const orphanMp4 = join(tmpdir(), `ecu-screencast-orphan-${String(process.pid)}.mp4`)
    const orphanPng = join(tmpdir(), `ecu-screenshot-orphan-${String(process.pid)}.png`)
    const unrelated = join(tmpdir(), `not-ours-${String(process.pid)}.webm`)
    await fs.writeFile(orphan, 'x')
    await fs.writeFile(orphanMp4, 'x')
    await fs.writeFile(orphanPng, 'x')
    await fs.writeFile(unrelated, 'x')

    const svc = new McpService()
    await svc.start(0)
    try {
      // The sweep runs on start(): our orphans gone, unrelated file untouched.
      expect(await fs.access(orphan).then(() => true, () => false)).toBe(false)
      expect(await fs.access(orphanMp4).then(() => true, () => false)).toBe(false)
      expect(await fs.access(orphanPng).then(() => true, () => false)).toBe(false)
      expect(await fs.access(unrelated).then(() => true, () => false)).toBe(true)
    } finally {
      await svc.stop()
      await fs.rm(unrelated, { force: true })
    }
  })
})

describe('McpService served-call logs — passthrough exclusion', () => {
  // Bridge setup mirrors the routing test: A forwards to B by name. The
  // source instance (A) must NOT record a call it merely forwarded; only
  // the executing instance (B) records it.
  const DIR = join(tmpdir(), `ecui-mcp-logs-${String(process.pid)}`)
  const serviceB = new McpService({ sessionName: 'logs-b', authToken: 'token-b', discoveryDir: DIR })
  const serviceA = new McpService({ sessionName: 'logs-a', discoveryDir: DIR })
  let portA: number
  let portB: number

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
    await writeMcpDiscoveryFile(DIR, {
      port: portB,
      projectPath: null,
      pid: process.pid,
      startedAt: '2026-05-03T00:00:00.000Z',
      token: 'token-b',
      name: 'logs-b'
    })
  })

  afterAll(async () => {
    await cleanupMcpDiscoveryFile(DIR, process.pid)
    await fs.rm(DIR, { recursive: true, force: true })
    await serviceA.stop()
    await serviceB.stop()
  })

  beforeEach(() => {
    serviceA.clearServedCalls()
    serviceB.clearServedCalls()
  })

  it('records a locally-executed call on the instance that ran it', async () => {
    await callEcho(portA, { foo: 'local' })
    expect(serviceA.getServedCalls()).toHaveLength(1)
    expect(entryAt(serviceA, 0).tool).toBe('echo')
  })

  it('does NOT record a forwarded call on the source instance', async () => {
    await callEcho(portA, { foo: 'fwd', [MCP_SESSION_ROUTING_KEY]: 'logs-b' })
    // A only forwarded — it must not have logged it.
    expect(serviceA.getServedCalls()).toHaveLength(0)
    // B actually executed it — it logs it (key stripped before recording).
    const onB = serviceB.getServedCalls()
    expect(onB).toHaveLength(1)
    const entryB = entryAt(serviceB, 0)
    expect(entryB.tool).toBe('echo')
    expect(MCP_SESSION_ROUTING_KEY in payloadOf(entryB)).toBe(false)
  })

  it('records a routing-key call that names the source itself (runs locally)', async () => {
    await callEcho(portA, { foo: 'self', [MCP_SESSION_ROUTING_KEY]: 'logs-a' })
    const onA = serviceA.getServedCalls()
    expect(onA).toHaveLength(1)
    // The reserved key is stripped before the payload is recorded.
    expect(MCP_SESSION_ROUTING_KEY in payloadOf(entryAt(serviceA, 0))).toBe(false)
  })
})
