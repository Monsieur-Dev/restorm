import { restormBaseTest, expect } from '../../helpers/base-fixture'

interface SettingsTabFixtures {
  petstoreFolderPath: string
}

/**
 * Fixture for the Settings-surface E2E. The app launches with no file
 * open (welcome screen), so the first assertions exercise the modal
 * branch. Opening the Petstore folder then activates a workbench so
 * the same Settings entry points open a workbench tab instead.
 */
export const test = restormBaseTest.extend<SettingsTabFixtures>({
  petstoreFolderPath: async ({ restormRoot }, use) => {
    const { join } = await import('path')
    await use(join(restormRoot, 'tests/e2e/samples/Petstore'))
  },

  page: async ({ electronApp, restormRoot }, use, testInfo) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForSelector('[data-testid="titlebar-menubar"]', { timeout: 15000 })
    await use(page)
    const { writeRendererIstanbulCoverage } = await import('../../helpers/coverage')
    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect }
