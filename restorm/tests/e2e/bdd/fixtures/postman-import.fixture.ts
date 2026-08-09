import { servicesWorkerFixture, type StartedServices } from '../../helpers/testcontainers/services'
import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page, expect } from '@playwright/test'
import { mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { installSystemModalsMockingForE2E, configureNextSaveFileDialogForE2E, configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { withE2ECoverageEnv } from '../../helpers/coverage'
import { createIsolatedUserDataDir } from '../../helpers/userdata-isolation'
import { collectBlockingRendererMessages, summariseBlockingMessages } from '../../helpers/renderer-log-guard'

export const POSTMAN_IMPORT_TEMP_DIR = resolve(__dirname, '../../.tmp/postman-import')
const RESTORM_ROOT = resolve(__dirname, '../../../..')

export interface PostmanImportFixtures {
  restormRoot: string
  launchApp: () => Promise<{ app: ElectronApplication; page: Page }>
}

export const test = base.extend<PostmanImportFixtures, { services: StartedServices }>({
  // The imported spec's request is EXECUTED against the live petstore —
  // this suite runs its own container (worker-scoped, ephemeral port).
  services: servicesWorkerFixture(['petstore']),
  restormRoot: [RESTORM_ROOT, { option: true }],

  launchApp: async ({ restormRoot }, use, testInfo) => {
    const apps: { app: ElectronApplication; logs: string[] }[] = []

    rmSync(POSTMAN_IMPORT_TEMP_DIR, { recursive: true, force: true })
    mkdirSync(POSTMAN_IMPORT_TEMP_DIR, { recursive: true })

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

    const launcher = async (): Promise<{ app: ElectronApplication; page: Page }> => {
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
    const blockingErrors: string[] = []
    for (const { app, logs } of apps) {
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

export { expect, configureNextSaveFileDialogForE2E, configureNextOpenDialogForE2E }
