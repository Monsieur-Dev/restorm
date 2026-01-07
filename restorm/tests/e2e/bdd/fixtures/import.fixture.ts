import { test as base } from 'playwright-bdd'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join, resolve } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import electronPath from 'electron'

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

  electronApp: async ({ restormRoot, tempFilePath }, use) => {
    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const app = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

    // Mock dialogs - both message box (for unsaved changes) and save dialog
    await app.evaluate(
      ({ dialog }, tempPath) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) // "No" to save changes
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: tempPath }) // Provide temp path for new file
      },
      tempFilePath
    )

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

    await use(page)
  }
})

export { expect } from '@playwright/test'

export { expect } from '@playwright/test'
