import { createBdd } from 'playwright-bdd'
import { join, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { parse as yamlParse } from 'yaml'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  RESTORM_IMPORT_TEMP_DIR,
  configureNextSaveFileDialogForE2E,
  configureNextOpenDialogForE2E
} from '../../fixtures/restorm-import.fixture'

const RESTORM_FIXTURES_DIR = resolve(__dirname, '../../../../unit/fixtures/restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let projectFilePath: string | null = null

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

async function importViaModal(source: string): Promise<void> {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  const input = importModal.locator('[data-testid="source-input-input"]')
  await input.fill(source)
  // No format picker exists in the modal — the preview tree populating IS
  // the auto-detection signal (canImport matched without user input).
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
}

Given('a new single-file YAML collection for restorm import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(RESTORM_IMPORT_TEMP_DIR, 'restorm-import.restorm')
  projectFilePath = target
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  const p = requirePage()
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(p.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await p.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await p.waitForTimeout(500)
})

When('I import the restorm fixture file {string}', async ({}, fileName: string) => {
  const filePath = join(RESTORM_FIXTURES_DIR, fileName)
  expect(existsSync(filePath), `fixture ${filePath} must exist`).toBe(true)
  await importViaModal(filePath)
})

When('I save the project', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+s')
  await p.waitForTimeout(1000)
  expect(projectFilePath !== null && existsSync(projectFilePath), 'project file must exist after save').toBe(true)
})

When("I import the project's own file", async () => {
  if (!projectFilePath) throw new Error('project must be saved before importing its own file')
  await importViaModal(projectFilePath)
})

When('I reopen the project from disk', async () => {
  if (!projectFilePath) throw new Error('project must be saved before reopening')
  const p = requirePage()
  await configureNextOpenDialogForE2E(requireApp(), { kind: 'openFile', path: projectFilePath })
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(p.locator('[data-testid="titlebar-menu-item-open"]').first()).toBeVisible({ timeout: 2000 })
  await p.locator('[data-testid="titlebar-menu-item-open"]').first().click()
  await p.waitForTimeout(1500)
})

Then('the sidebar should show the imported folder {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(sidebarRowsByName(p, name).first()).toBeVisible({ timeout: 10000 })
})

Then('expanding {string} should reveal {string}', async ({}, folderName: string, childName: string) => {
  const p = requirePage()
  const folderRow = sidebarRowsByName(p, folderName).first()
  await expect(folderRow).toBeVisible({ timeout: 10000 })
  if ((await folderRow.getAttribute('aria-expanded')) !== 'true') await folderRow.click()
  await expect(sidebarRowsByName(p, childName).first()).toBeVisible({ timeout: 10000 })
})

Then('the saved project file should contain no duplicate document ids', async () => {
  if (!projectFilePath) throw new Error('project must be saved before checking its ids')
  // "A clean duplicate set" means clean IDENTITIES, not just two sidebar
  // rows: two subtrees sharing ids would render identically but corrupt
  // every id-keyed lookup (selection, deletion, workbench layout). The
  // saved YAML carries every document id (KeyValue row ids are stripped by
  // the save, so this sweep is exactly the document-id surface).
  const doc: unknown = yamlParse(readFileSync(projectFilePath, 'utf-8'))
  const ids: string[] = []
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) { for (const v of node) collect(v); return }
    if (node === null || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    if (typeof rec['id'] === 'string' && rec['id'] !== '') ids.push(rec['id'])
    for (const [key, v] of Object.entries(rec)) {
      // A scenario port's `id` ('value', 'response', …) is a structural
      // label copied from the node kind's template — duplicated across
      // nodes BY DESIGN, never instance identity. Everything else must be
      // globally unique.
      if (key === 'inputs' || key === 'outputs') continue
      collect(v)
    }
  }
  collect(doc)
  expect(ids.length).toBeGreaterThan(10)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  expect(dupes, `duplicate ids in saved project: ${dupes.join(', ')}`).toHaveLength(0)
})

Then('exactly {int} folders named {string} should be in the sidebar', async ({}, count: number, name: string) => {
  const p = requirePage()
  // The duplicate lives under the own-file wrapper — expand it so both
  // rows are actually rendered before counting.
  const wrapperRow = sidebarRowsByName(p, 'restorm-import').first()
  await expect(wrapperRow).toBeVisible({ timeout: 10000 })
  if ((await wrapperRow.getAttribute('aria-expanded')) !== 'true') await wrapperRow.click()
  await expect(sidebarRowsByName(p, name)).toHaveCount(count, { timeout: 10000 })
})
