import { createBdd } from 'playwright-bdd'
import { test, expect } from '../../fixtures/petstore-file.fixture'
import { defineMenuBarBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import {
  searchBarClosedSelector,
  searchBarInputSelector,
  searchBarOpenSelector,
  searchBarRootSelector,
  searchBarResultsSelector,
  searchBarTooltipSelector
} from 'electron-core-ui/testing'

const bdd = createBdd(test)
const { Given, When, Then } = bdd

defineMenuBarBddSteps(bdd)

Given('the file is loaded', async ({ page }) => {
  await page.waitForSelector('[role="treeitem"]', { timeout: 10000 })
})

When('I open the search bar', async ({ page }) => {
  // Titlebar SearchBar is rendered by electron-core-ui Titlebar when showSearchBar=true
  // and uses stable data-testid selectors from electron-core-ui/testing.
  await page.waitForSelector('[data-testid="main-titlebar"]', { timeout: 15000 })
  await page.waitForSelector('[data-testid="main-titlebar-searchbar"]', { timeout: 5000 })

  const searchBarId = 'main-titlebar-searchbar'
  await page.locator(searchBarClosedSelector(searchBarId)).click({ force: true })
  await page.waitForSelector(searchBarOpenSelector(searchBarId), { timeout: 5000 })
})

When('I search for {string}', async ({ page }, query: string) => {
  const searchBarId = 'main-titlebar-searchbar'
  // Clear existing query then type via keyboard to align with electron-core-ui testing behavior
  const input = page.locator(searchBarInputSelector(searchBarId)).first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  for (const ch of query) {
    await page.keyboard.type(ch)
  }
  await page.waitForSelector(`[data-testid="${searchBarId}"][data-results-count]`, { timeout: 5000 })
})

When('I click on the first search result', async ({ page }) => {
  const searchBarId = 'main-titlebar-searchbar'
  const first = page.locator(`${searchBarResultsSelector(searchBarId)} [data-testid^="main-titlebar-searchbar-result-"]`).first()
  await expect(first).toBeVisible({ timeout: 5000 })
  await first.click()
  // Wait for tab to open
  await page.waitForSelector('.tab.active', { timeout: 5000 })
})

When('I hover over the first search result', async ({ page }) => {
  const searchBarId = 'main-titlebar-searchbar'
  const first = page.locator(`${searchBarResultsSelector(searchBarId)} [data-testid^="main-titlebar-searchbar-result-"]`).first()
  await expect(first).toBeVisible({ timeout: 5000 })
  await first.hover()
  await page.waitForSelector('[data-testid="main-titlebar-searchbar-tooltip"]', { timeout: 5000 })
})

Then('I should see search results', async ({ page }) => {
  const searchBarId = 'main-titlebar-searchbar'
  const searchResults = page.locator(`${searchBarResultsSelector(searchBarId)} [data-testid^="main-titlebar-searchbar-result-"]`)
  await expect(searchResults.first()).toBeVisible({ timeout: 5000 })
  const resultCount = await searchResults.count()
  expect(resultCount).toBeGreaterThan(0)
})

Then('the first result should contain {string}', async ({ page }, text: string) => {
  const searchBarId = 'main-titlebar-searchbar'
  const firstResult = page.locator(`${searchBarResultsSelector(searchBarId)} [data-testid^="main-titlebar-searchbar-result-"]`).first()
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
  const tooltip = page.locator(searchBarTooltipSelector('main-titlebar-searchbar'))
  await expect(tooltip).toBeVisible({ timeout: 5000 })
  const tooltipText = await tooltip.textContent()
  expect((tooltipText ?? '').trim().length).toBeGreaterThan(0)
})

When('I wait {int} seconds', async ({ page }, seconds: number) => {
  const delayMs = seconds * 1000
  await page.waitForTimeout(delayMs)
})

Then('the number of results should be {int}', async ({ page }, expectedCount: number) => {
  const searchBarRoot = page.locator(searchBarRootSelector('main-titlebar-searchbar')).first()
  await expect(searchBarRoot).toBeVisible({ timeout: 5000 })
  const raw = await searchBarRoot.getAttribute('data-results-count')
  const actualCount = Number(raw ?? '0')
  expect(actualCount).toBe(expectedCount)
})

Then('I should see no search results', async ({ page }) => {
  const searchBarRoot = page.locator(searchBarRootSelector('main-titlebar-searchbar')).first()
  await expect(searchBarRoot).toBeVisible({ timeout: 5000 })
  const raw = await searchBarRoot.getAttribute('data-results-count')
  const resultCount = Number(raw ?? '0')
  expect(resultCount).toBe(0)
})
