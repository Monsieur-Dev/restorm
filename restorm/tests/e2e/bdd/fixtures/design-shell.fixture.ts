import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'

/** Scratch root for the project files these scenarios author. */
export const DESIGN_SHELL_TEMP_DIR = resolve(__dirname, '../../.tmp/design-shell')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

export interface DesignShellFixtures {
  restormRoot: string
  /** Launch the app. `plan` seeds the dev-only entitlement plan
   * (absent = Community — the gate scenarios rely on both states). */
  launchApp: (opts?: { plan?: 'pro' | 'enterprise' }) => Promise<LaunchedApp>
}

export const test = base.extend<DesignShellFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const launched: { app: ElectronApplication; logs: string[] }[] = []

    rmSync(DESIGN_SHELL_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(DESIGN_SHELL_TEMP_DIR, { recursive: true })

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')
    const launchArgs = [
      '--no-sandbox',
      '--ozone-platform=x11',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      mainJsPath
    ]

    const launcher = async (opts?: { plan?: 'pro' | 'enterprise' }): Promise<LaunchedApp> => {
      // A fresh isolated userData per launch: the gate scenarios launch
      // twice (community, then pro) and must not share entitlement state.
      const isolatedUserDataDir = createIsolatedUserDataDir(restormRoot)
      const baseEnv: Record<string, string> = {
        ...withE2ECoverageEnv(restormRoot, process.env),
        NODE_ENV: 'development',
        RESTORM_USER_DATA_OVERRIDE: isolatedUserDataDir,
        ECUI_DISABLE_GPU: '1',
        ...(opts?.plan !== undefined ? { RESTORM_E2E_ENTITLEMENT_PLAN: opts.plan } : {})
      }
      const bootstrap = await electron.launch({
        executablePath: electronExePath,
        args: [...launchArgs, '--clear-settings'],
        env: baseEnv
      })
      bootstrap.process().kill('SIGKILL')
      await new Promise((r) => setTimeout(r, 500))

      const app = await electron.launch({
        executablePath: electronExePath,
        args: launchArgs,
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
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await installSystemModalsMockingForE2E(app)
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

export { expect }
