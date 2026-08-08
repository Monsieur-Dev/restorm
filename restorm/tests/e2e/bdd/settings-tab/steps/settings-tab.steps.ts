import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/settings-tab.fixture'
import { defineSystemModalsBddSteps, defineToggleBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { listViewRowSelectorByTitle, configureNextOpenDialogForE2E } from 'electron-core-ui/testing'

const bdd = createBdd(test)
const { Given, When, Then } = bdd

defineSystemModalsBddSteps(bdd)
// Generic Toggle steps (focus / keyboard / focus-ring assertions) so a Settings
// toggle can be driven the same way as any other ECUI Toggle.
defineToggleBddSteps(bdd)

// The Settings workbench tab is a singleton with this stable id; the
// EditorWorkbench composes every tab header's data-testid as
// `…-tab-<tabId>`, so an attribute-suffix selector finds the header
// regardless of which group it lives in.
const SETTINGS_TAB_HEADER_SELECTOR = '[data-testid$="-tab-settings:singleton"]'
const SETTINGS_TAB_CONTENT_SELECTOR = '[data-testid="settings-tab-content"]'
const SETTINGS_MODAL_SELECTOR = '[data-testid="settings-modal"]'
const SETTINGS_BUTTON_SELECTOR = '[data-testid="titlebar-settings-button"]'

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
  // A workbench is active once the sidebar shows the loaded collections.
  await expect(page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Swagger Petstore')).first())
    .toBeVisible({ timeout: 15000 })
})

When('I open Settings from the gear button', async ({ page }) => {
  await page.locator(SETTINGS_BUTTON_SELECTOR).click()
  // Let the modal mount / tab activate before assertions.
  await page.waitForTimeout(300)
})

When('I open Settings from the View menu', async ({ page }) => {
  const menubarTestId = 'titlebar-menubar'
  const settingsItem = page.locator('[data-testid="titlebar-menu-item-settings"]')

  // The responsive MenuBar lays out in `full`, `overflow`, or
  // `hamburger` mode depending on width. In `full` mode the View
  // entry sits directly on the bar; otherwise it is folded behind the
  // overflow / hamburger button as a nested submenu. The mode is read
  // INSIDE the retry below, so a relayout between attempts is picked up.

  // Generous menu timeout: the menu opens deterministically (click), but the
  // submenu item render can still exceed 5s when the host is under memory
  // pressure (heavy swap intermittently starves renderer timers), so wait
  // longer for the item itself.
  const MENU_TIMEOUT = 15000
  // Opening a menu is an INTERACTION, not an assertion: under load the submenu
  // can miss the hover/click meant to expand it and the entry never appears,
  // which reads as "Settings is missing". Re-opening is idempotent, so retry
  // the whole open instead of lengthening a single wait.
  await expect(async () => {
    const liveMode = await page.locator(`[data-testid="${menubarTestId}"]`).getAttribute('data-mode')
    if (liveMode === 'full') {
      // Click-open the View menu (a bare hover can race the menubar becoming
      // active), then click Settings.
      await page.locator('[data-testid="titlebar-menubar-item-view"]').click({ force: true })
    } else {
      // Open the overflow / hamburger bucket, then open the folded View entry
      // (its testid gains an `-overflow` suffix) to expand its submenu.
      const overflowBtn = page.locator(`[data-testid="${menubarTestId}-overflow-button"], [data-testid="${menubarTestId}-hamburger-button"]`).first()
      await overflowBtn.click({ force: true })
      const viewEntry = page.locator('[data-testid="titlebar-menubar-item-view-overflow"]')
      await viewEntry.waitFor({ state: 'visible', timeout: MENU_TIMEOUT })
      await viewEntry.hover()
      await viewEntry.click({ force: true })
    }
    await settingsItem.waitFor({ state: 'visible', timeout: 5000 })
  }).toPass({ timeout: 45_000 })
  await settingsItem.click({ force: true })
  await page.waitForTimeout(300)
})

When('I reload the window', async ({ page }) => {
  await page.reload()
  await page.waitForLoadState('load')
  await page.waitForSelector('[data-testid="titlebar-menubar"]', { timeout: 15000 })
  await page.waitForTimeout(800)
})

Then('the Settings modal should be visible', async ({ page }) => {
  await expect(page.locator(SETTINGS_MODAL_SELECTOR)).toBeVisible({ timeout: 5000 })
})

Then('the Settings modal should not be visible', async ({ page }) => {
  await expect(page.locator(SETTINGS_MODAL_SELECTOR)).toHaveCount(0, { timeout: 5000 })
})

Then('a Settings tab should be open', async ({ page }) => {
  await expect(page.locator(SETTINGS_TAB_HEADER_SELECTOR).first()).toBeVisible({ timeout: 10000 })
  await expect(page.locator(SETTINGS_TAB_CONTENT_SELECTOR)).toBeVisible({ timeout: 10000 })
})

Then('no Settings tab should be open', async ({ page }) => {
  await expect(page.locator(SETTINGS_TAB_HEADER_SELECTOR)).toHaveCount(0, { timeout: 5000 })
})

Then('exactly one Settings tab should be open', async ({ page }) => {
  await expect(page.locator(SETTINGS_TAB_HEADER_SELECTOR)).toHaveCount(1, { timeout: 10000 })
})

Then('the Settings tab should not appear in the opened-items list', async ({ page }) => {
  // The opened-items pane only lists request / scenario documents; the
  // Settings singleton carries neither, so it must not surface there.
  // (When only a Settings tab is open the pane is absent entirely — a
  // count of zero matching rows holds in both cases.)
  const openedRows = page.locator('[data-testid="sidebar-open-documents-listview"] [role="listitem"]')
  const count = await openedRows.count()
  for (let i = 0; i < count; i += 1) {
    const text = (await openedRows.nth(i).innerText()).trim()
    expect(text).not.toContain('Settings')
  }
})
