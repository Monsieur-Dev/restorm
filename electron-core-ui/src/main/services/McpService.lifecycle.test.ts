import { describe, it, expect, afterEach, vi } from 'vitest'
import { request as httpRequest } from 'node:http'

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
  // start() registers the ecui-media:// screencast protocol handler, which
  // touches protocol.handle + net.fetch — stub both so the lifecycle tests
  // below can drive start() without the real Electron protocol module.
  protocol: { handle: vi.fn() },
  net: { fetch: vi.fn() }
}))

vi.mock('./LoggerService', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import { McpService } from './McpService'

interface ProbeResult { status: number; body: string }

function probe(port: number): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Pins the runtime stop → resume lifecycle that the statusbar toggle relies on:
// the host registers its domain tools exactly once, then start/stop/start the
// HTTP listener as the user toggles. The host MUST NOT re-register on resume
// (registerTool throws on a duplicate name), so the registry has to survive a
// stop and a second start must re-bind cleanly.
describe('McpService stop → resume lifecycle', () => {
  let service: McpService

  afterEach(async () => {
    await service.stop()
  })

  it('re-binds after a stop (a second start succeeds, getPort flips null → port)', async () => {
    service = new McpService()

    await service.start(0)
    const firstPort = service.getPort()
    expect(firstPort).not.toBeNull()
    // A live listener answers (no 401 — auth disabled, no token).
    expect((await probe(firstPort ?? 0)).status).not.toBe(401)

    await service.stop()
    expect(service.getPort()).toBeNull()

    // Resume: start again WITHOUT re-registering tools.
    await service.start(0)
    const secondPort = service.getPort()
    expect(secondPort).not.toBeNull()
    expect((await probe(secondPort ?? 0)).status).not.toBe(401)
  })

  it('keeps the tool registry across a stop (host registers once, never re-registers)', async () => {
    service = new McpService()
    // Host registers its domain tool(s) exactly once, before the first start.
    service.registerTool(
      'ping',
      { titleKey: 'tool.ping', description: 'ping', inputSchema: {} },
      () => ({ content: [{ type: 'text', text: 'pong' }] })
    )

    await service.start(0)
    const before = service.getRegisteredToolTitleKeys().map((t) => t.name)
    expect(before).toContain('ping')

    await service.stop()
    // stop() tears down only the HTTP listener — the registry persists, so the
    // host can resume without re-registering (which would throw on a duplicate).
    expect(service.getRegisteredToolTitleKeys().map((t) => t.name)).toEqual(before)

    await service.start(0)
    // The resumed listener still serves the same registry.
    expect(service.getRegisteredToolTitleKeys().map((t) => t.name)).toEqual(before)

    // Guard the contract that makes re-registration unsafe: a duplicate throws.
    expect(() => {
      service.registerTool(
        'ping',
        { titleKey: 'tool.ping', description: 'ping', inputSchema: {} },
        () => ({ content: [{ type: 'text', text: 'pong' }] })
      )
    }).toThrow(/already registered/)
  })
})
