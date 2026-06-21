import { createBdd } from 'playwright-bdd'
import { copyFileSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, BODY_TYPE_MIGRATION_TEMP_DIR } from '../fixtures/body-type-migration.fixture'

const SAMPLES_DIR = resolve(__dirname, '../../../samples')
const LEGACY_SAMPLE = join(SAMPLES_DIR, 'body-type-legacy-sample.restorm')

// BODY_MODES order in HTTPRequestBodySection — the RadioGroup stamps the
// active index on `data-active-index`, so the mode maps to an index.
const BODY_MODE_INDEX: Record<string, string> = {
  text: '0',
  'form-data': '1',
  'x-www-form-urlencoded': '2',
  file: '3'
}

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

function sidebarRowByName(currentPage: Page, name: string): Locator {
  return currentPage
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: currentPage.getByText(name, { exact: true }) })
    .first()
}

async function openBodySubTab(p: Page): Promise<void> {
  const bodySubTab = p.locator('[role="tab"][data-tab-id="body"]:visible').first()
  if ((await bodySubTab.count()) > 0) {
    const active = await bodySubTab.getAttribute('aria-selected')
    if (active !== 'true') {
      await bodySubTab.click()
      await p.waitForTimeout(300)
    }
  }
}

async function expectDocumentTitleClean(p: Page): Promise<void> {
  await expect.poll(async () => (await p.title()).endsWith(' *'), {
    timeout: 10000,
    message: 'expected window title not to end with " *" (load-time migration must not dirty the document)'
  }).toBe(false)
}

Given('I open the legacy body-type sample collection', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const workingCopy = join(BODY_TYPE_MIGRATION_TEMP_DIR, 'body-type-legacy-sample.restorm')
  copyFileSync(LEGACY_SAMPLE, workingCopy)

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRowByName(page, 'Legacy form-data request')).toBeVisible({ timeout: 10000 })
})

When('I open the request {string} in a tab', async ({}, requestName: string) => {
  const p = requirePage()
  const row = sidebarRowByName(p, requestName)
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await p.waitForTimeout(300)
  await openBodySubTab(p)
})

Then('the body mode should be {string}', async ({}, mode: string) => {
  const p = requirePage()
  const expectedIndex = BODY_MODE_INDEX[mode]
  if (expectedIndex === undefined) throw new Error(`Unknown body mode: ${mode}`)
  const radio = p.locator('[data-testid="http-request-body-mode-radio"]:visible').first()
  await expect(radio).toBeVisible({ timeout: 10000 })
  await expect(radio).toHaveAttribute('data-active-index', expectedIndex, { timeout: 10000 })
})

Then('the body fields table should be visible', async () => {
  const p = requirePage()
  const table = p.locator('[data-testid="http-request-body-fields-table"]:visible').first()
  await expect(table).toBeVisible({ timeout: 10000 })
})

Then('the window should be clean', async () => {
  await expectDocumentTitleClean(requirePage())
})
