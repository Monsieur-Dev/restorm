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
  probeMcpEndpoint,
  resolveMcpDiscoveryDir,
  readAllLiveEntries,
  readAllInstancesIncludingCut,
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
      name: 'example session', mcpActive: true
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
      name: 'extra session', mcpActive: true
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
      startedAt: '2026-05-03T00:00:00.000Z', token: 'tok', name: NAME, mcpActive: true
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
    await writeMcpDiscoveryFile(DIR, { port: 41001, projectPath: null, pid: pidA, startedAt: sameStarted, token: 'tok', name: tieName, mcpActive: true })
    await writeMcpDiscoveryFile(DIR, { port: 41002, projectPath: null, pid: pidB, startedAt: sameStarted, token: 'tok', name: tieName, mcpActive: true })
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
      startedAt: '2026-05-03T00:00:00.000Z', token: 'tok', name: deadName, mcpActive: true
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
      startedAt: '2026-05-03T00:00:00.000Z', token: 'secret-token', name: NAME, mcpActive: true
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

describe('probeMcpEndpoint', () => {
  let server: Server
  let port: number
  let received: { auth?: string | undefined; forwarded?: string | undefined } | null = null
  let nextStatus = 200

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.on('data', () => { /* drain */ })
      req.on('end', () => {
        received = {
          auth: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
          forwarded: typeof req.headers['x-mcp-forwarded'] === 'string' ? req.headers['x-mcp-forwarded'] : undefined
        }
        res.statusCode = nextStatus
        res.setHeader('Content-Type', 'application/json')
        res.end('{"jsonrpc":"2.0","id":"ecui-probe","result":{}}')
      })
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const addr = server.address()
    port = typeof addr === 'object' && addr ? addr.port : 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })

  afterEach(() => { received = null; nextStatus = 200 })

  it('returns true on a 2xx and sends the bearer token', async () => {
    expect(await probeMcpEndpoint(port, 'probe-token')).toBe(true)
    expect(received?.auth).toBe('Bearer probe-token')
  })

  // The probe must carry the x-mcp-forwarded marker so restorm's main-process
  // firewall recognises it as the app's own inter-instance MCP-infra traffic
  // and exempts it (no "outbound request blocked" prompt). Without this the
  // list-instances discovery probe to a peer would be firewall-gated and the
  // peer never reported.
  it('tags the probe with the inter-instance MCP-infra (x-mcp-forwarded) header', async () => {
    await probeMcpEndpoint(port, 'probe-token')
    expect(received?.forwarded).toBe('1')
  })

  it('returns false on a non-2xx status', async () => {
    nextStatus = 401
    expect(await probeMcpEndpoint(port, 'probe-token')).toBe(false)
  })

  it('returns false for an invalid port without touching the network', async () => {
    expect(await probeMcpEndpoint(0, 'probe-token')).toBe(false)
    expect(received).toBeNull()
  })
})

// The MCP-cut hard-lockout + dual-view contract: a CUT instance (mcpActive:false)
// keeps its lockfile for the INTERNAL create-uniqueness view but is invisible to
// (and unroutable by) the AI-facing list. Two alive pids are used so an active
// and a cut entry coexist (the filename is `<pid>.json`).
describe('MCP-cut instances — dual discovery view', () => {
  const ACTIVE_PID = process.pid
  const CUT_PID = process.ppid
  const ACTIVE_NAME = `cut-suite-active-${String(ACTIVE_PID)}`
  const CUT_NAME = `cut-suite-cut-${String(CUT_PID)}`

  afterEach(async () => {
    await cleanupMcpDiscoveryFile(DIR, ACTIVE_PID)
    await cleanupMcpDiscoveryFile(DIR, CUT_PID)
  })

  async function writeActive(): Promise<void> {
    await writeMcpDiscoveryFile(DIR, {
      port: 40123, projectPath: '/tmp/active.restorm', pid: ACTIVE_PID,
      startedAt: '2026-05-03T00:00:00.000Z', token: 'tok', name: ACTIVE_NAME, mcpActive: true
    })
  }
  // Mirrors restorm's cut-marker write: port 0, mcpActive:false, and an EMPTY
  // token (defence-in-depth — a cut instance never persists a usable secret).
  async function writeCut(): Promise<void> {
    await writeMcpDiscoveryFile(DIR, {
      port: 0, projectPath: '/tmp/cut.restorm', pid: CUT_PID,
      startedAt: '2026-05-03T00:00:01.000Z', token: '', name: CUT_NAME, mcpActive: false
    })
  }

  it('readAllLiveEntries (AI-facing) EXCLUDES a cut instance, KEEPS the active one', async () => {
    await writeActive()
    await writeCut()
    const live = readAllLiveEntries(DIR)
    const names = live.map((e) => e.name)
    expect(names).toContain(ACTIVE_NAME)
    expect(names).not.toContain(CUT_NAME)
  })

  it('readAllInstancesIncludingCut (internal) INCLUDES both, flagging mcpActive', async () => {
    await writeActive()
    await writeCut()
    const all = readAllInstancesIncludingCut(DIR)
    const active = all.find((e) => e.name === ACTIVE_NAME)
    const cut = all.find((e) => e.name === CUT_NAME)
    expect(active?.mcpActive).toBe(true)
    expect(cut?.mcpActive).toBe(false)
    // The internal view carries the open file for the create-uniqueness check.
    expect(cut?.projectPath).toBe('/tmp/cut.restorm')
    // ...and never the bearer token (collision-only view).
    expect(cut).not.toHaveProperty('token')
  })

  it('findLiveSessionByName REFUSES a cut instance (hard lockout — never a routing target)', async () => {
    await writeCut()
    expect(findLiveSessionByName(DIR, CUT_NAME)).toBeNull()
  })

  it('the cut-marker on disk carries NO usable bearer token (defence-in-depth)', async () => {
    await writeCut()
    const onDisk = JSON.parse(await fs.readFile(join(DIR, `${String(CUT_PID)}.json`), 'utf8')) as { token: string; mcpActive: boolean }
    expect(onDisk.mcpActive).toBe(false)
    // The token field exists (stable shape) but is blank — no usable secret.
    expect(onDisk.token).toBe('')
  })

  it('findLiveSessionByName still resolves an active instance', async () => {
    await writeActive()
    expect(findLiveSessionByName(DIR, ACTIVE_NAME)?.name).toBe(ACTIVE_NAME)
  })

  it('an entry that does not state the flag is NOT treated as active', async () => {
    // The writer always states it. A lockfile missing it was not written by
    // this build, so it is not an instance we know how to talk to — inferring
    // "active" from an absence is what let a stale shape look alive.
    await writeMcpDiscoveryFile(DIR, {
      port: 40124, projectPath: null, pid: ACTIVE_PID,
      startedAt: '2026-05-03T00:00:00.000Z', token: 'tok', name: ACTIVE_NAME, mcpActive: true
    })
    const lockfile = join(DIR, `${String(ACTIVE_PID)}.json`)
    const raw = JSON.parse(await fs.readFile(lockfile, 'utf-8')) as Record<string, unknown>
    delete raw['mcpActive']
    await fs.writeFile(lockfile, JSON.stringify(raw), 'utf-8')

    expect(readAllLiveEntries(DIR).map((e) => e.name)).not.toContain(ACTIVE_NAME)
    expect(findLiveSessionByName(DIR, ACTIVE_NAME)).toBeNull()
  })
})
