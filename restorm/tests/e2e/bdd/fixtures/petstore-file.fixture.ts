import { join } from 'path'
import { listViewRootSelector } from 'electron-core-ui/testing'
import { restormBaseTest, expect } from '../../helpers/base-fixture'
import { launchRestormElectronApp } from '../../helpers/launch-restorm'
import { closeElectronAppForE2E } from '../../helpers/coverage'

interface PetstoreFileFixtures {
  petstoreFilePath: string
}

export const test = restormBaseTest.extend<PetstoreFileFixtures>({
  petstoreFilePath: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/Petstore.restorm'))
  },

  electronApp: async ({ restormRoot, petstoreFilePath }, use) => {
    const app = await launchRestormElectronApp({
      restormRoot,
      args: ['--open', petstoreFilePath]
    })
    await use(app)
    await closeElectronAppForE2E(app)
  },

  page: async ({ electronApp, restormRoot }, use, testInfo) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForSelector(`${listViewRootSelector('sidebar-listview')}[data-ready="true"]`, { timeout: 15000 })
    await use(page)
    const { writeRendererIstanbulCoverage } = await import('../../helpers/coverage')
    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect }
