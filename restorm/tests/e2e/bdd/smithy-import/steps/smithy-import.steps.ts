import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { test, expect, SMITHY_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E } from '../../fixtures/smithy-import.fixture'

const FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/smithy')
const SINGLE_FILE = join(SMITHY_IMPORT_TEMP_DIR, 'smithy-test.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

void electronApp

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function sidebarRowsByName(currentPage: Page, name: string): Locator {
  return currentPage
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: currentPage.getByText(name, { exact: true }) })
}

async function importViaModal(source: string): Promise<void> {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  const input = importModal.locator('[data-testid="source-input-input"]')
  await input.fill(source)
  // The import source field always resolves its value as a file path / URL
  // (ImportManager.importFrom reads it from disk) — there is no raw-content-
  // paste flow. The heavier IDL grammar can also take longer than the JSON
  // parsers this pattern was cloned from, hence the generous timeout.
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 30000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
}

Given('a new single-file collection for Smithy import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  await configureNextSaveFileDialogForE2E(launched.app, { kind: 'saveFile', path: SINGLE_FILE })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

When('I import the Smithy JSON AST fixture file', async () => {
  const filePath = join(FIXTURES_DIR, 'weather.json')
  expect(existsSync(filePath), `fixture must exist: ${filePath}`).toBe(true)
  await importViaModal(filePath)
})

When('I import the Smithy IDL fixture file', async () => {
  const filePath = join(FIXTURES_DIR, 'weather.smithy')
  expect(existsSync(filePath), `fixture must exist: ${filePath}`).toBe(true)
  await importViaModal(filePath)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 10000 })
})

Then('exactly {int} folder(s) named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 10000 })
})
