import { createBdd } from 'playwright-bdd'
import {
  defineCustomWcoBddSteps,
  defineSearchBarBddSteps,
  defineTitlebarBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openTitlebarE2ETab } from '../fixtures/titlebar.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineTitlebarBddSteps(bdd)

// Reuse internal component steps.
defineSearchBarBddSteps(bdd)
defineCustomWcoBddSteps(bdd)

Given('I open the titlebar e2e tab', async ({ page }) => {
  await openTitlebarE2ETab(page)
})

When('I set titlebar show search bar to {string}', async ({ page }, enabled: string) => {
  const shouldEnable = enabled === 'true'
  const locator = page.getByTestId('titlebar-show-searchbar')
  if (shouldEnable) {
    await locator.check()
  } else {
    await locator.uncheck()
  }
})

Then('titlebar harness last clicked should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('titlebar-last-clicked').innerText()).trim()
  if (text !== expected) throw new Error(`Expected titlebar last clicked "${expected}", got "${text}"`)
})

export {}
