import { createBdd } from 'playwright-bdd'
import {
  defineContextMenuBddSteps,
  defineListViewBddSteps,
  defineScrollableElementBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openListViewE2ETab } from '../fixtures/listview.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

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
