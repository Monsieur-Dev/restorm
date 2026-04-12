import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/handlebars.fixture'
import {
  listViewRowExpanderSelectorByTitle,
  listViewRowSelectorByTitle
} from 'electron-core-ui/testing'

const { Given, When, Then } = createBdd(test)

const consoleBuffer: string[] = []

Given('the Test API folder is expanded', async ({ page }) => {
  // Reset + attach renderer-side console capture (the launch helper's app.on('window')
  // misses the first window, so we attach directly to the page here).
  consoleBuffer.length = 0
  page.on('console', (msg) => {
    consoleBuffer.push(`[${msg.type()}] ${msg.text()}`)
  })
  const folderRow = page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Test API')).first()
  await expect(folderRow).toBeVisible({ timeout: 10000 })

  const expander = page.locator(listViewRowExpanderSelectorByTitle('sidebar-listview', 'Test API')).first()
  if (await expander.isVisible({ timeout: 500 }).catch(() => false)) {
    await expander.click()
  } else {
    await folderRow.dblclick()
  }
  await expect(page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Get User')).first()).toBeVisible({ timeout: 5000 })
})

When('I click on the {string} request', async ({ page }, requestName: string) => {
  const requestItem = page.locator(listViewRowSelectorByTitle('sidebar-listview', requestName)).first()
  await expect(requestItem).toBeVisible({ timeout: 5000 })
  await requestItem.click()
  const workbenchRoot = page.locator('[data-testid^="workbench"]').first()
  await expect(workbenchRoot).toBeVisible({ timeout: 15000 })
  // The visible url-container belongs to the currently active tab (others are hidden by CSS).
  await expect(
    page.locator('[data-testid="url-container"][data-url-resolved="true"]').locator('visible=true').first()
  ).toBeVisible({ timeout: 10000 })
})

When('I focus the URL field at the start', async ({ page }) => {
  const urlContainer = page.locator('[data-testid="url-container"]').locator('visible=true').first()
  const monacoEditor = urlContainer.locator('.monaco-editor').first()
  await expect(monacoEditor).toBeVisible({ timeout: 5000 })
  await monacoEditor.click()
  // Move cursor to beginning of the field
  await page.keyboard.press('Home')
  // Small settle delay so the IPC echo from the click/focus has time to flush
  await page.waitForTimeout(300)
})

When('I focus the body editor at the start', async ({ page }) => {
  const bodyEditor = page.locator('[data-testid="http-request-body-editor"] .monaco-editor').first()
  await expect(bodyEditor).toBeVisible({ timeout: 5000 })
  await bodyEditor.click()
  // Use Ctrl+Home to go to the very first character of the body editor
  await page.keyboard.press('Control+Home')
  await page.waitForTimeout(300)
})

When('I focus the GraphQL query editor at the start', async ({ page }) => {
  const queryEditor = page.locator('[data-testid="graphql-query-editor"] .monaco-editor').first()
  await expect(queryEditor).toBeVisible({ timeout: 5000 })
  await queryEditor.click()
  await page.keyboard.press('Control+Home')
  await page.waitForTimeout(300)
})

When('I click on the {string} folder', async ({ page }, folderName: string) => {
  const folderRow = page.locator(listViewRowSelectorByTitle('sidebar-listview', folderName)).first()
  await expect(folderRow).toBeVisible({ timeout: 5000 })
  await folderRow.click()
  const workbenchRoot = page.locator('[data-testid^="workbench"]').first()
  await expect(workbenchRoot).toBeVisible({ timeout: 15000 })
})

When('I focus the first environment variable value field', async ({ page }) => {
  // RestormKeyValueTable renders the value column via RestormVariableInputBox (Monaco).
  // The key column uses a plain InputBox, so the only .monaco-editor per row is the value.
  const variablesTable = page.locator('[data-testid="environment-folder-variables-table"]').first()
  await expect(variablesTable).toBeVisible({ timeout: 5000 })
  const valueEditor = variablesTable.locator('.monaco-editor').first()
  await expect(valueEditor).toBeVisible({ timeout: 5000 })
  await valueEditor.click()
  await page.keyboard.press('Home')
  await page.waitForTimeout(300)
})

Then('the GraphQL query editor should start with {string}', async ({ page }, expectedPrefix: string) => {
  await assertEditorStartsWith(page, '[data-testid="graphql-query-editor"] .monaco-editor', expectedPrefix)
})

Then('the first environment variable value should start with {string}', async ({ page }, expectedPrefix: string) => {
  await assertEditorStartsWith(page, '[data-testid="environment-folder-variables-table"] .monaco-editor', expectedPrefix, 0)
})

When('I type {string} character by character with delay {int} ms', async ({ page }, text: string, delayMs: number) => {
  for (const ch of text) {
    await page.keyboard.type(ch)
    if (delayMs > 0) {
      await page.waitForTimeout(delayMs)
    }
  }
  // Wait for the final debounce to flush so React state has caught up
  await page.waitForTimeout(500)
})

Then('the URL field should start with {string}', async ({ page }, expectedPrefix: string) => {
  await assertEditorStartsWith(page, '[data-testid="url-container"]:visible .monaco-editor', expectedPrefix)
})

Then('the body editor should start with {string}', async ({ page }, expectedPrefix: string) => {
  await assertEditorStartsWith(page, '[data-testid="http-request-body-editor"] .monaco-editor', expectedPrefix)
})

async function assertEditorStartsWith(page: import('@playwright/test').Page, editorSelector: string, expectedPrefix: string, editorIndex = 0): Promise<void> {
  const editor = page.locator(editorSelector).nth(editorIndex)
  const editorText = await editor.locator('.view-line').first().innerText()
  const diagLogs = consoleBuffer.filter((l) => l.includes('HTTPRequestTabView'))
  expect(
    editorText.startsWith(expectedPrefix),
    `Expected editor "${editorSelector}" to start with "${expectedPrefix}" but was "${editorText}".\n` +
    `--- HTTPRequestTabView logs (${diagLogs.length}) — last 50 ---\n${diagLogs.slice(-50).join('\n')}\n--- END ---`
  ).toBe(true)
}
