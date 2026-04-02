import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/handlebars.fixture'
import {
  listViewRowExpanderSelectorByTitle,
  listViewRowSelectorByTitle
} from 'electron-core-ui/testing'

const { Given, When, Then } = createBdd(test)

Given('the Test API folder is expanded', async ({ page }) => {
  // Wait for folder to be visible
  const folderRow = page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Test API')).first()
  await expect(folderRow).toBeVisible({ timeout: 10000 })

  // Expand folder using ListView expander
  const expander = page.locator(listViewRowExpanderSelectorByTitle('sidebar-listview', 'Test API')).first()
  if (await expander.isVisible({ timeout: 500 }).catch(() => false)) {
    await expander.click()
  } else {
    await folderRow.dblclick()
  }
  // Wait for children to appear
  await expect(page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Get User')).first()).toBeVisible({ timeout: 5000 })
})

When('I click on the {string} request', async ({ page }, requestName: string) => {
  const requestItem = page.locator(listViewRowSelectorByTitle('sidebar-listview', requestName)).first()
  await expect(requestItem).toBeVisible({ timeout: 5000 })
  await requestItem.click()
  // Wait for tab to open and URL container to be resolved
  const workbenchRoot = page.locator('[data-testid^="workbench"]').first()
  await expect(workbenchRoot).toBeVisible({ timeout: 15000 })
  await page.waitForSelector('[role="tab"]', { timeout: 15000 })
  await page.waitForSelector('[data-testid="url-container"][data-url-resolved="true"]', { timeout: 10000 })
  await page.waitForSelector('text=PATH PARAMS', { timeout: 5000 })
})

When('I change the path param {string} from {string} to {string}', async ({ page }, _paramName: string, oldValue: string, newValue: string) => {
  // Find the PATH PARAMS pane header and expand if collapsed
  const pathParamsPane = page.locator('text=PATH PARAMS').first()
  await expect(pathParamsPane).toBeVisible({ timeout: 5000 })

  const paneHeader = pathParamsPane.locator('..').locator('..')
  const isCollapsed = await paneHeader.locator('.pane-collapsed, [aria-expanded="false"]').count() > 0
  if (isCollapsed) {
    await pathParamsPane.click()
    // Wait for pane to expand
    await page.waitForSelector('.params-table-root', { timeout: 3000 })
  }

  const pathParamsSection = page.locator('.params-table-root').first()
  await expect(pathParamsSection).toBeVisible({ timeout: 5000 })

  // Wait for Monaco editors to render and contain the expected value
  // Use a Playwright locator that waits for the view-line content with retry
  const editorWithValue = pathParamsSection.locator(`.monaco-editor .view-line:has-text("${oldValue}")`).first()
  await expect(editorWithValue).toBeVisible({ timeout: 10000 })

  // Click on the editor containing the old value
  const targetEditor = editorWithValue.locator('xpath=ancestor::div[contains(@class,"monaco-editor")]').first()
  await targetEditor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(newValue)

  // Click outside to blur and trigger update
  await page.locator('.params-table th').first().click()
  
  // Wait for URL tooltip to update with the new value
  await page.waitForFunction(
    (value: string) => {
      const container = document.querySelector('[data-testid="url-container"]')
      const title = container?.getAttribute('title') ?? ''
      return title.includes(value)
    },
    newValue,
    { timeout: 10000 }
  )
})

Then('the URL tooltip should contain {string}', async ({ page }, expectedText: string) => {
  const urlContainer = page.locator('[data-testid="url-container"]').first()
  await expect(urlContainer).toBeVisible({ timeout: 10000 })

  const title = await urlContainer.getAttribute('title')
  expect(title).toBeTruthy()
  expect(title).toContain(expectedText)
})

Then('the URL tooltip should not contain {string}', async ({ page }, unexpectedText: string) => {
  const urlContainer = page.locator('[data-testid="url-container"]').first()
  await expect(urlContainer).toBeVisible({ timeout: 10000 })

  const title = await urlContainer.getAttribute('title')
  expect(title).toBeTruthy()
  expect(title).not.toContain(unexpectedText)
})
