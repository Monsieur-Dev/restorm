import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'
import {
  editorWorkbenchRootSelector,
  listViewRowSelectorByTitle,
  markdownEditorContentEditableSelector,
  tabsTabSelector
} from 'electron-core-ui/testing'

const { Given, When, Then } = createBdd(test)

let activeFolderId: string | null = null
let activeWorkbenchTestId: string | null = null

Given('the file is loaded', async ({ page }) => {
  await expect(page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Swagger Petstore')).first()).toBeVisible({ timeout: 15000 })
})

Given('the title does not contain {string}', async ({ page }, text: string) => {
  const title = await page.title()
  expect(title).not.toContain(text)
})

When('I click on {string} folder', async ({ page }, folderName: string) => {
  const folder = page.locator(listViewRowSelectorByTitle('sidebar-listview', folderName)).first()
  await expect(folder).toBeVisible({ timeout: 5000 })
  activeFolderId = await folder.getAttribute('data-item-id')
  if (!activeFolderId) {
    throw new Error(`Could not read data-item-id for folder "${folderName}"`)
  }
  await folder.click()
  // Workbench test id can be dynamic (e.g. workbench-{id})
  const workbenchRoot = page.locator('[data-testid^="workbench"]').first()
  await expect(workbenchRoot).toBeVisible({ timeout: 15000 })
  activeWorkbenchTestId = await workbenchRoot.getAttribute('data-testid')
  await page.waitForSelector('[role="tab"]', { timeout: 15000 })
})

When('I click on the Notes inner tab', async ({ page }) => {
  if (!activeFolderId) {
    throw new Error('No active folder id found. Click a folder before opening Notes tab.')
  }
  const tabsTestId = `folder-view-${activeFolderId}-tabs`
  await page.locator(tabsTabSelector(tabsTestId, 'notes')).click()
  await page.waitForSelector(markdownEditorContentEditableSelector(`folder-view-${activeFolderId}-markdown-editor-notes`), { timeout: 5000 })
})

When('I type {string} in the editor', async ({ page }, text: string) => {
  if (!activeFolderId) {
    throw new Error('No active folder id found. Open Notes tab before typing.')
  }
  const editor = page.locator(markdownEditorContentEditableSelector(`folder-view-${activeFolderId}-markdown-editor-notes`)).first()
  await expect(editor).toBeVisible({ timeout: 5000 })
  await editor.click()
  for (const ch of text) {
    await page.keyboard.type(ch)
  }
  // Wait for dirty indicator to appear
  await page.waitForSelector('.dirty-indicator', { timeout: 3000 }).catch(() => { /* indicator may take time */ })
})

When('I undo multiple times', async ({ page }) => {
  if (activeFolderId) {
    const editor = page.locator(markdownEditorContentEditableSelector(`folder-view-${activeFolderId}-markdown-editor-notes`)).first()
    if (await editor.isVisible({ timeout: 2000 }).catch(() => false)) {
      await editor.click()
    }
  }

  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Control+z')
  }
  // Wait for dirty indicator to potentially disappear
  await page.waitForFunction(() => {
    const indicator = document.querySelector('.dirty-indicator')
    return !indicator || window.getComputedStyle(indicator).display === 'none'
  }, { timeout: 3000 }).catch(() => { /* undo may not fully revert */ })
})

When('I modify an input field', async ({ page }) => {
  const input = page.locator('input[type="text"], input:not([type])').first()
  if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    await input.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' modified')
    await page.keyboard.press('Tab')
  }
  // Wait for dirty indicator to appear
  await page.waitForSelector('.dirty-indicator', { timeout: 3000 }).catch(() => { /* indicator may take time */ })
})

Then('a tab should be open', async ({ page }) => {
  const rootSelector = activeWorkbenchTestId ? editorWorkbenchRootSelector(activeWorkbenchTestId) : '[data-testid^="workbench"]'
  await page.waitForSelector(rootSelector, { timeout: 15000 })
  const tab = page.locator(`${rootSelector} [role="tab"]`).first()
  await expect(tab).toBeVisible({ timeout: 5000 })
})

Then('the tab should not have a dirty indicator', async ({ page }) => {
  const tab = page.locator('[role="tab"]').first()
  const dirtyIndicator = tab.locator('.dirty-indicator')
  await expect(dirtyIndicator).not.toBeVisible()
})

Then('the tab should have a dirty indicator', async ({ page }) => {
  const tab = page.locator('[role="tab"]').first()
  const dirtyIndicator = tab.locator('.dirty-indicator')
  await expect(dirtyIndicator).toBeVisible({ timeout: 5000 })
})

Then('the title should contain {string}', async ({ page }, text: string) => {
  const title = await page.title()
  expect(title).toContain(text)
})

Then('the title should not contain {string}', async ({ page }, text: string) => {
  const title = await page.title()
  expect(title).not.toContain(text)
})
