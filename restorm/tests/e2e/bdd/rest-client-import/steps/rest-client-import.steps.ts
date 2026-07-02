import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, REST_CLIENT_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E } from '../../fixtures/rest-client-import.fixture'

/** The committed `.http` fixture — the unit tests consume the same file, one source of truth. */
const FIXTURE = resolve(__dirname, '../../../../unit/fixtures/rest-client/sample.http')
const SINGLE_FILE = join(REST_CLIENT_IMPORT_TEMP_DIR, 'rest-client-test.restorm')

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

Given('a new single-file YAML collection', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: SINGLE_FILE })

  const p = requirePage()
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(p.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await p.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await p.waitForTimeout(500)
})

When('I import the REST Client sample file', async () => {
  const p = requirePage()
  expect(existsSync(FIXTURE), `fixture missing: ${FIXTURE}`).toBe(true)

  // The .http extension alone drives auto-detection — no format is picked explicitly.
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(FIXTURE)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 5000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 2000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(500)
})

Then('the sidebar should contain an environment folder named {string}', async ({}, name: string) => {
  const p = requirePage()
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })
  await expect(sidebar.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 5000 })
})

Then('the environment folder {string} should expose a request named {string}', async ({}, parent: string, requestName: string) => {
  const p = requirePage()
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })

  // Expand the root env folder if it isn't already.
  const parentRow = sidebar.locator('[role="treeitem"]', { hasText: parent }).first()
  await expect(parentRow).toBeVisible({ timeout: 5000 })
  const expanded = await parentRow.getAttribute('aria-expanded')
  if (expanded === 'false') {
    await parentRow.locator('.list-view-item-title-toggle, [data-testid$="-toggle"]').first().click().catch(() => undefined)
    await p.waitForTimeout(200)
  }

  await expect(sidebar.getByText(requestName, { exact: true }).first()).toBeVisible({ timeout: 5000 })
})
