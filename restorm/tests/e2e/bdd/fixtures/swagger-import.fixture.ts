import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E, configureNextSaveFileDialogForE2E, configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'

export const SWAGGER_IMPORT_TEMP_DIR = resolve(__dirname, '../../.tmp/swagger-import')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface SwaggerImportFixtures {
  restormRoot: string
  launchApp: () => Promise<{ app: ElectronApplication; page: Page }>
}

export const test = base.extend<SwaggerImportFixtures>({
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const apps: { app: ElectronApplication; logs: string[] }[] = []

    rmSync(SWAGGER_IMPORT_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(SWAGGER_IMPORT_TEMP_DIR, { recursive: true })

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

    // Teardown
    const { writeFileSync } = await import('fs')
    mkdirSync(testInfo.outputDir, { recursive: true })
    for (const { app, logs } of apps) {
      if (testInfo.status !== 'passed') {
        try {
          const p = await app.firstWindow().catch(() => null)
          if (p) {
            const shot = join(testInfo.outputDir, 'failure-state.png')
            await p.screenshot({ path: shot, fullPage: true })
            await testInfo.attach('failure-state-screenshot', { path: shot, contentType: 'image/png' })
          }
        } catch { /* ignore */ }
      }
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
