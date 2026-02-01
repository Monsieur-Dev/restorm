import { createBdd } from 'playwright-bdd'
import { defineScrollableElementBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openScrollableElementTab } from '../fixtures/scrollableelement.fixture'

const bdd = createBdd()
const { Given } = bdd

defineScrollableElementBddSteps(bdd)

Given('I open the scrollable element tab', async ({ page }) => {
  await openScrollableElementTab(page)
})

export {}
