import { createBdd } from 'playwright-bdd'
import { defineColorPickerBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openColorPickerTab } from '../fixtures/colorpicker.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineColorPickerBddSteps(bdd)

function normalizeHexForCompare(value: string): string {
  return value.trim().replace(/^#/, '').toLowerCase()
}

Given('I open the color picker tab', async ({ page }) => {
  await openColorPickerTab(page)
})

Then('color picker {string} last change should be {string}', async ({ page }, testId: string, expected: string) => {
  const value = await page.getByTestId(`${testId}-last-change`).innerText()
  if (normalizeHexForCompare(value) !== normalizeHexForCompare(expected)) {
    throw new Error(`Expected "${testId}" last change="${expected}", but got "${value}"`)
  }
})

Then('color picker {string} last change should not be {string}', async ({ page }, testId: string, notExpected: string) => {
  const value = await page.getByTestId(`${testId}-last-change`).innerText()
  if (normalizeHexForCompare(value) === normalizeHexForCompare(notExpected)) {
    throw new Error(`Expected "${testId}" last change to differ from "${notExpected}", but it was the same.`)
  }
})
