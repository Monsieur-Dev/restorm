import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'

/**
 * Scratch root for files the dirty-state scenarios create (single-file
 * collections, folder-mode roots, …). Wiped on every scenario start.
 */
export const DIRTY_STATE_TEMP_DIR = resolve(__dirname, '../../.tmp/dirty-state')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  configPath: string
}

export interface DirtyStateFixtures {
  restormRoot: string
  launchApp: () => Promise<LaunchedApp>
}

/**
 * Shared launcher — bootstraps with `--clear-settings` to discover the
 * userData path, then relaunches for real. Logs (main stdout/stderr +
 * renderer console + page errors) are captured and attached on teardown;
 * a failure screenshot is saved when the test doesn't pass.
 */
export const test = base.extend<DirtyStateFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []
    let configPath: string | null = null

    rmSync(DIRTY_STATE_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(DIRTY_STATE_TEMP_DIR, { recursive: true })

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    // Per-scenario userData isolation. See full-workflow.fixture.ts
    // for the full rationale; bootstrap + real launch share the same dir.
    const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
    const baseEnv = {
      ...withE2ECoverageEnv(restormRoot, process.env),
      NODE_ENV: 'development',
      RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
      ECUI_DISABLE_GPU: '1'
    }

    const launcher = async (): Promise<LaunchedApp> => {
      // Bootstrap pass with --clear-settings: isolates this scenario's
      // userData from anything the previous run may have left behind.
      const bootstrap = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath, '--clear-settings'],
        env: baseEnv
      })
      const userDataPath = await bootstrap.evaluate(({ app }) => app.getPath('userData'))
      configPath = join(userDataPath, 'config.json')
      bootstrap.process().kill('SIGKILL')
      await new Promise((r) => setTimeout(r, 300))

      const app = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath],
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
        p.on('pageerror', (err) => {
          logs.push(`[renderer:pageerror] ${err.message}\n${err.stack ?? ''}`)
        })
        p.on('dialog', (dialog) => { void dialog.accept() })
      })

      const page = await app.firstWindow()
      await page.waitForLoadState('load')
      // Reduce motion: snaps the FilesPanel star toggle to its target
      // frame instead of playing the lottie burst, keeping
      // close-then-reopen round-trip tests fast.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      // Strict system-modals mock — any unconfigured native dialog throws.
      await installSystemModalsMockingForE2E(app)
      await page.evaluate(() => {
        window.confirm = () => true
        window.alert = () => undefined
      })
      await page.waitForTimeout(1500)

      launched.push({ app, logs })
      if (!configPath) throw new Error('userData path discovery failed')
      return { app, page, configPath }
    }

    ;(globalThis as unknown as { __dirtyStateLaunched?: typeof launched }).__dirtyStateLaunched = launched

    await use(launcher)

    mkdirSync(testInfo.outputDir, { recursive: true })

    // Scan the captured renderer output for critical signals
    // (`Maximum update depth exceeded`, `getSnapshot should be cached`,
    // any `[renderer:error]`/`[renderer:pageerror]`). See
    // `helpers/renderer-log-guard.ts`.
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

/**
 * Expose the currently-running Electron app so steps can configure
 * `configureNext*DialogForE2E` against the last launched instance.
 */
export function currentElectronApp(): ElectronApplication | null {
  const launched = (globalThis as unknown as { __dirtyStateLaunched?: { app: ElectronApplication }[] }).__dirtyStateLaunched ?? []
  const current = launched[launched.length - 1]
  return current?.app ?? null
}

export { expect }
