import { createBdd } from 'playwright-bdd'
import { defineProgressBarBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openProgressBarTab } from '../fixtures/progressbar.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineProgressBarBddSteps(bdd)

Given('I open the progress bar tab', async ({ page }) => {
  await openProgressBarTab(page)
})

When('I click progress bar button {string}', async ({ page }, testId: string) => {
  await page.getByTestId(testId).click()
})

Then('progress bar onComplete count should be {int}', async ({ page }, expected: number) => {
  const text = await page.getByTestId('progressbar-on-complete-count').innerText()
  const n = Number(text.trim())
  if (!Number.isFinite(n) || n !== expected) {
    throw new Error(`Expected onComplete count ${expected}, got "${text.trim()}"`)
  }
})

Then('progress bar last complete should be {string}', async ({ page }, expected: string) => {
  const text = await page.getByTestId('progressbar-last-complete').innerText()
  if (text.trim() !== expected) {
    throw new Error(`Expected last complete "${expected}", got "${text.trim()}"`)
  }
})

export {}
