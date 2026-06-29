/**
 * Steps for the côte-à-côte scenario config-selector ↔ request quick-settings
 * live-sync regression lock (Yoann's 2026-06-23 7-step spec).
 *
 * Harness: a committed sample (scenario-quick-config-selector.restorm) holds an
 * HTTP GET request "qcs-req" and a scenario "qcs-scn" whose single httpRequest
 * action node is bound to that request by config.requestId. Both are opened as
 * tabs and stay MOUNTED (an inactive tab sits at 0×0 but is not unmounted), so a
 * config added/overwritten/deleted via the request's quick-settings popover must
 * propagate LIVE to the scenario node's selector with no reload — exactly the
 * sync the spec guards. To DRIVE the popover we focus the request tab; to ASSERT
 * the selector we focus the scenario tab; neither focus remounts the other tab,
 * so the live event path is what is under test (not a fresh read after remount).
 *
 * Confirmed production testids:
 *  - popover: quick-settings-{open-button,popover,name-input-input,storage-toggle,
 *    save-button,load-<id>,delete-<id>,confirm-ok}; badge .quick-settings-badge--{project,settings}
 *  - scenario node (QuickConfigSelectorRow): scn-override-config-select (absent
 *    when 0 file configs), scn-override-config-menu, items scn-override-config-item-{none,<id>}
 */

import { createBdd } from 'playwright-bdd'
import { copyFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import type { Page, ElectronApplication, Locator } from '@playwright/test'
import { configureNextOpenDialogForE2E, selectBoxTriggerSelector, selectBoxDropdownSelector } from 'electron-core-ui/testing'
import { test, expect } from '../../fixtures/mcp-server.fixture'

const { Given, When, Then } = createBdd(test)

const SAMPLE = resolve(__dirname, '../../../samples/scenario-quick-config-selector.restorm')
/** The scenario action's quick-config SelectBox testid (root). */
const CONFIG_SELECT = 'scn-override-config-select'
const optionLabels = (testid: string): string => `[data-testid^="${testid}-option-"][data-testid$="-label"]`
const REQUEST_NAME = 'qcs-req'
const SCENARIO_NAME = 'qcs-scn'

let app: ElectronApplication | null = null
let page: Page | null = null

function requirePage(): Page {
  if (page === null) throw new Error('launch first')
  return page
}

// `:visible` → the active tab / mounted surface (inactive tabs sit at 0×0).
const vis = (testid: string): string => `[data-testid="${testid}"]:visible`

/** A sidebar tree row by its exact visible name. */
function sidebarRow(p: Page, name: string): Locator {
  return p.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: p.getByText(name, { exact: true }) }).first()
}

/** Open (or re-focus) an item's tab by double-clicking its sidebar row. Opening
 * an already-open item focuses its existing tab without remounting it. */
async function focusTab(p: Page, name: string): Promise<void> {
  await sidebarRow(p, name).dblclick()
}

// ---------------------------------------------------------------------------
// Popover helpers (request side) — each focuses the request tab first.
// ---------------------------------------------------------------------------

async function openPopover(p: Page): Promise<void> {
  await focusTab(p, REQUEST_NAME)
  await p.locator(vis('quick-settings-open-button')).waitFor({ state: 'visible', timeout: 15_000 })
  await p.locator(vis('quick-settings-open-button')).click()
  await p.locator(vis('quick-settings-popover')).waitFor({ state: 'visible', timeout: 10_000 })
}

async function closePopover(p: Page): Promise<void> {
  // Popover dismisses on an outside mousedown (not Escape); the page corner is
  // always clear of the smartbar popover.
  await p.mouse.click(8, 8)
  await expect(p.locator(vis('quick-settings-popover'))).toHaveCount(0, { timeout: 5_000 })
}

/** Set the storage toggle to the requested mode. Toggle checked === 'project'. */
async function setStorageMode(p: Page, mode: 'settings' | 'project'): Promise<void> {
  const toggle = p.locator(vis('quick-settings-storage-toggle'))
  await toggle.waitFor({ state: 'visible', timeout: 10_000 })
  const isChecked = async (): Promise<boolean> => {
    const v = await toggle.evaluate((el) => {
      const sw = el.matches('[aria-checked]') ? el : el.querySelector('[aria-checked]')
      return sw?.getAttribute('aria-checked') ?? null
    })
    return v === 'true'
  }
  const want = mode === 'project'
  if ((await isChecked()) !== want) {
    await toggle.click()
    await expect.poll(isChecked, { timeout: 5_000 }).toBe(want)
  }
}

/** Locate a popover config row by its EXACT visible name (so "test" never also
 * matches "test2" — the row carries the name in its own text node). */
function configRow(p: Page, name: string): Locator {
  return p.locator('.quick-settings-config-row').filter({ has: p.getByText(name, { exact: true }) })
}

// ---------------------------------------------------------------------------
// Scenario selector helpers — each focuses the scenario tab first.
// ---------------------------------------------------------------------------

/** Read the labels of the scenario selector's SelectBox dropdown options. */
async function readSelectorItems(p: Page): Promise<string[]> {
  await p.locator(selectBoxTriggerSelector(CONFIG_SELECT)).first().click()
  const dropdown = p.locator(selectBoxDropdownSelector(CONFIG_SELECT))
  await dropdown.waitFor({ state: 'visible', timeout: 5_000 })
  const labels = await dropdown.locator(optionLabels(CONFIG_SELECT))
    .evaluateAll((els) => els.map((e) => e.textContent.trim()))
  await p.keyboard.press('Escape')
  return labels
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

Given('I launch restorm and open the quick-config-selector sample', async ({ launchAppWithMcp }) => {
  const launched = await launchAppWithMcp()
  app = launched.app
  page = launched.page
  const p = page

  // Copy to a temp working dir so the committed sample never churns.
  const dir = join(tmpdir(), `qcs-e2e-${String(Date.now())}`)
  mkdirSync(dir, { recursive: true })
  const workingCopy = join(dir, 'scenario-quick-config-selector.restorm')
  copyFileSync(SAMPLE, workingCopy)

  await configureNextOpenDialogForE2E(app, { kind: 'openFile', path: workingCopy })
  await p.locator('[data-testid="titlebar-menubar-item-file"]').click()
  await p.locator('[data-testid="titlebar-menu-item-open"]').first().click()

  await expect(sidebarRow(p, REQUEST_NAME)).toBeVisible({ timeout: 15_000 })
  await expect(sidebarRow(p, SCENARIO_NAME)).toBeVisible({ timeout: 15_000 })
})

Given('the {string} request and the {string} scenario are both open as tabs', async ({}, reqName: string, scnName: string) => {
  const p = requirePage()
  // Open the scenario first, then the request, so the request tab ends up
  // focused (popover ready) while the scenario canvas stays mounted in the back.
  await focusTab(p, scnName)
  await p.locator(vis('scn-override-config-select')).count().catch(() => 0) // ensure canvas mounted
  await focusTab(p, reqName)
  await p.locator(vis('quick-settings-open-button')).waitFor({ state: 'visible', timeout: 15_000 })
})

// ---------------------------------------------------------------------------
// When — request side
// ---------------------------------------------------------------------------

When('I save a quick config named {string} in {string} mode on the request', async ({}, name: string, mode: string) => {
  const p = requirePage()
  await openPopover(p)
  await setStorageMode(p, mode === 'project' ? 'project' : 'settings')
  await p.locator(vis('quick-settings-name-input-input')).fill(name)
  await p.locator(vis('quick-settings-save-button')).click()
  // Saving an existing name pops the overwrite confirm modal; confirm if shown.
  const ok = p.locator(vis('quick-settings-confirm-ok'))
  if (await ok.isVisible().catch(() => false)) await ok.click()
  await expect(configRow(p, name).first()).toBeVisible({ timeout: 10_000 })
  await closePopover(p)
})

When('I delete the quick config named {string} on the request', async ({}, name: string) => {
  const p = requirePage()
  await openPopover(p)
  await configRow(p, name).locator('[data-testid^="quick-settings-delete-"]').first().click()
  const ok = p.locator(vis('quick-settings-confirm-ok'))
  await ok.waitFor({ state: 'visible', timeout: 10_000 })
  await ok.click()
  await expect(configRow(p, name)).toHaveCount(0, { timeout: 10_000 })
  await closePopover(p)
})

// ---------------------------------------------------------------------------
// When — scenario side
// ---------------------------------------------------------------------------

When('I select the config {string} in the scenario action', async ({}, name: string) => {
  const p = requirePage()
  await focusTab(p, SCENARIO_NAME)
  await p.locator(selectBoxTriggerSelector(CONFIG_SELECT)).first().click()
  const dropdown = p.locator(selectBoxDropdownSelector(CONFIG_SELECT))
  await dropdown.waitFor({ state: 'visible', timeout: 5_000 })
  // Click the option whose label matches EXACTLY (so 'test' never hits 'test2').
  await dropdown.getByText(name, { exact: true }).click()
})

// ---------------------------------------------------------------------------
// Then — request popover
// ---------------------------------------------------------------------------

Then('the request popover lists a config named {string} with the {string} badge', async ({}, name: string, target: string) => {
  const p = requirePage()
  await openPopover(p)
  await expect(configRow(p, name).locator(`.quick-settings-badge--${target}`)).toBeVisible({ timeout: 10_000 })
  await closePopover(p)
})

Then('the request popover does not list a config named {string}', async ({}, name: string) => {
  const p = requirePage()
  await openPopover(p)
  await expect(configRow(p, name)).toHaveCount(0, { timeout: 10_000 })
  await closePopover(p)
})

// ---------------------------------------------------------------------------
// Then — scenario selector
// ---------------------------------------------------------------------------

Then('the scenario action shows no config selector', async ({}) => {
  const p = requirePage()
  await focusTab(p, SCENARIO_NAME)
  await expect(p.locator(vis('scn-override-config-select'))).toHaveCount(0, { timeout: 10_000 })
})

Then('the scenario action shows a config selector with items {string}', async ({}, csv: string) => {
  const p = requirePage()
  await focusTab(p, SCENARIO_NAME)
  const expected = csv.split(',').map((s) => s.trim()).filter((s) => s.length > 0 && s !== 'none')
  await expect(p.locator(vis('scn-override-config-select'))).toBeVisible({ timeout: 10_000 })
  await expect.poll(async () => {
    const items = await readSelectorItems(p)
    return expected.every((name) => items.some((label) => label.includes(name)))
  }, { timeout: 10_000, message: `selector should list items: ${expected.join(', ')}` }).toBe(true)
})

// The SelectBox trigger's `.select-text` span shows ONLY the selected option's
// label — assert it with an EXACT match (toHaveText), so 'test' never matches
// the substring inside 'test2'. (The root holds a hidden <select> with EVERY
// option, so a root-level toContainText would be wrong.)
const selectedText = (p: Page): Locator =>
  p.locator(`${selectBoxTriggerSelector(CONFIG_SELECT)}:visible .select-text`)

Then('the scenario action selector shows {string} as selected', async ({}, name: string) => {
  const p = requirePage()
  await focusTab(p, SCENARIO_NAME)
  await expect(selectedText(p)).toHaveText(name, { timeout: 10_000 })
})

Then('the scenario action selector does not show {string} as selected', async ({}, name: string) => {
  const p = requirePage()
  await focusTab(p, SCENARIO_NAME)
  await expect(selectedText(p)).not.toHaveText(name, { timeout: 10_000 })
})
