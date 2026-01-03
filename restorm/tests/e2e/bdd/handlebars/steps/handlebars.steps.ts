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
  // Wait for children to appear
  await page.waitForSelector('[role="treeitem"]:has-text("Get User")', { timeout: 5000 })
})

When('I click on the {string} request', async ({ page }, requestName: string) => {
  const requestItem = page.locator(`text=${requestName}`).first()
  await expect(requestItem).toBeVisible({ timeout: 5000 })
  await requestItem.click()
  // Wait for tab to open and URL container to be resolved
  await page.waitForSelector('.tab.active', { timeout: 5000 })
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

  // Wait for "Loading..." to disappear and actual values to appear
  await page.waitForFunction(
    () => {
      const section = document.querySelector('.params-table-root')
      const text = section?.textContent ?? ''
      return section && !text.includes('Loading')
    },
    { timeout: 10000 }
  )

  // Find the Monaco editor that contains the old value in the path params section
  const monacoEditors = pathParamsSection.locator('.monaco-editor')
  const editorCount = await monacoEditors.count()

  let targetEditor = null
  for (let i = 0; i < editorCount; i++) {
    const editor = monacoEditors.nth(i)
    const lines = await editor.locator('.view-line').allTextContents()
    if (lines.some(line => line.includes(oldValue))) {
      targetEditor = editor
      break
    }
  }

  if (!targetEditor) {
    await page.screenshot({ path: 'test-results/debug-path-params.png' })
    throw new Error(`Could not find editor containing "${oldValue}"`)
  }

  // Click on the editor and edit
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
