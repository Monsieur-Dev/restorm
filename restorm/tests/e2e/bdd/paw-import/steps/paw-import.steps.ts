import { materializeTextFixture } from '../../../helpers/testcontainers/services'
import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import type { Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  PAW_IMPORT_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/paw-import.fixture'

// Dedicated e2e sample (not the unit-test fixture): a single request under a
// single folder, no dynamic values, so the live-run scenario has nothing to
// confound it — dynamic-value mapping is already exhaustively unit-tested.
const FIXTURE_SOURCE = resolve(__dirname, '../../../samples/paw-petstore-e2e.json')
const SINGLE_FILE = join(PAW_IMPORT_TEMP_DIR, 'paw-import-test.restorm')

const SEND_BTN = '[data-testid="http-request-send-button"]:visible'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

function sidebarRowsByName(p: Page, name: string): Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) })
}

/** Expand a sidebar folder row via its chevron button (`.list-view-expander`)
 * rather than clicking the row itself — the row's own click handler only
 * toggles expansion when the ListView isn't configured `expandOnChevronOnly`,
 * so the chevron is the one control guaranteed to expand regardless. */
async function expandRowIfCollapsed(p: Page, name: string): Promise<void> {
  const row = sidebarRowsByName(p, name).first()
  await expect(row).toBeVisible({ timeout: 15000 })
  if ((await row.getAttribute('aria-expanded')) !== 'true') {
    await row.locator('.list-view-expander').click()
  }
}

Given('a new single-file YAML collection for Paw import', async ({ launchApp }) => {
  const launched = await launchApp()
  page = launched.page

  await configureNextSaveFileDialogForE2E(launched.app, { kind: 'saveFile', path: SINGLE_FILE })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

When('I import the Paw sample export', async ({ services }) => {
  const FIXTURE = materializeTextFixture(FIXTURE_SOURCE, join(PAW_IMPORT_TEMP_DIR, 'paw-petstore-e2e.json'), services)
  const p = requirePage()

  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 15000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(FIXTURE)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  if (name !== 'Paw Import') await expandRowIfCollapsed(p, 'Paw Import')
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 15000 })
})

Then('the sidebar should show the imported request {string}', async ({}, name: string) => {
  const p = requirePage()
  await expandRowIfCollapsed(p, 'Paw Import')
  await expandRowIfCollapsed(p, 'Pets')
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 15000 })
})

When('I open the imported request {string}', async ({}, name: string) => {
  const p = requirePage()
  await expandRowIfCollapsed(p, 'Paw Import')
  await expandRowIfCollapsed(p, 'Pets')
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 15000 })
  await sidebarRowsByName(p, name).first().click()
  await p.locator(SEND_BTN).waitFor({ state: 'visible', timeout: 20000 })
})

When('I click Send', async () => {
  const p = requirePage()
  await p.locator(SEND_BTN).click()
})

Then('the response status is {string}', async ({}, status: string) => {
  const p = requirePage()
  const responseTabs = p.locator('[data-testid="base-request-tabs-response"]').first()
  await responseTabs.waitFor({ state: 'visible', timeout: 20000 })
  await responseTabs.locator('[role="tab"]', { hasText: 'Infos' }).first().click({ timeout: 10000 })
  const statusEl = p.locator('[data-testid="http-response-status"]:visible').first()
  await expect(statusEl).toBeVisible({ timeout: 20000 })
  await expect(statusEl).toHaveAttribute('data-status-code', status, { timeout: 15000 })
})

Then('the response body contains {string}', async ({}, needle: string) => {
  const p = requirePage()
  const responseTabs = p.locator('[data-testid="base-request-tabs-response"]').first()
  await responseTabs.waitFor({ state: 'visible', timeout: 20000 })
  await responseTabs.locator('[role="tab"]', { hasText: 'Response' }).first().click({ timeout: 10000 })
  const editor = p.locator('[data-testid="http-response-body-editor"]:visible').first()
  await editor.waitFor({ state: 'visible', timeout: 20000 })
  await expect(async () => {
    const text = await editor.innerText()
    // Monaco can insert non-breaking spaces / soft-wraps; normalise
    // whitespace before substring matching (mirrors http-execution.steps.ts).
    const normalised = text.replace(/ /g, ' ').replace(/\s+/g, ' ')
    expect(normalised).toContain(needle.replace(/\s+/g, ' '))
  }).toPass({ timeout: 15000 })
})

Then('exactly {int} folders named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 15000 })
})
