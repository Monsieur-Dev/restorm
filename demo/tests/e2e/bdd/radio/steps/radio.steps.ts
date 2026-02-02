import { createBdd } from 'playwright-bdd'
import { defineRadioBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openRadioTab } from '../fixtures/radio.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineRadioBddSteps(bdd)

Given('I open the radio tab', async ({ page }) => {
  await openRadioTab(page)
})

Then('radio select count should be {int}', async ({ page }, expected: number) => {
  const text = await page.getByTestId('radio-select-count').innerText()
  const n = Number(text.trim())
  if (!Number.isFinite(n) || n !== expected) {
    throw new Error(`Expected select count ${expected}, got "${text.trim()}"`)
  }
})

Then('radio last select should contain {string}', async ({ page }, expected: string) => {
  const text = await page.getByTestId('radio-last-select').innerText()
  if (!text.includes(expected)) {
    throw new Error(`Expected last select to contain "${expected}", got "${text}"`)
  }
})

export {}
