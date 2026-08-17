import { createBdd } from 'playwright-bdd'
import { copyFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'
import { test, expect, DESIGN_SEARCH_TEMP_DIR } from '../../fixtures/design-search.fixture'

const { Given, When, Then } = createBdd(test)

let page: Page | null = null

const DESIGN_SAMPLE = join(__dirname, '../../../samples/api-design-sample.restorm')
const DESIGN_ID = 'design-petstore'

function requirePage(): Page {
  if (!page) throw new Error('the app has not been launched')
  return page
}

/** Design-category result rows currently listed, filtered by name. */
function designResults(p: Page, name: string): ReturnType<Page['locator']> {
  return p
    .locator('[data-testid="main-titlebar-searchbar-results"] [data-testid^="main-titlebar-searchbar-result-"][data-category="design"]')
    .filter({ hasText: name })
}

Given('a project carrying an API design is open for searching', async ({ launchApp }) => {
  const launched = await launchApp()
  page = launched.page
  const projectPath = join(DESIGN_SEARCH_TEMP_DIR, 'design-search.restorm')
  copyFileSync(DESIGN_SAMPLE, projectPath)
  const p = page
  await p.evaluate(async (path: string) => {
    const w = window as unknown as { restorm?: { file?: { openPath?: (fp: string) => Promise<unknown> } } }
    const fn = w.restorm?.file?.openPath
    if (typeof fn !== 'function') throw new Error('window.restorm.file.openPath is not available')
    await fn(path)
  }, projectPath)
  await expect(p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  // Let the load-time index walk settle before the first query.
  await p.waitForTimeout(1200)
})

When('I search the titlebar for {string}', async ({}, query: string) => {
  const p = requirePage()
  const closed = p.locator('[data-testid="main-titlebar-searchbar-closed"]').first()
  if (await closed.isVisible().catch(() => false)) {
    await closed.click({ force: true })
  }
  const input = p.locator('[data-testid="main-titlebar-searchbar-inputbox-input"]').first()
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.focus()
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Backspace')
  await p.keyboard.type(query)
  await p.waitForSelector('[data-testid="main-titlebar-searchbar"][data-results-count]', { timeout: 5000 })
})

Then('the design category lists a result named {string}', async ({}, name: string) => {
  const p = requirePage()
  // The category header carries the design category's codicon; the row
  // itself is stamped with data-category="design".
  await expect(p.locator('[data-testid="main-titlebar-searchbar-category-design"]')).toBeVisible({ timeout: 5000 })
  await expect(designResults(p, name).first()).toBeVisible({ timeout: 5000 })
})

When('I click the design search result named {string}', async ({}, name: string) => {
  const p = requirePage()
  await designResults(p, name).first().click()
  await p.waitForTimeout(500)
})

Then('the models section opens on the {string} model card', async ({}, name: string) => {
  const p = requirePage()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
  await expect(p.locator('[data-testid="design-model-name"]')).toContainText(name, { timeout: 5000 })
})

When('I rename the {string} model to {string} from the models section', async ({}, from: string, to: string) => {
  const p = requirePage()
  await p.locator(`[data-testid="sidebar-listview"] .list-view-row[data-item-id="${DESIGN_ID}"]`).click()
  await expect(p.locator(`[data-testid="design-tab-view-${DESIGN_ID}"]`)).toBeVisible({ timeout: 10000 })
  await p.locator('[data-testid="design-rail-models"]').click()
  await p.mouse.move(700, 450)
  await expect(p.locator('[data-testid="design-models-section"]')).toBeVisible({ timeout: 5000 })
  await p.locator('[data-testid="design-models-listview"] .list-view-row').filter({ hasText: from }).first().click()
  await expect(p.locator('[data-testid="design-model-name"]')).toContainText(from, { timeout: 5000 })
  await p.locator('[data-testid="design-model-name"]').click()
  const input = p.locator('[data-testid="design-model-name-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(to)
  await input.press('Enter')
  // The reactive DESIGN_UPDATED emit is debounced before it reaches
  // the main-side reindex — give it a beat.
  await p.waitForTimeout(1500)
})
