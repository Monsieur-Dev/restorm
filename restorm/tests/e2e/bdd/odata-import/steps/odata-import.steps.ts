import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  ODATA_PETSTORE_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/odata-petstore.fixture'

const ODATA_V4_METADATA_URL = 'http://localhost:5100/odata/$metadata'
const ODATA_FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/odata')
const IMPORT_FILE = join(ODATA_PETSTORE_TEMP_DIR, 'odata-import.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function requireApp(): ElectronApplication {
  if (!electronApp) throw new Error('app must be launched before configuring dialogs')
  return electronApp
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
  await expect(importModal).toBeVisible({ timeout: 2000 })
  const input = importModal.locator('[data-testid="source-input-input"]')
  await input.fill(source)
  // The preview tree populating is the "parsed + ready" signal.
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
}

Given('a new single-file YAML collection for OData import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(ODATA_PETSTORE_TEMP_DIR, 'odata-import.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  const saveOptionsModal = page.locator('[data-testid="save-options-modal"]')
  await expect(saveOptionsModal).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="save-mode-file"]').click()
  await page.locator('[data-testid="save-format-yaml"]').click()
  await page.locator('[data-testid="save-confirm-button"]').click()
  await expect(saveOptionsModal).not.toBeVisible({ timeout: 2000 })
  await page.waitForTimeout(500)
})

When('I import the OData v4 metadata URL', async () => {
  await importViaModal(ODATA_V4_METADATA_URL)
})

When('I import the OData fixture file {string}', async ({}, fileName: string) => {
  const filePath = join(ODATA_FIXTURES_DIR, fileName)
  expect(existsSync(filePath), `fixture ${filePath} must exist`).toBe(true)
  await importViaModal(filePath)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 10000 })
})

Then('the imported root folder should be tagged OData version {string}', async ({}, version: string) => {
  const p = requirePage()
  // Persist the imported document to disk, then read the version tag back
  // out of the saved single-file collection — the importer stamps the root
  // EnvironmentFolder's `tags` with `odata:<version>`.
  await p.keyboard.press('Control+S')
  await expect
    .poll(() => (existsSync(IMPORT_FILE) ? readFileSync(IMPORT_FILE, 'utf-8') : ''), { timeout: 10000 })
    .toContain(`odata:${version}`)
})
