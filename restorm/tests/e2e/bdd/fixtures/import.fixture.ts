import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

interface ImportFixture {
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<ImportFixture>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    })
    await use(app)
    await app.close()
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
})

export { expect } from '@playwright/test'
