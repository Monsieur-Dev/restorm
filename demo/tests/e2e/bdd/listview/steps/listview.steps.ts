import { createBdd } from 'playwright-bdd'
import { expect } from '@playwright/test'
import {
  defineContextMenuBddSteps,
  defineListViewBddSteps,
  defineScrollableElementBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openListViewE2ETab } from '../fixtures/listview.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineListViewBddSteps(bdd)
defineScrollableElementBddSteps(bdd)
defineContextMenuBddSteps(bdd)

Given('I open the list view e2e tab', async ({ page }) => {
  await openListViewE2ETab(page)
})

Then('list view harness last selection listid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-selection-listid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last selection listid "${expected}", got "${text}"`)
})

Then('list view harness last selection itemid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-selection-itemid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last selection itemid "${expected}", got "${text}"`)
})

Then('list view harness last selection ids should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-selection-ids').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last selection ids "${expected}", got "${text}"`)
})

Then('list view harness last toggle listid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-toggle-listid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last toggle listid "${expected}", got "${text}"`)
})

Then('list view harness last toggle itemid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-toggle-itemid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last toggle itemid "${expected}", got "${text}"`)
})

Then('list view harness last toggle expanded should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-toggle-expanded').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last toggle expanded "${expected}", got "${text}"`)
})

Then('list view harness last rename listid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-rename-listid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last rename listid "${expected}", got "${text}"`)
})

Then('list view harness last rename itemid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-rename-itemid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last rename itemid "${expected}", got "${text}"`)
})

Then('list view harness last rename value should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-rename-value').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last rename value "${expected}", got "${text}"`)
})

Then('list view harness last drop listid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-drop-listid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last drop listid "${expected}", got "${text}"`)
})

Then('list view harness last drop sourceid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-drop-sourceid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last drop sourceid "${expected}", got "${text}"`)
})

Then('list view harness last drop targetid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-drop-targetid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last drop targetid "${expected}", got "${text}"`)
})

Then('list view harness last drop position should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-drop-position').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last drop position "${expected}", got "${text}"`)
})

Then('list view harness last delete listid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-delete-listid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last delete listid "${expected}", got "${text}"`)
})

Then('list view harness last delete itemid should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listview-last-delete-itemid').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last delete itemid "${expected}", got "${text}"`)
})

export {}

// ── Virtualisation ────────────────────────────────────────────────────

Then('list view {string} mounts item {string}', async ({ page }, listId: string, itemId: string) => {
  await expect(page.locator(`[data-testid="${listId}"] .list-view-row[data-item-id="${itemId}"]`)).toBeVisible({ timeout: 5000 })
})

Then('list view {string} does not mount item {string}', async ({ page }, listId: string, itemId: string) => {
  await expect(page.locator(`[data-testid="${listId}"] .list-view-row[data-item-id="${itemId}"]`)).toHaveCount(0, { timeout: 5000 })
})

Then('list view {string} mounts fewer than {int} rows', async ({ page }, listId: string, max: number) => {
  const rows = page.locator(`[data-testid="${listId}"] .list-view-row`)
  await expect.poll(async () => rows.count(), { timeout: 5000 }).toBeLessThan(max)
  expect(await rows.count()).toBeGreaterThan(0)
})

Then('list view {string} scroll height is at least {int}', async ({ page }, listId: string, min: number) => {
  const content = page.locator(`[data-testid="${listId}-scrollable-content"]`)
  await expect.poll(async () => content.evaluate((el) => el.scrollHeight), { timeout: 5000 }).toBeGreaterThanOrEqual(min)
})

When('I scroll list view {string} to the bottom', async ({ page }, listId: string) => {
  const content = page.locator(`[data-testid="${listId}-scrollable-content"]`)
  await content.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.waitForTimeout(300)
})

// ── Follow tail ───────────────────────────────────────────────────────

When('I click the list view harness append button', async ({ page }) => {
  await page.locator('[data-testid="listview-tail-append"]').click()
  await page.waitForTimeout(300)
})

When('I scroll list view {string} to the top', async ({ page }, listId: string) => {
  const content = page.locator(`[data-testid="${listId}-scrollable-content"]`)
  await content.evaluate((el) => { el.scrollTop = 0 })
  await page.waitForTimeout(300)
})

Then('list view {string} is scrolled to the bottom', async ({ page }, listId: string) => {
  const content = page.locator(`[data-testid="${listId}-scrollable-content"]`)
  await expect.poll(async () => content.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop), { timeout: 5000 }).toBeLessThanOrEqual(1)
})

Then('list view {string} is scrolled to the top', async ({ page }, listId: string) => {
  const content = page.locator(`[data-testid="${listId}-scrollable-content"]`)
  await expect.poll(async () => content.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBe(0)
})
