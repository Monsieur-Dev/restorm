import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { openDesignSection } from './designNav'

/**
 * GUI driver for the API Designer — every helper drives the app the way a
 * human does (clicks, typed input, dropdown picks), never MCP. This is the
 * substrate for the click-by-click design reconstruction: an MCP replay proves
 * the store, but only a GUI replay proves the surface the user actually touches.
 */

export const T = {
  input: (id: string): string => `[data-testid="${id}-input"]`,
  testid: (id: string): string => `[data-testid="${id}"]`
}

/**
 * Type into a RestormVariableInputBox (a Monaco editor, testid
 * `<id>-codeeditor-textarea`) and dismiss the `{{…}}` autocomplete popup.
 */
export async function fillVariableInput(p: Page, id: string, value: string): Promise<void> {
  // A RestormVariableInputBox is a Monaco editor. The first one touched after
  // launch can swallow a click/type while its worker cold-starts, so type, read
  // the rendered text back, and retry until the value actually lands.
  const container = p.locator(`[data-testid="${id}-codeeditor"]`).first()
  await expect(container).toBeVisible({ timeout: 5000 })
  // The first Monaco on the page cold-loads the whole editor library; typing
  // before onMount silently no-ops. onMount stamps the editor textarea with this
  // testid, so its presence is the ready signal.
  await expect(p.locator(`[data-testid="${id}-codeeditor-textarea"]`)).toBeAttached({ timeout: 20000 })
  await container.scrollIntoViewIfNeeded().catch(() => undefined)
  const lines = container.locator('.view-lines')
  // Focus Monaco by clicking its box centre with the mouse. An element/`.label`
  // click can be redirected by the `<label>` wrapper (settings fields) to the
  // read-only IME textarea, leaving the editor unfocused; a coordinate click
  // lands on the editor pixels directly.
  for (let attempt = 0; attempt < 4; attempt++) {
    const box = await container.boundingBox()
    if (box) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    else await container.click()
    await p.waitForTimeout(150)
    await p.keyboard.press('ControlOrMeta+A')
    await p.keyboard.press('Delete')
    // insertText drops the text in atomically — no per-key auto-closing brackets
    // or suggest widget to mangle `{{var}}` the way keyboard.type() would.
    await p.keyboard.insertText(value)
    await p.keyboard.press('Escape') // dismiss any variable-suggestion widget
    await p.waitForTimeout(250)
    // Monaco strips the `{{ }}` into styled spans, so compare on the visible
    // text with whitespace removed.
    const shown = (await lines.innerText().catch(() => '')).replace(/\s+/g, '')
    if (shown === value.replace(/\s+/g, '')) return
  }
  throw new Error(`variable input "${id}" would not accept "${value}"`)
}

/** Fill an ECUI InputBox (root testid → `<id>-input`), committing on blur. */
export async function fillInput(p: Page, id: string, value: string): Promise<void> {
  const input = p.locator(T.input(id))
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.click()
  await input.fill(value)
  await input.blur()
  await p.waitForTimeout(250)
}

/** Pick an option in an ECUI SelectBox by visible text (trigger → dropdown → option). */
export async function pickSelect(p: Page, id: string, optionText: string | RegExp): Promise<void> {
  await p.locator(`[data-testid="${id}-trigger"]`).click()
  const dropdown = p.locator(`[data-testid="${id}-dropdown"]`)
  await expect(dropdown).toBeVisible({ timeout: 5000 })
  const option = dropdown.locator('.select-option').filter({ hasText: optionText }).first()
  await clickOption(p, option)
  await p.waitForTimeout(250)
}

/**
 * Click a portaled SelectBox option. The dropdown can overflow the (small e2e)
 * window, leaving the option outside the viewport where a real click can't
 * reach it — scroll it in, then dispatch the click directly so actionability's
 * viewport check doesn't block a target that's genuinely present and wired.
 */
async function clickOption(p: Page, option: ReturnType<Page['locator']>): Promise<void> {
  await expect(option).toBeAttached({ timeout: 5000 })
  await option.scrollIntoViewIfNeeded().catch(() => undefined)
  await option.dispatchEvent('click')
}

/** Pick a SelectBox option by EXACT trimmed text (avoids `number` matching
 * `Number (model)`). */
export async function pickSelectExact(p: Page, id: string, optionText: string): Promise<void> {
  await p.locator(`[data-testid="${id}-trigger"]`).click()
  const dropdown = p.locator(`[data-testid="${id}-dropdown"]`)
  await expect(dropdown).toBeVisible({ timeout: 5000 })
  const option = dropdown.locator('.select-option').filter({ has: p.getByText(optionText, { exact: true }) }).first()
  await clickOption(p, option)
  await p.waitForTimeout(250)
}

/**
 * Drive an ECUI Toggle to a desired boolean. The checkbox reflects state via
 * `aria-checked`/`checked`; click only when it differs from `want`.
 */
export async function toggleTo(p: Page, testid: string, want: boolean): Promise<void> {
  const toggle = p.locator(`[data-testid="${testid}"]`)
  await expect(toggle).toBeVisible({ timeout: 5000 })
  const isOn = await toggle.evaluate((el) => {
    const input = el.querySelector('input') ?? el
    if (input instanceof HTMLInputElement) return input.checked
    const aria = el.getAttribute('aria-checked') ?? el.querySelector('[aria-checked]')?.getAttribute('aria-checked')
    return aria === 'true'
  })
  if (isOn !== want) {
    await toggle.click()
    await p.waitForTimeout(150)
  }
}

/**
 * Create a fresh design from the EmptyBench card and return its design id
 * (read off the `design-tab-view-<id>` that opens). Creation lands in an inline
 * rename; Escape commits the default name, which a later step overrides.
 */
export async function dismissCrashConsent(p: Page): Promise<void> {
  // First-run crash-consent toast overlays the workbench and intercepts pointer
  // events on anything beneath it — settle it before driving the editor.
  const save = p.locator('[data-testid="crash-consent-toast-save"]')
  if (await save.isVisible({ timeout: 3000 }).catch(() => false)) {
    await save.click()
    await expect(p.locator('[data-testid="crash-consent-toast"]')).not.toBeVisible({ timeout: 5000 })
  }
}

export async function createBlankDesign(p: Page): Promise<string> {
  await dismissCrashConsent(p)
  const button = p.locator('[data-testid="empty-bench-card-create-design-button"]')
  await expect(button).toBeVisible({ timeout: 15000 })
  await button.click()
  await p.waitForTimeout(600)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  const view = p.locator('[data-testid^="design-tab-view-"]').first()
  await expect(view).toBeVisible({ timeout: 10000 })
  const testid = (await view.getAttribute('data-testid')) ?? ''
  const id = testid.replace('design-tab-view-', '')
  if (!id) throw new Error(`could not read design id from "${testid}"`)
  return id
}

/**
 * Enable the given non-http serving protocols (each is a toggle pill on the
 * server section). HTTP is always served and cannot be toggled.
 */
export async function setServingProtocols(p: Page, designId: string, protocols: readonly string[]): Promise<void> {
  const wanted = protocols.filter((proto) => proto !== 'http')
  if (wanted.length === 0) return
  await openDesignSection(p, designId, 'server')
  await expect(p.locator('[data-testid="design-server-section"]')).toBeVisible({ timeout: 5000 })
  for (const proto of wanted) {
    const pill = p.locator(`[data-testid="design-protocol-${proto}"]`)
    await expect(pill).toBeVisible({ timeout: 5000 })
    if (!(await pill.evaluate((el) => el.classList.contains('active')))) {
      await pill.click()
      await p.waitForTimeout(150)
    }
  }
}

/** Open the models section and add a bare model, landing in its schema tab. */
export async function addModel(p: Page, designId: string): Promise<void> {
  await openDesignSection(p, designId, 'models')
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-models-add"]').click()
  await expect(p.locator('[data-testid="design-model-tabs"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(200)
}

/**
 * Commit a new value into an ECUI EditableLabel (read mode is a trigger button;
 * a click swaps in an auto-focused `<id>-input`, committed on Enter).
 */
export async function editLabel(p: Page, id: string, value: string): Promise<void> {
  const label = p.locator(`[data-testid="${id}"]`)
  await expect(label).toBeAttached({ timeout: 5000 })
  // An EditableLabel with an empty value renders a zero-width trigger (only a
  // hover-revealed pencil), which Playwright treats as hidden — dispatch the
  // click directly so entering edit mode doesn't depend on a clickable box.
  const trigger = label.locator('button.ecui-editable-label-trigger')
  if (await trigger.count() > 0) await trigger.dispatchEvent('click')
  else await label.dispatchEvent('click')
  const input = p.locator(T.input(id))
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(value)
  await input.press('Enter')
  await p.waitForTimeout(250)
}

/** Rename the open model (schema tab header name is an EditableLabel). */
export async function renameModel(p: Page, name: string): Promise<void> {
  await editLabel(p, 'design-model-name', name)
}

/** Add a property to the open model and name it; returns its generated id
 * (read off the `design-property-panel-<propId>` that opens). */
export async function addProperty(p: Page, name: string): Promise<string> {
  await p.locator('[data-testid="design-add-property"]').click()
  const nameInput = p.locator('[data-testid="design-property-name-input"]')
  await expect(nameInput).toBeVisible({ timeout: 5000 })
  await nameInput.click()
  await nameInput.fill(name)
  await nameInput.blur()
  await p.waitForTimeout(300)
  return readSelectedPropId(p)
}

/** Read the selected property's id from the open `design-property-panel-<id>`. */
export async function readSelectedPropId(p: Page): Promise<string> {
  const panel = p.locator('[data-testid^="design-property-panel-"]').first()
  await expect(panel).toBeVisible({ timeout: 5000 })
  const testid = (await panel.getAttribute('data-testid')) ?? ''
  return testid.replace('design-property-panel-', '')
}

/** Click a tab in the model detail Tabs (schema/examples/settings/notes/codegen). */
export async function openModelTab(p: Page, tabId: string): Promise<void> {
  await p.locator(`[data-testid="design-model-tabs"] [role="tab"][data-tab-id="${tabId}"]`).click()
  await p.waitForTimeout(200)
}

/** Click a tab in the route detail Tabs (definition/responses/settings/codegen/notes). */
export async function openRouteTab(p: Page, tabId: string): Promise<void> {
  await p.locator(`[data-testid="design-route-tabs"] [role="tab"][data-tab-id="${tabId}"]`).click()
  await p.waitForTimeout(200)
}

/** Open a model in the models list by name (schema tab appears). */
export async function openModel(p: Page, name: string): Promise<void> {
  await p.locator('[data-testid="design-models-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) }).first().click()
  await expect(p.locator('[data-testid="design-model-tabs"]')).toBeVisible({ timeout: 5000 })
  await p.waitForTimeout(200)
}

/** Select an existing property row by its name (cells share a testid). */
export async function selectProperty(p: Page, name: string): Promise<void> {
  await p.locator('.design-prop-cell').filter({ has: p.getByText(name, { exact: true }) }).first().click()
  await expect(p.locator('[data-testid^="design-property-panel-"]')).toBeVisible({ timeout: 5000 })
}

/**
 * Rename the design node in the sidebar (F2 → inline rename input). The design
 * node's row carries `data-item-id="<designId>"`; the app has no name field in
 * the settings section, so the sidebar is the only surface for `design.name`.
 */
export async function renameDesignNode(p: Page, designId: string, name: string): Promise<void> {
  const node = p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${designId}"]`)
  await expect(node).toBeVisible({ timeout: 5000 })
  await node.click()
  await p.keyboard.press('F2')
  const input = p.locator('[data-testid="sidebar-listview-rename-input"]')
  await expect(input.first()).toBeVisible({ timeout: 5000 })
  await input.first().fill(name)
  await input.first().press('Enter')
  await expect(input).toHaveCount(0, { timeout: 5000 })
  await p.waitForTimeout(200)
}

/**
 * Fill the design identity + API fields on the settings section (shown by
 * default when a design opens). `basePath` goes through a variable-aware input,
 * so dismiss any autocomplete popup after typing.
 */
export async function setDesignIdentity(
  p: Page,
  fields: { title?: string; version?: string; description?: string; basePath?: string }
): Promise<void> {
  await expect(p.locator('[data-testid="design-settings-section"]')).toBeVisible({ timeout: 5000 })
  if (fields.title !== undefined) await fillInput(p, 'design-settings-title', fields.title)
  if (fields.version !== undefined) await fillInput(p, 'design-settings-version', fields.version)
  if (fields.description !== undefined && fields.description !== '') {
    await fillInput(p, 'design-settings-description', fields.description)
  }
  if (fields.basePath !== undefined && fields.basePath !== '') {
    await fillVariableInput(p, 'design-settings-base-path', fields.basePath)
    // Blur the Monaco editor so its debounced onChange commits before we
    // navigate away (renaming the design node steals focus to the sidebar).
    await p.locator('[data-testid="design-settings-title-input"]').click()
    await p.waitForTimeout(400)
  }
}
