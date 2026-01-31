import { createBdd } from 'playwright-bdd'
import { defineContextMenuBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openContextMenuTab } from '../fixtures/contextmenu.fixture'

const bdd = createBdd()
const { Given, When, Then } = bdd

defineContextMenuBddSteps(bdd)

Given('I open the context menu tab', async ({ page }) => {
  await openContextMenuTab(page)
})

When('I open the demo context menu', async ({ page }) => {
  await page.getByTestId('contextmenu-target').click({ button: 'right' })
  await page.getByTestId('contextmenu-main').waitFor({ state: 'visible', timeout: 5000 })
})

When('I click outside the demo context menu', async ({ page }) => {
  await page.getByTestId('contextmenu-outside').click()
})

Then('context menu last action should be {string}', async ({ page }, expected: string) => {
  const value = await page.getByTestId('contextmenu-last-action').innerText()
  if (value.trim() !== expected) {
    throw new Error(`Expected last action="${expected}", but got "${value}"`)
  }
})

Then('context menu last action should not be {string}', async ({ page }, notExpected: string) => {
  const value = await page.getByTestId('contextmenu-last-action').innerText()
  if (value.trim() === notExpected) {
    throw new Error(`Expected last action to differ from "${notExpected}", but it was the same.`)
  }
})
