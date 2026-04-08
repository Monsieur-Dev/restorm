import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'
import { listViewRowSelectorByTitle } from 'electron-core-ui/testing'

const { Given, When, Then } = createBdd(test)

Given('the file is loaded', async ({ page }) => {
  await expect(
    page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Swagger Petstore')).first()
  ).toBeVisible({ timeout: 15000 })
})

When('I open {string} from the sidebar', async ({ page }, itemName: string) => {
  const row = page.locator(listViewRowSelectorByTitle('sidebar-listview', itemName)).first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  // Wait for a tab with this name to appear
  const tab = page.locator('[role="tab"]').filter({ hasText: itemName }).first()
  await expect(tab).toBeVisible({ timeout: 10000 })
  // Ensure it's active
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 })
})

When('I click the navigation back button', async ({ page }) => {
  // The back button is an <a> element inside a Button component
  // Feature flag is async — wait longer for buttons to appear
  const backBtn = page.locator('[data-testid="main-titlebar-nav-back"]').first()
  await expect(backBtn).toBeVisible({ timeout: 15000 })
  // Ensure button is not disabled before clicking
  await expect(backBtn).not.toHaveAttribute('aria-disabled', 'true', { timeout: 5000 })
  await backBtn.click()
  await page.waitForTimeout(500)
})

When('I click the navigation forward button', async ({ page }) => {
  const fwdBtn = page.locator('[data-testid="main-titlebar-nav-forward"]').first()
  await expect(fwdBtn).toBeVisible({ timeout: 5000 })
  await fwdBtn.click()
  await page.waitForTimeout(300)
})

Then('the active tab title should contain {string}', async ({ page }, text: string) => {
  const activeTab = page.locator('[role="tab"][aria-selected="true"]').first()
  await expect(activeTab).toBeVisible({ timeout: 5000 })
  await expect(activeTab).toContainText(text, { timeout: 5000 })
})

When('I press Ctrl+Tab and release', async ({ page }) => {
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(200)
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
})

When('I hold Ctrl and press Tab to open the tab switcher', async ({ page }) => {
  await page.keyboard.down('Control')
  await page.keyboard.press('Tab')
  // Wait for overlay to appear
  await expect(page.locator('[data-testid="tab-switcher"]')).toBeVisible({ timeout: 5000 })
})

Then('the tab switcher item at index {int} should contain {string}', async ({ page }, index: number, text: string) => {
  const item = page.locator(`[data-testid="tab-switcher-item-${index}"]`)
  await expect(item).toBeVisible({ timeout: 3000 })
  await expect(item).toContainText(text, { timeout: 3000 })
})

When('I release Ctrl', async ({ page }) => {
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
})
