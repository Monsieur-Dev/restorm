import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { readFileSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { test, expect, configureNextSaveFileDialogForE2E, THRIFT_IMPORT_TEMP_DIR } from '../../fixtures/thrift-import.fixture'

const THRIFT_FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/thrift')

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

async function openImportModalWith(source: string): Promise<void> {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  const input = importModal.locator('[data-testid="source-input-input"]')
  await input.fill(source)
}

async function importViaModal(source: string): Promise<void> {
  await openImportModalWith(source)
  const p = requirePage()
  const importModal = p.locator('[data-testid="import-modal"]')
  // The preview tree populating is the "parsed + ready" signal.
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
}

Given('a new single-file YAML collection for Thrift import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(THRIFT_IMPORT_TEMP_DIR, 'thrift-import.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

When('I import the Thrift fixture file {string}', async ({}, fileName: string) => {
  await importViaModal(join(THRIFT_FIXTURES_DIR, fileName))
})

When('I paste the Thrift fixture file {string} into the import source', async ({}, fileName: string) => {
  const content = readFileSync(join(THRIFT_FIXTURES_DIR, fileName), 'utf-8')
  await openImportModalWith(content)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 10000 })
})

Then('exactly {int} folder named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 10000 })
})

Then('the import preview should be visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
})
