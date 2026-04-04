import { restormBaseTest, expect } from '../../helpers/base-fixture'

interface PetstoreFolderFixtures {
  petstoreFolderPath: string
}

export const test = restormBaseTest.extend<PetstoreFolderFixtures>({
  petstoreFolderPath: async ({ restormRoot }, use) => {
    const { join } = await import('path')
    await use(join(restormRoot, 'tests/e2e/samples/Petstore'))
  },

  // No file to open — uses default base electronApp (no args)

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
