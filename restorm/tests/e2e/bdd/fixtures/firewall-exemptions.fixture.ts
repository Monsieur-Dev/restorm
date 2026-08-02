import { restormBaseTest, expect } from '../../helpers/base-fixture'

/**
 * Fixture for the firewall outbound-exemptions E2E. Launches on the welcome
 * screen — the Firewall tab opens from the View menu without needing a project,
 * and the consent toggles are user-level settings, so no workspace is involved.
 */
export const test = restormBaseTest.extend({
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
