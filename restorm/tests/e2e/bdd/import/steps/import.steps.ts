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
  // Wait for app to be fully loaded
  await page.waitForSelector('[role="menubar"]', { timeout: 15000 })
  
  // Mock the save dialog to respond with a temp file path
  await page.evaluate(() => {
    // @ts-expect-error - Mocking electron dialog for tests
    if (window.electron?.dialog) {
      // @ts-expect-error - Mocking electron dialog for tests
      window.electron.dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: '/tmp/import-test-temp.restorm'
      })
    }
  })
  
  // Click File menu
  const fileMenu = page.locator('[role="menubar"] >> text=File').first()
  await expect(fileMenu).toBeVisible({ timeout: 5000 })
  await fileMenu.click()
  
  // Wait for menu to expand
  await page.waitForSelector('[role="menu"]', { timeout: 2000 })
  
  // Click New
  const newMenuItem = page.locator('[role="menuitem"] >> text=New').first()
  await expect(newMenuItem).toBeVisible({ timeout: 5000 })
  await newMenuItem.click()
  
  // Wait for the workspace to be visible (file is open)
  await page.waitForSelector('text=WORKSPACE', { timeout: 15000 })
})

When('I click the import button', async ({ page }) => {
  // Use Ctrl+I to open the import modal
  await page.keyboard.press('Control+I')
  await page.waitForSelector('[data-testid="import-modal"]', { timeout: 5000 })
})

When('I click the import button again', async ({ page }) => {
  // Use Ctrl+I to open the import modal
  await page.keyboard.press('Control+I')
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
  await page.waitForSelector('[data-testid="import-modal"] .import-preview-section, [data-testid="import-modal"] .import-error', { timeout: 3000 })
})

When('I paste the path to {string} in the source input', async ({ page }, filename: string) => {
  const filePath = getTestFilePath(filename)
  const inputBox = page.locator('[data-testid="import-modal"] textarea, [data-testid="import-modal"] input[type="text"]').first()
  await inputBox.fill(filePath)
  // Wait for debounce and preview to load
  await page.waitForSelector('[data-testid="import-modal"] .import-preview-section, [data-testid="import-modal"] .import-error', { timeout: 3000 })
})

When('I clear the source input', async ({ page }) => {
  const inputBox = page.locator('[data-testid="import-modal"] textarea, [data-testid="import-modal"] input[type="text"]').first()
  await inputBox.fill('')
  // Wait for debounce to complete and preview to clear
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="import-modal"] .import-preview-section'),
    { timeout: 2000 }
  ).catch(() => {
    // Preview may already be hidden, which is fine
  })
  // Wait an additional 300ms for the debounce timer to fully reset
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
  // Wait for the Import button to be enabled (aria-disabled="false")
  // Button component renders as <a role="button">
  const importButton = page.locator('[data-testid="import-modal"] [role="button"]:has-text("Import")[aria-disabled="false"]')
  await expect(importButton).toBeVisible({ timeout: 15000 })

  await importButton.click()

  // Wait for modal to close
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="import-modal"]'),
    { timeout: 5000 }
  )
})

Then('I should see new items in the sidebar', async ({ page }) => {
  const treeItems = page.locator('[role="tree"] [role="treeitem"]')
  await expect(treeItems.first()).toBeVisible({ timeout: 5000 })
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
  const dropdownButton = page.locator('[data-testid="destination-dropdown-button"]')
  await dropdownButton.click()
  
  // Check for root node - it should be visible and have the label "<Root>" or "<Racine>"
  const rootNode = page.locator('[role="treeitem"]:has-text("<Root>"), [role="treeitem"]:has-text("<Racine>")').first()
  await expect(rootNode).toBeVisible({ timeout: 3000 })
  
  // Close dropdown
  await page.keyboard.press('Escape')
})

Then('the destination dropdown should show all imported folders', async ({ page }) => {
  // Click on the dropdown button to open it
  const dropdownButton = page.locator('[data-testid="destination-dropdown-button"]')
  await dropdownButton.click()
  
  // Expand the root node if it's not already expanded
  const rootNode = page.locator('[role="treeitem"]:has-text("<Root>"), [role="treeitem"]:has-text("<Racine>")').first()
  const chevron = rootNode.locator('.codicon-chevron-right, .codicon-chevron-down').first()
  const isExpanded = await chevron.evaluate((el) => el.classList.contains('codicon-chevron-down'))
  
  if (!isExpanded) {
    await chevron.click()
  }
  
  // Check that we have folder items visible (the imported Swagger Petstore folder structure)
  // We should see at least "pet", "store", and "user" folders
  const treeItems = page.locator('[role="treeitem"]')
  await expect(treeItems.first()).toBeVisible({ timeout: 3000 })
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
})

When('I expand the {string} folder', async ({ page }, folderName: string) => {
  // Be ultra-specific: find the treeitem whose .list-view-title is EXACTLY the folder name
  const folderRow = page.locator('[role="tree"] [role="treeitem"]').filter({
    has: page.locator(`.list-view-title:text-is("${folderName}")`)
  }).first()
  await expect(folderRow).toBeVisible({ timeout: 10000 })
  
  const chevronRight = folderRow.locator('.codicon-chevron-right').first()
  const hasChevronRight = await chevronRight.count() > 0
  
  if (hasChevronRight) {
    await chevronRight.click()
    // Wait a bit for the expansion animation
    await page.waitForTimeout(300)
  }
})

When('I click on the {string} request', async ({ page }, requestName: string) => {
  // Find the treeitem that contains the exact request name in its .list-view-title
  // The title may contain badges, so we search for text that matches anywhere within .list-view-title
  const requestItem = page.locator(`[role="treeitem"]`).filter({ 
    has: page.locator(`.list-view-title`).filter({ hasText: requestName })
  }).first()
  
  await expect(requestItem).toBeVisible({ timeout: 10000 })
  await requestItem.click()
  await page.waitForSelector('.tab.active', { timeout: 5000 })
})

Then('the request tab should be open', async ({ page }) => {
  await page.waitForSelector('.tab.active', { timeout: 5000 })
  await page.waitForSelector('[data-testid="url-container"]', { timeout: 5000 })
})

When('I change the path param {string} to {string}', async ({ page }, paramName: string, value: string) => {
  const pathParamsPane = page.locator('text=PATH PARAMS').first()
  await expect(pathParamsPane).toBeVisible({ timeout: 5000 })
  
  const paneHeader = pathParamsPane.locator('..').locator('..')
  const isCollapsed = await paneHeader.locator('.pane-collapsed, [aria-expanded="false"]').count() > 0
  if (isCollapsed) {
    await pathParamsPane.click()
  }
  
  const pathParamsSection = page.locator('.params-table-root').first()
  await expect(pathParamsSection).toBeVisible({ timeout: 5000 })
  
  await page.waitForFunction(
    () => {
      const section = document.querySelector('.params-table-root')
      const text = section?.textContent ?? ''
      return section && !text.includes('Loading')
    },
    { timeout: 10000 }
  )
  
  const monacoEditors = pathParamsSection.locator('.monaco-editor')
  const editorCount = await monacoEditors.count()
  
  let targetEditor
  for (let i = 0; i < editorCount; i++) {
    const editor = monacoEditors.nth(i)
    const isVisible = await editor.isVisible()
    if (isVisible) {
      targetEditor = editor
      break
    }
  }
  
  if (!targetEditor) {
    throw new Error(`Could not find editor for path param "${paramName}"`)
  }
  
  await targetEditor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(value)
  await page.locator('.params-table th').first().click()
})

When('I select the environment {string} in the environment dropdown', async ({ page }, environmentName: string) => {
  const envDropdown = page.locator('[data-testid="environment-dropdown"], .environment-selector').first()
  await expect(envDropdown).toBeVisible({ timeout: 5000 })
  await envDropdown.click()
  
  const envOption = page.locator(`text="${environmentName}"`).first()
  await expect(envOption).toBeVisible({ timeout: 5000 })
  await envOption.click()
})

Then('the URL tooltip should be {string}', async ({ page }, expectedUrl: string) => {
  await page.waitForFunction(
    (url: string) => {
      const container = document.querySelector('[data-testid="url-container"]')
      const title = container?.getAttribute('title') ?? ''
      return title === url
    },
    expectedUrl,
    { timeout: 10000 }
  )
  
  const urlContainer = page.locator('[data-testid="url-container"]').first()
  const title = await urlContainer.getAttribute('title')
  expect(title).toBe(expectedUrl)
})

When('I select the root node in the destination dropdown', async ({ page }) => {
  const dropdownButton = page.locator('[data-testid="destination-dropdown-button"]')
  await expect(dropdownButton).toBeVisible({ timeout: 5000 })
  await dropdownButton.click()
  
  const rootNode = page.locator('[role="treeitem"]:has-text("<Root>"), [role="treeitem"]:has-text("<Racine>")').first()
  await expect(rootNode).toBeVisible({ timeout: 3000 })
  await rootNode.click()
})

When('I click the new folder button', async ({ page }) => {
  const newFolderButton = page.locator('[data-testid="new-folder-button"]')
  await expect(newFolderButton).toBeVisible({ timeout: 3000 })
  await newFolderButton.click()
})

When('I enter {string} as the folder name', async ({ page }, folderName: string) => {
  // Wait for the new folder dialog to be visible
  const dialog = page.locator('[data-testid="new-folder-dialog"]')
  await expect(dialog).toBeVisible({ timeout: 5000 })
  
  // Find the textarea/input within the InputBox
  const inputBox = dialog.locator('textarea, input[type="text"]').first()
  await expect(inputBox).toBeVisible({ timeout: 3000 })
  await inputBox.fill(folderName)
})

When('I click OK in the folder name dialog', async ({ page }) => {
  const okButton = page.locator('[data-testid="new-folder-ok-button"]')
  await expect(okButton).toBeVisible({ timeout: 3000 })
  await okButton.click()
  
  // Wait for the folder name dialog to close
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="new-folder-dialog"]'),
    { timeout: 3000 }
  )
  
  // Wait for preview to still be there after creating folder
  await page.waitForSelector('[data-testid="import-modal"] .import-preview-section', { timeout: 5000 })
})

Then('the folder {string} should be visible in the destination dropdown', async ({ page }, folderName: string) => {
  // Open the dropdown first
  const dropdownButton = page.locator('[data-testid="destination-dropdown-button"]')
  await expect(dropdownButton).toBeVisible({ timeout: 3000 })
  await dropdownButton.click()
  
  // Now check for the folder
  const folderItem = page.locator(`[role="treeitem"]:has-text("${folderName}")`).first()
  await expect(folderItem).toBeVisible({ timeout: 3000 })
  
  // Close the dropdown by clicking the button again
  await dropdownButton.click()
})

Then('the folder {string} should be selected', async ({ page }, folderName: string) => {
  // Verify the dropdown button shows the selected folder name
  // The dropdown should already be closed by the previous step
  const dropdown = page.locator('[data-testid="destination-dropdown-button"]')
  await expect(dropdown).toBeVisible()
  
  const buttonText = await dropdown.textContent()
  expect(buttonText).toContain(folderName)
})

Then('the folder {string} should exist in the sidebar', async ({ page }, folderPath: string) => {
  // Handle both simple folder names and paths like "Test/Swagger Petstore"
  if (folderPath.includes('/')) {
    // For paths, just check the last part exists
    const parts = folderPath.split('/')
    const lastName = parts[parts.length - 1]
    const folderItem = page.locator(`[role="tree"] [role="treeitem"]:has-text("${lastName}")`).first()
    await expect(folderItem).toBeVisible({ timeout: 5000 })
  } else {
    const folderItem = page.locator(`[role="tree"] [role="treeitem"]:has-text("${folderPath}")`).first()
    await expect(folderItem).toBeVisible({ timeout: 5000 })
  }
})

When('I expand the {string} folder in the sidebar', async ({ page }, folderName: string) => {
  const folderRow = page.locator(`[role="tree"] [role="treeitem"]:has-text("${folderName}")`).first()
  await expect(folderRow).toBeVisible({ timeout: 5000 })
  
  const chevron = folderRow.locator('.codicon-chevron-right, .codicon-chevron-down').first()
  if (await chevron.count() > 0) {
    await chevron.click()
  } else {
    await folderRow.dblclick()
  }
})

Then('I should see the subfolder {string} in the sidebar', async ({ page }, folderName: string) => {
  const subfolderItem = page.locator(`[role="tree"] [role="treeitem"]:has-text("${folderName}")`).first()
  await expect(subfolderItem).toBeVisible({ timeout: 5000 })
})

When('I wait {int} seconds to see the app state', async ({ page }, seconds: number) => {
  console.log(`[TEST] Waiting ${seconds} seconds to observe app state...`)
  await page.waitForTimeout(seconds * 1000)
  console.log('[TEST] Wait complete')
})
