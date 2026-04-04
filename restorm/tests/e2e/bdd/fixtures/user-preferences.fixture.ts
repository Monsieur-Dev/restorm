import { restormBaseTest, expect } from '../../helpers/base-fixture'
import { launchRestormElectronApp } from '../../helpers/launch-restorm'
import { closeElectronAppForE2E } from '../../helpers/coverage'

interface UserPreferencesFixtures {
  sampleFilePath: string
}

export const test = restormBaseTest.extend<UserPreferencesFixtures>({
  sampleFilePath: async ({ restormRoot }, use) => {
    const { join } = await import('path')
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
    const { writeRendererIstanbulCoverage } = await import('../../helpers/coverage')
    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect }
