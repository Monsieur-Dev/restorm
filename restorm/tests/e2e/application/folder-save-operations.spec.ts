import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import { join, resolve } from 'path'
import { existsSync, rmSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'fs'
import electronPath from 'electron'

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

test.describe('Folder Save Operations E2E', () => {
  let electronApp: ElectronApplication
  let page: Page
  const restormRoot = resolve(__dirname, '../../..')
  const petstoreFilePath = join(restormRoot, 'tests/e2e/samples/Petstore.restorm')
  const petstoreOriginalPath = join(restormRoot, 'Samples/Petstore.restorm')
  const tempFolderPath = join(restormRoot, 'tests/e2e/temp-save-test')
  const referenceFolderPath = join(restormRoot, 'tests/e2e/samples/Petstore')
  const referenceFolder2Path = join(restormRoot, 'tests/e2e/samples/Petstore 2')

  test.beforeEach(async () => {
    // Clean up and recreate temp folder for each test run
    if (existsSync(tempFolderPath)) {
      rmSync(tempFolderPath, { recursive: true, force: true })
    }
    mkdirSync(tempFolderPath, { recursive: true })
    
    // Restore the original Petstore.restorm from Samples
    copyFileSync(petstoreOriginalPath, petstoreFilePath)
    
    const electronExePath = electronPath as unknown as string
    const mainJsPath = join(restormRoot, 'dist/main/index.js')

    console.log('Opening file:', petstoreFilePath)
    console.log('Temp folder:', tempFolderPath)

    // Launch Electron app with -o argument pointing to the Petstore.restorm file
    electronApp = await electron.launch({
      executablePath: electronExePath,
      args: ['--no-sandbox', mainJsPath, '-o', petstoreFilePath],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        // Pass the temp folder path for dialog mocking
        E2E_MOCK_SAVE_FOLDER: tempFolderPath
      }
    })

    page = await electronApp.firstWindow()
    
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[Renderer ERROR] ${msg.text()}`)
      }
    })
    
    // Mock only showOpenDialog for folder selection
    // Don't mock showMessageBox yet to avoid unintended saves
    await electronApp.evaluate(({ dialog }, tempPath) => {
      // Mock showOpenDialog to return the temp folder
      dialog.showOpenDialog = () => Promise.resolve({
        canceled: false,
        filePaths: [tempPath]
      })
      
      // Mock showSaveDialog to return the temp folder
      dialog.showSaveDialog = () => Promise.resolve({
        canceled: false,
        filePath: tempPath
      })
    }, tempFolderPath)
    
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('load')
    
    // Wait for file to be loaded
    await page.waitForTimeout(5000)
  })

  test.afterEach(() => {
    try {
      electronApp.close().catch(() => { /* Ignore close errors */ })
    } catch {
      // Ignore close errors
    }
  })

  test.afterAll(() => {
    // Clean up temp folder after all tests
    if (existsSync(tempFolderPath)) {
      rmSync(tempFolderPath, { recursive: true, force: true })
    }
  })

  test('should save as folder, modify, and save again with correct structure', async () => {
    // Step 1: Verify file is loaded - check for Swagger Petstore
    await expect(page.locator('text=Swagger Petstore').first()).toBeVisible({ timeout: 15000 })
    console.log('✓ File loaded successfully')

    // Step 2: Open Save As dialog via menu
    // The dialog is mocked via E2E_MOCK_SAVE_FOLDER env variable set at launch
    await page.screenshot({ path: 'test-results/debug-before-menu.png' })

    // Open File menu and click Save As
    const fileMenu = page.locator('text=File').first()
    await fileMenu.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/debug-file-menu-open.png' })
    
    // Click "Save As..." menu item
    const saveAsItem = page.locator('text=Save As').first()
    await saveAsItem.click()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test-results/debug-after-save-as.png' })

    // Step 3: In the Save Options Modal, select Folder mode and YAML format
    // Wait for modal to appear
    await page.waitForSelector('[data-testid="save-options-modal"]', { timeout: 5000 })
    console.log('✓ Save Options modal opened')

    // Select Folder mode from the first SelectBox (using the custom-trigger div)
    const modeSelectTrigger = page.locator('[data-testid="save-mode-group"] .custom-trigger').first()
    await modeSelectTrigger.click()
    await page.waitForTimeout(300)
    // Click on "Folder Structure" option in the dropdown
    await page.locator('[role="option"]:has-text("Folder Structure")').click()
    await page.waitForTimeout(300)
    console.log('✓ Selected Folder mode')

    // Select YAML format - second SelectBox
    const formatSelectTrigger = page.locator('[data-testid="save-format-group"] .custom-trigger').first()
    await formatSelectTrigger.click()
    await page.waitForTimeout(300)
    await page.locator('[role="option"]:has-text("YAML")').click()
    await page.waitForTimeout(300)
    console.log('✓ Selected YAML format')

    // Click Save button in modal - target by role and text
    await page.screenshot({ path: 'test-results/debug-before-save-button.png' })
    const saveBtn = page.locator('.ecu-modal-body [role="button"]:has-text("Save")').first()
    await saveBtn.click()
    await page.waitForTimeout(3000)
    console.log('✓ Save as folder completed')

    // Step 4: Compare structure with reference
    const actualStructure = getDirectoryStructure(tempFolderPath)
    const expectedStructure = getDirectoryStructure(referenceFolderPath)
    
    console.log('Actual structure:', actualStructure.length, 'items')
    console.log('Expected structure:', expectedStructure.length, 'items')

    const comparison = compareDirectoryStructures(actualStructure, expectedStructure)
    
    if (!comparison.match) {
      console.log('Missing files:', comparison.missing)
      console.log('Extra files:', comparison.extra)
    }
    
    expect(comparison.match).toBe(true)
    console.log('✓ Folder structure matches reference')

    // Step 5: Delete "user" folder in Swagger Petstore
    // Now enable the mock for confirmation dialogs
    await electronApp.evaluate(({ dialog }) => {
      // Mock showMessageBox to always confirm (return 0 = first button = Yes/OK)
      dialog.showMessageBox = () => Promise.resolve({
        response: 0,
        checkboxChecked: false
      })
    })
    
    await page.screenshot({ path: 'test-results/debug-before-delete-user.png' })
    
    // Find and expand Swagger Petstore folder to see user folder
    // First, double-click to expand
    const swaggerFolder = page.locator('text=Swagger Petstore').first()
    await swaggerFolder.dblclick()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/debug-after-expand-swagger.png' })

    // Find and right-click on "user" folder
    const userFolder = page.locator('text=user').first()
    await userFolder.click({ button: 'right' })
    await page.waitForTimeout(300)

    // Click Delete in context menu
    await page.screenshot({ path: 'test-results/debug-context-menu.png' })
    await page.click('text=Delete >> visible=true')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/debug-delete-confirm-modal.png' })

    // Confirm deletion - Button component uses <a role="button">, text is "Delete" or "Supprimer"
    const confirmButton = page.locator('[role="button"]:has-text("Delete"), [role="button"]:has-text("Supprimer")').last()
    await confirmButton.click()
    await page.waitForTimeout(500)
    console.log('✓ Deleted user folder')

    // Step 6: Click on "Find pet by ID" request
    // Close search if open (press Escape)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/debug-before-expand-swagger2.png' })
    
    // Re-expand Swagger Petstore if collapsed
    const swaggerItem = page.locator('[role="treeitem"]:has-text("Swagger Petstore")').first()
    const swaggerChevron = swaggerItem.locator('.codicon-chevron-right').first()
    if (await swaggerChevron.isVisible()) {
      await swaggerItem.locator('.list-view-expander').click()
      await page.waitForTimeout(300)
    }
    
    // Now expand "pet" folder 
    // Pet should be the first treeitem with exact text "pet" under Swagger Petstore
    await page.screenshot({ path: 'test-results/debug-before-expand-pet2.png' })
    const petItem = page.locator('[role="treeitem"]').filter({ hasText: /^pet$/ }).first()
    await petItem.locator('.list-view-expander').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/debug-after-expand-pet.png' })

    const findPetRequest = page.locator('text=Find pet by ID').first()
    await findPetRequest.click()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test-results/debug-after-select-findpet.png' })

    // Step 7: Click on the name in breadcrumb to edit it
    // Make sure no modal is open
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/debug-before-breadcrumb-click.png' })
    
    // The breadcrumb shows: Swagger Petstore > pet > Find pet by ID
    // Click on "Find pet by ID" in the breadcrumb nav to edit it
    // Use :visible to only get the visible breadcrumb (there's one per tab)
    const visibleBreadcrumbItem = page.locator('button[aria-current="page"]:visible').first()
    await visibleBreadcrumbItem.click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/debug-after-breadcrumb-click.png' })
    
    // Now an input should be visible
    const breadcrumbInput = page.locator('.ecui-breadcrumb-input:visible')
    await breadcrumbInput.fill('Find pet by ID - modified')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/debug-after-rename.png' })
    console.log('✓ Renamed request to "Find pet by ID - modified"')

    // Step 8: Delete "Updates a pet in the store with form data" request
    await page.screenshot({ path: 'test-results/debug-before-delete-update.png' })
    const updatePetRequest = page.locator('text=Updates a pet').first()
    await updatePetRequest.click({ button: 'right' })
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/debug-context-menu-update.png' })

    // Click Delete in context menu - use role="menuitem" to be more specific
    const deleteMenuItem = page.locator('[role="menuitem"]:has-text("Delete")').first()
    await deleteMenuItem.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/debug-confirm-dialog-update.png' })

    // Confirm deletion - the confirmation modal uses Button component with role="button"
    // Get the visible Delete button (should be in the modal, not in context menu)
    const confirmButton2 = page.locator('.ecu-modal-body [role="button"]:has-text("Delete")').first()
    await confirmButton2.click()
    await page.waitForTimeout(500)
    console.log('✓ Deleted "Updates a pet in the store with form data" request')

    // Step 9: Save with Ctrl+S
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(2000)
    console.log('✓ Saved with Ctrl+S')

    // Step 10: Compare structure with second reference
    const finalStructure = getDirectoryStructure(tempFolderPath)
    const expectedStructure2 = getDirectoryStructure(referenceFolder2Path)
    
    console.log('Final structure:', finalStructure.length, 'items')
    console.log('Expected structure 2:', expectedStructure2.length, 'items')

    const comparison2 = compareDirectoryStructures(finalStructure, expectedStructure2)
    
    if (!comparison2.match) {
      console.log('Missing files:', comparison2.missing)
      console.log('Extra files:', comparison2.extra)
    }
    
    expect(comparison2.match).toBe(true)
    console.log('✓ Final folder structure matches reference 2')
  })
})
