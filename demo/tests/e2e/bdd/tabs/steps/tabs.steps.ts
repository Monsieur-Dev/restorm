import { createBdd } from 'playwright-bdd'
import { defineTabsBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openTabsTab } from '../fixtures/tabs.fixture'

const bdd = createBdd()
const { Given } = bdd

defineTabsBddSteps(bdd)

Given('I open the tabs test tab', async ({ page }) => {
  await openTabsTab(page)
})

export {}
