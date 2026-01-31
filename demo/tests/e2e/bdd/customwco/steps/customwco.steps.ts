import { createBdd } from 'playwright-bdd'
import { defineCustomWcoBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openCustomWcoTab } from '../fixtures/customwco.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineCustomWcoBddSteps(bdd)

Given('I open the custom wco tab', async ({ page }) => {
  await openCustomWcoTab(page)
})

Then('custom wco last action should be {string}', async ({ page }, expected: string) => {
  const value = await page.getByTestId('customwco-last-action').innerText()
  if (value.trim() !== expected) {
    throw new Error(`Expected custom wco last action="${expected}", but got "${value}"`)
  }
})

When('I set demo custom wco window state to {string}', async ({ page }, state: string) => {
  if (state === 'maximized') {
    await page.getByTestId('customwco-set-maximized').click()
    return
  }
  if (state === 'restored') {
    await page.getByTestId('customwco-set-restored').click()
    return
  }
  throw new Error(`Invalid window state "${state}"`)
})
