import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect, OPENAPI_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E } from '../../fixtures/openapi-import.fixture'

const FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/openapi')
const SINGLE_FILE = join(OPENAPI_IMPORT_TEMP_DIR, 'api-design-issues-test.restorm')

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
  // The background (main-process) validation pass runs off the collections-set
  // that the imported tree commits; give it a beat to broadcast.
  await p.waitForTimeout(800)
}

When('I import the deliberately flawed OpenAPI spec', async () => {
  if (!page) throw new Error('app must be launched')
  await importFixture(page, 'design-issues-3.0.json')
})

When('I import the OpenAPI 3.0 Petstore spec', async () => {
  if (!page) throw new Error('app must be launched')
  await importFixture(page, 'petstore-3.0.json')
})

Then('the sidebar should contain an environment folder named {string}', async ({}, name: string) => {
  if (!page) throw new Error('app must be launched')
  const sidebar = page.locator('[data-testid="sidebar-listview"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })
  await expect(sidebar.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 5000 })
})

function envFolderRow(p: Page, name: string): ReturnType<Page['locator']> {
  return p.locator('[data-testid="sidebar-listview"] [role="treeitem"]', { hasText: name }).first()
}

Then('the environment folder {string} should show a design-issues indicator', async ({}, name: string) => {
  if (!page) throw new Error('app must be launched')
  const row = envFolderRow(page, name)
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row.locator('[data-testid^="design-issues-indicator-"]')).toBeVisible({ timeout: 5000 })
})

Then('the environment folder {string} should not show a design-issues indicator', async ({}, name: string) => {
  if (!page) throw new Error('app must be launched')
  const row = envFolderRow(page, name)
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row.locator('[data-testid^="design-issues-indicator-"]')).toHaveCount(0)
})

async function openEnvFolder(p: Page, name: string): Promise<void> {
  const row = envFolderRow(p, name)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.dblclick()
  await expect(p.locator('[data-testid$="-tabs"]').first()).toBeVisible({ timeout: 5000 })
}

Then('opening the environment folder {string} reveals an {string} tab', async ({}, name: string, _tab: string) => {
  if (!page) throw new Error('app must be launched')
  await openEnvFolder(page, name)
  const issuesTab = page.locator('[data-testid$="-tabs-tab-issues"]')
  await expect(issuesTab).toBeVisible({ timeout: 5000 })
  await issuesTab.click()
})

Then('opening the environment folder {string} shows no {string} tab', async ({}, name: string, _tab: string) => {
  if (!page) throw new Error('app must be launched')
  await openEnvFolder(page, name)
  await expect(page.locator('[data-testid$="-tabs-tab-issues"]')).toHaveCount(0)
})

Then('the Issues tab lists at least {int} design problems', async ({}, min: number) => {
  if (!page) throw new Error('app must be launched')
  await expect(page.locator('[data-testid="api-design-issues-list"]')).toBeVisible({ timeout: 5000 })
  const groups = page.locator('[data-testid^="api-design-issue-group-"]')
  const count = await groups.count()
  expect(count).toBeGreaterThanOrEqual(min)
})
