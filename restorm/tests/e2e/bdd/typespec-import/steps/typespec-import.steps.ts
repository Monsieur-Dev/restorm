import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/typespec-import.fixture'

const TYPESPEC_FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/typespec')

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

/** The importer auto-expands every folder it just created, but defensively
 * expand anyway (matching openapi-import's pattern) — if a row is already
 * expanded this is a harmless no-op. */
async function ensureExpanded(currentPage: Page, name: string): Promise<void> {
  const row = sidebarRowsByName(currentPage, name).first()
  if (!(await row.count())) return
  const expanded = await row.getAttribute('aria-expanded').catch(() => null)
  if (expanded === 'false') {
    await row.locator('.list-view-item-title-toggle, [data-testid$="-toggle"], button.list-view-expander').first().click().catch(() => undefined)
    await currentPage.waitForTimeout(200)
  }
}

async function openImportModalWithSource(source: string): Promise<void> {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  const input = importModal.locator('[data-testid="source-input-input"]')
  await input.fill(source)
}

/** Full happy-path import: fill the source, wait for the parsed preview,
 * confirm, wait for the modal to close. */
async function importViaModal(source: string): Promise<void> {
  const p = requirePage()
  await openImportModalWithSource(source)
  // The preview tree populating is the "compiled + parsed + ready" signal —
  // for TypeSpec this is downstream of a real compile (via Restorm's own
  // bundled compiler, `process.execPath` + `ELECTRON_RUN_AS_NODE`), the
  // slowest step of any importer in this suite (cold module load under
  // xvfb) — give it generous headroom, well beyond a pure-JSON importer.
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 45000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(p.locator('[data-testid="import-modal"]')).not.toBeVisible({ timeout: 20000 })
  await p.waitForTimeout(500)
}

Given('a new single-file YAML collection for TypeSpec import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(resolve(__dirname, '../../../.tmp/typespec-import'), 'typespec-import.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

When('I import the TypeSpec sample file {string}', async ({}, fileName: string) => {
  const filePath = join(TYPESPEC_FIXTURES_DIR, fileName)
  expect(existsSync(filePath), `fixture ${filePath} must exist`).toBe(true)
  await importViaModal(filePath)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 20000 })
})

Then('the sidebar should show the imported request {string}', async ({}, name: string) => {
  const p = requirePage()
  // The petstore fixture has no `tags`, so the OpenAPI importer files every
  // operation under an untagged "Other" sub-folder beneath the root "Pet
  // Store" folder — expand both ancestors before looking for the request.
  await ensureExpanded(p, 'Pet Store')
  await ensureExpanded(p, 'Other')
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 20000 })
})

Then('exactly {int} imported folder named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 20000 })
})
