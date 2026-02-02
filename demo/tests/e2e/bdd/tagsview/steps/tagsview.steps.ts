import { createBdd } from 'playwright-bdd'
import {
  defineContextMenuBddSteps,
  defineTagsViewBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openTagsViewE2ETab } from '../fixtures/tagsview.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineTagsViewBddSteps(bdd)
defineContextMenuBddSteps(bdd)

Given('I open the tags view e2e tab', async ({ page }) => {
  await openTagsViewE2ETab(page)
})

Then('tags view tags json should be {string}', async ({ page }, expected: string) => {
  const text = await page.getByTestId('tagsview-tags-json').innerText()
  if (text.trim() !== expected) {
    throw new Error(`Expected tags json="${expected}", got "${text}"`)
  }
})

export {}
