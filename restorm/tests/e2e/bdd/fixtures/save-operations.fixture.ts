import { test as base } from 'playwright-bdd'
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import { existsSync, rmSync, mkdirSync, copyFileSync } from 'fs'
import electronPath from 'electron'

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
        ...process.env,
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

    try {
      app.process().kill('SIGKILL')
    } catch {
      // Ignore kill errors
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()

    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[Renderer ERROR] ${msg.text()}`)
      }
    })

    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    await page.waitForTimeout(5000)

    await use(page)
  }
})

export { expect } from '@playwright/test'
