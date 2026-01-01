import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/handlebars.fixture'

const { Given, When, Then } = createBdd(test)

Given('the Test API folder is expanded', async ({ page }) => {
  // Wait for folder to be visible
  const folderRow = page.locator('[role="treeitem"]:has-text("Test API")').first()
  await expect(folderRow).toBeVisible({ timeout: 10000 })

  // Expand folder
  const chevron = folderRow.locator('.codicon-chevron-right, .codicon-chevron-down, [class*="chevron"]').first()
  if (await chevron.count() > 0) {
    await chevron.click()
  } else {
    await folderRow.dblclick()
  }
  await page.waitForTimeout(500)
})

When('I click on the {string} request', async ({ page }, requestName: string) => {
  const requestItem = page.locator(`text=${requestName}`).first()
  await expect(requestItem).toBeVisible({ timeout: 5000 })
  await requestItem.click()
  await page.waitForTimeout(2000)
})

When('I change the path param {string} from {string} to {string}', async ({ page }, paramName: string, oldValue: string, newValue: string) => {
  // Find the PATH PARAMS pane header and expand if collapsed
  const pathParamsPane = page.locator('text=PATH PARAMS').first()
  await expect(pathParamsPane).toBeVisible({ timeout: 5000 })

  const paneHeader = pathParamsPane.locator('..').locator('..')
  const isCollapsed = await paneHeader.locator('.pane-collapsed, [aria-expanded="false"]').count() > 0
  if (isCollapsed) {
    await pathParamsPane.click()
    await page.waitForTimeout(500)
  }

  const pathParamsSection = page.locator('.params-table-root').first()
  await expect(pathParamsSection).toBeVisible({ timeout: 5000 })

  // Find the Monaco editor that contains the old value
  const monacoEditors = page.locator('.params-table .monaco-editor')
  const editorCount = await monacoEditors.count()

  let targetEditor = null
  for (let i = 0; i < editorCount; i++) {
    const editor = monacoEditors.nth(i)
    const text = await editor.locator('.view-line').first().textContent()
    if (text?.includes(oldValue)) {
      targetEditor = editor
      break
    }
  }

  expect(targetEditor).not.toBeNull()

  // Click on the editor and edit
  await targetEditor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(newValue)

  // Click outside to blur and trigger update
  await page.locator('.params-table th').first().click()
  await page.waitForTimeout(2000)
})

Then('the URL tooltip should contain {string}', async ({ page }, expectedText: string) => {
  const urlContainer = page.locator('div[title]').filter({ hasText: '{{baseUrl}}' }).first()
  await expect(urlContainer).toBeVisible({ timeout: 10000 })

  const title = await urlContainer.getAttribute('title')
  expect(title).toBeTruthy()
  expect(title).toContain(expectedText)
})

Then('the URL tooltip should not contain {string}', async ({ page }, unexpectedText: string) => {
  const urlContainer = page.locator('div[title]').filter({ hasText: '{{baseUrl}}' }).first()
  await expect(urlContainer).toBeVisible({ timeout: 10000 })

  const title = await urlContainer.getAttribute('title')
  expect(title).toBeTruthy()
  expect(title).not.toContain(unexpectedText)
})
