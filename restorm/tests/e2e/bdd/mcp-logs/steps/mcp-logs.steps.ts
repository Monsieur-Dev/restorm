import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/mcp-logs.fixture'
import { defineSystemModalsBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { listViewRowSelectorByTitle, configureNextOpenDialogForE2E } from 'electron-core-ui/testing'

const bdd = createBdd(test)
const { Given, When, Then } = bdd

defineSystemModalsBddSteps(bdd)

// The MCP-logs workbench tab is a singleton with this stable id; the
// EditorWorkbench composes every tab header's data-testid as
// `…-tab-<tabId>`, so an attribute-suffix selector finds the header
// regardless of which group it lives in.
const MCP_LOGS_TAB_HEADER_SELECTOR = '[data-testid$="-tab-mcp-logs:singleton"]'
const MCP_LOGS_TAB_CONTENT_SELECTOR = '[data-testid="mcp-logs-tab-content"]'
const MCP_LOGS_MODAL_SELECTOR = '[data-testid="mcp-logs-modal"]'
const MCP_LOGS_MENU_ITEM_SELECTOR = '[data-testid="titlebar-menu-item-mcp-logs"]'

const MENUBAR_TEST_ID = 'titlebar-menubar'

/** Wait until the responsive menubar has settled on a single layout mode.
 * The menubar recomputes its mode (full / overflow / hamburger) on every
 * resize + on the welcome→workbench transition; reading `data-mode` and
 * clicking in the same tick can race a reconciliation that detaches the
 * just-resolved button. Poll until the mode is stable across two reads. */
async function waitForStableMenubarMode(page: Page): Promise<string> {
  const root = page.locator(`[data-testid="${MENUBAR_TEST_ID}"]`)
  await root.waitFor({ state: 'attached', timeout: 15000 })
  const deadline = Date.now() + 10000
  let last = await root.getAttribute('data-mode')
  while (Date.now() < deadline) {
    await page.waitForTimeout(120)
    const next = await root.getAttribute('data-mode')
    if (next !== null && next === last) return next
    last = next
  }
  return last ?? 'full'
}

/** Open the responsive View menu (full / overflow / hamburger modes) once.
 * Returns true if the View dropdown actually opened — the caller retries on
 * false, which is the reliable cure for the mid-reconciliation race. */
async function tryOpenViewMenu(page: Page): Promise<boolean> {
  const mode = await waitForStableMenubarMode(page)
  if (mode === 'full') {
    await page.locator('[data-testid="titlebar-menubar-item-view"]').click({ force: true })
  } else {
    const overflowBtn = page.locator(`[data-testid="${MENUBAR_TEST_ID}-overflow-button"], [data-testid="${MENUBAR_TEST_ID}-hamburger-button"]`).first()
    await overflowBtn.click({ force: true })
    const viewEntry = page.locator('[data-testid="titlebar-menubar-item-view-overflow"]')
    try {
      await viewEntry.waitFor({ state: 'visible', timeout: 3000 })
    } catch {
      return false
    }
    await viewEntry.hover()
    await viewEntry.click({ force: true })
  }
  // The View dropdown is open only once its MCP-logs entry is visible.
  try {
    await page.locator(MCP_LOGS_MENU_ITEM_SELECTOR).waitFor({ state: 'visible', timeout: 4000 })
    return true
  } catch {
    return false
  }
}

/** Open the View menu and leave it open with the MCP-logs item visible.
 * Retries the open a few times: a click landing mid-reconciliation simply
 * fails to open the dropdown, so re-settling + re-clicking is far more
 * robust than a single long waitFor that just times out under load. */
async function openViewMenu(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await tryOpenViewMenu(page)) return
    // Close any half-open menu + let the menubar settle before retrying.
    await page.keyboard.press('Escape').catch(() => undefined)
    await page.waitForTimeout(250)
  }
  // Final attempt surfaces a clear error if the menu genuinely never opens.
  if (!(await tryOpenViewMenu(page))) {
    throw new Error('View menu did not expose the MCP-logs item after repeated attempts')
  }
}

Given('no file is open', async ({ page }) => {
  await expect(page.locator('[data-testid="welcome-new-button"]')).toBeVisible({ timeout: 15000 })
})

Given('a project folder is open', async ({ page, electronApp, petstoreFolderPath }) => {
  await configureNextOpenDialogForE2E(electronApp, { kind: 'openFolder', path: petstoreFolderPath })
  const result = await page.evaluate(async () => {
    interface OpenFolderResult { success: boolean; error?: string }
    const w = window as unknown as { restorm?: { file?: { openFolder?: () => Promise<OpenFolderResult> } } }
    const fn = w.restorm?.file?.openFolder
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openFolder is not available')
    return await fn()
  })
  if (!(result as { success?: boolean }).success) {
    throw new Error(`openFolder returned success=false (${String((result as { error?: unknown }).error)})`)
  }
  await expect(page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Swagger Petstore')).first())
    .toBeVisible({ timeout: 15000 })
})

When('I open MCP logs from the View menu', async ({ page }) => {
  // openViewMenu only returns once the MCP-logs item is visible.
  await openViewMenu(page)
  await page.locator(MCP_LOGS_MENU_ITEM_SELECTOR).click({ force: true })
  await page.waitForTimeout(300)
})

When('I reload the window', async ({ page }) => {
  await page.reload()
  await page.waitForLoadState('load')
  await page.waitForSelector('[data-testid="titlebar-menubar"]', { timeout: 15000 })
  await page.waitForTimeout(800)
})

Then('the MCP logs modal should be visible', async ({ page }) => {
  await expect(page.locator(MCP_LOGS_MODAL_SELECTOR)).toBeVisible({ timeout: 5000 })
})

Then('the MCP logs modal should not be visible', async ({ page }) => {
  await expect(page.locator(MCP_LOGS_MODAL_SELECTOR)).toHaveCount(0, { timeout: 5000 })
})

Then('an MCP logs tab should be open', async ({ page }) => {
  await expect(page.locator(MCP_LOGS_TAB_HEADER_SELECTOR).first()).toBeVisible({ timeout: 10000 })
  await expect(page.locator(MCP_LOGS_TAB_CONTENT_SELECTOR)).toBeVisible({ timeout: 10000 })
})

Then('no MCP logs tab should be open', async ({ page }) => {
  await expect(page.locator(MCP_LOGS_TAB_HEADER_SELECTOR)).toHaveCount(0, { timeout: 5000 })
})

Then('exactly one MCP logs tab should be open', async ({ page }) => {
  await expect(page.locator(MCP_LOGS_TAB_HEADER_SELECTOR)).toHaveCount(1, { timeout: 10000 })
})

Then('the MCP logs tab should not appear in the opened-items list', async ({ page }) => {
  // The opened-items pane only lists request / scenario documents; the MCP
  // logs singleton carries neither, so it must not surface there.
  const openedRows = page.locator('[data-testid="sidebar-open-documents-listview"] [role="listitem"]')
  const count = await openedRows.count()
  for (let i = 0; i < count; i += 1) {
    const text = (await openedRows.nth(i).innerText()).trim()
    expect(text).not.toContain('MCP')
  }
})

Then('the MCP logs menu entry should be disabled', async ({ page }) => {
  await openViewMenu(page)
  const item = page.locator(MCP_LOGS_MENU_ITEM_SELECTOR)
  await item.waitFor({ state: 'visible', timeout: 15000 })
  await expect(item).toHaveAttribute('data-disabled', 'true')
})
