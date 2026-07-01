import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  WADL_IMPORT_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/wadl-import.fixture'

const WADL_FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/wadl')

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

/** Expand a sidebar tree row by name so its children become visible. A
 * newly imported root auto-expands one level; a resource nested two (or
 * more) levels deep — e.g. WADL's `{id}` under `pets` — needs its parent
 * expanded explicitly first. No-op if already expanded. */
async function expandSidebarFolder(currentPage: Page, name: string): Promise<void> {
  const row = sidebarRowsByName(currentPage, name).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  const expanded = await row.getAttribute('aria-expanded')
  if (expanded === 'false') {
    await row.locator('.list-view-item-title-toggle, [data-testid$="-toggle"]').first().click().catch(() => undefined)
    await currentPage.waitForTimeout(200)
  }
}

async function importViaModal(source: string): Promise<void> {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  const input = importModal.locator('[data-testid="source-input-input"]')
  await input.fill(source)
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
}

Given('a fresh single-file collection for WADL import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(WADL_IMPORT_TEMP_DIR, 'wadl-import.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 5000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

When('I import the WADL fixture file {string}', async ({}, fileName: string) => {
  const filePath = join(WADL_FIXTURES_DIR, fileName)
  expect(existsSync(filePath), `fixture ${filePath} must exist`).toBe(true)
  await importViaModal(filePath)
})

When('I open the import modal', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  await expect(p.locator('[data-testid="import-modal"]')).toBeVisible({ timeout: 15000 })
})

When('I paste the WADL fixture file {string} into the import source', async ({}, fileName: string) => {
  const p = requirePage()
  const filePath = join(WADL_FIXTURES_DIR, fileName)
  expect(existsSync(filePath), `fixture ${filePath} must exist`).toBe(true)
  const input = p.locator('[data-testid="import-modal"] [data-testid="source-input-input"]')
  await input.fill(filePath)
})

Then('the import preview should be visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="import-modal"] [data-testid="import-selection-tree"]')).toBeVisible({
    timeout: 30000
  })
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 15000 })
})

Then('I expand the sidebar folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expandSidebarFolder(p, name)
})

Then('exactly {int} folders named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 15000 })
})
