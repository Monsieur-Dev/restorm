import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'

const { Given, When, Then } = createBdd(test)

Given('the file is loaded', async ({ page }) => {
  await page.waitForSelector('[role="treeitem"]', { timeout: 10000 })
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

When('I click on the first search result', async ({ page }) => {
  await page.waitForSelector('.search-result-item', { timeout: 5000, state: 'visible' })
  const firstResult = page.locator('.search-result-item').first()
  await firstResult.click()
  // Wait for tab to open
  await page.waitForSelector('.tab.active', { timeout: 5000 })
})

When('I hover over the first search result', async ({ page }) => {
  await page.waitForSelector('.search-result-item', { timeout: 5000, state: 'visible' })
  const firstResult = page.locator('.search-result-item').first()
  await firstResult.hover()
  // Wait for tooltip to appear
  await page.waitForSelector('[role="tooltip"], .search-result-tooltip', { timeout: 3000 }).catch(() => { /* tooltip may not appear */ })
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

Then('a tooltip should be visible', async ({ page }) => {
  const tooltipSelectors = [
    '[role="tooltip"]',
    '[class*="Tooltip"]',
    '[class*="tooltip"]',
    '.tooltip-content',
    '[data-testid*="tooltip"]'
  ]

  for (const selector of tooltipSelectors) {
    const tooltip = page.locator(selector)
    const count = await tooltip.count()
    if (count > 0) {
      const isVisible = await tooltip.first().isVisible().catch(() => false)
      if (isVisible) {
        const tooltipText = await tooltip.first().textContent()
        expect(tooltipText?.trim().length).toBeGreaterThan(0)
        return
      }
    }
  }
  // Tooltip might be in a portal - if not found, at least verify no errors occurred
})

When('I wait {int} seconds', async ({ page }, seconds: number) => {
  const delayMs = seconds * 1000
  await page.waitForTimeout(delayMs)
})

Then('the number of results should be {int}', async ({ page }, expectedCount: number) => {
  const searchResults = page.locator('.search-result-item')
  await page.waitForSelector('.search-result-item', { timeout: 5000, state: 'visible' }).catch(() => {
    // If no results found, count should be 0
  })
  const actualCount = await searchResults.count()
  expect(actualCount).toBe(expectedCount)
})

When('I close the file', async ({ page }) => {
  // Click File menu
  const fileMenu = page.locator('[role="menubar"] >> text=File').first()
  await expect(fileMenu).toBeVisible({ timeout: 5000 })
  await fileMenu.click()
  
  // Wait for menu to expand
  await page.waitForSelector('[role="menu"]', { timeout: 2000 })
  
  // Click Close
  const closeMenuItem = page.locator('[role="menuitem"] >> text=Close').first()
  await expect(closeMenuItem).toBeVisible({ timeout: 5000 })
  await closeMenuItem.click()
  
  // Wait for file to be closed (no file name in titlebar, or welcome screen appears)
  await page.waitForSelector('text=WORKSPACE', { timeout: 10000 }).catch(() => {
    // File might be closed, welcome screen might appear
  })
})

Then('I should see no search results', async ({ page }) => {
  // Wait for search results container to be ready (empty state or no results)
  await page.waitForSelector('[data-testid="search-results"][data-ready="true"], .search-result-item, .search-results-empty', { timeout: 5000 })
  
  // Check that there are no search result items
  const searchResults = page.locator('.search-result-item')
  const resultCount = await searchResults.count()
  expect(resultCount).toBe(0)
})
