import { createBdd } from 'playwright-bdd'
import { defineTooltipBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openTooltipTab } from '../fixtures/tooltip.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineTooltipBddSteps(bdd)

Given('I open the tooltip tab', async ({ page }) => {
  await openTooltipTab(page)
})

When('I click {string}', async ({ page }, testId: string) => {
  await page.getByTestId(testId).click()
})

When('I set tooltip placement to {string}', async ({ page }, placement: string) => {
  await page.getByTestId('tooltip-placement').selectOption(placement)
})

When('I set tooltip side to {string}', async ({ page }, side: string) => {
  await page.getByTestId('tooltip-side').selectOption(side)
})

When('I enable tooltip fixedTop with value {int}', async ({ page }, top: number) => {
  await page.getByTestId('tooltip-fixed-top-enabled').check()
  await page.getByTestId('tooltip-fixed-top-value').fill(String(top))
})

Then('tooltip active target should be {string}', async ({ page }, expected: string) => {
  const text = await page.getByTestId('tooltip-active-target').innerText()
  if (text.trim() !== expected) {
    throw new Error(`Expected active target "${expected}", got "${text.trim()}"`)
  }
})

export {}
