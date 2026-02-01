import { createBdd } from 'playwright-bdd'
import { defineToggleBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openToggleTab } from '../fixtures/toggle.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineToggleBddSteps(bdd)

Given('I open the toggle tab', async ({ page }) => {
  await openToggleTab(page)
})

Then('toggle change count should be {int}', async ({ page }, expected: number) => {
  const text = await page.getByTestId('toggle-change-count').innerText()
  const n = Number(text.trim())
  if (!Number.isFinite(n) || n !== expected) {
    throw new Error(`Expected change count ${expected}, got "${text.trim()}"`)
  }
})

Then('toggle last change should contain {string}', async ({ page }, expected: string) => {
  const text = await page.getByTestId('toggle-last-change').innerText()
  if (!text.includes(expected)) {
    throw new Error(`Expected last change to contain "${expected}", got "${text}"`)
  }
})

export {}
