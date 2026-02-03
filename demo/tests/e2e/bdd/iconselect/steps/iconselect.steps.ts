import { createBdd } from 'playwright-bdd'
import {
  defineIconSelectBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openIconSelectE2ETab } from '../fixtures/iconselect.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineIconSelectBddSteps(bdd)

Given('I open the icon select e2e tab', async ({ page }) => {
  await openIconSelectE2ETab(page)
})

Then('icon select harness selected type should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('iconselect-selected-type').innerText()).trim()
  if (text !== expected) throw new Error(`Expected selected type "${expected}", got "${text}"`)
})

Then('icon select harness selected value should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('iconselect-selected-value').innerText()).trim()
  if (text !== expected) throw new Error(`Expected selected value "${expected}", got "${text}"`)
})

Then('icon select harness selected value should not be empty', async ({ page }) => {
  const text = (await page.getByTestId('iconselect-selected-value').innerText()).trim()
  if (text.length === 0) throw new Error('Expected selected value to be non-empty')
})

export {}
