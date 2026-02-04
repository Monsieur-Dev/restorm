import { createBdd } from 'playwright-bdd'
import {
  defineInputBoxBddSteps,
  defineMarkdownViewerBddSteps,
  defineScrollableElementBddSteps,
  defineSearchBarBddSteps,
  defineTooltipBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openSearchBarE2ETab } from '../fixtures/searchbar.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineSearchBarBddSteps(bdd)

// Reuse internal component steps (SearchBar embeds them).
defineInputBoxBddSteps(bdd)
defineScrollableElementBddSteps(bdd)
defineTooltipBddSteps(bdd)
defineMarkdownViewerBddSteps(bdd)

Given('I open the search bar e2e tab', async ({ page }) => {
  await openSearchBarE2ETab(page)
})

Then('search bar harness last clicked should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('searchbar-last-clicked').innerText()).trim()
  if (text !== expected) throw new Error(`Expected search bar last clicked "${expected}", got "${text}"`)
})

export {}
