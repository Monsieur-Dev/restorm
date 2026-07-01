import { createBdd } from 'playwright-bdd'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { test, expect, HTTPIE_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E } from '../../fixtures/httpie-import.fixture'

const E2E_SAMPLES_DIR = resolve(__dirname, '../../../samples')
const UNIT_FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/httpie')
const SINGLE_FILE = join(HTTPIE_IMPORT_TEMP_DIR, 'httpie-import-test.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

void electronApp

function requirePage(): Page {
  if (!page) throw new Error('app must be launched')
  return page
}

function sidebarRow(p: Page, name: string): Locator {
  return p.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) }).first()
}

Given('a new single-file collection for HTTPie import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  await configureNextSaveFileDialogForE2E(launched.app, { kind: 'saveFile', path: SINGLE_FILE })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

async function importFixture(p: Page, samplePath: string): Promise<void> {
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

When('I import the HTTPie Desktop collection', async () => {
  await importFixture(requirePage(), join(E2E_SAMPLES_DIR, 'httpie-collection.json'))
})

When('I import the HTTPie CLI session', async () => {
  await importFixture(requirePage(), join(UNIT_FIXTURES_DIR, 'session.json'))
})

Then('the sidebar should contain an environment folder named {string}', async ({}, name: string) => {
  const p = requirePage()
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })
  await expect(sidebar.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 5000 })
})

When('I open the request {string} and send it', async ({}, name: string) => {
  const p = requirePage()
  await sidebarRow(p, name).dblclick()
  const sendButton = p.locator('[data-testid="http-request-send-button"]').first()
  await expect(sendButton).toBeVisible({ timeout: 5000 })
  await sendButton.click()
  await expect(p.locator('[data-testid="http-response-status"]').first()).toBeVisible({ timeout: 15000 })
})

Then('the response status should be {int}', async ({}, statusCode: number) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="http-response-status"]').first()).toHaveAttribute(
    'data-status-code',
    String(statusCode),
    { timeout: 10000 }
  )
})

Then('the saved collection should carry the session variable {string} with value {string}', async ({}, key: string, value: string) => {
  const p = requirePage()
  await p.keyboard.press('Control+S')
  await expect
    .poll(() => (existsSync(SINGLE_FILE) ? readFileSync(SINGLE_FILE, 'utf-8') : ''), { timeout: 10000 })
    .toContain(value)
  const saved = readFileSync(SINGLE_FILE, 'utf-8')
  expect(saved).toContain(key)
})
