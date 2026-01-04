import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/import.fixture'
import * as path from 'path'

const { Given, When, Then } = createBdd(test)

// Helper to get absolute path to test file
function getTestFilePath(filename: string): string {
  return path.resolve(__dirname, `../../../../unit/${filename}`)
}

Given('I have started the application', async ({ page }) => {
  // Application should already be running via fixture
  await page.waitForSelector('[role="menubar"]', { timeout: 10000 })
})

Given('I have created a new empty file', async ({ page }) => {
  // Mock the save dialog to respond "No"
  await page.evaluate(() => {
    if (window.electron?.dialog) {
      // @ts-expect-error - Mocking dialog for tests
      window.electron.dialog.showSaveDialog = async () => ({
        canceled: true
      })
    }
  })
  
  // Click File menu
  const fileMenu = page.locator('[role="menubar"] >> text=File').first()
  await fileMenu.click()
  
  // Click New
  const newMenuItem = page.locator('[role="menuitem"] >> text=New').first()
  await newMenuItem.click()
  
  // Wait for empty file to be created
  await page.waitForSelector('[role="tree"]', { timeout: 5000 })
})

When('I click the import button', async ({ page }) => {
  const importButton = page.locator('button:has(i.codicon-add)').first()
  await importButton.click()
  await page.waitForSelector('[data-testid="import-modal"]', { timeout: 5000 })
})

When('I click the import button again', async ({ page }) => {
  const importButton = page.locator('button:has(i.codicon-add)').first()
  await importButton.click()
  await page.waitForSelector('[data-testid="import-modal"]', { timeout: 5000 })
})

Then('the import modal should be open', async ({ page }) => {
  const modal = page.locator('[data-testid="import-modal"]')
  await expect(modal).toBeVisible()
})

Then('the import modal should be closed', async ({ page }) => {
  const modal = page.locator('[data-testid="import-modal"]')
  await expect(modal).not.toBeVisible({ timeout: 5000 })
})

When('I paste {string} in the source input', async ({ page }, input: string) => {
  const inputBox = page.locator('[data-testid="import-modal"] textarea, [data-testid="import-modal"] input[type="text"]').first()
  await inputBox.fill(input)
  // Wait for debounce and preview to load
  await page.waitForTimeout(500)
})

When('I paste the path to {string} in the source input', async ({ page }, filename: string) => {
  const filePath = getTestFilePath(filename)
  const inputBox = page.locator('[data-testid="import-modal"] textarea, [data-testid="import-modal"] input[type="text"]').first()
  await inputBox.fill(filePath)
  // Wait for debounce and preview to load
  await page.waitForTimeout(500)
})

When('I clear the source input', async ({ page }) => {
  const inputBox = page.locator('[data-testid="import-modal"] textarea, [data-testid="import-modal"] input[type="text"]').first()
  await inputBox.fill('')
  // Wait for preview to clear
  await page.waitForTimeout(300)
})

Then('I should see import preview results', async ({ page }) => {
  // Wait for preview section to be visible with items
  const previewSection = page.locator('[data-testid="import-modal"] .import-preview-section')
  await expect(previewSection).toBeVisible({ timeout: 5000 })
  
  // Verify there are items in the preview
  const previewItems = page.locator('[data-testid="import-modal"] .import-preview [role="treeitem"]')
  const count = await previewItems.count()
  expect(count).toBeGreaterThan(0)
})

Then('I should not see import preview results', async ({ page }) => {
  // Preview section should either not be visible or have no items
  const previewSection = page.locator('[data-testid="import-modal"] .import-preview-section')
  const isVisible = await previewSection.isVisible().catch(() => false)
  
  if (isVisible) {
    const previewItems = page.locator('[data-testid="import-modal"] .import-preview [role="treeitem"]')
    const count = await previewItems.count()
    expect(count).toBe(0)
  }
})

When('I click the Import button in the modal', async ({ page }) => {
  const importButton = page.locator('[data-testid="import-modal"] button:has-text("Import")').first()
  await importButton.click()
  // Wait for modal to close
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="import-modal"]'),
    { timeout: 5000 }
  )
})

Then('I should see new items in the sidebar', async ({ page }) => {
  // Wait for sidebar to update
  await page.waitForTimeout(500)
  
  const treeItems = page.locator('[role="tree"] [role="treeitem"]')
  const count = await treeItems.count()
  expect(count).toBeGreaterThan(0)
})

When('I open the search bar', async ({ page }) => {
  const searchBar = page.locator('.search-bar-closed, .search-bar-container, [data-testid="search-bar"]').first()
  await expect(searchBar).toBeVisible({ timeout: 5000 })
  await searchBar.click()
  // Wait for search input to appear
  await page.waitForSelector('.search-bar-open input', { timeout: 3000 })
})

When('I search for {string}', async ({ page }, query: string) => {
  const searchInput = page.locator('.search-bar-input input, input.search-bar-input, .search-bar-open input').first()
  await expect(searchInput).toBeVisible({ timeout: 2000 })
  await searchInput.fill('')
  await searchInput.fill(query)
  // Wait for search results to appear
  await page.waitForSelector('[data-testid="search-results"][data-ready="true"], .search-result-item, .search-results-empty', { timeout: 5000 })
})

Then('I should see search results', async ({ page }) => {
  const searchResults = page.locator('.search-result-item')
  await page.waitForSelector('.search-result-item', { timeout: 5000, state: 'visible' })
  const resultCount = await searchResults.count()
  expect(resultCount).toBeGreaterThan(0)
})

Then('the first result should contain {string}', async ({ page }, text: string) => {
  const searchResults = page.locator('.search-result-item')
  const firstResult = searchResults.first()
  const resultText = await firstResult.textContent()
  expect(resultText?.toLowerCase()).toContain(text.toLowerCase())
})

When('I click on the first search result', async ({ page }) => {
  await page.waitForSelector('.search-result-item', { timeout: 5000, state: 'visible' })
  const firstResult = page.locator('.search-result-item').first()
  await firstResult.click()
  // Wait for tab to open
  await page.waitForSelector('.tab.active, [role="tab"]', { timeout: 5000 })
})

Then('a tab containing {string} should be open', async ({ page }, tabText: string) => {
  const tabs = page.locator('.ecui-tabs-tab, [role="tab"]')
  const tabCount = await tabs.count()
  expect(tabCount).toBeGreaterThan(0)

  let foundTab = false
  for (let i = 0; i < tabCount; i++) {
    const text = await tabs.nth(i).textContent()
    if (text?.toLowerCase().includes(tabText.toLowerCase())) {
      foundTab = true
      break
    }
  }
  expect(foundTab).toBe(true)
})

Then('the destination dropdown should show the root node', async ({ page }) => {
  // Click on the dropdown button to open it
  const dropdownButton = page.locator('[data-testid="import-modal"] button:has(i.codicon-folder)').first()
  await dropdownButton.click()
  
  // Wait for dropdown to appear
  await page.waitForTimeout(300)
  
  // Check for root node - it should be visible and have the label "<Root>" or "<Racine>"
  const rootNode = page.locator('[role="treeitem"]:has-text("<Root>"), [role="treeitem"]:has-text("<Racine>")').first()
  await expect(rootNode).toBeVisible({ timeout: 3000 })
  
  // Close dropdown
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
})

Then('the destination dropdown should show all imported folders', async ({ page }) => {
  // Click on the dropdown button to open it
  const dropdownButton = page.locator('[data-testid="import-modal"] button:has(i.codicon-folder)').first()
  await dropdownButton.click()
  
  // Wait for dropdown to appear
  await page.waitForTimeout(300)
  
  // Expand the root node if it's not already expanded
  const rootNode = page.locator('[role="treeitem"]:has-text("<Root>"), [role="treeitem"]:has-text("<Racine>")').first()
  const chevron = rootNode.locator('.codicon-chevron-right, .codicon-chevron-down').first()
  const isExpanded = await chevron.evaluate((el) => el.classList.contains('codicon-chevron-down'))
  
  if (!isExpanded) {
    await chevron.click()
    await page.waitForTimeout(300)
  }
  
  // Check that we have folder items visible (the imported Swagger Petstore folder structure)
  // We should see at least "pet", "store", and "user" folders
  const treeItems = page.locator('[role="treeitem"]')
  const itemCount = await treeItems.count()
  
  // Should have more than just the root node
  expect(itemCount).toBeGreaterThan(1)
  
  // Check for specific folder names that should be present from Swagger Petstore
  const folderNames = ['pet', 'store', 'user']
  for (const folderName of folderNames) {
    const folderItem = page.locator(`[role="treeitem"]:has-text("${folderName}")`).first()
    const isVisible = await folderItem.isVisible().catch(() => false)
    
    // If not immediately visible, it might be in a subfolder
    if (!isVisible) {
      // Try to find it in the tree structure (case insensitive)
      const allItems = await treeItems.allTextContents()
      const hasFolder = allItems.some(text => text.toLowerCase().includes(folderName.toLowerCase()))
      expect(hasFolder).toBe(true)
    }
  }
  
  // Close dropdown
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
})
