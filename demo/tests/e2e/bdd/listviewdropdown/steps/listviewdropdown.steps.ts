import { createBdd } from 'playwright-bdd'
import {
  defineButtonBddSteps,
  defineListViewBddSteps,
  defineListViewDropdownBddSteps,
  defineScrollableElementBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openListViewDropdownE2ETab } from '../fixtures/listviewdropdown.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineListViewDropdownBddSteps(bdd)

// Reuse internal component steps (ListViewDropdown embeds them).
defineButtonBddSteps(bdd)
defineScrollableElementBddSteps(bdd)
defineListViewBddSteps(bdd)

Given('I open the list view dropdown e2e tab', async ({ page }) => {
  await openListViewDropdownE2ETab(page)
})

Then('list view dropdown harness last clicked should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('listviewdropdown-last-clicked').innerText()).trim()
  if (text !== expected) throw new Error(`Expected list view dropdown last clicked "${expected}", got "${text}"`)
})

export {}
