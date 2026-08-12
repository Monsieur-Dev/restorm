import { gitServerWorkerFixture, type StartedGitServer } from '../../helpers/testcontainers/gitServer'
/**
 * Fixture for the `git-mcp` BDD project: launches restorm with the
 * embedded MCP server enabled AND a git-tracked project, so scenarios can
 * drive the MCP git routes (`git_commit_push`/`git_confirm_push`/
 * `git_pull`/`git_resolve_conflicts`) end-to-end the same way an
 * external agent (Claude, Cursor, ...) would — no UI interaction at
 * all, `open_project` opens the file over MCP too.
 *
 * Built fresh rather than composing `git-integration.fixture.ts` (whose
 * `launchApp` does a bootstrap→kill→relaunch dance purely to recover the
 * userData path for dialog-mocking setup this suite never needs — MCP's
 * `open_project` tool opens a file by path directly, no native dialog)
 * or `mcp-server.fixture.ts` (restorm-specific, no git clone/seed
 * helpers). Reuses the generic JSON-RPC helpers from
 * `electron-core-ui/testing` (the same ones `mcp-server.fixture.ts` uses)
 * and `gitServerSeed.ts`'s host-side seeding primitives directly.
 */

import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import electronPath from 'electron'
import {
  postMcpJsonRpc,
  callMcpToolOverJsonRpc,
  readMcpDiscoveryWithRetry,
  type McpDiscovery,
  type McpJsonRpcResponse,
  type McpToolReply
} from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'
import { seedFreshRepo as seedFreshRepoOnRemote, gitServerUrlFor, gitEnv } from '../../../integration/gitServerSeed'

export type { McpDiscovery, McpJsonRpcResponse, McpToolReply }

const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface LaunchedMcpApp {
  app: ElectronApplication
  page: Page
  discovery: McpDiscovery
}

export interface GitMcpFixtures {
  restormRoot: string
  /** Per-scenario scratch root for git working copies (`mkdtempSync`,
   * torn down after the scenario) — see `git-integration.fixture.ts`'s
   * `gitIntegrationRoot` for the incident this pattern avoids repeating
   * (a shared, wiped-at-setup root races across concurrently-running
   * scenarios in different Playwright workers). */
  gitIntegrationRoot: string
  /** Seed a FRESH, scenario-scoped remote and clone it, returning the
   * `.restorm` path — mirrors `git-integration.fixture.ts`'s helper of
   * the same name (every scenario here mutates its own remote, so no
   * scenario shares a repo with another). */
  seedFreshRepo: (repoName: string) => Promise<string>
  /** Clone an EXISTING repo (already seeded via `seedFreshRepo` earlier
   * in the SAME scenario) into a new directory, returning the clone dir. */
  cloneNamedRepo: (repoName: string, dirName: string) => Promise<string>
  /** Launch restorm with MCP on + a discovery file, resolving once the
   * discovery file (`port` + `token`) is readable. Fresh isolated
   * userData dir per launch — no project pre-opened; scenarios call the
   * `open_project` MCP tool themselves. */
  launchAppWithMcp: () => Promise<LaunchedMcpApp>
  callMcpTool: (discovery: McpDiscovery, name: string, args?: Record<string, unknown>) => Promise<McpToolReply>
  rawJsonRpc: (discovery: McpDiscovery, body: Record<string, unknown>) => Promise<McpJsonRpcResponse>
}

function run(command: string, cwd?: string): void {
  execSync(command, { cwd, stdio: 'ignore', env: gitEnv() })
}

export const test = base.extend<GitMcpFixtures, { gitServer: StartedGitServer }>({
  // This suite runs its OWN git daemon (worker-scoped, ephemeral port,
  // mkdtemp repos dir) — the seed-module helpers are routed at it.
  gitServer: gitServerWorkerFixture(),
  restormRoot: [RESTORM_ROOT, { option: true }],

  gitIntegrationRoot: async ({ gitServer: _gitServer }, use) => {
    const root = mkdtempSync(join(tmpdir(), 'restorm-git-mcp-'))
    await use(root)
    rmSync(root, { recursive: true, force: true })
  },

  seedFreshRepo: async ({ gitIntegrationRoot }, use) => {
    await use((repoName: string) => {
      const url = seedFreshRepoOnRemote(repoName)
      const workingCopy = join(gitIntegrationRoot, repoName)
      rmSync(workingCopy, { recursive: true, force: true })
      run(`git clone "${url}" "${workingCopy}"`)
      return Promise.resolve(join(workingCopy, 'api.restorm'))
    })
  },

  cloneNamedRepo: async ({ gitIntegrationRoot }, use) => {
    await use((repoName: string, dirName: string) => {
      const workingCopy = join(gitIntegrationRoot, dirName)
      rmSync(workingCopy, { recursive: true, force: true })
      run(`git clone "${gitServerUrlFor(repoName)}" "${workingCopy}"`)
      return Promise.resolve(workingCopy)
    })
  },

  launchAppWithMcp: async ({ restormRoot, gitServer: _gitServer }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const launcher = async (): Promise<LaunchedMcpApp> => {
      const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
      const baseEnv = {
        ...withE2ECoverageEnv(restormRoot, process.env),
        NODE_ENV: 'development',
        RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
        ECUI_DISABLE_GPU: '1',
        // The git MCP routes are Pro-gated (`git.client`, see
        // `mcpProGate.ts`) — seed the dev-only Pro entitlement so the
        // gate passes in this harness (dead code in packaged builds).
        RESTORM_E2E_ENTITLEMENT_PLAN: 'pro'
      }
      const discoveryPath = join(tmpdir(), `restorm-git-mcp-e2e-${String(Date.now())}-${String(Math.floor(Math.random() * 1_000_000))}.json`)
      try { rmSync(discoveryPath, { force: true }) } catch { /* fine */ }

      const app = await electron.launch({
        executablePath: electronExePath,
        args: [
          '--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
          mainJsPath,
          '--clear-settings',
          // MCP is on by default (governed by a setting) — xvfb provides a
          // DISPLAY so the headless rule keeps it on under this harness.
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

      // Allow main-process boot to finish writing the discovery file.
      const discovery = await readMcpDiscoveryWithRetry(discoveryPath)
      launched.push({ app, logs })
      return { app, page, discovery }
    }

    await use(launcher)

    mkdirSync(testInfo.outputDir, { recursive: true })
    const blockingErrors: string[] = []
    for (const { app, logs } of launched) {
      blockingErrors.push(...collectBlockingRendererMessages(logs))
      try {
        if (logs.length > 0) {
          const logFile = join(testInfo.outputDir, 'electron-logs.txt')
          writeFileSync(logFile, logs.join('\n'), 'utf-8')
          await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
        }
      } catch { /* ignore */ }
      try { app.process().kill('SIGKILL') } catch { /* ignore */ }
    }

    if (blockingErrors.length > 0 && testInfo.status === 'passed') {
      const logFile = join(testInfo.outputDir, 'renderer-errors.txt')
      writeFileSync(logFile, blockingErrors.join('\n\n'), 'utf-8')
      await testInfo.attach('renderer-errors', { path: logFile, contentType: 'text/plain' })
      throw new Error(summariseBlockingMessages(blockingErrors))
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
