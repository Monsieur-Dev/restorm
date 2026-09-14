import { createBdd } from 'playwright-bdd'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, OPENAPI_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E } from '../../fixtures/openapi-import.fixture'

const FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/openapi')
const SINGLE_FILE = join(OPENAPI_IMPORT_TEMP_DIR, 'openapi-test.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

void electronApp

Given('a new single-file YAML collection', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  await configureNextSaveFileDialogForE2E(launched.app, { kind: 'saveFile', path: SINGLE_FILE })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

async function importFixture(p: Page, fixtureName: string): Promise<void> {
  const samplePath = join(FIXTURES_DIR, fixtureName)
  expect(existsSync(samplePath), `fixture must exist: ${samplePath}`).toBe(true)

  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(samplePath)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 5000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 5000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(500)
}

When('I import the OpenAPI 3.0 Petstore spec', async () => {
  if (!page) throw new Error('app must be launched')
  await importFixture(page, 'petstore-3.0.json')
})

When('I import the OpenAPI 3.1 Petstore spec', async () => {
  if (!page) throw new Error('app must be launched')
  await importFixture(page, 'petstore-3.1.json')
})

Then('the sidebar should contain an environment folder named {string}', async ({}, name: string) => {
  if (!page) throw new Error('app must be launched')
  const sidebar = page.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })
  await expect(sidebar.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 5000 })
})

Then('the environment folder {string} should expose a sub-folder named {string}', async ({}, parent: string, child: string) => {
  if (!page) throw new Error('app must be launched')
  const sidebar = page.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })

  // Expand the parent folder if it isn't already.
  const parentRow = sidebar.locator('[role="treeitem"]', { hasText: parent }).first()
  await expect(parentRow).toBeVisible({ timeout: 5000 })
  const expanded = await parentRow.getAttribute('aria-expanded')
  if (expanded === 'false') {
    await parentRow.locator('.list-view-item-title-toggle, [data-testid$="-toggle"]').first().click().catch(() => undefined)
    await page.waitForTimeout(200)
  }

  await expect(sidebar.getByText(child, { exact: true }).first()).toBeVisible({ timeout: 5000 })
})

// ── Paste pretty-print ────────────────────────────────────────────────

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

When('I paste the minified OpenAPI 3.0 Petstore spec into the import source field', async () => {
  const p = requirePage()
  const minified = JSON.stringify(JSON.parse(readFileSync(join(FIXTURES_DIR, 'petstore-3.0.json'), 'utf8')) as unknown)
  expect(minified.includes('\n')).toBe(false)
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  const input = importModal.locator('[data-testid="source-input"] textarea, [data-testid="source-input"] input, [data-testid="source-input"]').first()
  await input.focus()
  // A real clipboard paste: a ClipboardEvent carrying the text, dispatched on
  // the focused field (the OS clipboard is not scriptable under xvfb).
  await input.evaluate((el: Element, text: string) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, minified)
})

Then('the import source opens in the editor on several lines', async () => {
  const p = requirePage()
  const editor = p.locator('[data-testid="source-input-editor"]')
  await expect(editor).toBeVisible({ timeout: 5000 })
  // At least four rendered lines: the one-line paste was re-indented.
  await expect(editor.locator('.view-line').nth(3)).toBeVisible({ timeout: 5000 })
})

Then("the import preview lists the spec's routes", async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="import-modal"] .import-preview-section')).toBeVisible({ timeout: 10000 })
})

Then('the import source editor has the keyboard focus', async () => {
  const p = requirePage()
  // The paste grew the single-line field into the editor: the focus followed.
  await expect.poll(() => p.evaluate(() => document.activeElement?.closest('[data-testid="source-input-editor"]') !== null), { timeout: 5000 }).toBe(true)
})
