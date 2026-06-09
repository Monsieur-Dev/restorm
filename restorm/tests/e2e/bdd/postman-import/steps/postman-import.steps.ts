import { createBdd } from 'playwright-bdd'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import { test, expect, POSTMAN_IMPORT_TEMP_DIR, configureNextSaveFileDialogForE2E } from '../../fixtures/postman-import.fixture'

/** The committed Postman export fixture (real `postman export` output) that the
 * unit tests also consume — one source of truth for the import surface. */
const FIXTURE = resolve(__dirname, '../../../samples/petstore-workflow.postman_collection.json')
const NEW_FILE = join(POSTMAN_IMPORT_TEMP_DIR, 'postman-import-test.restorm')

const { Given, When, Then } = createBdd(test)

let electronApp: ElectronApplication | null = null
let page: Page | null = null
let copiedLog = ''

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

Given('a new single-file collection for Postman import', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: NEW_FILE })

  const p = requirePage()
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(p.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await p.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  const modal = p.locator('[data-testid="save-options-modal"]')
  await expect(modal).toBeVisible({ timeout: 2000 })
  await p.locator('[data-testid="save-mode-file"]').click()
  await p.locator('[data-testid="save-format-json"]').click()
  await p.locator('[data-testid="save-confirm-button"]').click()
  await expect(modal).not.toBeVisible({ timeout: 2000 })
  await p.waitForTimeout(500)
})

When('I import the Postman workflow collection', async () => {
  const p = requirePage()
  expect(existsSync(FIXTURE), `fixture missing: ${FIXTURE}`).toBe(true)

  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  const input = importModal.locator('textarea, input[type="text"]').first()
  await input.fill(FIXTURE)
  await expect(importModal.locator('.import-preview-section')).toBeVisible({ timeout: 5000 })
  const importButton = importModal.locator('[role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 2000 })
  await importButton.click()
  await expect(importModal).not.toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(500)
})

Then('a workflow scenario {string} appears in the tree', async ({}, scenarioName: string) => {
  const p = requirePage()
  // The importer nests everything under a root env-folder named after the
  // collection; expand it, then assert the workflow scenario row is present.
  const root = sidebarRowByName(p, 'Petstore Workflows (restorm compat)')
  await expect(root).toBeVisible({ timeout: 15000 })
  if ((await root.getAttribute('aria-expanded')) !== 'true') await root.click()
  await expect(sidebarRowByName(p, scenarioName)).toBeVisible({ timeout: 15000 })
})

When('I run the imported workflow scenario and copy all its logs', async ({}) => {
  const p = requirePage()
  const scenarioName = 'Petstore Workflows (restorm compat) — Workflow'

  await sidebarRowByName(p, scenarioName).click()
  await expect(p.locator('[data-testid="scenario-editor"]')).toBeVisible({ timeout: 15000 })
  await expect(p.locator('[data-testid="scenario-inspector-toolbar"]')).toBeVisible({ timeout: 15000 })

  // Run the whole scenario (no node selected). The imported workflow has no
  // input nodes, so it falls straight through with no prompt. The Run button is
  // disabled when any box has a validation error, so this click also asserts the
  // imported graph is valid (correct bindings + selectors).
  await expect(p.locator('[data-testid="scenario-inspector-run"]')).toBeEnabled({ timeout: 15000 })
  await p.locator('[data-testid="scenario-inspector-run"]').click()
  const deadline = Date.now() + 60000
  for (;;) {
    const done = await p.evaluate(() => {
      const run = document.querySelector('[data-testid="scenario-inspector-run"]')
      const logsReady = document.querySelector('[data-testid="scenario-inspector-logs-copy"]')
      const running = run?.classList.contains('scn-inspector-run-round-active') ?? false
      return !!logsReady && !running
    })
    if (done) break
    if (Date.now() > deadline) throw new Error('imported workflow scenario did not finish within 60s')
    await p.waitForTimeout(150)
  }

  // Show every entry (engine + run + user), then copy.
  const allToggle = p.locator('[data-testid="scenario-inspector-logs-all-action"]')
  if ((await allToggle.getAttribute('aria-checked')) !== 'true') await allToggle.click()

  await expect(async () => {
    await p.locator('[data-testid="scenario-inspector-logs-copy"]').click()
    copiedLog = await requireApp().evaluate(({ clipboard }) => clipboard.readText())
    expect(copiedLog.length, 'clipboard did not hold the run-log').toBeGreaterThan(0)
  }).toPass({ timeout: 8000 })
})

Then('the run-log shows the verbatim Postman scripts executing across the chain', async () => {
  // The pre-request `console.log` from a LATER request proves the chain advanced
  // past the first request via `pm.execution.setNextRequest(...)` → a control
  // edge, AND that a verbatim pm pre-request script (collectionVariables read +
  // payload builder) ran in the real engine.
  expect(copiedLog, 'the chain did not advance to the Create Pet pre-request script').toContain('built pet payload with 3 tags')
})

Then('the run-log shows a request succeeded against the live API with a passing pm.test', async () => {
  // A passing pm.test (✓) only happens when a real HTTP call returned the
  // expected status — i.e. the request reached the live petstore and the
  // verbatim `pm.response.to.have.status(200)` assertion ran and passed.
  expect(copiedLog, 'the login request did not return 200 from the live API').toContain('✓ login returns 200')
})
