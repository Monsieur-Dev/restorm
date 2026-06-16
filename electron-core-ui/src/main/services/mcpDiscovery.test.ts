import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'

// The discovery module logs a warning on same-name collisions; stub the
// logger so the test doesn't pull in the winston/electron app singleton.
vi.mock('./LoggerService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
import {
  writeMcpDiscoveryFile,
  cleanupMcpDiscoveryFile,
  findLiveSessionByName,
  forwardToNamedSession,
  resolveMcpDiscoveryDir,
  type McpDiscoveryEntry
} from './mcpDiscovery'

// Each suite run gets an isolated discovery dir so tests never collide with a
// real running instance (or with each other).
let DIR: string
beforeAll(async () => { DIR = await fs.mkdtemp(join(tmpdir(), 'ecui-mcp-disc-')) })
afterAll(async () => { await fs.rm(DIR, { recursive: true, force: true }) })

async function readEntry(path: string): Promise<McpDiscoveryEntry> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as McpDiscoveryEntry
}

describe('resolveMcpDiscoveryDir', () => {
  it('uses the override when it is a non-empty string', () => {
    expect(resolveMcpDiscoveryDir('app-mcp', '/custom/dir')).toBe('/custom/dir')
  })

  it('falls back to tmpdir/<appDirName> when the override is empty or unset', () => {
    expect(resolveMcpDiscoveryDir('app-mcp', '   ')).toBe(join(tmpdir(), 'app-mcp'))
    expect(resolveMcpDiscoveryDir('app-mcp')).toBe(join(tmpdir(), 'app-mcp'))
  })
})

describe('writeMcpDiscoveryFile', () => {
  // Synthetic, out-of-range pid — write/read round-trips don't need liveness.
  const FIXED_PID = -Math.abs(process.pid) - 1_000_000

  afterEach(async () => { await cleanupMcpDiscoveryFile(DIR, FIXED_PID) })

  it('round-trips the entry (incl. bearer token) through the on-disk lockfile', async () => {
    const token = 'deadbeef'.repeat(4)
    const entry: McpDiscoveryEntry = {
      port: 12345,
      projectPath: '/tmp/example.doc',
      pid: FIXED_PID,
      startedAt: '2026-05-03T00:00:00.000Z',
      token,
      name: 'example session'
    }
    await writeMcpDiscoveryFile(DIR, entry)
    const parsed = await readEntry(join(DIR, `${String(FIXED_PID)}.json`))
    expect(parsed).toEqual(entry)
  })

  it('writes a second copy at the launcher-specific extra path when given', async () => {
    const extraPath = join(DIR, `extra-${String(FIXED_PID)}.json`)
    const token = 'cafebabe'.repeat(4)
    await writeMcpDiscoveryFile(DIR, {
      port: 23456,
      projectPath: null,
      pid: FIXED_PID,
      startedAt: '2026-05-03T00:00:00.000Z',
      token,
      name: 'extra session'
    }, extraPath)
    try {
      const parsed = await readEntry(extraPath)
      expect(parsed.token).toBe(token)
      expect(parsed.port).toBe(23456)
      expect(parsed.name).toBe('extra session')
    } finally {
      await fs.unlink(extraPath).catch(() => undefined)
    }
  })
})

describe('findLiveSessionByName', () => {
  // Use this process's REAL pid so the liveness gate (`process.kill(pid, 0)`)
  // passes.
  const LIVE_PID = process.pid
  const NAME = `find-by-name-${String(LIVE_PID)}`

  afterEach(async () => { await cleanupMcpDiscoveryFile(DIR, LIVE_PID) })

  it('returns the live entry whose name matches verbatim', async () => {
    await writeMcpDiscoveryFile(DIR, {
      port: 40001, projectPath: null, pid: LIVE_PID,
      startedAt: '2026-05-03T00:00:00.000Z', token: 'tok', name: NAME
    })
    const found = findLiveSessionByName(DIR, NAME)
    expect(found?.port).toBe(40001)
    expect(found?.name).toBe(NAME)
  })

  it('returns null for an unknown name', () => {
    expect(findLiveSessionByName(DIR, 'no-such-session-xyz')).toBeNull()
  })

  it('returns null when the dir does not exist', () => {
    expect(findLiveSessionByName(join(DIR, 'nope'), NAME)).toBeNull()
  })

  it('breaks a same-name same-startedAt tie deterministically (highest pid wins)', async () => {
    // Two live instances sharing one name + the same clock-second must resolve
    // by pid, never by filesystem iteration order. Use this process and its
    // parent — both alive, distinct pids.
    const pidA = process.pid
    const pidB = process.ppid
    const tieName = `tie-${String(pidA)}`
    const sameStarted = '2026-05-03T00:00:00.000Z'
    const winnerPid = Math.max(pidA, pidB)
    const winnerPort = winnerPid === pidA ? 41001 : 41002
    await writeMcpDiscoveryFile(DIR, { port: 41001, projectPath: null, pid: pidA, startedAt: sameStarted, token: 'tok', name: tieName })
    await writeMcpDiscoveryFile(DIR, { port: 41002, projectPath: null, pid: pidB, startedAt: sameStarted, token: 'tok', name: tieName })
    try {
      const found = findLiveSessionByName(DIR, tieName)
      expect(found?.pid).toBe(winnerPid)
      expect(found?.port).toBe(winnerPort)
    } finally {
      await cleanupMcpDiscoveryFile(DIR, pidB)
      // pidA cleaned by the outer afterEach (LIVE_PID === process.pid)
    }
  })

  it('ignores entries whose recorded pid is dead', async () => {
    const deadPid = -Math.abs(process.pid) - 2_000_000
    const deadName = `dead-${String(deadPid)}`
    await writeMcpDiscoveryFile(DIR, {
      port: 40002, projectPath: null, pid: deadPid,
      startedAt: '2026-05-03T00:00:00.000Z', token: 'tok', name: deadName
    })
    try {
      expect(findLiveSessionByName(DIR, deadName)).toBeNull()
    } finally {
      await cleanupMcpDiscoveryFile(DIR, deadPid)
    }
  })
})

describe('forwardToNamedSession', () => {
  const LIVE_PID = process.pid
  const NAME = `forward-${String(LIVE_PID)}`
  let server: Server
  let port: number
  let received: { auth?: string | undefined; forwarded?: string | undefined; body: string } | null = null

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => { chunks.push(c) })
      req.on('end', () => {
        const auth = req.headers.authorization
        const forwarded = req.headers['x-mcp-forwarded']
        received = {
          auth: typeof auth === 'string' ? auth : undefined,
          forwarded: typeof forwarded === 'string' ? forwarded : undefined,
          body: Buffer.concat(chunks).toString('utf8')
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream')
        res.end('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n')
      })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const addr = server.address()
    port = typeof addr === 'object' && addr ? addr.port : 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })

  afterEach(async () => {
    await cleanupMcpDiscoveryFile(DIR, LIVE_PID)
    received = null
  })

  it('forwards to the matching live entry with its bearer token + forwarded header', async () => {
    await writeMcpDiscoveryFile(DIR, {
      port, projectPath: null, pid: LIVE_PID,
      startedAt: '2026-05-03T00:00:00.000Z', token: 'secret-token', name: NAME
    })
    const result = await forwardToNamedSession(DIR, NAME, '{"jsonrpc":"2.0","id":1,"method":"tools/call"}')
    expect(result?.status).toBe(200)
    expect(received?.auth).toBe('Bearer secret-token')
    expect(received?.forwarded).toBe('1')
    expect(result?.body).toContain('"ok":true')
    // The peer's Content-Type is captured so the bridge can relay it verbatim.
    expect(result?.contentType).toBe('text/event-stream')
  })

  it('returns null when no entry matches the name', async () => {
    expect(await forwardToNamedSession(DIR, 'absent-session', '{}')).toBeNull()
  })
})
