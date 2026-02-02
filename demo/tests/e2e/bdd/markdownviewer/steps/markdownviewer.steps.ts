import { createBdd } from 'playwright-bdd'
import { defineMarkdownViewerBddSteps } from 'electron-core-ui/testing/playwright-bdd'
import { openMarkdownViewerTab } from '../fixtures/markdownviewer.fixture'

const bdd = createBdd()
const { Given } = bdd

defineMarkdownViewerBddSteps(bdd)

Given('I open the markdown viewer tab', async ({ page }) => {
  await openMarkdownViewerTab(page)
})

export {}
