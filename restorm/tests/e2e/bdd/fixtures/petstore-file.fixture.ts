import { test as base } from 'playwright-bdd'
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import electronPath from 'electron'

interface PetstoreFileFixtures {
  electronApp: ElectronApplication
  page: Page
  restormRoot: string
  petstoreFilePath: string
}

export const test = base.extend<PetstoreFileFixtures>({
  restormRoot: [resolve(__dirname, '../../../..'), { option: true }],

  petstoreFilePath: async ({ restormRoot }, use) => {
    await use(join(restormRoot, 'tests/e2e/samples/Petstore.restorm'))
  },

  electronApp: async ({ restormRoot, petstoreFilePath }, use) => {
    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const app = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath, '--open', petstoreFilePath],
      env: {
        ...process.env,
        NODE_ENV: 'development'
      }
    })

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
    // Wait for the main sidebar list view to be ready (replaces fixed timeout)
    await page.waitForSelector('[data-testid="sidebar-listview"][data-ready="true"]', { timeout: 15000 })

    await use(page)
  }
})

export { expect } from '@playwright/test'
