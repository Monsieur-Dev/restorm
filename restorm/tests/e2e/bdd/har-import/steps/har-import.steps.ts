import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  HAR_IMPORT_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/har-import.fixture'

const HAR_FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/har')

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
  // No format picker exists in the modal — the preview tree populating IS
  // the auto-detection signal (canImport matched without user input).
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
}

Given('a new single-file YAML collection for HAR import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(HAR_IMPORT_TEMP_DIR, 'har-import.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  const p = requirePage()
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(p.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await p.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await p.waitForTimeout(500)
})

When('I import the HAR fixture file {string}', async ({}, fileName: string) => {
  const filePath = join(HAR_FIXTURES_DIR, fileName)
  expect(existsSync(filePath), `fixture ${filePath} must exist`).toBe(true)
  await importViaModal(filePath)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 10000 })
})

Then('the sidebar should show a child of {string}', async ({}, folderName: string) => {
  const p = requirePage()
  const folderRow = sidebarRowsByName(p, folderName).first()
  if ((await folderRow.getAttribute('aria-expanded')) !== 'true') await folderRow.click()
  const childCount = await p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ hasNot: p.getByText(folderName, { exact: true }) })
    .count()
  expect(childCount, `expected at least one row besides "${folderName}"`).toBeGreaterThan(0)
})

Then('exactly {int} folders named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 10000 })
})

Then('the imported request {string} should have response history', async ({}, requestName: string) => {
  const p = requirePage()
  const requestRow = sidebarRowsByName(p, requestName).first()
  await expect(requestRow).toBeVisible({ timeout: 10000 })
  await requestRow.click()

  // The history button carries a per-tab id suffix (`…-<requestId>`) so an
  // inactive `display:none` tab's copy can't be resolved by a flat testid;
  // `:visible` pins the locator to the active tab's on-screen button.
  const historyButton = p.locator('[data-testid^="request-header-history-button-"]:visible')
  await expect(historyButton).toBeVisible({ timeout: 5000 })
  await historyButton.click()

  await expect(p.locator('[data-testid="response-history-modal"]')).toBeVisible({ timeout: 5000 })
  // `HarImportService`'s `postImportSeed` writes history keyed by the
  // request's FINAL id — the one `useImport.ts` regenerates AFTER the tree
  // leaves main, threaded back through the `import:postImportSeed` IPC round
  // trip. A wrong channel name, a preload-binding miss, or the id map never
  // reaching main would leave this list empty while every unit test (which
  // mocks the boundary it sits on) still passes — this is the assertion that
  // actually exercises the real renderer → IPC → main → ResponseHistoryService
  // chain end to end.
  const rows = p.locator('[data-testid="response-history-list-view"] .list-view-row')
  await expect(rows.first()).toBeVisible({ timeout: 10000 })
})
