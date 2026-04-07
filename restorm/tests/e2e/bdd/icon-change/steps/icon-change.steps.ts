import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'
import {
  listViewRowSelectorByTitle
} from 'electron-core-ui/testing'

const { Given, When, Then } = createBdd(test)

Given('the file is loaded', async ({ page }) => {
  await expect(
    page.locator(listViewRowSelectorByTitle('sidebar-listview', 'Swagger Petstore')).first()
  ).toBeVisible({ timeout: 15000 })
})

Given('the title does not contain {string}', async ({ page }, text: string) => {
  const title = await page.title()
  expect(title).not.toContain(text)
})

When('I click on {string} folder in the sidebar', async ({ page }, folderName: string) => {
  const folder = page.locator(listViewRowSelectorByTitle('sidebar-listview', folderName)).first()
  await expect(folder).toBeVisible({ timeout: 5000 })
  await folder.dblclick()
  await page.waitForSelector('[role="tab"]', { timeout: 15000 })
})

Then('a tab should be open for the folder', async ({ page }) => {
  const tab = page.locator('[role="tab"]').first()
  await expect(tab).toBeVisible({ timeout: 5000 })
})

Then('the tab should not have a dirty indicator', async ({ page }) => {
  const tab = page.locator('[role="tab"]').first()
  const dirtyIndicator = tab.locator('.dirty-indicator')
  await expect(dirtyIndicator).not.toBeVisible()
})

Then('the tab should have a dirty indicator', async ({ page }) => {
  const tab = page.locator('[role="tab"]').first()
  const dirtyIndicator = tab.locator('.dirty-indicator')
  await expect(dirtyIndicator).toBeVisible({ timeout: 5000 })
})

When('I open the breadcrumb icon select', async ({ page }) => {
  const iconSelectTrigger = page.locator('.ecui-breadcrumb-icon-select [role="button"]').first()
  await expect(iconSelectTrigger).toBeVisible({ timeout: 5000 })
  await iconSelectTrigger.click()
  await page.waitForSelector('.ecui-icon-select-picker', { timeout: 5000 })
})

When('I select the codicon tab in the icon picker', async ({ page }) => {
  const codiconTab = page.locator('.ecui-icon-select-tabs [role="button"]').nth(1)
  await codiconTab.click()
  await page.waitForTimeout(200)
})

When('I search for {string} in the icon picker', async ({ page }, query: string) => {
  const searchInput = page.locator('.ecui-icon-select-picker input').first()
  await expect(searchInput).toBeVisible({ timeout: 5000 })
  await searchInput.click()
  await searchInput.fill(query)
  await page.waitForTimeout(500)
})

When('I select the first codicon result', async ({ page }) => {
  const firstIcon = page.locator('[data-icon-type="codicon"][data-icon-name]').first()
  await expect(firstIcon).toBeVisible({ timeout: 5000 })
  await firstIcon.click()
  await page.waitForTimeout(500)
})

Then('the breadcrumb icon should be {string}', async ({ page }, iconName: string) => {
  const icon = page.locator(`.ecui-breadcrumb .codicon-${iconName}`).first()
  await expect(icon).toBeVisible({ timeout: 5000 })
})

Then('the sidebar item {string} icon should be {string}', async ({ page }, itemName: string, iconName: string) => {
  const sidebarRow = page.locator(listViewRowSelectorByTitle('sidebar-listview', itemName)).first()
  await expect(sidebarRow).toBeVisible({ timeout: 5000 })
  const icon = sidebarRow.locator(`.codicon-${iconName}`)
  await expect(icon).toBeVisible({ timeout: 5000 })
})

Then('the active tab should contain icon {string}', async ({ page }, iconName: string) => {
  // The active tab should contain an IconView with the specified codicon
  const activeTab = page.locator('[role="tab"][aria-selected="true"]').first()
  await expect(activeTab).toBeVisible({ timeout: 5000 })
  const icon = activeTab.locator(`.codicon-${iconName}`)
  await expect(icon).toBeVisible({ timeout: 10000 })
})

Then('the title should contain {string}', async ({ page }, text: string) => {
  await page.waitForFunction(
    (t: string) => document.title.includes(t),
    text,
    { timeout: 10000 }
  )
})

When('I rename {string} to {string} in the sidebar', async ({ page }, oldName: string, newName: string) => {
  const row = page.locator(listViewRowSelectorByTitle('sidebar-listview', oldName)).first()
  await expect(row).toBeVisible({ timeout: 5000 })
  // Double-click to select, then F2 to rename
  await row.click()
  await page.keyboard.press('F2')
  // Wait for the rename input to appear
  const input = page.locator('[data-testid="sidebar-listview"] input[type="text"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(newName)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
})

Then('the breadcrumb should show {string}', async ({ page }, text: string) => {
  const breadcrumbLink = page.locator('.ecui-breadcrumb-link--current, .ecui-breadcrumb-link--editable')
  await expect(breadcrumbLink).toContainText(text, { timeout: 5000 })
})

When('I right-click on the sidebar empty area', async ({ page }) => {
  // Scroll the sidebar list to the bottom, then right-click below the last item
  const listView = page.locator('[data-testid="sidebar-listview"]').first()
  await expect(listView).toBeVisible({ timeout: 5000 })

  // Scroll the list view to the bottom
  const scrollable = listView.locator('.scrollable-content').first()
  await scrollable.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(200)

  // Get the last row's bounding box, then click below it
  const rows = listView.locator('.list-view-row')
  const lastRow = rows.last()
  const lastRowBox = await lastRow.boundingBox()
  const listViewBox = await listView.boundingBox()
  if (!lastRowBox || !listViewBox) throw new Error('Could not get bounding boxes')

  // Click below the last row but within the list view area
  const clickY = Math.min(lastRowBox.y + lastRowBox.height + 10, listViewBox.y + listViewBox.height - 2)
  await page.mouse.click(listViewBox.x + listViewBox.width / 2, clickY, { button: 'right' })
  await page.waitForTimeout(200)
})

When('I click {string} in the context menu', async ({ page }, menuItemId: string) => {
  // Menu items have id={menuItemId} on the <a> element with role="menuitem"
  const menuItem = page.locator(`#${menuItemId}[role="menuitem"]`).first()
  await expect(menuItem).toBeVisible({ timeout: 3000 })
  await menuItem.click()
  await page.waitForTimeout(300)
})

When('I right-click on {string} in the sidebar', async ({ page }, itemName: string) => {
  const row = page.locator(listViewRowSelectorByTitle('sidebar-listview', itemName)).first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click({ button: 'right' })
  await page.waitForTimeout(200)
})

When('I confirm the default name', async ({ page }) => {
  // Press Enter to confirm the current editing value
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
})

When('I confirm the delete dialog', async ({ page }) => {
  // Click the confirm/delete button in the confirmation dialog
  const confirmBtn = page.locator('.modal button, [role="dialog"] button').filter({ hasText: /Delete|Supprimer/ }).first()
  await expect(confirmBtn).toBeVisible({ timeout: 5000 })
  await confirmBtn.click()
  await page.waitForTimeout(300)
})

Then('the sidebar item {string} should not be visible', async ({ page }, itemName: string) => {
  const row = page.locator(listViewRowSelectorByTitle('sidebar-listview', itemName)).first()
  await expect(row).not.toBeVisible({ timeout: 5000 })
})

Then('the sidebar item {string} should be visible', async ({ page }, itemName: string) => {
  const row = page.locator(listViewRowSelectorByTitle('sidebar-listview', itemName)).first()
  await expect(row).toBeVisible({ timeout: 5000 })
})

Then('the color picker button should be visible in the variables table', async ({ page }) => {
  // The color cell renders a Button with ariaLabel 'Open color picker'
  const colorButton = page.locator('[data-testid="environment-folder-variables-table"] [aria-label="Open color picker"]').first()
  await expect(colorButton).toBeVisible({ timeout: 5000 })
})

When('I click on the {string} environment', async ({ page }, envName: string) => {
  const envItem = page.locator(listViewRowSelectorByTitle('environment-folder-environment-list', envName)).first()
  await expect(envItem).toBeVisible({ timeout: 5000 })
  await envItem.click()
  await page.waitForTimeout(300)
})
