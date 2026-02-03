import { createBdd } from 'playwright-bdd'
import { defineSashBddSteps, defineSplitViewBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openSplitViewE2ETab } from '../fixtures/splitview.fixture'

const bdd = createBdd()
const { Given } = bdd

defineSplitViewBddSteps(bdd)
defineSashBddSteps(bdd)

Given('I open the split view e2e tab', async ({ page }) => {
  await openSplitViewE2ETab(page)
})

export {}
