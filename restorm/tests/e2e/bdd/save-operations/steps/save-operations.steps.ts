import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/save-operations.fixture'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const { Given, When, Then } = createBdd(test)

/**
 * Recursively get the structure of a directory as an array of relative paths
 */
function getDirectoryStructure(dirPath: string, basePath?: string): string[] {
  const base = basePath ?? dirPath
  const entries: string[] = []

  if (!existsSync(dirPath)) {
    return entries
  }

  const items = readdirSync(dirPath).sort()

  for (const item of items) {
    const fullPath = join(dirPath, item)
    const relativePath = fullPath.substring(base.length + 1)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      entries.push(relativePath + '/')
      entries.push(...getDirectoryStructure(fullPath, base))
    } else {
      entries.push(relativePath)
    }
  }

  return entries
}

/**
 * Compare two directory structures
 */
function compareDirectoryStructures(actual: string[], expected: string[]): { match: boolean; missing: string[]; extra: string[] } {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)

  const missing = expected.filter(e => !actualSet.has(e))
  const extra = actual.filter(a => !expectedSet.has(a))

  return {
    match: missing.length === 0 && extra.length === 0,
    missing,
    extra
  }
}

Given('the file is loaded', async ({ page }) => {
  await expect(page.locator('text=Swagger Petstore').first()).toBeVisible({ timeout: 15000 })
})

When('I open the File menu', async ({ page }) => {
  const fileMenu = page.locator('text=File').first()
  await fileMenu.click()
  // Wait for menu to appear
  await page.waitForSelector('[role="menuitem"]', { timeout: 3000 })
})

When('I click on {string}', async ({ page }, text: string) => {
  const item = page.locator(`text=${text}`).first()
  await item.click()
  // Wait for modal if "Save As" clicked
  if (text.includes('Save')) {
    await page.waitForSelector('[data-testid="modal"][data-ready="true"]', { timeout: 5000 }).catch(() => { /* modal may not open */ })
  }
})

Then('the save options modal should be open', async ({ page }) => {
  await page.waitForSelector('[data-testid="save-options-modal"]', { timeout: 5000 })
})

When('I select Folder mode', async ({ page }) => {
  const folderModeButton = page.locator('[data-testid="save-mode-folder"]')
  await folderModeButton.click()
})

When('I select YAML format', async ({ page }) => {
  const yamlFormatButton = page.locator('[data-testid="save-format-yaml"]')
  await yamlFormatButton.click()
})

When('I click the Save button', async ({ page }) => {
  const saveBtn = page.locator('[data-testid="save-confirm-button"]').first()
  await expect(saveBtn).toBeVisible({ timeout: 5000 })
  await saveBtn.click()
  // Wait for modal to close and file system operation to complete
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="modal"]').length === 0,
    { timeout: 10000 }
  )
  await page.screenshot({ path: 'test-results/debug-after-save-as.png' })
})

Then('the folder structure should match the reference', async ({ tempFolderPath, referenceFolderPath }) => {
  const actualStructure = getDirectoryStructure(tempFolderPath)
  const expectedStructure = getDirectoryStructure(referenceFolderPath)

  const comparison = compareDirectoryStructures(actualStructure, expectedStructure)

  if (!comparison.match) {
    console.log('Missing files:', comparison.missing)
    console.log('Extra files:', comparison.extra)
  }

  expect(comparison.match).toBe(true)
})

When('I enable confirmation dialog auto-confirm', async ({ electronApp }) => {
  await electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({
      response: 0,
      checkboxChecked: false
    })
  })
})

When('I expand {string} in sidebar', async ({ page }, folderName: string) => {
  // Use text matching to find exact text or text at start of item
  const folder = page.locator(`[role="treeitem"]`).filter({ hasText: new RegExp(`^${folderName}$|^${folderName}\\s`) }).first()
  await expect(folder).toBeVisible({ timeout: 5000 })

  // Click on expander if collapsed
  const chevronRight = folder.locator('.codicon-chevron-right').first()
  if (await chevronRight.isVisible({ timeout: 1000 }).catch(() => false)) {
    await folder.locator('.list-view-expander').click()
    // Wait for children to appear
    await page.waitForSelector(`[role="treeitem"]:has-text("${folderName}")`, { timeout: 5000 }).catch(() => { /* expansion may fail silently */ })
  }
  await page.screenshot({ path: `test-results/debug-after-expand-${folderName.replace(/\s/g, '-')}.png` })
})

When('I right-click on {string} in sidebar', async ({ page }, itemName: string) => {
  const item = page.locator(`[role="treeitem"]:has-text("${itemName}")`).first()
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click({ button: 'right' })
  // Wait for context menu to appear
  await page.waitForSelector('[role="menuitem"]', { timeout: 3000 })
})

When('I click {string} in context menu', async ({ page }, text: string) => {
  await page.screenshot({ path: `test-results/debug-before-click-${text.replace(/\s/g, '-')}.png` })
  const menuItem = page.locator(`[role="menuitem"]:has-text("${text}")`).first()
  await expect(menuItem).toBeVisible({ timeout: 5000 })
  await menuItem.click()
  // Wait for context menu to close
  await page.waitForFunction(
    () => document.querySelectorAll('[role="menu"]').length === 0,
    { timeout: 3000 }
  ).catch(() => { /* menu may close async */ })
  await page.screenshot({ path: `test-results/debug-after-click-${text.replace(/\s/g, '-')}.png` })
})

When('I confirm the deletion', async ({ page }) => {
  await page.screenshot({ path: 'test-results/debug-confirm-deletion-modal.png' })
  const confirmButton = page.locator('[role="button"]:has-text("Delete"), [role="button"]:has-text("Supprimer")').last()
  await expect(confirmButton).toBeVisible({ timeout: 5000 })
  await confirmButton.click()
  // Wait for modal to close
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="modal"]').length === 0,
    { timeout: 10000 }
  ).catch(() => { /* modal may close async */ })
  await page.screenshot({ path: 'test-results/debug-after-confirm-deletion.png' })
})

When('I confirm the deletion in modal', async ({ page }) => {
  const confirmButton = page.locator('.ecu-modal-body [role="button"]:has-text("Delete")').first()
  await confirmButton.click()
  // Wait for modal to close
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="modal"]').length === 0,
    { timeout: 5000 }
  ).catch(() => { /* modal may close async */ })
})

When('I click on {string} in sidebar', async ({ page }, itemName: string) => {
  const item = page.locator(`[role="treeitem"]:has-text("${itemName}")`).first()
  await expect(item).toBeVisible({ timeout: 10000 })
  await item.click()
  // Wait for tab to open
  await page.waitForSelector('.tab.active', { timeout: 5000 })
})

When('I click on the breadcrumb name', async ({ page }) => {
  await page.keyboard.press('Escape')
  const visibleBreadcrumbItem = page.locator('button[aria-current="page"]:visible').first()
  await expect(visibleBreadcrumbItem).toBeVisible({ timeout: 3000 })
  await visibleBreadcrumbItem.click()
  // Wait for input to appear
  await page.waitForSelector('.ecui-breadcrumb-input:visible', { timeout: 3000 })
})

When('I rename it to {string}', async ({ page }, newName: string) => {
  const breadcrumbInput = page.locator('.ecui-breadcrumb-input:visible')
  await breadcrumbInput.fill(newName)
  await page.keyboard.press('Enter')
  // Wait for rename to complete (input disappears)
  await page.waitForFunction(
    () => document.querySelectorAll('.ecui-breadcrumb-input:not([style*="display: none"])').length === 0,
    { timeout: 5000 }
  ).catch(() => { /* input may hide async */ })
})

Then('the tab should contain {string}', async ({ page }, text: string) => {
  const tabs = page.locator('[role="tab"]')
  await expect(tabs.first()).toBeVisible({ timeout: 5000 })
  const tabCount = await tabs.count()

  let found = false
  for (let i = 0; i < tabCount; i++) {
    const tabText = await tabs.nth(i).textContent()
    if (tabText?.includes(text)) {
      found = true
      break
    }
  }
  expect(found).toBe(true)
})

When('I press Ctrl+S', async ({ page }) => {
  await page.keyboard.press('Control+s')
  // Wait for save to complete (dirty indicator should disappear)
  await page.waitForFunction(
    () => {
      const indicator = document.querySelector('.dirty-indicator')
      return !indicator || window.getComputedStyle(indicator).display === 'none'
    },
    { timeout: 10000 }
  ).catch(() => { /* save may take time */ })
})

Then('the final folder structure should match the second reference', async ({ tempFolderPath, referenceFolder2Path }) => {
  const finalStructure = getDirectoryStructure(tempFolderPath)
  const expectedStructure = getDirectoryStructure(referenceFolder2Path)

  const comparison = compareDirectoryStructures(finalStructure, expectedStructure)

  if (!comparison.match) {
    console.log('Missing files:', comparison.missing)
    console.log('Extra files:', comparison.extra)
  }

  expect(comparison.match).toBe(true)
})
