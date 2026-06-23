import { createBdd } from 'playwright-bdd'
import { join } from 'path'
import type { ElectronApplication, Page, Locator } from '@playwright/test'
import {
  test,
  expect,
  ODATA_PETSTORE_TEMP_DIR,
  configureNextSaveFileDialogForE2E
} from '../../fixtures/odata-petstore.fixture'

const ODATA_BATCH_URL = 'http://localhost:5100/odata/$batch'

const ODATA_BASE = 'http://localhost:5100'
const ODATA_METADATA_URL = `${ODATA_BASE}/odata/$metadata`

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

Given('a new single-file YAML collection for the OData petstore', async ({ launchApp }) => {
  const launched = await launchApp()
  electronApp = launched.app
  page = launched.page

  const target = join(ODATA_PETSTORE_TEMP_DIR, 'odata-petstore.restorm')
  await configureNextSaveFileDialogForE2E(requireApp(), { kind: 'saveFile', path: target })

  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await expect(page.locator('[data-testid="titlebar-menu-item-new"]').first()).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="titlebar-menu-item-new"]').first().click()

  const saveOptionsModal = page.locator('[data-testid="save-options-modal"]')
  await expect(saveOptionsModal).toBeVisible({ timeout: 2000 })
  await page.locator('[data-testid="save-mode-file"]').click()
  await page.locator('[data-testid="save-format-yaml"]').click()
  await page.locator('[data-testid="save-confirm-button"]').click()
  await expect(saveOptionsModal).not.toBeVisible({ timeout: 2000 })
  await page.waitForTimeout(500)
})

When('I open the import modal and paste the OData metadata URL', async () => {
  const p = requirePage()
  await p.keyboard.press('Control+I')
  const importModal = p.locator('[data-testid="import-modal"]')
  await expect(importModal).toBeVisible({ timeout: 2000 })
  await p.locator('[data-testid="source-input-input"]').fill(ODATA_METADATA_URL)
  // Wait for the importer to fetch + parse the EDMX. The preview list
  // populating is the "ready" signal — without it, clicking Import
  // races the preview state and lands an empty tree.
  await expect(p.locator('[data-testid="import-selection-tree"]')).toBeVisible({ timeout: 30000 })
})

When('I import the previewed routes', async () => {
  const p = requirePage()
  await p.locator('[data-testid="import-button"]').click()
  await expect(p.locator('[data-testid="import-modal"]')).not.toBeVisible({ timeout: 15000 })
  // Wait for the sidebar to settle — the env folder named after the
  // OData service appears once the import committed.
  await expect(sidebarRowByName(p, 'OData.PetStore.Models')).toBeVisible({ timeout: 10000 })
})

When('I open the {string} request in an OData tab', async ({}, requestName: string) => {
  const p = requirePage()
  // The OData importer nests operations under
  //   OData.PetStore.Models (env folder)
  //     └─ Pets (entity-set folder)
  //         ├─ List Pets
  //         ├─ Get Pets by Id
  //         └─ …
  // Expand both ancestors so the leaf row materialises.
  await expandRowIfCollapsed(p, 'OData.PetStore.Models')
  await expandRowIfCollapsed(p, 'Pets')
  const row = sidebarRowByName(p, requestName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  // The OData tab has its own send button — wait for it to mount as
  // the anchor that confirms the tab opened.
  await expect(p.locator('[data-testid="odata-request-send"]:visible').first()).toBeVisible({ timeout: 10000 })
})

When('I send the OData request', async () => {
  const p = requirePage()
  await p.locator('[data-testid="odata-request-send"]:visible').first().click()
  // Response body editor mounts after the executor's promise resolves.
  await expect(p.locator('[data-testid="odata-response-body-editor"]:visible').first()).toBeVisible({ timeout: 30000 })
  // Brief settle so Monaco fills in the JSON before assertions read it.
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

async function typeIntoOdataInput(p: Page, testId: string, text: string): Promise<void> {
  // `fill()` proved unreliable here: the second `fill()` lands its
  // onChange before the first input's per-slot proxy-write debounce
  // settles, and the cross-slot flush inside `scheduleProxyWrite`
  // fires the *first* slot's flush against a stale `request.queryOptions`
  // snapshot. Real keyboard typing reproduces the per-character
  // onChange the production code expects, and the `Send` handler's
  // `flushAllPendingProxyWrites` cleans up any in-flight timers.
  const input = p.locator(`[data-testid="${testId}-input"]:visible`).first()
  await input.click()
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type(text, { delay: 5 })
}

/** Set the Monaco-backed `$filter` editor content. Per-character
 * `keyboard.type` races the suggestion widget (the open widget consumes
 * arrow/selection state and drops or reorders characters), so we clear
 * the field then insert the whole string atomically with
 * `insertText` — a single IME-style event Monaco applies verbatim.
 * Escape afterwards closes any suggestion widget the insert popped. */
async function typeIntoOdataFilter(p: Page, text: string): Promise<void> {
  const editor = p.locator('[data-testid="odata-request-filter"] .monaco-editor').first()
  await editor.click()
  await p.keyboard.press('Escape')
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.insertText(text)
  await p.keyboard.press('Escape')
}

When(
  'I narrow the OData query to filter {string} and select {string}',
  async ({}, filter: string, select: string) => {
    const p = requirePage()
    await typeIntoOdataFilter(p, filter)
    // Dismiss the suggestion widget so it doesn't intercept the next
    // field's focus / typing.
    await p.keyboard.press('Escape')
    await typeIntoOdataInput(p, 'odata-request-select', select)
    // Settle the per-field 250 ms debounce so the proxy's
    // `queryOptions` write actually fires before the next Send
    // step. `handleSend` itself pushes the freshest snapshot to
    // ContextService synchronously, but waiting here keeps the
    // assertion log readable.
    await p.waitForTimeout(350)
  }
)

When('I type {string} into the OData filter editor', async ({}, text: string) => {
  const p = requirePage()
  await typeIntoOdataFilter(p, text)
  // The editor uses `quickSuggestions: false`, so the suggest widget
  // only appears on an explicit trigger — invoke it the same way Ctrl+
  // Space does for the user.
  await p.keyboard.press('Control+Space')
})

Then('the OData filter suggestion list should contain {string}', async ({}, expected: string) => {
  const p = requirePage()
  // Monaco renders the suggest widget into an overflow container on the
  // body (fixedOverflowWidgets); it carries the `.visible` class while
  // open. Match the row by its label text.
  const widget = p.locator('.suggest-widget.visible').first()
  await expect(widget).toBeVisible({ timeout: 5000 })
  await expect(widget.locator('.monaco-list-row').filter({ hasText: expected }).first())
    .toBeVisible({ timeout: 5000 })
})

When('I dismiss the OData filter suggestion list', async () => {
  const p = requirePage()
  await p.keyboard.press('Escape')
})

When('I set the OData filter to {string}', async ({}, text: string) => {
  const p = requirePage()
  await typeIntoOdataFilter(p, text)
})

Then('the OData filter editor should contain {string}', async ({}, expected: string) => {
  const p = requirePage()
  // The Monaco view renders the content across `.view-line` spans; the
  // editor root carries the test id.
  await expect(p.locator('[data-testid="odata-request-filter"] .view-lines'))
    .toContainText(expected, { timeout: 5000 })
})

Then('the OData filter editor should have no validation errors', async () => {
  const p = requirePage()
  // An error marker renders as an `squiggly-error` decoration in the
  // editor overlay. A well-formed clause with a real property + an
  // opaque {{template}} value must produce none.
  await expect(p.locator('[data-testid="odata-request-filter"] .squiggly-error'))
    .toHaveCount(0, { timeout: 5000 })
})

// ============================================================================
// Batch steps — GET-in-change-set configurable behavior
// ============================================================================

/** Pick an option in an ECUI SelectBox by zero-based index. */
async function selectBatchBoxOption(p: Page, testId: string, index: number): Promise<void> {
  await p.locator(`[data-testid="${testId}-trigger"]`).first().click({ force: true })
  await p.locator(`[data-testid="${testId}-option-${index}"]`).first().click({ force: true })
}

When('I create a new batch request named {string}', async ({}, _name: string) => {
  const p = requirePage()
  // Open an existing imported OData request — open "List Pets" from the sidebar.
  await expandRowIfCollapsed(p, 'OData.PetStore.Models')
  await expandRowIfCollapsed(p, 'Pets')
  const row = sidebarRowByName(p, 'List Pets')
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  await expect(p.locator('[data-testid="odata-request-send"]:visible').first()).toBeVisible({ timeout: 10000 })
  // Switch operation kind to Batch (index 3: entity-set=0, function=1, action=2, batch=3).
  await selectBatchBoxOption(p, 'odata-request-operation-kind', 3)
  await expect(p.locator('[data-testid="odata-batch-editor"]').first()).toBeVisible({ timeout: 5000 })
  // Set URL to the $batch endpoint via the OData URL VariableInputBox.
  const textarea = p.locator(
    '[data-testid="odata-request-url-codeeditor-textarea"], [data-testid="odata-request-url-codeeditor-monaco"] textarea'
  ).first()
  await textarea.click({ force: true })
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Delete')
  await p.keyboard.type(ODATA_BATCH_URL, { delay: 5 })
  await p.waitForTimeout(300)
})

/** Fill an ECUI InputBox with the given text. Uses fill() to trigger
 *  the React synthetic input event, then waits for the 300ms debounce
 *  to flush the onChange into the reactive model. */
async function typeBatchInput(p: Page, testId: string, text: string): Promise<void> {
  const input = p.locator(`[data-testid="${testId}-input"]`).first()
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.click({ force: true })
  await input.fill(text)
  // Allow the 300ms InputBox debounce to fire + proxy write to settle.
  await p.waitForTimeout(500)
}

When('I add a GET sub-request to the batch with URL {string} in change-set {string}', async ({}, url: string, changeSet: string) => {
  const p = requirePage()
  // Click "Add sub-request" and wait for the new card to appear.
  await p.locator('[data-testid="odata-batch-add"]').click({ force: true })
  // Wait for the first card (index 0) or the next card to materialise.
  const rows = p.locator('[data-testid^="odata-batch-sub-"]:not([data-testid*="response"]):not([data-testid*="body"])')
  await expect(rows.first()).toBeVisible({ timeout: 3000 })
  const count = await rows.count()
  const lastIndex = count - 1
  // Method defaults to GET; type the URL and change-set group.
  await typeBatchInput(p, `odata-batch-url-${lastIndex}`, url)
  await typeBatchInput(p, `odata-batch-group-${lastIndex}`, changeSet)
})

When('I add a POST sub-request to the batch with URL {string} in change-set {string}', async ({}, url: string, changeSet: string) => {
  const p = requirePage()
  await p.locator('[data-testid="odata-batch-add"]').click({ force: true })
  const rows = p.locator('[data-testid^="odata-batch-sub-"]:not([data-testid*="response"]):not([data-testid*="body"])')
  await expect(rows.first()).toBeVisible({ timeout: 3000 })
  const count = await rows.count()
  const lastIndex = count - 1
  // Switch method to POST (GET=0, POST=1, PATCH=2, PUT=3, DELETE=4).
  await selectBatchBoxOption(p, `odata-batch-method-${lastIndex}`, 1)
  await typeBatchInput(p, `odata-batch-url-${lastIndex}`, url)
  await typeBatchInput(p, `odata-batch-group-${lastIndex}`, changeSet)
})

When('I send the OData batch request', async () => {
  const p = requirePage()
  const sendBtn = p.locator('[data-testid="odata-request-send"]:visible').first()
  await sendBtn.click()
  // The send button becomes disabled while the request is in-flight, then
  // re-enables when done (even for error responses with empty body).
  await expect(sendBtn).toBeEnabled({ timeout: 30000 })
  await p.waitForTimeout(300)
})

Then('the batch GET-in-change-set warning should be visible', async () => {
  const p = requirePage()
  // The serializer warning is shown in the response panel.
  await expect(p.locator('[data-testid="odata-batch-serializer-warning-0"]:visible').first())
    .toBeVisible({ timeout: 10000 })
})

Then('the batch GET-in-change-set warning should not be visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="odata-batch-serializer-warning-0"]'))
    .not.toBeVisible({ timeout: 5000 })
})

Then('the per-child batch responses should be rendered', async () => {
  const p = requirePage()
  // At least one per-child response card should be present.
  await expect(p.locator('[data-testid="odata-batch-sub-response-0"]:visible').first())
    .toBeVisible({ timeout: 10000 })
})

When('I enable the {string} toggle', async ({}, _label: string) => {
  const p = requirePage()
  // The "Allow GET in change-set" toggle has a specific test ID.
  const toggle = p.locator('[data-testid="odata-batch-allow-get-in-changeset"]').first()
  await expect(toggle).toBeVisible({ timeout: 5000 })
  // Click it to enable (it's currently off).
  await toggle.click()
  await p.waitForTimeout(300)
})

When('I remove all sub-requests from the batch', async () => {
  const p = requirePage()
  // Remove rows from last to first to avoid index shifting.
  let rows = p.locator('[data-testid^="odata-batch-sub-"]:not([data-testid*="response"]):not([data-testid*="body"])')
  let count = await rows.count()
  while (count > 0) {
    const removeBtn = p.locator(`[data-testid="odata-batch-remove-${count - 1}"]`).first()
    await expect(removeBtn).toBeVisible({ timeout: 3000 })
    await removeBtn.click({ force: true })
    await p.waitForTimeout(300)
    rows = p.locator('[data-testid^="odata-batch-sub-"]:not([data-testid*="response"]):not([data-testid*="body"])')
    count = await rows.count()
  }
})

When('I add a standalone GET sub-request to the batch with URL {string}', async ({}, url: string) => {
  const p = requirePage()
  await p.locator('[data-testid="odata-batch-add"]').click({ force: true })
  const rows = p.locator('[data-testid^="odata-batch-sub-"]:not([data-testid*="response"]):not([data-testid*="body"])')
  await expect(rows.first()).toBeVisible({ timeout: 3000 })
  const count = await rows.count()
  const lastIndex = count - 1
  // No change-set group — this is a standalone request outside any change-set.
  await typeBatchInput(p, `odata-batch-url-${lastIndex}`, url)
})

// ODATA_VERSION_BY_INDEX (mirrors ODataRequestTabView.tsx): v4=0, v4.01=1, v3=2, v2=3
const ODATA_VERSION_INDEX: Record<string, number> = {
  'v4': 0,
  'v4.01': 1,
  'v3': 2,
  'v2': 3
}

Then('the OData version selector should include {string}', async ({}, version: string) => {
  const p = requirePage()
  // The version SelectBox is rendered as a native <select> with a custom overlay.
  // The native <select> element (`data-testid="odata-request-version-select"`)
  // always has all options in the DOM without needing to open the dropdown.
  // Check the native select's options for the requested version text.
  const nativeSelect = p.locator('[data-testid="odata-request-version-select"]').first()
  await expect(nativeSelect).toBeAttached({ timeout: 5000 })
  const optionFound = await nativeSelect.locator(`option`).filter({ hasText: version }).count()
  if (optionFound === 0) throw new Error(`OData version option "${version}" not found in selector`)
})

When('I select OData version {string}', async ({}, version: string) => {
  const p = requirePage()
  // Use the known version→index mapping to click via the ECUI SelectBox API.
  const index = ODATA_VERSION_INDEX[version]
  if (index === undefined) throw new Error(`Unknown OData version "${version}" — update ODATA_VERSION_INDEX`)
  await selectBatchBoxOption(p, 'odata-request-version', index)
  await p.waitForTimeout(300)
})

Then('the force-absolute-batch-URLs toggle should be visible', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="odata-batch-force-absolute-urls"]').first())
    .toBeVisible({ timeout: 5000 })
})
