import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/user-preferences.fixture'
import { defineSystemModalsBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { configureNextOpenDialogForE2E } from 'electron-core-ui/testing'

const bdd = createBdd(test)
const { Given, When, Then } = bdd

defineSystemModalsBddSteps(bdd)

Given('the welcome screen should be visible', async ({ page }) => {
  await expect(page.locator('.welcome-container')).toBeVisible({ timeout: 15000 })
})

Given('recent files and favorites should be empty', async ({ page }) => {
  // No list items when both lists are empty
  await expect(page.locator('.welcome-file-item')).toHaveCount(0)
  // Empty-state hint is shown when there is no content
  await expect(page.locator('.welcome-hint')).toBeVisible()
})

Given('I configure the open file dialog to return the sample file path', async ({ electronApp, sampleFilePath }) => {
  await configureNextOpenDialogForE2E(electronApp, { kind: 'openFile', path: sampleFilePath })
})

When('I request opening a file', async ({ page }) => {
  const fileMenu = page.locator('[role="menubar"] >> text=File').first()
  await expect(fileMenu).toBeVisible({ timeout: 5000 })
  await fileMenu.click()

  await page.waitForSelector('[role="menu"]', { timeout: 2000 })

  const openMenuItem = page.locator('[role="menuitem"] >> text=Open').first()
  await expect(openMenuItem).toBeVisible({ timeout: 5000 })
  await openMenuItem.click()
})

Then('the file should be loaded', async ({ page }) => {
  await expect(page.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 15000 })
})

Then('the sidebar should contain items', async ({ page }) => {
  const items = page.locator('[role="treeitem"]')
  await expect(items.first()).toBeVisible({ timeout: 15000 })
  const count = await items.count()
  expect(count).toBeGreaterThan(0)
})

When('I click on the first sidebar item', async ({ page }) => {
  const first = page.locator('[role="treeitem"]').first()
  await expect(first).toBeVisible({ timeout: 5000 })
  await first.click()
})

Then('the workbench should contain an open tab', async ({ page }) => {
  // Workbench tabs are rendered with role="tab"
  await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 })
})

When('I close the file', async ({ page }) => {
  const fileMenu = page.locator('[role="menubar"] >> text=File').first()
  await expect(fileMenu).toBeVisible({ timeout: 5000 })
  await fileMenu.click()

  await page.waitForSelector('[role="menu"]', { timeout: 2000 })

  const closeMenuItem = page.locator('[role="menuitem"] >> text=Close').first()
  await expect(closeMenuItem).toBeVisible({ timeout: 5000 })
  await closeMenuItem.click()
})

Then('the recent files list should contain the sample file', async ({ page, sampleFilePath }) => {
  const fileName = sampleFilePath.split('/').pop() ?? ''
  const recentItem = page.locator('.welcome-file-item:has([data-testid="toggle-favorite-button"])').filter({ hasText: fileName }).first()
  await expect(recentItem).toBeVisible({ timeout: 15000 })
})

Then('the favorites list should be empty', async ({ page }) => {
  await expect(page.locator('[data-testid="remove-favorite-button"]')).toHaveCount(0)
})

When('I favorite the recent file', async ({ page }) => {
  const toggle = page.locator('[data-testid="toggle-favorite-button"]').first()
  await expect(toggle).toBeVisible({ timeout: 15000 })
  await toggle.click()
})

Then('the favorites list should contain the sample file', async ({ page, sampleFilePath }) => {
  const fileName = sampleFilePath.split('/').pop() ?? ''
  const favoriteItem = page.locator('.welcome-file-item:has([data-testid="remove-favorite-button"])').filter({ hasText: fileName }).first()
  await expect(favoriteItem).toBeVisible({ timeout: 15000 })
})

When('I remove the file from favorites', async ({ page }) => {
  page.once('dialog', (dialog) => {
    void dialog.accept()
  })
  const removeBtn = page.locator('[data-testid="remove-favorite-button"]').first()
  await expect(removeBtn).toBeVisible({ timeout: 15000 })
  await removeBtn.click()
})

When('I open the recent file', async ({ page, sampleFilePath }) => {
  const fileName = sampleFilePath.split('/').pop() ?? ''
  const recentItem = page.locator('.welcome-file-item', { hasText: fileName }).first()
  await expect(recentItem).toBeVisible({ timeout: 15000 })
  await recentItem.click()
})
