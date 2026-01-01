import { test as base } from 'playwright-bdd'
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import electronPath from 'electron'

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

  electronApp: async ({ restormRoot, petstoreFolderPath }, use) => {
    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    const app = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath, '-o', petstoreFolderPath],
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
    await page.waitForTimeout(10000)

    await use(page)
  }
})

export { expect } from '@playwright/test'
