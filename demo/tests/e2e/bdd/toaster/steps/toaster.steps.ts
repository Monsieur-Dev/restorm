import { createBdd } from 'playwright-bdd'
import { defineToasterBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openToasterTab } from '../fixtures/toaster.fixture'

const bdd = createBdd()
const { Given, When } = bdd

defineToasterBddSteps(bdd)

Given('I open the toaster tab', async ({ page }) => {
  await openToasterTab(page)
})

When('I click {string}', async ({ page }, testId: string) => {
  await page.getByTestId(testId).click()
})

When('I fill toaster title {string}', async ({ page }, value: string) => {
  await page.getByTestId('toaster-input-title').fill(value)
})

When('I fill toaster body {string}', async ({ page }, value: string) => {
  await page.getByTestId('toaster-input-body').fill(value)
})

When('I fill toaster duration {string}', async ({ page }, value: string) => {
  await page.getByTestId('toaster-input-duration').fill(value)
})

export {}
