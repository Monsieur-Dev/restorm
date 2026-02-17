import { test as base } from 'playwright-bdd'
import type { ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import { launchRestormElectronApp } from '../../helpers/launch-restorm'
import { closeElectronAppForE2E, writeRendererIstanbulCoverage } from '../../helpers/coverage'

interface UserPreferencesFixtures {
  electronApp: ElectronApplication
  page: Page
  restormRoot: string
  sampleFilePath: string
}

export const test = base.extend<UserPreferencesFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  sampleFilePath: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/Petstore.restorm'))
  },

  electronApp: async ({ restormRoot }, use) => {
    const app = await launchRestormElectronApp({
      restormRoot,
      args: ['--clear-settings']
    })

    await use(app)
    await closeElectronAppForE2E(app)
  },

  page: async ({ electronApp, restormRoot }, use, testInfo) => {
    const page = await electronApp.firstWindow()

    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForSelector('.welcome-container, [role="menubar"]', { timeout: 15000 })

    await use(page)

    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect } from '@playwright/test'
