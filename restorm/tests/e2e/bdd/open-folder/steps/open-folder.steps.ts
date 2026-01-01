import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-folder.fixture'

const { Given, Then } = createBdd(test)

const FOLDER_NAMES = [
  'Swagger Petstore',
  'GraphQL Docker',
  'GraphQL Petstore',
  'gRPC Docker',
  'gRPC Petstore',
  'SOAP Docker',
  'SOAP Petstore',
  'AsyncAPI Docker',
  'AsyncAPI Petstore'
]

Given('the folder is loaded', async ({ page }) => {
  await expect(page.locator('text=Swagger Petstore').first()).toBeVisible({ timeout: 15000 })
})

Then('I should see {string} folder', async ({ page }, folderName: string) => {
  const folder = page.locator(`[role="treeitem"]:has-text("${folderName}")`).first()
  await expect(folder).toBeVisible({ timeout: 5000 })
})

Then('I should see exactly {int} folders', async ({ page }, count: number) => {
  let foundCount = 0
  for (const name of FOLDER_NAMES) {
    const folder = page.locator(`[role="treeitem"]:has-text("${name}")`).first()
    if (await folder.isVisible()) {
      foundCount++
    }
  }
  expect(foundCount).toBe(count)
})
