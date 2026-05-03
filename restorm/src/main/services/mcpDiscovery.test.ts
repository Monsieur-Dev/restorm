import { describe, it, expect, vi, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron-core-ui', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import { writeMcpDiscoveryFile, cleanupMcpDiscoveryFile, MCP_DISCOVERY_DIR, type McpDiscoveryEntry } from './mcpDiscovery'

const FIXED_PID = 999_999

async function readEntry(path: string): Promise<McpDiscoveryEntry> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as McpDiscoveryEntry
}

afterEach(async () => {
  await cleanupMcpDiscoveryFile(FIXED_PID)
})

describe('mcpDiscovery', () => {
  it('round-trips the bearer token through the on-disk lockfile', async () => {
    const token = 'deadbeef'.repeat(4)
    await writeMcpDiscoveryFile({
      port: 12345,
      projectPath: '/tmp/example.restorm',
      pid: FIXED_PID,
      startedAt: '2026-05-03T00:00:00.000Z',
      token
    })

    const parsed = await readEntry(join(MCP_DISCOVERY_DIR, `${String(FIXED_PID)}.json`))
    expect(parsed).toEqual({
      port: 12345,
      projectPath: '/tmp/example.restorm',
      pid: FIXED_PID,
      startedAt: '2026-05-03T00:00:00.000Z',
      token
    })
  })

  it('writes the token into a launcher-specific extra file when given', async () => {
    const extraPath = join(tmpdir(), `restorm-mcp-launcher-test-${String(FIXED_PID)}.json`)
    const token = 'cafebabe'.repeat(4)
    await writeMcpDiscoveryFile({
      port: 23456,
      projectPath: null,
      pid: FIXED_PID,
      startedAt: '2026-05-03T00:00:00.000Z',
      token
    }, extraPath)

    try {
      const parsed = await readEntry(extraPath)
      expect(parsed.token).toBe(token)
      expect(parsed.port).toBe(23456)
    } finally {
      await fs.unlink(extraPath).catch(() => undefined)
    }
  })
})
