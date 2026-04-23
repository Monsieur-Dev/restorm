import { createBdd } from 'playwright-bdd'
import { copyFileSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, ODATA_TYPING_TEMP_DIR } from '../../fixtures/odata-typing.fixture'

const SAMPLES_DIR = resolve(__dirname, '../../../samples')
const ODATA_TYPING_SAMPLE = join(SAMPLES_DIR, 'odata-typing-sample.restorm')

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

function tabByName(currentPage: Page, name: string): Locator {
  return currentPage
    .locator('.tab[role="tab"]')
    .filter({ has: currentPage.getByText(name, { exact: true }) })
    .first()
}

/**
 * Locate an InputBox's actual `<input>` element. `InputBox` from
 * electron-core-ui exposes the real input under the suffix
 * `-input` when a `data-testid` is set, so always reach for that form
 * rather than querying the wrapper.
 */
function odataInput(currentPage: Page, testId: string): Locator {
  return currentPage.locator(`[data-testid="${testId}-input"]`).first()
}

Given('I open the OData typing sample collection', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  // Copy the sample into the scratch dir so the test never modifies the
  // shipped fixture, then drive File ▸ Open through the mocked native
  // dialog.
  const workingCopy = join(ODATA_TYPING_TEMP_DIR, 'odata-typing-sample.restorm')
  copyFileSync(ODATA_TYPING_SAMPLE, workingCopy)

  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: workingCopy })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-open"]').first().click()

  // Wait for the sidebar to populate with the imported collection.
  await expect(
    page.locator('[data-testid="sidebar-listview"] .list-view-row')
      .filter({ has: page.getByText('OData Typing', { exact: true }) })
      .first()
  ).toBeVisible({ timeout: 10000 })
})

When('I open the request {string} in an OData tab', async ({}, requestName: string) => {
  const p = requirePage()
  // Expand the tree so "List People" becomes reachable. Fall back to a
  // plain click if the row is already visible (the env folder may be
  // expanded by default).
  const envRow = p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText('OData Typing', { exact: true }) })
    .first()
  if (await envRow.count() > 0) {
    const expanded = await envRow.getAttribute('aria-expanded')
    if (expanded !== 'true') await envRow.click()
  }
  const folderRow = p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText('People', { exact: true }) })
    .first()
  if (await folderRow.count() > 0) {
    const expanded = await folderRow.getAttribute('aria-expanded')
    if (expanded !== 'true') await folderRow.click()
  }

  const row = p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(requestName, { exact: true }) })
    .first()
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await expect(tabByName(p, requestName)).toBeVisible({ timeout: 5000 })
  // Wait for the OData form to mount — the $filter input is the most
  // reliable anchor because it lives at the top of the query-options
  // section and has no variants across operation kinds.
  await expect(odataInput(p, 'odata-request-filter')).toBeVisible({ timeout: 5000 })
})

/**
 * Drive typing through real keyboard events so the React onChange
 * handler fires on every character — this is exactly the path that was
 * broken in OYO-253 (proxy mutated, React state didn't, input stayed
 * visually empty).
 */
async function typeInto(p: Page, testId: string, text: string): Promise<void> {
  const input = odataInput(p, testId)
  await input.click()
  // Select + clear anything already present so the assertion compares
  // exactly what we just typed.
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type(text)
  // Give the reactive proxy's 50ms debounce + React commit a beat so
  // downstream listeners (URL preview, dirty-state) settle before the
  // assertion reads them back.
  await p.waitForTimeout(200)
}

When('I type {string} into the $filter input', async ({}, text: string) => {
  await typeInto(requirePage(), 'odata-request-filter', text)
})

When('I type {string} into the $top input', async ({}, text: string) => {
  await typeInto(requirePage(), 'odata-request-top', text)
})

When('I type {string} into the $select input', async ({}, text: string) => {
  await typeInto(requirePage(), 'odata-request-select', text)
})

When('I type {string} into the $search input', async ({}, text: string) => {
  await typeInto(requirePage(), 'odata-request-search', text)
})

Then('the $filter input should show {string}', async ({}, expected: string) => {
  await expect(odataInput(requirePage(), 'odata-request-filter')).toHaveValue(expected, { timeout: 5000 })
})

Then('the $top input should show {string}', async ({}, expected: string) => {
  await expect(odataInput(requirePage(), 'odata-request-top')).toHaveValue(expected, { timeout: 5000 })
})

Then('the $select input should show {string}', async ({}, expected: string) => {
  await expect(odataInput(requirePage(), 'odata-request-select')).toHaveValue(expected, { timeout: 5000 })
})

Then('the $search input should show {string}', async ({}, expected: string) => {
  await expect(odataInput(requirePage(), 'odata-request-search')).toHaveValue(expected, { timeout: 5000 })
})

Then('the OData URL preview should contain {string}', async ({}, fragment: string) => {
  const preview = requirePage().locator('[data-testid="odata-request-url-preview"]')
  await expect(preview).toContainText(fragment, { timeout: 5000 })
})
