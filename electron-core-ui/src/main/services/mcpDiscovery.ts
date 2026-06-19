import { promises as fs, readdirSync, readFileSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { logger } from './LoggerService'

/**
 * MCP cross-instance bridge — generic discovery + transport.
 *
 * Multiple `--mcp` instances of the SAME Electron app can run at once, each
 * binding a free port and minting a bearer token. To let a single MCP client
 * (one launcher) reach a SPECIFIC instance, every instance drops a per-pid
 * lockfile into a shared discovery directory, and any instance can act as a
 * BRIDGE: a `tools/call` carrying the reserved `__session` key naming another
 * instance is forwarded there (port + token resolved from its lockfile) and
 * the response relayed verbatim. See {@link McpService} for the request-layer
 * plumbing that peels the key off before per-tool schema validation.
 *
 * Everything here is app-agnostic: the discovery DIRECTORY is the only
 * environment-specific input, and it's always passed in by the caller (use
 * {@link resolveMcpDiscoveryDir} for the conventional default). The on-disk
 * lockfile format is a stable contract — external launchers (e.g. a
 * standalone `mcp-launcher` script) read it without importing this module, so
 * the JSON shape must stay backward-compatible.
 */

/**
 * Reserved routing key the bridge peels off a `tools/call`'s `arguments`
 * before per-tool schema validation. Exported so consumers + external
 * launchers reference the exact key rather than re-spelling the magic string.
 */
export const MCP_SESSION_ROUTING_KEY = '__session'

/**
 * HTTP header set on a forwarded request so a forward never re-forwards. The
 * bridge refuses to forward again when it sees this header — a belt-and-
 * suspenders loop guard on top of the own-name short-circuit.
 */
export const MCP_FORWARDED_HEADER = 'x-mcp-forwarded'

export interface McpDiscoveryEntry {
  /** OS-picked port the MCP HTTP server is bound to. */
  port: number
  /** Path of the document/project this instance currently has open, if any
   * (lets a launcher route to a specific one later; first-live-wins for now).
   * `null` when the app has nothing open or doesn't track a path. */
  projectPath: string | null
  /** PID of the main process owning this entry. Used both as the filename
   * and as the liveness probe (`process.kill(pid, 0)`). */
  pid: number
  /** ISO-8601 timestamp of when the lockfile was written. Breaks ties when
   * several live instances share a name (most-recent wins). */
  startedAt: string
  /** Per-process bearer token. A bridge reads this and injects
   * `Authorization: Bearer <token>` on the forwarded HTTP request, so the
   * round-trip stays transparent while the MCP endpoint stays gated. */
  token: string
  /** Human-readable session name (e.g. a ticket name). Lets a client TARGET
   * a specific instance: a `tools/call` carrying `__session: "<name>"` is
   * routed to the instance whose lockfile records this exact name. */
  name: string
}

/**
 * Conventional discovery-dir resolution: an explicit override (typically an
 * env var the app + its launcher both read) pins a fixed path; otherwise fall
 * back to `os.tmpdir()/<appDirName>` (cross-platform, self-cleaning on
 * reboot). The app and any external launcher MUST resolve to the SAME path —
 * exporting the override to both removes the `os.tmpdir()` divergence race
 * when they run with different `TMPDIR`s.
 */
export function resolveMcpDiscoveryDir(appDirName: string, override?: string): string {
  const o = override?.trim()
  return o !== undefined && o !== '' ? o : join(tmpdir(), appDirName)
}

function lockfilePath(dir: string, pid: number): string {
  return join(dir, `${String(pid)}.json`)
}

/**
 * Atomically write the discovery lockfile for this instance into `dir`.
 * Mkdir the parent on first use. Writes via tmp + rename so a reader never
 * sees a half-written file. Best-effort — failures are logged but never throw
 * (the app just loses launcher auto-discovery; manual port pinning still
 * works). `extraPath` writes a second copy at an exact path (e.g. a launcher
 * polling a `--mcp-discovery-file`).
 */
export async function writeMcpDiscoveryFile(dir: string, entry: McpDiscoveryEntry, extraPath?: string): Promise<void> {
  try {
    // The lockfile carries the MCP bearer `token`, so keep both the dir and
    // the file owner-only (0700/0600) — on a shared host another local user
    // could otherwise read the token and reach the loopback MCP endpoint.
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const json = JSON.stringify(entry)
    const target = lockfilePath(dir, entry.pid)
    const tmp = `${target}.${String(process.pid)}.tmp`
    await fs.writeFile(tmp, json, { encoding: 'utf8', mode: 0o600 })
    await fs.rename(tmp, target)

    if (extraPath && extraPath !== target) {
      const extraTmp = `${extraPath}.${String(process.pid)}.tmp`
      await fs.mkdir(dirname(extraPath), { recursive: true, mode: 0o700 })
      await fs.writeFile(extraTmp, json, { encoding: 'utf8', mode: 0o600 })
      await fs.rename(extraTmp, extraPath)
    }
  } catch (error) {
    // Do NOT log `entry.token` — it's the bearer secret for the MCP HTTP
    // endpoint. Restrict log payloads to identifying-but-not-sensitive fields.
    logger.warn('[mcpDiscovery] failed to write discovery file', {
      pid: entry.pid,
      port: entry.port,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Best-effort cleanup of an instance's lockfile(s) on shutdown. */
export async function cleanupMcpDiscoveryFile(dir: string, pid: number, extraPath?: string): Promise<void> {
  const targets = [lockfilePath(dir, pid), ...(extraPath ? [extraPath] : [])]
  for (const path of targets) {
    try {
      await fs.unlink(path)
    } catch {
      // Already gone / never written — nothing to clean up.
    }
  }
}

/** Liveness check: ESRCH = dead, EPERM = alive but owned by another user
 * (still counts as live). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Trust a discovery file only if the CURRENT user owns it. The lockfile carries
 * the MCP bearer token, so a file planted by another local user must not be read
 * + routed to. On POSIX we compare the file's owner uid to ours.
 *
 * Windows caveat: NTFS has no Unix uid (Node reports `uid: 0` for everyone), so
 * this check can't distinguish owners there — we fall back to trusting the file.
 * The dir is created 0700 on POSIX; on a shared Windows host the discovery dir
 * should live under a per-user profile path for the same guarantee.
 */
function isOwnedByCurrentUser(filePath: string): boolean {
  if (process.platform === 'win32') return true
  try {
    return statSync(filePath).uid === userInfo().uid
  } catch {
    return false
  }
}

/**
 * Find a live discovery entry in `dir` whose `name` matches verbatim. Scans
 * the dir synchronously (small, loopback-only), filters to parseable
 * lockfiles with an alive pid and a usable port/token. Returns the most-recent
 * match (ISO `startedAt`, ties broken on `pid`) or `null`.
 *
 * The pid check is a cheap liveness gate; the actual HTTP forward that follows
 * is the real reachability test (a dead endpoint just fails the POST, which
 * the caller turns into a clean JSON-RPC error).
 */
export function findLiveSessionByName(dir: string, name: string): McpDiscoveryEntry | null {
  let dirents: import('fs').Dirent[]
  try {
    dirents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const matches: McpDiscoveryEntry[] = []
  for (const e of dirents) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue
    const filePath = join(dir, e.name)
    // Don't read (or trust the token in) a discovery file owned by another user.
    if (!isOwnedByCurrentUser(filePath)) continue
    let parsed: Partial<McpDiscoveryEntry>
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<McpDiscoveryEntry>
    } catch {
      continue
    }
    if (parsed.name !== name) continue
    const pid = Number(parsed.pid)
    const port = Number(parsed.port)
    if (!Number.isInteger(pid) || !Number.isInteger(port) || port <= 0) continue
    if (typeof parsed.token !== 'string') continue
    if (!isPidAlive(pid)) continue
    matches.push(parsed as McpDiscoveryEntry)
  }
  if (matches.length === 0) return null
  // Most-recent wins. Break ISO-`startedAt` ties on `pid` (descending) so a
  // same-name collision still routes deterministically — two instances
  // started in the same clock-second must not resolve by filesystem
  // iteration order.
  matches.sort((a, b) => {
    const byStarted = (b.startedAt || '').localeCompare(a.startedAt || '')
    return byStarted !== 0 ? byStarted : b.pid - a.pid
  })
  if (matches.length > 1) {
    // Session names are meant to be unique addresses. Two live instances
    // sharing one name is almost always an accident (e.g. two checkouts
    // opening the same project basename); we route to the most-recent but
    // surface the ambiguity so it can be fixed with an explicit name.
    logger.warn('[mcpDiscovery] multiple live MCP sessions share a name; routing to the most recent', {
      name,
      count: matches.length
    })
  }
  return matches[0] ?? null
}

/**
 * Read all parseable lockfiles in `dir`, filter to entries whose pid is
 * alive, and return the full {@link McpDiscoveryEntry} objects (including
 * the bearer token). Does NOT do an HTTP liveness probe — the faster
 * synchronous pid check is enough to prune stale entries here; the caller
 * (the `list-instances` tool) runs the async probe in a second pass.
 *
 * The token is included so the caller can use it for the HTTP probe.
 * Callers MUST NOT expose the token in any user-visible output — strip
 * it before returning a response (the `list-instances` handler does so).
 *
 * Returns an empty array when `dir` does not exist or is unreadable.
 */
export function readAllLiveEntries(dir: string): McpDiscoveryEntry[] {
  let dirents: import('fs').Dirent[]
  try {
    dirents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: McpDiscoveryEntry[] = []
  for (const e of dirents) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue
    let parsed: Partial<McpDiscoveryEntry>
    try {
      parsed = JSON.parse(readFileSync(join(dir, e.name), 'utf8')) as Partial<McpDiscoveryEntry>
    } catch {
      continue
    }
    const pid = Number(parsed.pid)
    const port = Number(parsed.port)
    if (!Number.isInteger(pid) || !Number.isInteger(port) || port <= 0) continue
    if (typeof parsed.token !== 'string') continue
    if (typeof parsed.name !== 'string') continue
    if (!isPidAlive(pid)) continue
    out.push({
      pid,
      port,
      token: parsed.token,
      name: parsed.name,
      projectPath: typeof parsed.projectPath === 'string' ? parsed.projectPath : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : ''
    })
  }
  return out
}

/**
 * Confirm that a given `(port, token)` pair points at a live MCP
 * endpoint by sending a minimal JSON-RPC `initialize` POST. Returns
 * `true` on a 2xx response, `false` on any other status, network error,
 * or timeout. Bounded by `timeoutMs` (default 800 ms — same cap used by
 * the external launcher) so a wedged peer can't stall the probe loop.
 *
 * Used by the `list-instances` tool to confirm each pid-alive candidate
 * actually has a reachable HTTP endpoint (e.g. filters out pid-reuse
 * after a crash where the port was taken by an unrelated process).
 */
export function probeMcpEndpoint(port: number, token: string, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0) { resolve(false); return }
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: 'ecui-probe',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ecui-list-instances', version: '0.0.0' }
      }
    })
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': `Bearer ${token}`
    }
    let settled = false
    const settle = (ok: boolean): void => { if (!settled) { settled = true; resolve(ok) } }
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/', method: 'POST', headers },
      (res) => {
        const ok = typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 300
        // Drain so the socket can close cleanly; we only care about the status.
        res.on('data', () => { /* drain */ })
        res.on('end', () => { settle(ok) })
        res.on('error', () => { settle(false) })
      }
    )
    req.setTimeout(timeoutMs, () => { req.destroy(); settle(false) })
    req.on('error', () => { settle(false) })
    req.write(payload)
    req.end()
  })
}

/**
 * Forward a raw JSON-RPC payload to a named live instance discovered in `dir`,
 * over its loopback MCP endpoint: POST `/` with `Authorization: Bearer
 * <token>` and the streamable-HTTP `Accept`, returning the raw
 * `{ status, body, contentType? }` so the bridge can relay it verbatim.
 * Bounded by `timeoutMs` so a wedged peer can't hang the bridge. Returns
 * `null` when the target isn't live or the request errors / times out — the
 * caller then answers a clean JSON-RPC error.
 */
export function forwardToNamedSession(
  dir: string,
  name: string,
  jsonRpcText: string,
  timeoutMs = 30_000
): Promise<{ status: number; body: string; contentType?: string } | null> {
  const entry = findLiveSessionByName(dir, name)
  if (!entry) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const settle = (v: { status: number; body: string; contentType?: string } | null): void => {
      if (!settled) { settled = true; resolve(v) }
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': String(Buffer.byteLength(jsonRpcText)),
      'Authorization': `Bearer ${entry.token}`,
      [MCP_FORWARDED_HEADER]: '1'
    }
    const req = httpRequest(
      { host: '127.0.0.1', port: entry.port, path: '/', method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = []
        const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : undefined
        res.on('data', (c: Buffer) => { chunks.push(c) })
        res.on('end', () => {
          settle({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), ...(contentType ? { contentType } : {}) })
        })
        res.on('error', () => { settle(null) })
      }
    )
    req.setTimeout(timeoutMs, () => { req.destroy(); settle(null) })
    req.on('error', () => { settle(null) })
    req.write(jsonRpcText)
    req.end()
  })
}
