import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
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

async function importViaModal(sourcePath: string): Promise<void> {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  const input = importModal.locator('[data-testid="source-input-input"]')
  await input.fill(sourcePath)
  // The preview tree populating is the "parsed + ready" signal. drafter.js's
  // WASM parse is heavier than the JSON-based importers' preview, so this
  // gets a generous timeout.
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

// There is no raw-content-paste import: the source field always resolves to
// a file path or a URL (`ImportManager.importFrom` reads it via `fs.readFile`
// when it isn't a URL) — pasting multi-KB raw text into it fails at the
// filesystem layer. To prove detection works off the `FORMAT: 1A` content
// header alone (not just the `.apib` extension), write the fixture to a
// same-content file with a NON-`.apib` extension and import that path.
When('I import the API Blueprint fixture content saved without the .apib extension', async () => {
  const content = readFileSync(join(FIXTURES_DIR, 'polls.apib'), 'utf-8')
  const noExtPath = join(API_BLUEPRINT_IMPORT_TEMP_DIR, 'polls-no-extension.txt')
  writeFileSync(noExtPath, content, 'utf-8')
  await importViaModal(noExtPath)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 15000 })
})

Then('exactly {int} folders named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 15000 })
})
