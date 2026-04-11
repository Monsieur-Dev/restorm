import { test as base } from 'playwright-bdd'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { resolve } from 'path'
import { launchRestormElectronApp, writeAppLogs } from './launch-restorm'
import { closeElectronAppForE2E, writeRendererIstanbulCoverage } from './coverage'

export interface BaseRestormFixtures {
  electronApp: ElectronApplication
  page: Page
  restormRoot: string
}

/**
 * Base Playwright-BDD fixture for Restorm Electron E2E tests.
 *
 * All main process and renderer console logs are automatically captured
 * by `launchRestormElectronApp` and saved to `electron-logs.txt` on teardown.
 */
export const restormBaseTest = base.extend<BaseRestormFixtures>({
  restormRoot: [resolve(__dirname, '../../..'), { option: true }],

  electronApp: async ({ restormRoot }, use, testInfo: TestInfo) => {
    const app = await launchRestormElectronApp({ restormRoot })
    await use(app)

    // Save captured logs
    const logFile = writeAppLogs(app, testInfo.outputDir)
    if (logFile) {
      await testInfo.attach('electron-logs', { path: logFile, contentType: 'text/plain' })
    }

    await closeElectronAppForE2E(app)
  },

  page: async ({ electronApp, restormRoot }, use, testInfo: TestInfo) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')

    await use(page)

    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect } from '@playwright/test'

// Re-export for fixtures that override electronApp
export { writeAppLogs } from './launch-restorm'
