import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E, configureNextSaveFileDialogForE2E, configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'

// Temporary diagnostic fixture — mirrors the swagger-import one but
// without the renderer-log-guard teardown that gates on critical
// errors. This is for a throwaway visual debug test, not CI.
export const AUTH_DEBUG_TEMP_DIR = resolve(__dirname, '../../.tmp/auth-modal-debug')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface AuthDebugFixtures {
  restormRoot: string
  launchApp: () => Promise<{ app: ElectronApplication; page: Page }>
}

export const test = base.extend<AuthDebugFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const apps: { app: ElectronApplication; logs: string[] }[] = []

    rmSync(AUTH_DEBUG_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(AUTH_DEBUG_TEMP_DIR, { recursive: true })

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const launcher = async (): Promise<{ app: ElectronApplication; page: Page }> => {
      const bootstrap = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath, '--clear-settings'],
        env: { ...withE2ECoverageEnv(restormRoot, process.env), NODE_ENV: 'development' }
      })
      bootstrap.process().kill('SIGKILL')
      await new Promise((r) => setTimeout(r, 300))

      const app = await electron.launch({
        executablePath: electronExePath,
        args: ['--no-sandbox', '--ozone-platform=x11', mainJsPath],
        env: { ...withE2ECoverageEnv(restormRoot, process.env), NODE_ENV: 'development' }
      })

      const logs: string[] = []
      app.process().stdout?.on('data', (d: Buffer) => { logs.push(d.toString().trim()) })
      app.process().stderr?.on('data', (d: Buffer) => { logs.push(d.toString().trim()) })

      const page = await app.firstWindow()
      await page.waitForLoadState('load')
      await installSystemModalsMockingForE2E(app)
      await page.evaluate(() => { window.confirm = () => true; window.alert = () => undefined })
      await page.waitForTimeout(1500)

      apps.push({ app, logs })
      return { app, page }
    }

    await use(launcher)

    const { writeFileSync } = await import('fs')
    mkdirSync(testInfo.outputDir, { recursive: true })
    for (const { app, logs } of apps) {
      try {
        if (logs.length > 0) {
          const logFile = join(testInfo.outputDir, 'electron-logs.txt')
          writeFileSync(logFile, logs.join('\n'), 'utf-8')
          await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
        }
      } catch { /* ignore */ }
      try { app.process().kill('SIGKILL') } catch { /* ignore */ }
    }
  }
})

export { expect, configureNextSaveFileDialogForE2E, configureNextOpenDialogForE2E }
