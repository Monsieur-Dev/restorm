import { join } from 'path'
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'fs'
import { restormBaseTest, expect } from '../../helpers/base-fixture'
import { launchRestormElectronApp } from '../../helpers/launch-restorm'
import { closeElectronAppForE2E } from '../../helpers/coverage'

interface SaveOperationsFixtures {
  petstoreFilePath: string
  tempFolderPath: string
  referenceFolderPath: string
  referenceFolder2Path: string
}

export const test = restormBaseTest.extend<SaveOperationsFixtures>({
  petstoreFilePath: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/Petstore.restorm'))
  },

  tempFolderPath: async ({ restormRoot }, use) => {
    const tempPath = join(restormRoot, 'tests/e2e/temp-save-test')
    if (existsSync(tempPath)) {
      rmSync(tempPath, { recursive: true, force: true })
    }
    mkdirSync(tempPath, { recursive: true })
    await use(tempPath)
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

    const app = await launchRestormElectronApp({
      restormRoot,
      args: ['-o', petstoreFilePath],
      extraEnv: { E2E_MOCK_SAVE_FOLDER: tempFolderPath }
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
    await page.waitForSelector('[data-testid="sidebar-listview"][data-ready="true"]', { timeout: 15000 })
    await use(page)
    const { writeRendererIstanbulCoverage } = await import('../../helpers/coverage')
    await writeRendererIstanbulCoverage(page, testInfo, restormRoot)
  }
})

export { expect }
