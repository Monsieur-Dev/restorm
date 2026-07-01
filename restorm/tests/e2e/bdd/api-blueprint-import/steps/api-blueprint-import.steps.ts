import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  API_BLUEPRINT_IMPORT_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/api-blueprint-import.fixture'

const FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/api-blueprint')

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

Given('a new single-file YAML collection for API Blueprint import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(API_BLUEPRINT_IMPORT_TEMP_DIR, 'api-blueprint-import.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

When('I import the API Blueprint fixture file {string}', async ({}, fileName: string) => {
  const filePath = join(FIXTURES_DIR, fileName)
  expect(existsSync(filePath), `fixture ${filePath} must exist`).toBe(true)
  await importViaModal(filePath)
})

When('I paste the API Blueprint fixture content into the import source', async () => {
  const content = readFileSync(join(FIXTURES_DIR, 'polls.apib'), 'utf-8')
  await importViaModal(content)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 10000 })
})

Then('exactly {int} folder named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 10000 })
})
