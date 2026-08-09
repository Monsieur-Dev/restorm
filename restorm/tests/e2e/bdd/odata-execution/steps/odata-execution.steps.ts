import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  ODATA_PETSTORE_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/odata-petstore.fixture'

import type { StartedServices } from '../../../helpers/testcontainers/services'

let suiteServices: StartedServices | null = null
const svc = (): StartedServices => {
  if (suiteServices === null) throw new Error('launch first (services not captured)')
  return suiteServices
}
const odataV4MetadataUrl = (): string => `${svc().url('odata-petstore')}/odata/$metadata`
const odataV2MetadataUrl = (): string => `${svc().url('odata-v2-petstore')}/$metadata`
const odataV2Base = (): string => svc().url('odata-v2-petstore')

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

async function expandRowIfCollapsed(currentPage: Page, name: string): Promise<void> {
  const row = sidebarRowByName(currentPage, name)
  if (await row.count() === 0) return
  const expanded = await row.getAttribute('aria-expanded')
  if (expanded !== 'true') await row.click()
}

/** `fill()` is unreliable on the OData inputs (per-slot proxy-write
 * debounce races — see odata-petstore.steps); type with the real
 * keyboard instead. Used for the ECUI `InputBox` query-option fields
 * (`$filter`/`$select`/`$top`), which expose a `${testId}-input`. */
async function typeIntoOdataInput(p: Page, testId: string, text: string): Promise<void> {
  const input = p.locator(`[data-testid="${testId}-input"]:visible`).first()
  await input.click()
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type(text, { delay: 5 })
}

/** The request URL is an ECUI `VariableInputBox` (a Monaco editor), not
 * a plain InputBox — its editable element is the Monaco textarea under
 * `${testId}-codeeditor`, not a `${testId}-input`. Mirror the ECUI
 * variableInputBox step helper (force-click the textarea, select-all,
 * retype). */
async function typeIntoOdataUrl(p: Page, text: string): Promise<void> {
  const textarea = p.locator(
    '[data-testid="odata-request-url-codeeditor-textarea"], [data-testid="odata-request-url-codeeditor-monaco"] textarea'
  ).first()
  await textarea.click({ force: true })
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type(text, { delay: 5 })
}

/** The `$filter` field is a Monaco-backed `VariableInputBox` (testid
 * `odata-request-filter`), not a plain InputBox — it has no
 * `${testId}-input`. Per-character typing races the suggestion widget,
 * so clear then insert the whole string atomically with `insertText`;
 * Escape closes any suggestion the insert popped. Mirrors the
 * odata-petstore filter helper. */
async function typeIntoOdataFilter(p: Page, text: string): Promise<void> {
  const editor = p.locator('[data-testid="odata-request-filter"] .monaco-editor').first()
  await editor.click()
  await p.keyboard.press('Escape')
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.insertText(text)
  await p.keyboard.press('Escape')
}

/** Pick an option in an ECUI SelectBox by index: click its trigger,
 * then the option row (both force-clicked, matching the ECUI selectBox
 * test step). */
async function selectBoxOption(p: Page, testId: string, index: number): Promise<void> {
  await p.locator(`[data-testid="${testId}-trigger"]`).first().click({ force: true })
  await p.locator(`[data-testid="${testId}-option-${index}"]`).first().click({ force: true })
}

async function importViaModal(source: string): Promise<void> {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  await importModal.locator('[data-testid="source-input-input"]').fill(source)
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
  await p.locator('[data-testid="import-button"]').click()
  await expect(importModal).not.toBeVisible({ timeout: 15000 })
  await p.waitForTimeout(500)
}

Given('a new single-file YAML collection for OData execution', async ({ launchApp, services }) => {
  suiteServices = services
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(ODATA_PETSTORE_TEMP_DIR, 'odata-execution.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  await page.waitForTimeout(500)
})

When('I import the OData v4 metadata URL', async () => {
  await importViaModal(odataV4MetadataUrl())
})

When('I import the OData v2 metadata URL', async () => {
  await importViaModal(odataV2MetadataUrl())
})

When('I open the OData request {string}', async ({}, requestName: string) => {
  const p = requirePage()
  // Expand every sidebar folder so the leaf request row materialises,
  // regardless of which OData service (v4 Pets / v2 Products) is open.
  for (const folder of ['OData.PetStore.Models', 'PetStoreV2', 'Pets', 'Products']) {
    await expandRowIfCollapsed(p, folder)
  }
  const row = sidebarRowByName(p, requestName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  await expect(p.locator('[data-testid="odata-request-send"]:visible').first()).toBeVisible({ timeout: 10000 })
})

When('I send the OData request', async () => {
  const p = requirePage()
  const sendBtn = p.locator('[data-testid="odata-request-send"]:visible').first()
  await sendBtn.click()
  // Wait for the send button to re-enable (response received, even on error).
  // Batch requests show per-child cards instead of `odata-response-body-editor`
  // so we gate on the send button rather than a specific response element.
  await expect(sendBtn).toBeEnabled({ timeout: 30000 })
  await p.waitForTimeout(300)
})

When('I set the OData filter to {string} and select {string}', async ({}, filter: string, select: string) => {
  const p = requirePage()
  await typeIntoOdataFilter(p, filter)
  await p.keyboard.press('Escape')
  await typeIntoOdataInput(p, 'odata-request-select', select)
  await p.waitForTimeout(350)
})

When('I set the OData top to {string}', async ({}, top: string) => {
  const p = requirePage()
  await typeIntoOdataInput(p, 'odata-request-top', top)
  await p.waitForTimeout(350)
})

When('I enable the OData count option', async () => {
  const p = requirePage()
  const toggle = p.locator('[data-testid="odata-request-count"]').first()
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click()
  await p.waitForTimeout(200)
})

When('I set the OData by-key id to {string}', async ({}, id: string) => {
  const p = requirePage()
  // The importer seeds a by-key URL of `{{baseUrl}}/Products({{id}})`;
  // point it at a concrete id (keeping {{baseUrl}} so the env resolves
  // it to the running mock).
  await typeIntoOdataUrl(p, `{{baseUrl}}/Products(${id})`)
  await p.waitForTimeout(300)
})

/** Switch the open OData request to a JSON-format `$batch`, returning
 * once the batch editor + JSON format are selected. */
async function switchToJsonBatch(p: Page): Promise<void> {
  // A $batch POSTs the envelope to the service's `$batch` endpoint — the
  // importer's entity-set URL must be re-pointed there.
  await typeIntoOdataUrl(p, '{{baseUrl}}/$batch')

  // Operation kind SelectBox — Batch is index 3
  // (['entity-set','function','action','batch']).
  await selectBoxOption(p, 'odata-request-operation-kind', 3)
  await expect(p.locator('[data-testid="odata-batch-editor"]').first()).toBeVisible({ timeout: 5000 })

  // Batch format SelectBox — JSON is index 1 (['multipart','json']).
  await selectBoxOption(p, 'odata-batch-format', 1)
}

/** Configure one batch sub-request card (method, url, optional body +
 * change-set label). The card must already exist (click Add first). */
async function fillBatchSub(
  p: Page,
  index: number,
  spec: { method: string; url: string; body?: string; group?: string }
): Promise<void> {
  if (spec.method !== 'GET') {
    // Method SelectBox — options are ['GET','POST','PATCH','PUT','DELETE'].
    const methodIndex = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].indexOf(spec.method.toUpperCase())
    await selectBoxOption(p, `odata-batch-method-${index}`, methodIndex < 0 ? 0 : methodIndex)
  }
  const urlInput = p.locator(`[data-testid="odata-batch-url-${index}-input"]`).first()
  await urlInput.click()
  await urlInput.fill(spec.url)
  if (spec.group) {
    const groupInput = p.locator(`[data-testid="odata-batch-group-${index}-input"]`).first()
    await groupInput.click()
    await groupInput.fill(spec.group)
  }
  if (spec.body !== undefined) {
    const bodyEditor = p.locator(`[data-testid="odata-batch-body-${index}"]`).first()
    await bodyEditor.click()
    await p.keyboard.press('Control+A')
    await p.keyboard.press('Delete')
    await p.keyboard.type(spec.body, { delay: 3 })
  }
}

When('I switch the request to a JSON batch of three GETs', async () => {
  const p = requirePage()
  await switchToJsonBatch(p)
  for (let i = 0; i < 3; i++) {
    await p.locator('[data-testid="odata-batch-add"]').first().click()
    await fillBatchSub(p, i, { method: 'GET', url: 'Products' })
  }
  await p.waitForTimeout(300)
})

When('I switch the request to a JSON batch change-set with a valid POST and a failing DELETE', async () => {
  const p = requirePage()
  await switchToJsonBatch(p)
  // One change-set (shared `atomicityGroup`): a valid POST followed by a
  // DELETE of a non-existent key. The DELETE 404s, so the server rolls
  // the whole change-set back and reports every member as failed
  // (ChangeSetFailed) — the all-or-nothing semantics the matrix requires.
  // No request body is typed, so this stays clear of the Monaco body
  // editor; the POST creates a default row that the rollback discards,
  // leaving the store clean.
  await p.locator('[data-testid="odata-batch-add"]').first().click()
  await fillBatchSub(p, 0, { method: 'POST', url: 'Products', group: 'cs1' })
  await p.locator('[data-testid="odata-batch-add"]').first().click()
  await fillBatchSub(p, 1, { method: 'DELETE', url: 'Products(99999)', group: 'cs1' })
  await p.waitForTimeout(300)
})

When('I point the OData request URL at the v2 mock error path', async () => {
  const p = requirePage()
  await typeIntoOdataUrl(p, `${odataV2Base()}/error400`)
  // Clear any pre-filled query options so the bare error URL is sent.
  await p.waitForTimeout(300)
})

Then('the OData response body should contain {string}', async ({}, expected: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="odata-response-body-editor"]:visible').first())
    .toContainText(expected, { timeout: 15000 })
})

Then('the OData response body should not contain {string}', async ({}, unexpected: string) => {
  const p = requirePage()
  await expect(p.locator('[data-testid="odata-response-body-editor"]:visible').first())
    .not.toContainText(unexpected, { timeout: 5000 })
})

Then('the OData next-page button should be visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="odata-response-load-next-page"]:visible').first())
    .toBeVisible({ timeout: 10000 })
})

When('I click the OData next-page button', async () => {
  const p = requirePage()
  await p.locator('[data-testid="odata-response-load-next-page"]:visible').first().click()
  await p.waitForTimeout(500)
})

// JSON-batch per-child assertions. 66.16 renders each child as an
// `odata-batch-sub-response-N` card (status + body editor) instead
// of a single `odata-response-body-editor` for the raw batch envelope.
Then('the OData batch response should have {int} sub-responses', async ({}, count: number) => {
  const p = requirePage()
  // Wait for the first card to appear, then count all cards.
  await expect(p.locator('[data-testid="odata-batch-sub-response-0"]').first())
    .toBeVisible({ timeout: 15000 })
  const actual = await p.locator('[data-testid^="odata-batch-sub-response-"]').count()
  if (actual !== count) throw new Error(`Expected ${count} batch sub-responses, got ${actual}`)
})

Then('the OData batch sub-response {int} body should contain {string}', async ({}, index: number, text: string) => {
  const p = requirePage()
  // The sub-body is a Monaco CodeEditor; its textarea holds the rendered JSON.
  const bodyEditor = p.locator(`[data-testid="odata-batch-sub-body-${index}"]`).first()
  await expect(bodyEditor).toBeVisible({ timeout: 10000 })
  await expect(bodyEditor).toContainText(text, { timeout: 5000 })
})
