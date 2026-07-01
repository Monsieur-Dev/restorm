import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { configureNextSaveFileDialogForE2E } from 'electron-core-ui/testing'
import {
  test,
  expect,
  DOC_VIEWER_TEMP_DIR,
  currentElectronApp
} from '../../fixtures/documentation-viewer.fixture'

const PETSTORE_SAMPLE = resolve(__dirname, '../../../../unit/swagger-petstore.json')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null

function requirePage(): Page {
  if (!page) throw new Error('app must be launched before driving UI steps')
  return page
}

/** Resolve the currently-launched Electron app. Used by the
 * background step's save-dialog config; falls back to the
 * fixture's globalThis register so a dialog configured during
 * teardown still hits the right instance. */
function requireApp(): ElectronApplication {
  const app = electronApp ?? currentElectronApp()
  if (!app) throw new Error('app must be launched before configuring dialogs')
  return app
}

function sidebarRowByTitle(p: Page, title: string): import('@playwright/test').Locator {
  return p
    .locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(title, { exact: true }) })
    .first()
}

async function activateEnvFolderDocsTab(p: Page): Promise<void> {
  // Open the petstore env folder by clicking it in the sidebar — single
  // click opens the tab; double would just toggle expansion of the row.
  const envRow = sidebarRowByTitle(p, 'Swagger Petstore')
  await expect(envRow).toBeVisible({ timeout: 10000 })
  await envRow.click()

  // Switch to the Docs sub-tab inside that env folder view.
  const docsTab = p
    .locator('[role="tab"][data-tab-id="docs"]:visible')
    .first()
  await expect(docsTab).toBeVisible({ timeout: 10000 })
  await docsTab.click()
  await expect(p.locator('[data-testid="env-folder-documentation-host"]')).toBeVisible({ timeout: 10000 })
  // Give React Flow a moment to compute layout + fit-view.
  await p.waitForTimeout(800)
}

Given('the docs viewer scenario is bootstrapped with the Petstore spec', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  // 1. New single-file YAML collection.
  const filePath = join(DOC_VIEWER_TEMP_DIR, 'doc-viewer.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: filePath })
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()
  await expect(async () => { expect(existsSync(filePath)).toBe(true) }).toPass({ timeout: 10000 })
  await page.waitForTimeout(400)

  // 2. Import the Petstore sample.
  expect(existsSync(PETSTORE_SAMPLE), `sample must exist: ${PETSTORE_SAMPLE}`).toBe(true)
  await page.keyboard.press('Control+I')
  const importModal = page.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 10000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(PETSTORE_SAMPLE)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 15000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(800)

  // 3. Close any auto-opened request tab and let the window settle.
  const activeTab = page.locator('.tab[role="tab"][aria-selected="true"]').first()
  if (await activeTab.count() > 0 && await activeTab.isVisible()) {
    const closeBtn = activeTab.locator('[aria-label="Close"]').first()
    if (await closeBtn.count() > 0) await closeBtn.click()
  }
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+Shift+s')
  await expect.poll(async () => (await requirePage().title()).endsWith(' *'), {
    timeout: 10000,
    message: 'window should settle clean after import + auto-save'
  }).toBe(false)

  await activateEnvFolderDocsTab(page)
})

// ── Search ────────────────────────────────────────────────────────────

When('I press Ctrl+F on the docs panel', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+f')
  await p.waitForTimeout(200)
})

Then('the custom search bar should be visible', async () => {
  const p = requirePage()
  const bar = p.locator('[data-testid="documentation-host-search-bar"]')
  await expect(bar).toBeVisible({ timeout: 5000 })
})

// ── Sidebar navigation ────────────────────────────────────────────────

When('I click the sidebar Operation entry {string}', async ({}, summary: string) => {
  const p = requirePage()
  const link = p
    .locator('[data-testid="documentation-host-sidebar"] [data-testid^="documentation-host-sidebar-op-"]')
    .filter({ hasText: summary })
    .first()
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(400)
})

Then('the route block {string} should be visible in the docs panel', async ({}, opSlug: string) => {
  const p = requirePage()
  const block = p.locator(`[data-testid="documentation-host-route-${opSlug}"]`)
  await expect(block).toBeVisible({ timeout: 10000 })
  // Verify the block sits inside the visible viewport.
  const box = await block.boundingBox()
  if (!box) throw new Error('route block has no bounding box')
  expect(box.y, 'route block should be on screen').toBeGreaterThan(-200)
})

When('I click the sidebar Model entry {string}', async ({}, modelName: string) => {
  const p = requirePage()
  const link = p.locator(`[data-testid="documentation-host-sidebar-model-${modelName}"]`)
  await expect(link).toBeVisible({ timeout: 10000 })
  await link.click()
  await p.waitForTimeout(800)
})

Then('the React Flow node {string} should be on screen', async ({}, modelName: string) => {
  const p = requirePage()
  const node = p.locator(`[data-testid="documentation-host-model-node-${modelName}"]`)
  await expect(node).toBeVisible({ timeout: 10000 })
  const box = await node.boundingBox()
  if (!box) throw new Error('model node has no bounding box')
  expect(box.y, 'model node should be on screen').toBeGreaterThan(-200)
})

// ── Add request from docs ─────────────────────────────────────────────

When('I click the {string} button next to operation {string}', async ({}, _label: string, opSlug: string) => {
  const p = requirePage()
  const btn = p.locator(`[data-testid="documentation-host-route-header-add-${opSlug}"]`)
  await expect(btn).toBeVisible({ timeout: 10000 })
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
  await p.waitForTimeout(800)
})

Then(
  'a request named {string} should appear inside the tag-folder {string}',
  async ({}, requestName: string, tagFolder: string) => {
    const p = requirePage()
    // The tag-folder lives inside the env folder. Expand it if
    // collapsed before checking for the new request row.
    const folderRow = sidebarRowByTitle(p, tagFolder)
    await expect(folderRow).toBeVisible({ timeout: 10000 })
    if ((await folderRow.getAttribute('aria-expanded')) !== 'true') {
      const expander = folderRow.locator('button.list-view-expander').first()
      if (await expander.count() > 0) await expander.click()
    }
    const requestRow = sidebarRowByTitle(p, requestName)
    await expect(requestRow).toBeVisible({ timeout: 10000 })
  }
)
