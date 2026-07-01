import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { test, expect, RAML_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E } from '../../fixtures/raml-import.fixture'

const FIXTURE = resolve(__dirname, '../../../../unit/fixtures/raml/petstore.raml')
const SINGLE_FILE = join(RAML_IMPORT_TEMP_DIR, 'raml-test.restorm')

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
function sidebarRowByName(p: Page, name: string): Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) })
    .first()
}

/** Expand a sidebar tree row by name if it's currently collapsed. Used to
 * walk down to a leaf request nested several resource-folders deep — the
 * RAML importer creates one folder per resource (even a leaf resource with
 * a single method), so a request like "GET /pet/findByStatus" sits under
 * "Pet" > "/findByStatus", both of which must be expanded before the
 * request row is visible/clickable. */
async function expandTreeItemIfCollapsed(p: Page, name: string): Promise<void> {
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  const row = sidebar.locator('[role="treeitem"]', { hasText: name }).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  const expandedAttr = await row.getAttribute('aria-expanded')
  if (expandedAttr === 'false') {
    await row.locator('.list-view-item-title-toggle, [data-testid$="-toggle"]').first().click().catch(() => undefined)
    await p.waitForTimeout(200)
  }
}

Given('a new single-file collection for RAML import', async ({ launchApp }) => {
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

async function importFixture(p: Page): Promise<void> {
  expect(existsSync(FIXTURE), `fixture must exist: ${FIXTURE}`).toBe(true)

  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(FIXTURE)
  // RAML parsing (raml-1-parser: temp-file write + its definition-system
  // init) is heavier than the JSON-based importers this step's timeouts
  // were modeled on — give the debounced preview more room.
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(500)
}

When('I import the RAML petstore sample', async () => {
  await importFixture(requirePage())
})

When('I open the import modal and paste the RAML petstore sample', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(FIXTURE)
})

Then('the import preview should be visible', async () => {
  await expect(requirePage().locator('[data-testid="import-modal"] .import-preview-section')).toBeVisible({ timeout: 15000 })
})

Then('the sidebar should contain an environment folder named {string}', async ({}, name: string) => {
  const sidebar = requirePage().locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })
  await expect(sidebar.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 5000 })
})

Then('the environment folder {string} should expose a sub-folder named {string}', async ({}, parent: string, child: string) => {
  const p = requirePage()
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })

  const parentRow = sidebar.locator('[role="treeitem"]', { hasText: parent }).first()
  await expect(parentRow).toBeVisible({ timeout: 5000 })
  const expanded = await parentRow.getAttribute('aria-expanded')
  if (expanded === 'false') {
    await parentRow.locator('.list-view-item-title-toggle, [data-testid$="-toggle"]').first().click().catch(() => undefined)
    await p.waitForTimeout(200)
  }

  await expect(sidebar.getByText(child, { exact: true }).first()).toBeVisible({ timeout: 5000 })
})

Then('exactly {int} root folders named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const sidebar = requirePage().locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })
  await expect(sidebar.getByText(name, { exact: true })).toHaveCount(count, { timeout: 5000 })
})

When('I run the {string} request', async ({}, requestName: string) => {
  const p = requirePage()
  // The request lives 2 resource-folders deep: root > "Pet" > "/findByStatus"
  // (see fixtures/raml/petstore.raml — every resource gets its own folder,
  // even a leaf resource with a single method). Expand the chain before
  // looking for the request row.
  for (const ancestor of ['Pet Store RAML API', 'Pet', '/findByStatus']) {
    await expandTreeItemIfCollapsed(p, ancestor)
  }

  const row = sidebarRowByName(p, requestName)
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()

  const sendBtn = p.locator('[data-testid="http-request-send-button"]:visible')
  await expect(sendBtn).toBeVisible({ timeout: 10000 })
  await sendBtn.click()
})

Then('the response status is {string}', async ({}, status: string) => {
  const p = requirePage()
  const responseTabs = p.locator('[data-testid="base-request-tabs-response"]').first()
  await responseTabs.waitFor({ state: 'visible', timeout: 20000 })
  const infosTab = responseTabs.locator('[role="tab"]', { hasText: 'Infos' }).first()
  await infosTab.click({ timeout: 10000 })
  const statusEl = p.locator('[data-testid="http-response-status"]:visible').first()
  await expect(statusEl).toBeVisible({ timeout: 20000 })
  await expect(statusEl).toHaveAttribute('data-status-code', status, { timeout: 10000 })
})
