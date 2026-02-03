import { createBdd } from 'playwright-bdd'
import {
  defineScrollableElementBddSteps,
  defineSelectBoxBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openSelectBoxE2ETab } from '../fixtures/selectbox.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineSelectBoxBddSteps(bdd)
defineScrollableElementBddSteps(bdd)

Given('I open the select box e2e tab', async ({ page }) => {
  await openSelectBoxE2ETab(page)
})

Then('select box harness last selected id should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('selectbox-last-selected-id').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last selected id "${expected}", got "${text}"`)
})

Then('select box harness last selected index should be {int}', async ({ page }, expected: number) => {
  const text = (await page.getByTestId('selectbox-last-selected-index').innerText()).trim()
  const n = Number(text)
  if (!Number.isFinite(n) || n !== expected) throw new Error(`Expected last selected index ${expected}, got "${text}"`)
})

Then('select box harness last selected text should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('selectbox-last-selected-text').innerText()).trim()
  if (text !== expected) throw new Error(`Expected last selected text "${expected}", got "${text}"`)
})

export {}
