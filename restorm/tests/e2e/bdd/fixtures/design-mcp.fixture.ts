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
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import electronPath from 'electron'
import {
  installSystemModalsMockingForE2E,
  postMcpJsonRpc,
  callMcpToolOverJsonRpc,
  readMcpDiscoveryWithRetry,
  type McpDiscovery,
  type McpJsonRpcResponse,
  type McpToolReply
} from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'

export type { McpDiscovery, McpJsonRpcResponse, McpToolReply }

export const DESIGN_MCP_TEMP_DIR = resolve(__dirname, '../../.tmp/design-mcp')

function resetTempDir(): void {
  rmSync(DESIGN_MCP_TEMP_DIR, { recursive: true, force: true })
  mkdirSync(DESIGN_MCP_TEMP_DIR, { recursive: true })
}

export interface LaunchedMcpApp {
  app: ElectronApplication
  page: Page
  discovery: McpDiscovery
}

export interface DesignMcpFixtures {
  restormRoot: string
  /**
   * A fresh, uniquely-named scratch dir for THIS scenario's MCP-created
   * projects (`mkdtempSync`, torn down after the scenario). Was previously
   * ONE fixed path shared across the whole run, wiped-and-recreated at every
   * scenario's launch — safe for a single scenario in isolation, but a
   * cross-worker hazard once ≥2 projects sharing this fixture run together
   * (the default `pnpm test:e2e`/CI/pre-push shape): one scenario's startup
   * wipe would delete another concurrently-running scenario's in-flight
   * files. Per-test isolation removes the shared mutable state entirely — no
   * scenario can ever touch another's dir, regardless of scheduling.
   */
  designMcpTempDir: string
  /**
   * Launch restorm (MCP on by default) with a launcher-extra discovery file
   * path, then read it back to recover `port + token`. Resolves once both are
   * known. Fresh isolated userData dir per launch.
   */
  launchAppWithMcp: (opts?: { plan?: 'pro' | 'enterprise' | null }) => Promise<LaunchedMcpApp> // () => Promise<LaunchedMcpApp>
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

export const test = base.extend<DesignMcpFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  designMcpTempDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'restorm-design-mcp-'))
    await use(dir)
    rmSync(dir, { recursive: true, force: true })
  },

  launchAppWithMcp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []
    resetTempDir()

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const launcher = async (opts?: { plan?: 'pro' | 'enterprise' | null }): Promise<LaunchedMcpApp> => {
      const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
      const baseEnv = {
        ...withE2ECoverageEnv(restormRoot, process.env),
        NODE_ENV: 'development',
        RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
        ECUI_DISABLE_GPU: '1',
        // Pro by default; the Community-refusal scenario passes
        // `plan: null` to boot without a seeded entitlement.
        ...(opts?.plan !== null ? { RESTORM_E2E_ENTITLEMENT_PLAN: opts?.plan ?? 'pro' } : {})
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
      const discovery = await readMcpDiscoveryWithRetry(discoveryPath)
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
    await use((discovery, name, args = {}) => callMcpToolOverJsonRpc(discovery, name, args))
  },

  rawJsonRpc: async ({}, use) => {
    await use((discovery, body) => postMcpJsonRpc(discovery, body))
  }
})

export { expect }
