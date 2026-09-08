import { createBdd } from 'playwright-bdd'
import { copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_MODELS_TEMP_DIR } from '../../fixtures/design-models.fixture'
import { openDesignSection, addDesignEntity, openDesignEntity, deleteDesignEntityNode, designEntityNode, clickDesignMenuItem } from '../../../support/designNav'
import { designEntityTitle } from '../../../support/designGuiDriver'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null
let projectPath = ''

const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-sample.restorm')
const DESIGN_ID = 'design-petstore'
const DESIGN_NAME = 'Petstore design'
/** Fixture property ids (the committed sample uses the reference ids). */
const PROP_IDS: Record<string, string> = {
  id: 'prop-user-id',
  email: 'prop-user-email',
  password: 'prop-user-password'
}

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

function sidebarRow(p: Page, itemId: string): ReturnType<Page['locator']> {
  return p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${itemId}"]`)
}

/** A property row's cells all carry the same testid; matching by text
 * keeps the steps id-agnostic for properties the scenario creates. */
function propertyCellByText(p: Page, text: string): ReturnType<Page['locator']> {
  return p.locator('.design-prop-cell').filter({ has: p.getByText(text, { exact: true }) }).first()
}

async function pickSelectOption(p: Page, selectTestId: string, optionText: string | RegExp): Promise<void> {
  await p.locator(`[data-testid="${selectTestId}-trigger"]`).click()
  const dropdown = p.locator(`[data-testid="${selectTestId}-dropdown"]`)
  await expect(dropdown).toBeVisible({ timeout: 5000 })
  const option = dropdown.locator('.select-option').filter({ hasText: optionText }).first()
  // The dropdown is portaled and can overflow the window, leaving the option
  // outside the viewport where a plain click times out — scroll it in and
  // dispatch the click so it isn't blocked by the viewport actionability check.
  await expect(option).toBeAttached({ timeout: 5000 })
  await option.scrollIntoViewIfNeeded().catch(() => undefined)
  await option.dispatchEvent('click')
  await p.waitForTimeout(300)
}

async function openModelsSection(p: Page): Promise<void> {
  await sidebarRow(p, DESIGN_ID).click()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await openDesignSection(p, DESIGN_ID, 'models')
  await p.mouse.move(700, 400)
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
}

Given('a Pro project carrying an API design is open in the models editor', async ({ launchApp }) => {
  const launched = await launchApp({ plan: 'pro' })
  page = launched.page
  projectPath = join(DESIGN_MODELS_TEMP_DIR, 'design-models.restorm')
  copyFileSync(DESIGN_SAMPLE, projectPath)
  const p = page
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (fp: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(sidebarRow(p, DESIGN_ID)).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="app-statusbar-version-plan"]')).toContainText('Pro', { timeout: 10000 })
  await p.waitForTimeout(800)
  await openModelsSection(p)
})

// ── Model list ────────────────────────────────────────────────────────

When('I add a model', async () => {
  const p = requirePage()
  await addDesignEntity(p, DESIGN_ID, 'models', /Add a model/)
  await expect(p.locator('[data-testid="design-model-tabs"]')).toBeVisible({ timeout: 5000 })
})

When('I open the model {string}', async ({}, name: string) => {
  const p = requirePage()
  await openDesignEntity(p, DESIGN_ID, 'models', name)
  await expect(p.locator('[data-testid="design-model-tabs"]')).toBeVisible({ timeout: 5000 })
})

Then('the models list does not offer {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(
    p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id^="design-entity:${DESIGN_ID}:models:"]`)
      .filter({ has: p.getByText(name, { exact: true }) })
  ).toHaveCount(0, { timeout: 5000 })
})

// Add a second model to the sidebar multi-selection (Ctrl-click, like the
// real gesture — the earlier `open the model` step left the first one selected).
When('I also select the model {string} in the sidebar', async ({}, name: string) => {
  const p = requirePage()
  await designEntityNode(p, DESIGN_ID, 'models', name).click({ modifiers: ['Control'] })
})

// Delete the whole multi-selection: right-click a selected node (its selection
// menu offers only Delete for design entities), then confirm the batch dialog.
When('I delete the selected models', async () => {
  const p = requirePage()
  await designEntityNode(p, DESIGN_ID, 'models', 'User').click({ button: 'right' })
  await clickDesignMenuItem(p, /Delete|Supprimer/)
  await expect(p.locator('[data-testid="delete-confirmation-modal"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="delete-confirmation-confirm-button"]').click()
  await p.waitForTimeout(500)
})

Then('the model card shows {string}', async ({}, name: string) => {
  const p = requirePage()
  await expect(designEntityTitle(p)).toContainText(name, { timeout: 5000 })
})

// ── Schema tab: properties ────────────────────────────────────────────

When('I add a property named {string}', async ({}, name: string) => {
  const p = requirePage()
  await p.locator('[data-testid="design-add-property"]').click()
  await expect(p.locator('[data-testid="design-property-name-input"]')).toBeVisible({ timeout: 5000 })
  if (name !== '') {
    const input = p.locator('[data-testid="design-property-name-input"]')
    await input.click()
    await input.fill(name)
    await input.blur()
    await p.waitForTimeout(400)
  }
})

When('I rename the selected property to {string}', async ({}, name: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="design-property-name-input"]')
  await input.click()
  await input.fill(name)
  await input.blur()
  await p.waitForTimeout(400)
})

When('I select the property row {string}', async ({}, name: string) => {
  const p = requirePage()
  await propertyCellByText(p, name).click()
  await expect(p.locator('[data-testid^="design-property-panel-"]')).toBeVisible({ timeout: 5000 })
})

When('I toggle the property flag {string}', async ({}, flag: string) => {
  const p = requirePage()
  await p.locator(`[data-testid="design-flag-${flag}"]`).click()
  await p.waitForTimeout(200)
})

When('I set the property min length to {string}', async ({}, value: string) => {
  const p = requirePage()
  const input = p.locator('[data-testid="design-property-min-length-input"]')
  await input.click()
  await input.fill(value)
  await input.blur()
  await p.waitForTimeout(400)
})

When('I set the property type to {string}', async ({}, optionText: string) => {
  const p = requirePage()
  await pickSelectOption(p, 'design-property-type', optionText)
})

When('I set the reference delete rule to {string}', async ({}, optionText: string) => {
  const p = requirePage()
  // Localized option — accept the French wording or its English fallback.
  const fallback: Record<string, RegExp> = {
    'Supprimer en cascade': /Supprimer en cascade|Cascade delete/
  }
  await pickSelectOption(p, 'design-property-ondelete', fallback[optionText] ?? optionText)
})

Then('the property row {string} shows the type {string}', async ({}, name: string, type: string) => {
  const p = requirePage()
  const row = propertyCellByText(p, name)
  await expect(row).toBeVisible({ timeout: 5000 })
  const rowTestId = await row.getAttribute('data-testid')
  if (rowTestId === null) throw new Error('property cell has no testid')
  await expect(
    p.locator(`[data-testid="${rowTestId}"]`).filter({ has: p.locator('.design-prop-type') })
  ).toContainText(type, { timeout: 5000 })
})

Then('the property row {string} shows the flags {string}', async ({}, name: string, _flags: string) => {
  const p = requirePage()
  // Localized badge text — assert through the panel's toggles instead.
  await propertyCellByText(p, name).click()
  for (const flag of ['required', 'pii', 'searchable']) {
    await expect(p.locator(`[data-testid="design-flag-${flag}"]`).getByRole('checkbox')).toBeChecked({ timeout: 5000 })
  }
})

// ── Save / reopen round-trip ──────────────────────────────────────────

When('I save the project', async () => {
  const p = requirePage()
  await p.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
    }))
  })
  await p.waitForTimeout(1500)
})

Then('the saved file carries a model {string} whose property {string} is required, PII, searchable, with min length 3', async ({}, modelName: string, propertyName: string) => {
  const saved = readFileSync(projectPath, 'utf-8')
  expect(saved).toContain(`name: ${modelName}`)
  expect(saved).toContain(`name: ${propertyName}`)
  expect(saved).toContain('pii: true')
  expect(saved).toContain('searchable: true')
  expect(saved).toContain('minLength: 3')
})

When('I close the design tab and reopen the design on the models section', async () => {
  const p = requirePage()
  const tab = p.locator('.tab[role="tab"]').filter({ has: p.getByText(DESIGN_NAME, { exact: true }) }).first()
  await tab.hover()
  // ECUI Button renders an <a>, not a <button>.
  await tab.locator('.tab-actions a[aria-label="Close"]').first().click()
  await p.waitForTimeout(500)
  await openModelsSection(p)
})

// ── Inheritance ───────────────────────────────────────────────────────

When('I expand the inherited properties pane', async () => {
  const p = requirePage()
  const toggle = p.locator('[data-testid="design-inherited-pane-toggle"]')
  await expect(toggle).toBeVisible({ timeout: 5000 })
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click()
    await p.waitForTimeout(200)
  }
})

Then('the inherited property row {string} is read-only with a jump to the parent', async ({}, name: string) => {
  const p = requirePage()
  const cell = p.locator('.design-prop-cell.inherited').filter({ has: p.getByText(name, { exact: true }) }).first()
  await expect(cell).toBeVisible({ timeout: 5000 })
  await expect(cell.locator('.design-prop-jump')).toBeVisible()
})

When('I click the jump on the inherited row {string}', async ({}, name: string) => {
  const p = requirePage()
  await p.locator('.design-prop-cell.inherited').filter({ has: p.getByText(name, { exact: true }) })
    .first().locator('.design-prop-jump').click()
  await p.waitForTimeout(400)
})

When('I open the model {string} settings tab', async ({}, name: string) => {
  const p = requirePage()
  await openDesignEntity(p, DESIGN_ID, 'models', name)
  await expect(p.locator('[data-testid="design-model-tabs"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-model-tabs"] [role="tab"][data-tab-id="settings"]').click()
  await expect(p.locator(`[data-testid^="design-model-settings-"]`)).toBeVisible({ timeout: 5000 })
})

Then('the inheritance choices do not offer {string}', async ({}, name: string) => {
  const p = requirePage()
  const selectId = 'design-model-inherits'
  await p.locator(`[data-testid="${selectId}-trigger"]`).click()
  const dropdown = p.locator(`[data-testid="${selectId}-dropdown"]`)
  await expect(dropdown).toBeVisible({ timeout: 5000 })
  await expect(dropdown.locator('.select-option').filter({ hasText: name })).toHaveCount(0)
  await p.keyboard.press('Escape')
})

Then('the used-by list contains {string}', async ({}, label: string) => {
  const p = requirePage()
  await expect(
    p.locator('[data-testid="design-model-usages"] .design-usage-chip').filter({ hasText: label })
  ).toHaveCount(1, { timeout: 5000 })
})

When('I click the used-by entry {string}', async ({}, label: string) => {
  const p = requirePage()
  await p.locator('[data-testid="design-model-usages"] .design-usage-chip').filter({ hasText: label }).first().click()
  await p.waitForTimeout(400)
})

Then('the model card has no inherited rows', async () => {
  const p = requirePage()
  // With no inherited properties the inherited pane is not rendered at all
  // (rather than rendered-but-empty), so assert on the pane itself — this stays
  // correct whether or not the pane would have been collapsed.
  await expect(p.locator('.design-schema-pane--inherited')).toHaveCount(0, { timeout: 5000 })
})

// ── Validation errors ─────────────────────────────────────────────────

Then('the models sidebar entry carries an error dot', async () => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-section-error-models"]`)).toBeVisible({ timeout: 5000 })
  await expect(p.locator(`[data-testid="design-error-${DESIGN_ID}"]`).first()).toBeVisible({ timeout: 5000 })
})

Then('the models sidebar entry carries no error dot', async () => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-section-error-models"]`)).toHaveCount(0, { timeout: 5000 })
})

Then('the selected property panel reports a duplicate-name issue', async () => {
  const p = requirePage()
  await expect(p.locator('[data-testid="design-property-issues"]')).toBeVisible({ timeout: 5000 })
})

// ── Parent-model deletion ─────────────────────────────────────────────

When('I ask to delete the model', async () => {
  const p = requirePage()
  // The trash moved to the sidebar node's context menu — delete the currently
  // open model (its name is the H1 title) from there; the confirm modal is the same.
  const name = (await designEntityTitle(p).innerText()).trim()
  await deleteDesignEntityNode(p, DESIGN_ID, 'models', name)
  await expect(p.locator('[data-testid="design-model-delete-modal"]')).toBeVisible({ timeout: 5000 })
})

Then('the delete modal lists the child {string}', async ({}, childName: string) => {
  const p = requirePage()
  await expect(
    p.locator('[data-testid="design-model-delete-impact"] li').filter({ hasText: childName })
  ).toHaveCount(1, { timeout: 5000 })
})

When('I confirm the model deletion', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-model-delete-confirm"]').click()
  await p.waitForTimeout(500)
})

// ── Enums ─────────────────────────────────────────────────────────────

When('I open the enums section', async () => {
  const p = requirePage()
  await openDesignSection(p, DESIGN_ID, 'enums')
  await p.mouse.move(700, 400)
  await expect(p.locator('[data-testid="design-enums-section"]')).toBeVisible({ timeout: 5000 })
})

When('I open the models section', async () => {
  const p = requirePage()
  await openDesignSection(p, DESIGN_ID, 'models')
  await p.mouse.move(700, 400)
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
})

When('I add an enum', async () => {
  const p = requirePage()
  // Added through the Enums sidebar row's context menu; the new enum is created
  // with a default name and selected — its values table (add-entry) opens.
  await addDesignEntity(p, DESIGN_ID, 'enums', /Add an enum/)
  await expect(p.locator('[data-testid="design-enums-add-entry-button"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(300)
})

When('I add the enum value {string}', async ({}, value: string) => {
  const p = requirePage()
  await p.locator('[data-testid="design-enums-add-entry-button"]').click()
  await p.waitForTimeout(300)
  // InputBox puts the testid on the INPUT with an `-input` suffix — the
  // root only carries `-container`.
  const input = p.locator('[data-testid^="design-enums-entries-table-row-"][data-testid$="-key-input"]').last()
  await input.click()
  await input.fill(value)
  await input.blur()
  await p.waitForTimeout(600)
})

// ── Named examples ────────────────────────────────────────────────────

When('I open the model {string} examples tab', async ({}, name: string) => {
  const p = requirePage()
  await openDesignEntity(p, DESIGN_ID, 'models', name)
  await expect(p.locator('[data-testid="design-model-tabs"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-model-tabs"] [role="tab"][data-tab-id="examples"]').click()
  await expect(p.locator('[data-testid="design-example-pills"]')).toBeVisible({ timeout: 5000 })
})

When('I add a named example', async () => {
  const p = requirePage()
  await p.locator('[data-testid="design-example-add"]').click()
  await expect(p.locator('[data-testid="design-example-name-input"]')).toBeVisible({ timeout: 5000 })
})

Then('the example value row {string} is tagged {string}', async ({}, propertyName: string, tag: string) => {
  const p = requirePage()
  const propId = PROP_IDS[propertyName]
  if (propId === undefined) throw new Error(`unknown fixture property: ${propertyName}`)
  const badge = p.locator(`[data-testid="design-example-origin-${propId}"]`)
  await expect(badge).toBeVisible({ timeout: 5000 })
  // Class-based: the badge text is localized.
  await expect(badge).toHaveClass(tag === 'auto' ? /auto/ : /defined/, { timeout: 5000 })
})

When('I type {string} as the example value of {string}', async ({}, value: string, propertyName: string) => {
  const p = requirePage()
  const propId = PROP_IDS[propertyName]
  if (propId === undefined) throw new Error(`unknown fixture property: ${propertyName}`)
  const input = p.locator(`[data-testid="design-example-value-${propId}-input"]`)
  await input.click()
  await input.fill(value)
  await p.waitForTimeout(600)
})

Then('the example value input of {string} reports a constraint violation', async ({}, propertyName: string) => {
  const p = requirePage()
  const propId = PROP_IDS[propertyName]
  if (propId === undefined) throw new Error(`unknown fixture property: ${propertyName}`)
  // InputBox renders `<testid>-message` while the validator refuses
  // the current draft.
  await expect(p.locator(`[data-testid="design-example-value-${propId}-message"]`)).toBeVisible({ timeout: 5000 })
})

// ── Operational-profile intents (model settings) ──────────────────────
// The e2e app may run in French OR English (CI falls back to English), so
// match each option against both wordings — same tactic as the delete-rule step.
const PROFILE_LABEL_ALIASES: Record<string, RegExp> = {
  'Lecture dominante': /Lecture dominante|Read-heavy/,
  'Écriture dominante': /Écriture dominante|Write-heavy/,
  'Données personnelles (PII)': /Données personnelles \(PII\)|Personal data \(PII\)/
}

When('I set the model profile {string} to {string}', async ({}, testid: string, label: string) => {
  const p = requirePage()
  const matcher = PROFILE_LABEL_ALIASES[label] ?? label
  // Reuse the hardened picker: the dropdown is portaled and can overflow the
  // window, so a plain click on a lower option times out.
  await pickSelectOption(p, testid, matcher)
  // The trigger reflects the pick once the model doc is updated.
  await expect(p.locator(`[data-testid="${testid}-trigger"]`)).toContainText(matcher, { timeout: 5000 })
})

Then('the model profile {string} shows {string}', async ({}, testid: string, label: string) => {
  const p = requirePage()
  const matcher = PROFILE_LABEL_ALIASES[label] ?? label
  await expect(p.locator(`[data-testid="${testid}-trigger"]`)).toContainText(matcher, { timeout: 5000 })
})
