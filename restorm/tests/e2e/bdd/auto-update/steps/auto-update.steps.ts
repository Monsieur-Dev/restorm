import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/auto-update.fixture'
import { listViewRowSelectorByTitle, configureNextOpenDialogForE2E } from 'electron-core-ui/testing'

const { Given, When, Then } = createBdd(test)

Given('the app is running with the update mock', async ({ page, electronApp, petstoreFolderPath }) => {
  // Open a project so a workbench (and its app toaster, where update
  // notifications render) is active — the toaster is not mounted on the welcome
  // screen. Mirrors the settings-tab suite's folder-open flow.
  await configureNextOpenDialogForE2E(electronApp, { kind: 'openFolder', path: petstoreFolderPath })
  const result = await page.evaluate(async () => {
    interface OpenFolderResult { success: boolean; error?: string }
    const w = window as unknown as {
      restorm?: { file?: { openFolder?: () => Promise<OpenFolderResult> } }
    }
    const fn = w.restorm?.file?.openFolder
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openFolder is not available')
    return await fn()
  })
  if (!(result as { success?: boolean }).success) {
    throw new Error(`openFolder returned success=false (${String((result as { error?: unknown }).error)})`)
  }
  await expect(
    page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Swagger Petstore')).first()
  ).toBeVisible({ timeout: 15000 })
  await page.waitForFunction(() => Boolean(window.api.update), undefined, { timeout: 15000 })
})

When('I trigger a manual update check', async ({ page }) => {
  // Drive the real preload IPC → main mock engine → state broadcast, exactly as
  // the Settings "Check now" button does.
  await page.evaluate(async () => {
    await window.api.update.checkNow()
  })
})

When('I check for updates from the Help menu', async ({ page }) => {
  const menubarTestId = 'titlebar-menubar'
  const item = page.locator('[data-testid="titlebar-menu-item-check-updates"]')
  const MENU_TIMEOUT = 15000
  // Layout-agnostic (full / overflow / hamburger), mirroring the settings-tab
  // View-menu step.
  const mode = await page.locator(`[data-testid="${menubarTestId}"]`).getAttribute('data-mode')
  if (mode === 'full') {
    await page.locator('[data-testid="titlebar-menubar-item-help"]').click({ force: true })
  } else {
    const overflowBtn = page
      .locator(
        `[data-testid="${menubarTestId}-overflow-button"], [data-testid="${menubarTestId}-hamburger-button"]`
      )
      .first()
    await overflowBtn.click({ force: true })
    const helpEntry = page.locator('[data-testid="titlebar-menubar-item-help-overflow"]')
    await helpEntry.waitFor({ state: 'visible', timeout: MENU_TIMEOUT })
    await helpEntry.hover()
    await helpEntry.click({ force: true })
  }
  await item.waitFor({ state: 'visible', timeout: MENU_TIMEOUT })
  await item.click({ force: true })
})

Then('the "up to date" update notification appears', async ({ page }) => {
  // The mock reports no update on a manual check → the "you're up to date" toast
  // (matched by its stable data-toast-title substring).
  const toast = page.locator('[data-toast-title*="up to date" i]')
  await expect(toast).toBeVisible({ timeout: 10000 })
})
