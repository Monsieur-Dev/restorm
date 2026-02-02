import { createBdd } from 'playwright-bdd'
import {
  defineMenuBarBddSteps,
  defineScrollableElementBddSteps
} from 'electron-core-ui/testing/playwright-bdd'
import { openMenuBarE2ETab } from '../fixtures/menubar.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineMenuBarBddSteps(bdd)
defineScrollableElementBddSteps(bdd)

Given('I open the menubar e2e tab', async ({ page }) => {
  await openMenuBarE2ETab(page)
})

Then('menubar action count should be {int}', async ({ page }, expected: number) => {
  const text = await page.getByTestId('menubar-action-count').innerText()
  const actual = Number(text.trim())
  if (actual !== expected) {
    throw new Error(`Expected menubar action count=${expected}, got ${actual}`)
  }
})

Then('menubar last action should be {string}', async ({ page }, expected: string) => {
  const text = await page.getByTestId('menubar-last-action').innerText()
  if (text.trim() !== expected) {
    throw new Error(`Expected menubar last action="${expected}", got "${text}"`)
  }
})

Then('menubar autosave enabled should be {string}', async ({ page }, expected: string) => {
  const text = await page.getByTestId('menubar-autosave-enabled').innerText()
  if (text.trim() !== expected) {
    throw new Error(`Expected menubar autosave enabled="${expected}", got "${text}"`)
  }
})

export {}
