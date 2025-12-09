import { test, expect } from '@playwright/test'

test.describe('Settings Page - VSCode Theme Integration', () => {
  test('should load settings page with VSCode dark theme', async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:5173') // Use the dev server URL
    
    // Wait for the settings editor to be visible
    await page.waitForSelector('.settings-editor', { timeout: 10000 })
    
    // Check that the main structure exists
    const settingsEditor = page.locator('.settings-editor')
    await expect(settingsEditor).toBeVisible()
    
    // Check header
    const header = page.locator('.settings-header')
    await expect(header).toBeVisible()
    
    // Check search input
    const searchInput = page.locator('.settings-search-input')
    await expect(searchInput).toBeVisible()
    
    // Check body
    const body = page.locator('.settings-body')
    await expect(body).toBeVisible()
    
    // Check TOC (tree view)
    const toc = page.locator('.settings-toc-container')
    await expect(toc).toBeVisible()
    
    // Check content area
    const content = page.locator('.settings-editor-content')
    await expect(content).toBeVisible()
    
    // Check that at least one setting item exists
    const settingItems = page.locator('.setting-item')
    const count = await settingItems.count()
    expect(count).toBeGreaterThan(0)
  })
  
  test('should have VSCode CSS variables applied', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForSelector('.settings-editor')
    
    // Check that the data-theme attribute is set
    const htmlElement = page.locator('html')
    const theme = await htmlElement.getAttribute('data-theme')
    expect(theme).toBeTruthy()
    if (theme) {
      expect(['vscode-dark', 'vscode-light', 'vscode-hc-dark', 'vscode-hc-light']).toContain(theme)
    }
    
    // Check that VSCode CSS variables are defined
    const editorBg = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--ecui-editor-background')
    })
    expect(editorBg).toBeTruthy()
    expect(editorBg.trim()).not.toBe('')
  })
  
  test('should allow search functionality', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForSelector('.settings-search-input')
    
    // Type in search
    await page.fill('.settings-search-input', 'language')
    
    // Wait a bit for debounce
    await page.waitForTimeout(500)
    
    // Check that settings are filtered (some items should be hidden)
    const settingItems = page.locator('.setting-item:visible')
    const count = await settingItems.count()
    expect(count).toBeGreaterThan(0)
  })
  
  test('should navigate to category when clicking tree item', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForSelector('.settings-toc-tree')
    
    // Click on a tree item
    const firstTreeItem = page.locator('.settings-tree-item').first()
    await firstTreeItem.click()
    
    // Check that the item is marked as active
    await expect(firstTreeItem).toHaveClass(/active/)
  })
  
  test('should render different control types', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForSelector('.settings-editor-content')
    
    // Check for checkbox (boolean control)
    const checkbox = page.locator('input[type="checkbox"]').first()
    await expect(checkbox).toBeVisible()
    
    // Check for text input (string control)
    const textInput = page.locator('input[type="text"]').first()
    await expect(textInput).toBeVisible()
    
    // Check for select (enum control)
    const select = page.locator('select').first()
    await expect(select).toBeVisible()
  })
  
  test('should show gear icon on setting hover', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForSelector('.setting-item')
    
    const firstSetting = page.locator('.setting-item').first()
    
    // Hover over the setting
    await firstSetting.hover()
    
    // Check that gear icon is visible
    const gearIcon = firstSetting.locator('.setting-item-gear-icon')
    await expect(gearIcon).toBeVisible()
  })
  
  test('should have sticky category headers', async ({ page }) => {
    await page.goto('http://localhost:5173')
    await page.waitForSelector('.settings-group-title-label')
    
    // Check that category header has sticky positioning
    const categoryHeader = page.locator('.settings-group-title-label').first()
    const position = await categoryHeader.evaluate((el) => {
      return window.getComputedStyle(el).position
    })
    expect(position).toBe('sticky')
  })
})

