import { test as base } from 'playwright-bdd'
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import electronPath from 'electron'
import { closeElectronAppForE2E, withE2ECoverageEnv, writeRendererIstanbulCoverage } from '../../helpers/coverage'

interface PetstoreFolderFixtures {
  electronApp: ElectronApplication
  page: Page
  restormRoot: string
  petstoreFolderPath: string
}

export const test = base.extend<PetstoreFolderFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  petstoreFolderPath: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/Petstore'))
  },

  electronApp: async ({ restormRoot, petstoreFolderPath: _petstoreFolderPath }, use) => {
    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const app = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath],
      env: {
        ...withE2ECoverageEnv(restormRoot, process.env),
        NODE_ENV: 'development'
      }
    })

    await use(app)
    await closeElectronAppForE2E(app)
  },

  page: async ({ electronApp, restormRoot }, use, testInfo) => {
    const page = await electronApp.firstWindow()

    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    // App can start without any file/folder opened: wait for menubar instead of list-view.
    await page.waitForSelector('[data-testid="titlebar-menubar"]', { timeout: 15000 })

    await use(page)

    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect } from '@playwright/test'
