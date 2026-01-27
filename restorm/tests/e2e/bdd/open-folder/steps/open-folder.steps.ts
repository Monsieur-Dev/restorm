import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-folder.fixture'
import { defineSystemModalsBddSteps } from 'electron-core-ui/testing/playwright-bdd'

const bdd = createBdd(test)
const { Given, When, Then } = bdd

defineSystemModalsBddSteps(bdd)

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

When('I request opening a folder', async ({ page }) => {
  const result = await page.evaluate(async () => {
    interface OpenFolderResult {
      success: boolean
      path?: string
      format?: string
      error?: string
    }
    const w = window as unknown as { restorm?: { file?: { openFolder?: () => Promise<OpenFolderResult> } } }
    const fn = w.restorm?.file?.openFolder
    if (typeof fn !== 'function') {
      throw new Error('window.restorm.file.openFolder is not available')
    }
    return await fn()
  })
  if (typeof (result as { success?: unknown }).success !== 'boolean') {
    throw new Error('Invalid result from window.restorm.file.openFolder()')
  }
  if (!(result as { success: boolean }).success) {
    const err = (result as { error?: unknown }).error
    throw new Error(`openFolder() returned success=false (error=${String(err)})`)
  }
})

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
