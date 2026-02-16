import { test as base } from 'playwright-bdd'
import type { ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import { launchRestormElectronApp } from '../../helpers/launch-restorm'

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

    try {
      app.process().kill('SIGKILL')
    } catch {
      // Ignore kill errors
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()

    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForSelector('.welcome-container, [role="menubar"]', { timeout: 15000 })

    await use(page)
  }
})

export { expect } from '@playwright/test'
