import { createBdd } from 'playwright-bdd'
import { defineButtonBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openButtonTab } from '../fixtures/button.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineButtonBddSteps(bdd)

Given('I open the button tab', async ({ page }) => {
  await openButtonTab(page)
})

Then('button {string} click count should be {int}', async ({ page }, testId: string, expected: number) => {
  const value = await page.getByTestId(`${testId}-click-count`).innerText()
  const count = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(count) || count !== expected) {
    throw new Error(`Expected "${testId}" click count=${expected}, but got "${value}"`)
  }
})

Then('button {string} should not be focused', async ({ page }, testId: string) => {
  const isFocused = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)
    if (!el) return false
    const button = el.matches('[role="button"]') ? el : el.querySelector('[role="button"]')
    if (!button) return false
    return document.activeElement === button
  }, testId)

  if (isFocused) {
    throw new Error(`Expected button "${testId}" to not be focused`)
  }
})

Then('dropdown {string} primary click count should be {int}', async ({ page }, testId: string, expected: number) => {
  const value = await page.getByTestId(`${testId}-primary-click-count`).innerText()
  const count = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(count) || count !== expected) {
    throw new Error(`Expected "${testId}" primary click count=${expected}, but got "${value}"`)
  }
})

Then('dropdown {string} last action label should be {string}', async ({ page }, testId: string, expected: string) => {
  const value = await page.getByTestId(`${testId}-action-click-label`).innerText()
  if (value.trim() !== expected) {
    throw new Error(`Expected "${testId}" last action label="${expected}", but got "${value}"`)
  }
})

When('I click outside', async ({ page }) => {
  await page.getByTestId('button-harness-outside').click()
})
