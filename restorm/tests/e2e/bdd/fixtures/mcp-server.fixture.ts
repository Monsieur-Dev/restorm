/**
 * Fixture for the `mcp-server` BDD project: launches restorm with the
 * embedded MCP server enabled, then exposes a JSON-RPC helper the
 * scenarios use to drive the server end-to-end the same way Claude or
 * Cursor would. Each scenario gets a clean userData dir so MCP-state
 * never leaks across tests.
 *
 * The discovery file restorm writes (with `port + token + pid`) lives
 * in `os.tmpdir()/restorm-mcp/<pid>.json`. We read it through the
 * launcher-extra path the CLI flag accepts (`--mcp-discovery-file`)
 * because that's the path real launchers use too — same code path,
 * same race conditions, same retries.
 */

import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'

export const MCP_SERVER_TEMP_DIR = resolve(__dirname, '../../.tmp/mcp-server')

function resetTempDir(): void {
  rmSync(MCP_SERVER_TEMP_DIR, { recursive: true, force: true })
  mkdirSync(MCP_SERVER_TEMP_DIR, { recursive: true })
}

export interface McpDiscovery {
  port: number
  token: string
  projectPath: string | null
  pid: number
  startedAt: string
}

export interface McpJsonRpcResponse {
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

export interface McpToolReply {
  content?: { type: string; text?: string }[]
  isError?: boolean
}

export interface LaunchedMcpApp {
  app: ElectronApplication
  page: Page
  discovery: McpDiscovery
}

export interface McpServerFixtures {
  restormRoot: string
  /**
   * Launch restorm (MCP on by default) with a launcher-extra discovery file
   * path, then read it back to recover `port + token`. Resolves once both are
   * known. Fresh isolated userData dir per launch.
   */
  launchAppWithMcp: () => Promise<LaunchedMcpApp>
  /**
   * Call an MCP tool over JSON-RPC. Returns the raw result envelope —
   * scenarios are expected to assert on the parsed text content.
   */
  callMcpTool: (discovery: McpDiscovery, name: string, args?: Record<string, unknown>) => Promise<McpToolReply>
  /**
   * Issue a raw JSON-RPC call. Useful for `tools/list` / `initialize`
   * roundtrips that don't fit the `tools/call` shape.
   */
  rawJsonRpc: (discovery: McpDiscovery, body: Record<string, unknown>) => Promise<McpJsonRpcResponse>
}

let nextRpcId = 1

async function postJsonRpc(discovery: McpDiscovery, body: Record<string, unknown>): Promise<McpJsonRpcResponse> {
  // The MCP Streamable-HTTP transport accepts JSON-RPC over POST. The
  // SDK negotiates a session via headers; for a stateless server one
  // request = one response is fine. Accept both `application/json` and
  // `text/event-stream` so the SDK's negotiation doesn't 406.
  const url = `http://127.0.0.1:${String(discovery.port)}/mcp`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${discovery.token}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextRpcId++, ...body })
  })
  if (!response.ok) {
    throw new Error(`MCP HTTP error ${String(response.status)}: ${await response.text()}`)
  }
  // Streamable HTTP can reply as SSE-framed `event: message\ndata: …` or
  // as a single JSON object. Detect by content-type and parse the right
  // shape — the JSON-RPC envelope is the same either way.
  const ct = response.headers.get('content-type') ?? ''
  if (ct.includes('text/event-stream')) {
    const raw = await response.text()
    const dataLine = raw.split('\n').find((l) => l.startsWith('data:'))
    if (!dataLine) throw new Error(`MCP SSE reply had no data frame: ${raw.slice(0, 200)}`)
    return JSON.parse(dataLine.slice(5).trim()) as McpJsonRpcResponse
  }
  return await response.json() as McpJsonRpcResponse
}

async function readDiscoveryWithRetry(path: string, timeoutMs = 15_000): Promise<McpDiscovery> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      if (existsSync(path)) {
        const raw = readFileSync(path, 'utf-8')
        const parsed = JSON.parse(raw) as McpDiscovery
        if (parsed.port && parsed.token) return parsed
      }
    } catch (err) {
      lastError = err
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out reading MCP discovery file at ${path}: ${String(lastError)}`)
}

export const test = base.extend<McpServerFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  launchAppWithMcp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []
    resetTempDir()

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const launcher = async (): Promise<LaunchedMcpApp> => {
      const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
      const baseEnv = {
        ...withE2ECoverageEnv(restormRoot, process.env),
        NODE_ENV: 'development',
        RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
        ECUI_DISABLE_GPU: '1',
        // The mcp-server e2e exercises Pro-gated tools (e.g. set_tab_maximized is
        // UI automation = Pro). Boot with a seeded Pro entitlement so the gate
        // passes in this dev-only harness (dead code in packaged builds).
        RESTORM_E2E_ENTITLEMENT_PLAN: 'pro'
      }
      const discoveryPath = join(tmpdir(), `restorm-mcp-e2e-${String(Date.now())}-${String(Math.floor(Math.random() * 1_000_000))}.json`)
      try { rmSync(discoveryPath, { force: true }) } catch { /* fine */ }

      const app = await electron.launch({
        executablePath: electronExePath,
        args: [
          '--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
          mainJsPath,
          '--clear-settings',
          // MCP is on by default now (governed by the setting, ON by default) —
          // no `--mcp` flag exists anymore. xvfb provides a DISPLAY so the
          // headless rule keeps MCP on under the e2e harness.
          `--mcp-discovery-file=${discoveryPath}`
        ],
        env: baseEnv
      })

      const logs: string[] = []
      app.process().stdout?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n')) {
          const trimmed = line.trim()
          if (trimmed) logs.push(`[main:out] ${trimmed}`)
        }
      })
      app.process().stderr?.on('data', (data: Buffer) => {
        for (const line of data.toString().split('\n')) {
          const trimmed = line.trim()
          if (trimmed) logs.push(`[main:err] ${trimmed}`)
        }
      })
      app.on('window', (p) => {
        p.on('console', (msg) => { logs.push(`[renderer:${msg.type()}] ${msg.text()}`) })
        p.on('pageerror', (err) => { logs.push(`[renderer:pageerror] ${err.message}\n${err.stack ?? ''}`) })
        p.on('dialog', (dialog) => { void dialog.accept() })
      })

      const page = await app.firstWindow()
      await page.waitForLoadState('load')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await installSystemModalsMockingForE2E(app)
      await page.evaluate(() => {
        window.confirm = () => true
        window.alert = () => undefined
      })
      // Allow main-process boot to finish writing the discovery file.
      const discovery = await readDiscoveryWithRetry(discoveryPath)
      launched.push({ app, logs })
      return { app, page, discovery }
    }

    await use(launcher)

    mkdirSync(testInfo.outputDir, { recursive: true })
    for (const { app, logs } of launched) {
      try {
        if (logs.length > 0) {
          const logFile = join(testInfo.outputDir, 'electron-logs.txt')
          writeFileSync(logFile, logs.join('\n'), 'utf-8')
          await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
        }
      } catch { /* ignore */ }
      try { app.process().kill('SIGKILL') } catch { /* ignore */ }
    }
  },

  callMcpTool: async ({}, use) => {
    await use(async (discovery, name, args = {}) => {
      const reply = await postJsonRpc(discovery, {
        method: 'tools/call',
        params: { name, arguments: args }
      })
      if (reply.error) throw new Error(`MCP tool ${name} failed: ${reply.error.message}`)
      return (reply.result ?? {}) as McpToolReply
    })
  },

  rawJsonRpc: async ({}, use) => {
    await use((discovery, body) => postJsonRpc(discovery, body))
  }
})

export { expect }
