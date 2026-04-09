import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'
import { listViewRowSelectorByTitle } from 'electron-core-ui/testing'

const { Given, When, Then } = createBdd(test)

/** Locate a sidebar row by exact title match */
function sidebarRow(page: import('@playwright/test').Page, title: string): import('@playwright/test').Locator {
  return page.locator('[data-testid="sidebar-listview"] .list-view-row')
    .filter({ has: page.locator('.list-view-title', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
    .first()
}

Given('the file is loaded', async ({ page }) => {
  await expect(
    page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Swagger Petstore')).first()
  ).toBeVisible({ timeout: 15000 })
})

When('I open {string} from the sidebar', async ({ page }, itemName: string) => {
  const row = sidebarRow(page, itemName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  const tab = page.locator('[role="tab"]').filter({ hasText: itemName }).first()
  await expect(tab).toBeVisible({ timeout: 10000 })
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 })
})

When('I collapse {string} in the sidebar', async ({ page }, folderName: string) => {
  const row = sidebarRow(page, folderName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 3000 })
  await row.locator('button.list-view-expander').first().click()
  await expect(row).toHaveAttribute('aria-expanded', 'false', { timeout: 3000 })
})

When('I expand {string} in the sidebar', async ({ page }, folderName: string) => {
  const row = sidebarRow(page, folderName)
  await expect(row).toBeVisible({ timeout: 10000 })
  const expanded = await row.getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await row.locator('button.list-view-expander').first().click()
  }
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 3000 })
  await page.waitForTimeout(300)
})

When('I click the tab {string} in the workbench', async ({ page }, tabName: string) => {
  const tab = page.locator('[role="tab"]').filter({ hasText: tabName }).first()
  await expect(tab).toBeVisible({ timeout: 5000 })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 })
  await page.waitForTimeout(500)
})

Then('{string} should be collapsed in the sidebar', async ({ page }, folderName: string) => {
  const row = sidebarRow(page, folderName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row).toHaveAttribute('aria-expanded', 'false', { timeout: 3000 })
})

Then('{string} should be expanded in the sidebar', async ({ page }, folderName: string) => {
  const row = sidebarRow(page, folderName)
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 3000 })
})
