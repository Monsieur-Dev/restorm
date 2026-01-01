import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'

const { Given, When, Then } = createBdd(test)

Given('the file is loaded', async ({ page }) => {
  await expect(page.locator('[role="treeitem"]:has-text("Swagger Petstore")').first()).toBeVisible({ timeout: 15000 })
})

Given('the title does not contain {string}', async ({ page }, text: string) => {
  const title = await page.title()
  expect(title).not.toContain(text)
})

When('I click on {string} folder', async ({ page }, folderName: string) => {
  const folder = page.locator(`[role="treeitem"]:has-text("${folderName}")`).first()
  await folder.click()
  await page.waitForTimeout(1000)
})

When('I click on the Notes inner tab', async ({ page }) => {
  const notesSelectors = [
    '[role="tabpanel"] [role="tab"]:has-text("Notes")',
    '[role="tablist"]:not(.tabs-container) [role="tab"]:has-text("Notes")',
    'button:has-text("Notes")',
    '[data-state] button:has-text("Notes")'
  ]

  for (const selector of notesSelectors) {
    const notesTab = page.locator(selector).first()
    if (await notesTab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await notesTab.click()
      await page.waitForTimeout(500)
      return
    }
  }

  // Fallback
  const notesText = page.getByText('Notes', { exact: true })
  const all = await notesText.all()
  for (const el of all) {
    if (await el.isVisible().catch(() => false)) {
      await el.click()
      await page.waitForTimeout(500)
      break
    }
  }
})

When('I type {string} in the editor', async ({ page }, text: string) => {
  await page.waitForTimeout(500)

  const editorSelectors = [
    '.ProseMirror[contenteditable="true"]',
    '.milkdown .editor',
    '[role="textbox"][contenteditable="true"]'
  ]

  let editor = null
  for (const selector of editorSelectors) {
    const loc = page.locator(selector).first()
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
      editor = loc
      break
    }
  }

  if (!editor) {
    throw new Error('Could not find visible editor')
  }

  await editor.click()
  await page.keyboard.type(text)
  await page.waitForTimeout(500)
})

When('I undo multiple times', async ({ page }) => {
  const editorSelectors = [
    '.ProseMirror[contenteditable="true"]',
    '.milkdown .editor',
    '[role="textbox"][contenteditable="true"]'
  ]

  let editor = null
  for (const selector of editorSelectors) {
    const loc = page.locator(selector).first()
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
      editor = loc
      break
    }
  }

  if (editor) {
    await editor.click()
  }

  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Control+z')
  }
  await page.waitForTimeout(500)
})

When('I modify an input field', async ({ page }) => {
  const input = page.locator('input[type="text"], input:not([type])').first()
  if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    await input.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' modified')
    await page.keyboard.press('Tab')
  }
  await page.waitForTimeout(1500)
})

Then('a tab should be open', async ({ page }) => {
  const tab = page.locator('[role="tab"]').first()
  await expect(tab).toBeVisible({ timeout: 5000 })
})

Then('the tab should not have a dirty indicator', async ({ page }) => {
  const tab = page.locator('[role="tab"]').first()
  const dirtyIndicator = tab.locator('.dirty-indicator')
  await expect(dirtyIndicator).not.toBeVisible()
})

Then('the tab should have a dirty indicator', async ({ page }) => {
  await page.waitForTimeout(1000)
  const tab = page.locator('[role="tab"]').first()
  const dirtyIndicator = tab.locator('.dirty-indicator')
  await expect(dirtyIndicator).toBeVisible()
})

Then('the title should contain {string}', async ({ page }, text: string) => {
  const title = await page.title()
  expect(title).toContain(text)
})

Then('the title should not contain {string}', async ({ page }, text: string) => {
  const title = await page.title()
  expect(title).not.toContain(text)
})
