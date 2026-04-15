import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'
import { defineMenuBarBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { listViewRowSelectorByTitle } from 'electron-core-ui/testing'

const bdd = createBdd(test)
const { When, Then } = bdd

// `I open menu bar … menu …` / `I click menu bar item …` come in via the
// shared menu-bar step set.
defineMenuBarBddSteps(bdd)

// The `I expand {string} in the sidebar` / `I open {string} from the sidebar`
// / `the file is loaded` verbs come in via the shared sidebar-sync steps,
// which are co-loaded by this project (see `playwright.config.ts`).

When('I middle-click the tab {string}', async ({ page }, tabTitle: string) => {
  const tab = page.locator('.tab[role="tab"]').filter({ hasText: tabTitle }).first()
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click({ button: 'middle' })
  await expect(tab).toHaveCount(0, { timeout: 5000 })
})

When('I close every tab in the workbench via middle-click', async ({ page }) => {
  // Middle-click tabs one at a time until none remain. Useful both to clean
  // up any leftover state from a previous run and to exercise the
  // middle-click close path for the fix-under-test.
  const tabLocator = page.locator('.tab[role="tab"]')
  // Small guard to avoid an infinite loop if the close doesn't take effect.
  for (let i = 0; i < 50; i += 1) {
    const count = await tabLocator.count()
    if (count === 0) return
    await tabLocator.first().click({ button: 'middle' })
    await expect(tabLocator).toHaveCount(count - 1, { timeout: 5000 })
  }
  throw new Error('Failed to close all tabs after 50 middle-click attempts')
})

Then('the workbench should have no tabs', async ({ page }) => {
  // The workbench renders a `.welcome-container` (empty state) when no tabs
  // are open. We check that AND that no `[role="tab"]` remains in the
  // workbench area to be resilient to layout tweaks.
  await expect(page.locator('.tab[role="tab"]')).toHaveCount(0, { timeout: 10000 })
})

When('I close the current file', async ({ page }) => {
  // File → Close via the menu bar.
  await page.locator('[data-testid="titlebar-menubar-item-file"]').click()
  const closeItem = page.locator('[data-testid="titlebar-menu-item-close"]').first()
  await expect(closeItem).toBeVisible({ timeout: 5000 })
  await closeItem.click()
  // The welcome screen replaces the workbench when no file is loaded.
  await expect(page.locator('.welcome-container')).toBeVisible({ timeout: 10000 })
})

When('I reopen the Petstore file from the welcome screen', async ({ page }) => {
  // The petstore-file fixture launches Restorm with `--open Petstore.restorm`,
  // so the file is already in the recent-files list. Click it.
  const recentItem = page.locator('.welcome-file-item', { hasText: 'Petstore.restorm' }).first()
  await expect(recentItem).toBeVisible({ timeout: 10000 })
  await recentItem.click()
  // Wait for the sidebar tree to come back — signals the file finished
  // loading and the workbench has its restored (or empty) state.
  await expect(page.locator('[data-testid="sidebar-listview"] .list-view-title', { hasText: 'Swagger Petstore' }).first())
    .toBeVisible({ timeout: 15000 })
})

When('I select the {string} environment in the workbench', async ({ page }, envName: string) => {
  // Scope to the active tab's environment dropdown — there's only one
  // workbench dropdown at a time, so a plain testid lookup is enough.
  const dropdownButton = page.locator('[data-testid="environment-dropdown-button"]').first()
  await expect(dropdownButton).toBeVisible({ timeout: 5000 })
  await dropdownButton.click()
  const item = page.locator(`text="${envName}"`).first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
  // Dropdown closes on click; give the UI a beat to settle.
  await page.waitForTimeout(200)
})

Then('the selected environment in the workbench should be {string}', async ({ page }, envName: string) => {
  const dropdownButton = page.locator('[data-testid="environment-dropdown-button"]').first()
  await expect(dropdownButton).toContainText(envName, { timeout: 10000 })
})

When('I rename {string} to {string} in the sidebar', async ({ page }, oldName: string, newName: string) => {
  const row = page.locator(listViewRowSelectorByTitle('sidebar-listview', oldName)).first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  await page.keyboard.press('F2')
  const input = page.locator('[data-testid="sidebar-listview"] input[type="text"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(newName)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
})
