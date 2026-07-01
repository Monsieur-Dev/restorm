import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
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
