import { createBdd } from 'playwright-bdd'
import { defineButtonBddSteps, defineModalBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openModalE2ETab } from '../fixtures/modal.fixture'

const bdd = createBdd()
const { Given, Then } = bdd

defineModalBddSteps(bdd)
defineButtonBddSteps(bdd)

Given('I open the modal e2e tab', async ({ page }) => {
  await openModalE2ETab(page)
})

Then('modal harness last close should be {string}', async ({ page }, expected: string) => {
  const text = (await page.getByTestId('modal-last-close').innerText()).trim()
  if (text !== expected) throw new Error(`Expected modal last close "${expected}", got "${text}"`)
})

export {}
