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

Then('the "up to date" update notification appears', async ({ page }) => {
  // The mock reports no update on a manual check → the "you're up to date" toast
  // (matched by its stable data-toast-title substring).
  const toast = page.locator('[data-toast-title*="up to date" i]')
  await expect(toast).toBeVisible({ timeout: 10000 })
})
