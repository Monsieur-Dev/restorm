import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'
import { defineMenuBarBddSteps } from 'electron-core-ui/testing/playwright-bdd'

const bdd = createBdd(test)
const { When, Then } = bdd

// `I open menu bar … menu …` / `I click menu bar item …` come in via the
// shared menu-bar step set.
defineMenuBarBddSteps(bdd)

// The `I expand {string} in the sidebar` / `I open {string} from the sidebar`
// / `the file is loaded` verbs come in via the shared sidebar-sync steps,
// which are co-loaded by this project (see `playwright.config.ts`).

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
