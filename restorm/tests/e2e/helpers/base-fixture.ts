import { test as base } from 'playwright-bdd'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { resolve } from 'path'
import { launchRestormElectronApp } from './launch-restorm'
import { closeElectronAppForE2E, writeRendererIstanbulCoverage } from './coverage'

export interface BaseRestormFixtures {
  electronApp: ElectronApplication
  page: Page
  restormRoot: string
}

/**
 * Base Playwright-BDD fixture for Restorm Electron E2E tests.
 *
 * Provides `restormRoot`, `electronApp` (launched with optional CLI args),
 * and `page` (first window with coverage teardown).
 *
 * Extend this fixture to add test-specific data or override `electronApp`
 * for custom launch args / env / post-launch hooks.
 */
export const restormBaseTest = base.extend<BaseRestormFixtures>({
  restormRoot: [resolve(__dirname, '../../..'), { option: true }],

  electronApp: async ({ restormRoot }, use) => {
    const app = await launchRestormElectronApp({ restormRoot })
    await use(app)
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
