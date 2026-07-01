import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'

export { expect }
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'

export const SCENARIO_CODE_DEPS_TEMP_DIR = resolve(__dirname, '../../.tmp/scenario-code-deps')
const RESTORM_ROOT = resolve(__dirname, '../../../..')
/** Pre-provisioned offline package mirror (a committed tiny zero-dep pure-Python
 * wheel) — `RESTORM_CODE_DEPS_OFFLINE_DIR` makes the installer satisfy the pinned
 * dependency from here with ZERO network, so the deps flow is deterministic and
 * never touches a live PyPI. Laid out exactly like the cache: `<lang>/<name>@<version>/<artifact>`. */
const OFFLINE_MIRROR_DIR = resolve(__dirname, '../../samples/code-deps-offline')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

export interface ScenarioCodeDepsFixtures {
  restormRoot: string
  launchApp: () => Promise<LaunchedApp>
}

export const test = base.extend<ScenarioCodeDepsFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []

    rmSync(SCENARIO_CODE_DEPS_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(SCENARIO_CODE_DEPS_TEMP_DIR, { recursive: true })

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    // A FRESH isolated userData for the whole test, kept across the two runs in
    // the single app session.
    const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
    // The code-deps cache lives under the OS temp dir (`app.getPath('temp')`).
    // Isolate that per test via TMPDIR so a run starts with an EMPTY cache — the
    // golden expects the first-run "Downloading" line, and the cache-reuse
    // scenario needs a genuine first-run miss then a second-run hit (both runs
    // share this one dir within the single app session).
    const isolatedTempDir = mkdtempSync(join(tmpdir(), 'restorm-code-deps-e2e-'))
    const baseEnv = {
      ...withE2ECoverageEnv(restormRoot, process.env),
      NODE_ENV: 'development',
      RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
      RESTORM_CODE_DEPS_OFFLINE_DIR: OFFLINE_MIRROR_DIR,
      TMPDIR: isolatedTempDir,
      TMP: isolatedTempDir,
      TEMP: isolatedTempDir,
      ECUI_DISABLE_GPU: '1',
      TZ: 'UTC'
    }

    const launcher = async (): Promise<LaunchedApp> => {
      const bootstrap = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', mainJsPath, '--clear-settings'],
        env: baseEnv
      })
      bootstrap.process().kill('SIGKILL')
      await new Promise((r) => setTimeout(r, 300))

      const app = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', mainJsPath],
        env: baseEnv
      })

      const logs: string[] = []
      app.process().stdout?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
          const trimmed = line.trim()
          if (trimmed) logs.push(`[main:out] ${trimmed}`)
        }
      })
      app.process().stderr?.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
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
      await installSystemModalsMockingForE2E(app)
      await page.evaluate(() => {
        window.confirm = () => true
        window.alert = () => undefined
      })
      await page.waitForTimeout(1500)

      launched.push({ app, logs })
      return { app, page }
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
  }
})
