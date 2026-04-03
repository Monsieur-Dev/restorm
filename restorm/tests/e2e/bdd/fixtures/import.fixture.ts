import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join, resolve } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import electronPath from 'electron'
import { closeElectronAppForE2E, withE2ECoverageEnv, writeRendererIstanbulCoverage } from '../../helpers/coverage'

interface ImportFixture {
  electronApp: ElectronApplication
  page: Page
  restormRoot: string
  tempFilePath: string
}

export const test = base.extend<ImportFixture>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  tempFilePath: async ({ restormRoot }, use) => {
    const tempDir = join(restormRoot, 'tests/e2e/temp')
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }
    const tempFile = join(tempDir, 'import-temp.restorm')
    await use(tempFile)
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  },

  electronApp: async ({ restormRoot }, use) => {
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

    await use(page)

    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect } from '@playwright/test'
