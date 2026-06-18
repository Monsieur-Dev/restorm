import { createBdd } from 'playwright-bdd'
import type { Page } from '@playwright/test'
import { test, expect } from '../../fixtures/mcp-logs-disabled.fixture'

const bdd = createBdd(test)
const { Given, Then } = bdd

const MCP_LOGS_MENU_ITEM_SELECTOR = '[data-testid="titlebar-menu-item-mcp-logs"]'

/** Open the responsive View menu (full / overflow / hamburger modes), then
 * wait for the MCP-logs item to appear. Retries the open because the
 * welcome-screen menubar re-renders during boot, which can detach the
 * just-resolved menu button mid-click. */
async function openViewMenuToMcpLogs(page: Page): Promise<void> {
  const menubarTestId = 'titlebar-menubar'
  const MENU_TIMEOUT = 15000
  const item = page.locator('[data-testid="titlebar-menu-item-mcp-logs"]')
  await expect(async () => {
    // Reset any half-open / toggled menu so each attempt starts clean (a bare
    // re-click of an already-open View menu would just close it again).
    if (!(await item.isVisible())) {
      await page.keyboard.press('Escape')
      const mode = await page.locator(`[data-testid="${menubarTestId}"]`).getAttribute('data-mode')
      if (mode === 'full') {
        await page.locator('[data-testid="titlebar-menubar-item-view"]').click({ force: true })
      } else {
        const overflowBtn = page.locator(`[data-testid="${menubarTestId}-overflow-button"], [data-testid="${menubarTestId}-hamburger-button"]`).first()
        await overflowBtn.click({ force: true })
        const viewEntry = page.locator('[data-testid="titlebar-menubar-item-view-overflow"]')
        await viewEntry.waitFor({ state: 'visible', timeout: MENU_TIMEOUT })
        await viewEntry.hover()
        await viewEntry.click({ force: true })
      }
    }
    await expect(item).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30000 })
}

Given('no file is open', async ({ page }) => {
  await expect(page.locator('[data-testid="welcome-new-button"]')).toBeVisible({ timeout: 15000 })
})

Then('the MCP logs menu entry should be disabled', async ({ page }) => {
  await openViewMenuToMcpLogs(page)
  const item = page.locator(MCP_LOGS_MENU_ITEM_SELECTOR)
  await expect(item).toHaveAttribute('data-disabled', 'true')
})
