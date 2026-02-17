import { test as base } from 'playwright-bdd'
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'fs'
import electronPath from 'electron'
import { closeElectronAppForE2E, withE2ECoverageEnv, writeRendererIstanbulCoverage } from '../../helpers/coverage'

interface SaveOperationsFixtures {
  electronApp: ElectronApplication
  page: Page
  restormRoot: string
  petstoreFilePath: string
  tempFolderPath: string
  referenceFolderPath: string
  referenceFolder2Path: string
}

export const test = base.extend<SaveOperationsFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  petstoreFilePath: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/Petstore.restorm'))
  },

  tempFolderPath: async ({ restormRoot }, use) => {
    const tempPath = join(restormRoot, 'tests/e2e/temp-save-test')

    // Clean and create temp folder
    if (existsSync(tempPath)) {
      rmSync(tempPath, { recursive: true, force: true })
    }
    mkdirSync(tempPath, { recursive: true })

    await use(tempPath)

    // Cleanup after test
    if (existsSync(tempPath)) {
      rmSync(tempPath, { recursive: true, force: true })
    }
  },

  referenceFolderPath: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/Petstore'))
  },

  referenceFolder2Path: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/Petstore 2'))
  },

  electronApp: async ({ restormRoot, petstoreFilePath, tempFolderPath }, use) => {
    // Restore the original Petstore.restorm from Samples
    const petstoreOriginalPath = join(restormRoot, 'Samples/Petstore.restorm')
    copyFileSync(petstoreOriginalPath, petstoreFilePath)

    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const app = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath, '-o', petstoreFilePath],
      env: {
        ...withE2ECoverageEnv(restormRoot, process.env),
        NODE_ENV: 'development',
        E2E_MOCK_SAVE_FOLDER: tempFolderPath
      }
    })

    // Mock dialogs immediately after launch
    await app.evaluate(({ dialog }, tempPath) => {
      dialog.showOpenDialog = () => Promise.resolve({
        canceled: false,
        filePaths: [tempPath]
      })
      dialog.showSaveDialog = () => Promise.resolve({
        canceled: false,
        filePath: tempPath
      })
    }, tempFolderPath)

    await use(app)
    await closeElectronAppForE2E(app)
  },

  page: async ({ electronApp, restormRoot }, use, testInfo) => {
    const page = await electronApp.firstWindow()

    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    // Wait for the main sidebar list view to be ready (replaces fixed timeout)
    await page.waitForSelector('[data-testid="sidebar-listview"][data-ready="true"]', { timeout: 15000 })

    await use(page)

    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect } from '@playwright/test'
