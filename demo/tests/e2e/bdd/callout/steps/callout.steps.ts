import { createBdd } from 'playwright-bdd'
import { defineCalloutBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openCalloutTab } from '../fixtures/callout.fixture'

const bdd = createBdd()
const { Given } = bdd

defineCalloutBddSteps(bdd)

Given('I open the callout tab', async ({ page }) => {
  await openCalloutTab(page)
})
