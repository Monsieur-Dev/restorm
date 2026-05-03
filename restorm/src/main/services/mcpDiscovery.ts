import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { logger } from 'electron-core-ui'

/**
 * Where running restorm instances drop their per-pid lockfile so MCP
 * launchers can find them. Kept under `os.tmpdir()` so it's
 * cross-platform and self-cleaning on reboot.
 */
export const MCP_DISCOVERY_DIR = join(tmpdir(), 'restorm-mcp')

export interface McpDiscoveryEntry {
  /** OS-picked port the MCP HTTP server is bound to. */
  port: number
  /** Currently-open project file path, if any (helps the launcher
   * route to a specific project later — first-live-wins for now). */
  projectPath: string | null
  /** PID of the restorm main process owning this entry. Used both as
   * the filename and as the liveness probe (`process.kill(pid, 0)`). */
  pid: number
  /** ISO-8601 timestamp of when the lockfile was written. Lets the
   * launcher pick the most-recent entry when several are live. */
  startedAt: string
  /** Per-process bearer token. The launcher reads this and injects
   * `Authorization: Bearer <token>` on every forwarded HTTP request, so
   * the round-trip stays transparent for Claude Code / Cursor while the
   * MCP endpoint stays gated against unauthenticated callers. */
  token: string
}

function lockfilePath(pid: number): string {
  return join(MCP_DISCOVERY_DIR, `${String(pid)}.json`)
}

/**
 * Atomically write the discovery lockfile for this restorm instance.
 * Mkdir the parent dir on first use. Writes via tmp + rename so a
 * launcher never reads a half-written file. Best-effort — failures are
 * logged but don't take down restorm; the user just loses launcher
 * auto-discovery (manual port pinning still works as a fallback).
 */
export async function writeMcpDiscoveryFile(entry: McpDiscoveryEntry, extraPath?: string): Promise<void> {
  try {
    await fs.mkdir(MCP_DISCOVERY_DIR, { recursive: true })
    const json = JSON.stringify(entry)
    const target = lockfilePath(entry.pid)
    const tmp = `${target}.${String(process.pid)}.tmp`
    await fs.writeFile(tmp, json, 'utf8')
    await fs.rename(tmp, target)

    if (extraPath && extraPath !== target) {
      // The launcher passed `--mcp-discovery-file=<path>` so it can
      // poll that exact path after spawning us — write it too. Same
      // atomic-rename pattern.
      const extraTmp = `${extraPath}.${String(process.pid)}.tmp`
      await fs.mkdir(join(extraPath, '..'), { recursive: true })
      await fs.writeFile(extraTmp, json, 'utf8')
      await fs.rename(extraTmp, extraPath)
    }
  } catch (error) {
    logger.warn('[mcpDiscovery] failed to write discovery file', {
      pid: entry.pid,
      port: entry.port,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Best-effort cleanup of this instance's lockfile on shutdown. */
export async function cleanupMcpDiscoveryFile(pid: number, extraPath?: string): Promise<void> {
  const targets = [lockfilePath(pid), ...(extraPath ? [extraPath] : [])]
  for (const path of targets) {
    try {
      await fs.unlink(path)
    } catch {
      // File already gone or never written — fine.
    }
  }
}
