/**
 * Fixture for the `sidebar-clone` BDD project: launches restorm with the
 * embedded MCP server enabled (same as `mcp-server.fixture.ts`) so scenarios
 * can BOTH drive the sidebar "Clone"/rename actions through the real UI
 * (Playwright) AND read back the exact ids/references a clone produced
 * (`callMcpTool` — `get_scenario`, `list_quick_configs`, …), which the UI
 * alone can't assert on precisely. Each scenario gets a clean userData dir
 * so state never leaks across tests.
 *
 * Copied from `mcp-server.fixture.ts` rather than shared/imported — every
 * suite here gets its own fixture file (see `git-mcp.fixture.ts`), so a
 * change to one project's launch semantics can't silently ripple into
 * another's.
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

export const SIDEBAR_CLONE_TEMP_DIR = resolve(__dirname, '../../.tmp/sidebar-clone')

function resetTempDir(): void {
  rmSync(SIDEBAR_CLONE_TEMP_DIR, { recursive: true, force: true })
  mkdirSync(SIDEBAR_CLONE_TEMP_DIR, { recursive: true })
}

export interface LaunchedMcpApp {
  app: ElectronApplication
  page: Page
  discovery: McpDiscovery
}

export interface SidebarCloneFixtures {
  restormRoot: string
  /** Fresh, uniquely-named scratch dir for this scenario's MCP-created
   * project — see `mcp-server.fixture.ts`'s `mcpServerTempDir` for the
   * per-test-isolation rationale (a shared fixed path is a cross-worker
   * hazard once ≥2 scenarios run together). */
  sidebarCloneTempDir: string
  /** Launch restorm (MCP on by default) with a launcher-extra discovery
   * file path, then read it back to recover `port + token`. Fresh isolated
   * userData dir per launch. */
  launchAppWithMcp: () => Promise<LaunchedMcpApp>
  /** Call an MCP tool over JSON-RPC (`tools/call`). */
  callMcpTool: (discovery: McpDiscovery, name: string, args?: Record<string, unknown>) => Promise<McpToolReply>
  /** Issue a raw JSON-RPC call — used once per launch for the `initialize`
   * handshake before any `tools/call`. */
  rawJsonRpc: (discovery: McpDiscovery, body: Record<string, unknown>) => Promise<McpJsonRpcResponse>
}

export const test = base.extend<SidebarCloneFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  sidebarCloneTempDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'restorm-sidebar-clone-'))
    await use(dir)
    rmSync(dir, { recursive: true, force: true })
  },

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
        // The env-folder scenario exercises the whole scenario domain
        // (create_scenario, create_scenario_node, …), which is Pro-gated —
        // see mcp-server.fixture.ts for the same seed and rationale.
        RESTORM_E2E_ENTITLEMENT_PLAN: 'pro'
      }
      const discoveryPath = join(tmpdir(), `restorm-sidebar-clone-e2e-${String(Date.now())}-${String(Math.floor(Math.random() * 1_000_000))}.json`)
      try { rmSync(discoveryPath, { force: true }) } catch { /* fine */ }

      const app = await electron.launch({
        executablePath: electronExePath,
        args: [
          '--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
          mainJsPath,
          '--clear-settings',
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
