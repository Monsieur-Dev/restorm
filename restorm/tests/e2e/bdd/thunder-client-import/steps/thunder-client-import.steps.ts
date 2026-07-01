import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/thunder-client-import.fixture'

const THUNDER_CLIENT_FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/thunder-client')

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

// A surface's value can live in a plain text node, an ECUI InputBox
// `<input>`/`<textarea>`, or a Monaco editor (rendered `.view-line` spans,
// which `textContent` still aggregates). The request URL and the method
// SelectBox both need this: the URL is a Monaco surface, the SelectBox
// renders its selected option's label as regular text.
async function surfaceContains(p: Page, testid: string, needle: string): Promise<boolean> {
  return p.evaluate(({ tid, n }) => {
    const els = Array.from(document.querySelectorAll(`[data-testid="${tid}"]`))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
    for (const el of els) {
      const texts: string[] = [el.textContent]
      el.querySelectorAll('input, textarea').forEach((i) => texts.push((i as HTMLInputElement).value))
      if (texts.some((t) => t.includes(n))) return true
    }
    return false
  }, { tid: testid, n: needle }).catch(() => false)
}

async function expectSurfaceContains(p: Page, testid: string, needle: string): Promise<void> {
  await expect.poll(() => surfaceContains(p, testid, needle), {
    timeout: 20_000,
    message: `${testid} should surface "${needle}" (text / input / monaco)`
  }).toBe(true)
}

// A RestormKeyValueTable renders each row's key as an ECUI InputBox, so the
// key lives in an `<input>` VALUE, not as table text.
async function expectKvTableKey(p: Page, tableTestid: string, key: string): Promise<void> {
  const inputs = p.locator(`[data-testid="${tableTestid}"]:visible input`)
  await expect.poll(async () => {
    const values = await inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
    return values.includes(key)
  }, { timeout: 20_000, message: `${tableTestid} should have a row whose input value is "${key}"` }).toBe(true)
}

async function importViaModal(source: string): Promise<void> {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  const input = importModal.locator('[data-testid="source-input-input"]')
  await input.fill(source)
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 15000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(500)
}

Given('a new single-file JSON collection for Thunder Client import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(resolve(__dirname, '../../../.tmp/thunder-client-import'), 'thunder-client-import.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  const p = requirePage()
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(p.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await p.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await p.waitForTimeout(500)
})

When('I import the Thunder Client fixture file {string}', async ({}, fileName: string) => {
  const filePath = join(THUNDER_CLIENT_FIXTURES_DIR, fileName)
  expect(existsSync(filePath), `fixture ${filePath} must exist`).toBe(true)
  await importViaModal(filePath)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 10000 })
})

When('I open the imported request {string}', async ({}, name: string) => {
  const p = requirePage()
  // Expand the ancestor folder so a nested request (e.g. "List pets"
  // under Pets) is actually in the DOM, then wait for the expand to
  // settle before touching anything else — reflow from the toggle can
  // otherwise shift a same-tick second click onto the wrong row.
  const pets = sidebarRowsByName(p, 'Pets').first()
  await expect(pets).toBeVisible({ timeout: 10000 })
  if ((await pets.getAttribute('aria-expanded')) !== 'true') {
    await pets.click()
    await expect(pets).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 })
  }

  // A single click opens (or focuses) the row's tab — same as the tree
  // elsewhere in the suite; a double-click risks its second half landing
  // on a row that reflowed after the first.
  const row = sidebarRowsByName(p, name).first()
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await expect(p.locator('[data-testid="http-request-url-section"]:visible')).toBeVisible({ timeout: 10000 })
})

Then('the request editor shows method {string} and url {string}', async ({}, method: string, url: string) => {
  const p = requirePage()
  await expectSurfaceContains(p, 'http-request-method-select', method)
  await expectSurfaceContains(p, 'http-request-url-input', url)
})

Then('the request editor shows a header named {string}', async ({}, headerName: string) => {
  const p = requirePage()
  await expectKvTableKey(p, 'http-request-headers-table', headerName)
})
