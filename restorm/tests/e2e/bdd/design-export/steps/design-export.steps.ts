import { createBdd } from 'playwright-bdd'
import { copyFileSync, existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import type { Page, ElectronApplication } from '@playwright/test'
import SwaggerParser from '@apidevtools/swagger-parser'
import { configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import { test, expect, DESIGN_EXPORT_TEMP_DIR } from '../../fixtures/design-export.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let app: ElectronApplication | null = null
let exportedPath = ''

const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-server-sample.restorm')
const PETSTORE_SPEC = resolve(__dirname, '../../../../unit/fixtures/openapi/petstore-3.0.json')
const DESIGN_ID = 'design-petstore'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function requireApp(): ElectronApplication {
  if (!app) throw new Error('the app has not been launched')
  return app
}

function exportedDocument(): Record<string, unknown> {
  expect(existsSync(exportedPath), `exported file must exist: ${exportedPath}`).toBe(true)
  return JSON.parse(readFileSync(exportedPath, 'utf-8')) as Record<string, unknown>
}

async function openProject(launchApp: (opts?: { plan?: 'pro' | 'enterprise' }) => Promise<{ app: ElectronApplication; page: Page }>, projectFile: string): Promise<void> {
  const launched = await launchApp({ plan: 'pro' })
  page = launched.page
  app = launched.app
  const projectPath = join(DESIGN_EXPORT_TEMP_DIR, projectFile)
  copyFileSync(DESIGN_SAMPLE, projectPath)
  const p = page
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (fp: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await p.waitForTimeout(800)
}

async function openDesignSettings(p: Page): Promise<void> {
  await p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${DESIGN_ID}"]`).click()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="design-export-download"]')).toBeVisible({ timeout: 5000 })
}

Given('a Pro project carrying an API design is open on its export settings', async ({ launchApp }) => {
  await openProject(launchApp, 'design-export.restorm')
  await openDesignSettings(requirePage())
})

Given('a Pro project with the imported Petstore spec and its derived design', async ({ launchApp }) => {
  // The import modal needs an OPEN project to import into.
  await openProject(launchApp, 'design-export-chain.restorm')
  const p = requirePage()
  // Import the Petstore spec through the real import modal.
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  await importModal.locator('textarea, input[type="text"]').first().fill(PETSTORE_SPEC)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 10000 })
  await importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(800)
  // Derive the design from the imported env folder's context menu —
  // exact text: the project root ("Petstore design project") and the
  // sample design ("Petstore design") must not match.
  const envRow = p.locator('[data-testid="sidebar-listview"] [role="treeitem"]')
    .filter({ has: p.getByText('Petstore', { exact: true }) }).first()
  await expect(envRow).toBeVisible({ timeout: 5000 })
  await envRow.click({ button: 'right' })
  const entry = p.getByText('Créer un design à partir de cette API', { exact: true })
    .or(p.getByText('Create a design from this API', { exact: true }))
  await expect(entry.first()).toBeVisible({ timeout: 5000 })
  await entry.first().click()
  await p.waitForTimeout(800)
  await expect(p.locator('[data-testid^="design-tab-view-"]')).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="design-export-download"]')).toBeVisible({ timeout: 5000 })
})

When('I download the design descriptor as {string}', async ({}, formatLabel: string) => {
  const p = requirePage()
  // The combo already defaults to the requested (only) format — assert
  // rather than reconfigure, so the step fails loudly if formats grow.
  await expect(p.locator('[data-testid="design-export-format-trigger"]')).toContainText(formatLabel, { timeout: 5000 })
  exportedPath = join(DESIGN_EXPORT_TEMP_DIR, `exported-${String(Date.now())}.json`)
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: exportedPath })
  await p.locator('[data-testid="design-export-download"]').click()
  await expect(p.locator('[data-testid="design-export-status"]')).toBeVisible({ timeout: 10000 })
})

Then('the exported file is a valid OpenAPI 3.1 document', async () => {
  const doc = exportedDocument()
  expect(doc['openapi']).toBe('3.1.0')
  // The real linter — not an eyeball check.
  await expect(SwaggerParser.validate(structuredClone(doc) as never)).resolves.toBeDefined()
})

Then('the exported document carries the design\'s routes and components', () => {
  const doc = exportedDocument()
  const paths = doc['paths'] as Record<string, unknown>
  // Spec spelling ({id}, not {{id}}), no design base path in operation
  // paths (it travels in servers[0].url).
  expect(Object.keys(paths)).toEqual(['/v1/users/{id}', '/v1/users'])
  const schemas = (doc['components'] as { schemas: Record<string, unknown> }).schemas
  expect(Object.keys(schemas).sort()).toEqual(['AdminUser', 'Order', 'User', 'UserStatus'])
  expect((doc['servers'] as { url: string }[])[0]?.url).toContain('/api')
})

Then('the exported document carries no design intents', () => {
  const raw = readFileSync(exportedPath, 'utf-8')
  expect(raw).not.toContain('x-restorm')
  expect(raw).not.toContain('volumetry')
  expect(raw).not.toContain('"pii"')
})

Then('the export status reports the saved file', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-export-status"]')).toContainText(exportedPath, { timeout: 5000 })
})

Then('the exported document matches the imported Petstore shape', () => {
  const doc = exportedDocument()
  const original = JSON.parse(readFileSync(PETSTORE_SPEC, 'utf-8')) as {
    paths: Record<string, unknown>
    components: { schemas: Record<string, unknown> }
  }
  const exported = doc['paths'] as Record<string, unknown>
  // Same path surface and the same component names — the semantic
  // equivalence core (the strict field-level round-trip is pinned by
  // the emitter's unit suite).
  expect(Object.keys(exported).sort()).toEqual(Object.keys(original.paths).sort())
  const schemas = (doc['components'] as { schemas: Record<string, unknown> }).schemas
  for (const name of Object.keys(original.components.schemas)) {
    expect(schemas).toHaveProperty(name)
  }
})

When('I spin the design server from the settings', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-serve-spin"]').click()
  await expect(p.locator('[data-testid="design-run-modal"]')).toBeVisible({ timeout: 10000 })
})

When('I import the served descriptor from {string}', async ({}, url: string) => {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 5000 })
  await importModal.locator('textarea, input[type="text"]').first().fill(url)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })
  await importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(800)
})

Then('the sidebar carries an imported environment folder named {string}', async ({}, name: string) => {
  const p = requirePage()
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  // The design row is titled "Petstore design" — the EXACT "Petstore"
  // match is the freshly imported env folder, proving the served
  // /swagger.json is a genuinely importable spec.
  await expect(sidebar.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10000 })
})

Then('the imported folder exposes the design\'s operation surface', async () => {
  const p = requirePage()
  const sidebar = p.locator('[data-testid="sidebar-listview"]')
  // Equivalence surface: the imported folder re-creates the design's
  // group as a sub-folder and one request per route, named by summary.
  // (Field-level strict equivalence is 468.17's round-trip job.)
  const expandByExactText = async (text: string): Promise<void> => {
    const row = sidebar.locator('[role="treeitem"]').filter({ has: p.getByText(text, { exact: true }) }).first()
    await expect(row).toBeVisible({ timeout: 5000 })
    if ((await row.getAttribute('aria-expanded')) === 'false') {
      await row.locator('.list-view-item-title-toggle, [data-testid$="-toggle"]').first().click().catch(() => undefined)
      await p.waitForTimeout(300)
    }
  }
  await expandByExactText('Petstore')
  await expandByExactText('Users')
  // "List users" is skipped on purpose: the sample project pre-authors
  // a request with that exact name, which would satisfy the assertion
  // vacuously. The two remaining summaries only exist via the import.
  for (const summary of ['Fetch one user', 'Create a user']) {
    await expect(sidebar.getByText(summary, { exact: true }).first()).toBeVisible({ timeout: 5000 })
  }
})
